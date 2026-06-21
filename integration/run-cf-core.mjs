/**
 * run-cf-core.mjs — Cloudflare Worker【核心路径】端到端联调。
 *
 * 拓扑:
 *   测试脚本 ──> CF Worker(真实,wrangler dev 本地 miniflare,带 KV/D1/R2 绑定)
 *                  ├──> mock LLM(SSE 流式,/v1/chat/completions)
 *                  └──> 本地 KV/D1/R2(miniflare state)
 *
 * 验证点:
 *   1. KV 存储:POST /api/storage/:key + GET 往返。
 *   2. 全量同步:POST /api/sync(拆分 KV+D1)+ GET /api/sync/:userId 组装还原(characters + chats)。
 *   3. 流式中转:/v1/chat/completions 透传 mock LLM 的 SSE,逐 token 接收 + [DONE]。
 *   4. 混淆协议:X-Crypto-Data:true 时 Worker 解 Base64 请求体后转发,流式原样回写。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockLlm } from './mock-llm.mjs';
import { log, fail, pass, fetchJson, waitFor, spawnLong } from './lib.mjs';

const TAG = 'CF核心';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'packages', 'worker-cloudflare');
const WORKER_PORT = 8787;
const LLM_PORT = 9911;

const llm = await startMockLlm(LLM_PORT);
log(TAG, `mock LLM on :${LLM_PORT}`);

const wrangler = spawnLong(
  'npx',
  [
    'wrangler', 'dev', '-c', 'wrangler.test.toml', '--local',
    '--port', String(WORKER_PORT), '--ip', '127.0.0.1',
    '--var', `DEFAULT_LLM_URL:http://127.0.0.1:${LLM_PORT}/v1/chat/completions`,
  ],
  { cwd: WORKER_DIR, env: { ...process.env, CLOUDFLARE_TELEMETRY_DISABLED: '1', CI: '1' } },
);

const base = `http://127.0.0.1:${WORKER_PORT}`;
const results = [];

/** 从 SSE 流中收集 token 内容,返回数组与是否见到 [DONE]。 */
async function collectSse(resp) {
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const tokens = [];
  let done = false;
  for (;;) {
    const { value, done: rdone } = await reader.read();
    if (rdone) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') { done = true; continue; }
      try {
        const chunk = JSON.parse(payload);
        const t = chunk.choices?.[0]?.delta?.content;
        if (t) tokens.push(t);
      } catch { /* ignore */ }
    }
  }
  return { tokens, done };
}

try {
  await waitFor(TAG, `${base}/api/health`, 30000);
  log(TAG, 'Worker 已启动');

  // ① KV 存储往返
  const put = await fetch(`${base}/api/storage/hello`, { method: 'POST', body: 'world' });
  if (!put.ok) fail(TAG, `KV POST 失败: ${put.status}`);
  const get = await fetchJson(`${base}/api/storage/hello`);
  if (get.json?.data?.value !== 'world') fail(TAG, `KV GET 往返不符: ${get.text}`);
  pass(TAG, 'KV 存储(/api/storage/:key)POST+GET 往返正确');
  results.push(true);

  // ② 全量同步往返(KV + D1 拆分)
  const payload = {
    version: 1,
    exportedAt: 1700000000000,
    userId: 'u-cf-test',
    characters: [{ name: '小满' }, { name: '阿白' }],
    chats: [{ role: 'user', content: '你好', ts: 1700000000001 }, { role: 'assistant', content: '嗨', ts: 1700000000002 }],
    worldinfo: [{ uid: 1, content: 'w1' }],
    presets: [],
  };
  const up = await fetchJson(`${base}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (up.status !== 200 || !up.json?.success) fail(TAG, `sync 上传失败: ${up.status} ${up.text}`);
  const down = await fetchJson(`${base}/api/sync/u-cf-test`);
  const d = down.json?.data;
  if (!d) fail(TAG, `sync 拉取无数据: ${down.text}`);
  if (JSON.stringify(d.characters) !== JSON.stringify(payload.characters)) fail(TAG, `characters 还原不符: ${JSON.stringify(d.characters)}`);
  if (d.chats.length !== 2 || d.chats[0].content !== '你好' || d.chats[1].content !== '嗨')
    fail(TAG, `chats(D1)还原不符: ${JSON.stringify(d.chats)}`);
  pass(TAG, '全量同步往返正确(characters→KV,chats→D1,组装还原一致)');
  results.push(true);

  // ③ 流式中转
  const sresp = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key' },
    body: JSON.stringify({ model: 'mock', messages: [{ role: 'user', content: 'hi' }], stream: true }),
  });
  if (!sresp.ok) fail(TAG, `completions 流式请求失败: ${sresp.status}`);
  const sse = await collectSse(sresp);
  if (sse.tokens.length < 3) fail(TAG, `流式 token 过少(${sse.tokens.length}):${sse.tokens.join('')}`);
  if (!sse.done) fail(TAG, '未收到 [DONE]');
  pass(TAG, `流式中转正确(收到 ${sse.tokens.length} 个 token + [DONE]):「${sse.tokens.join('')}」`);
  results.push(true);

  // ④ 混淆协议(请求侧解 Base64)
  const plainBody = JSON.stringify({ model: 'mock', messages: [{ role: 'user', content: 'hi' }], stream: true });
  const cryptoResp = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer test-key', 'X-Crypto-Data': 'true' },
    body: Buffer.from(plainBody).toString('base64'),
  });
  if (!cryptoResp.ok) fail(TAG, `混淆流式请求失败: ${cryptoResp.status}`);
  const csse = await collectSse(cryptoResp);
  if (csse.tokens.length < 3) fail(TAG, `混淆流式 token 过少:${csse.tokens.join('')}`);
  pass(TAG, `X-Crypto-Data 混淆协议正确(Worker 解 Base64 请求体后转发,流式回写 ${csse.tokens.length} token)`);
  results.push(true);
} finally {
  wrangler.kill('SIGTERM');
  llm.server.close();
}

process.exit(results.every(Boolean) ? 0 : 1);
