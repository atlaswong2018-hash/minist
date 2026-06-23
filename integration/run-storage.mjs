/**
 * run-storage.mjs — 分层存储 S1~S5 的 CF Worker 后端端到端联调。
 *
 * 拓扑:测试脚本 → wrangler dev(本地 miniflare KV/D1/R2,无需真实云凭证)。
 * 验证:
 *   S1/S4 资产:PUT /api/r2/cards/<sha>.<ext>、HEAD(去重探测 200/404)、GET 往返。
 *   S3 同步 per-card:listCards(空)→ putCard×2 → getCard → listCards(含)→ deleteCard → 404。
 *   S3 同步非角色数据:POST /api/sync(characters=[])→ GET /api/sync/:uid(characters=[],worldinfo/chats 往返)。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { log, pass, fetchJson, waitFor, spawnLong, summarize } from './lib.mjs';

const TAG = '存储E2E';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'packages', 'worker-cloudflare');
const PORT = 8787;
const base = `http://127.0.0.1:${PORT}`;
const UID = 'e2e-' + Math.random().toString(36).slice(2, 10);

const wrangler = spawnLong('npx', [
  'wrangler', 'dev', '-c', 'wrangler.test.toml', '--local',
  '--port', String(PORT), '--ip', '127.0.0.1',
], { cwd: WORKER_DIR, env: { ...process.env, CLOUDFLARE_TELEMETRY_DISABLED: '1', CI: '1' } });

const results = [];
let hadFail = false;
function check(label, cond) {
  if (cond) { pass(TAG, label); results.push(true); }
  else { console.error(`[${TAG}] ❌ FAIL: ${label}`); results.push(false); hadFail = true; }
}

try {
  log(TAG, `等待 wrangler dev :${PORT} 就绪...`);
  await waitFor(TAG, `${base}/api/health`, 45000);
  pass(TAG, 'worker 就绪');

  // ── S1/S4 资产路由 ──
  const assetKey = 'cards/e2esha256.png';
  const assetBody = 'fake-png-bytes-测试-1234';

  let r = await fetchJson(`${base}/api/r2/${assetKey}`, {
    method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: assetBody,
  });
  check('S1 资产 PUT 上传 → 200', r.status === 200);

  r = await fetchJson(`${base}/api/r2/${assetKey}`, { method: 'HEAD' });
  check('S4 资产 HEAD 已存在 → 200(去重探测)', r.status === 200);

  r = await fetchJson(`${base}/api/r2/cards/nonexistent.png`, { method: 'HEAD' });
  check('S4 资产 HEAD 不存在 → 404', r.status === 404);

  r = await fetchJson(`${base}/api/r2/${assetKey}`);
  check('S1 资产 GET → 200 且内容往返一致', r.status === 200 && r.text === assetBody);

  // ── S3 同步 per-card CRUD ──
  r = await fetchJson(`${base}/api/sync/cards/${UID}`);
  check('S3 listCards 初始为空', r.ok && (r.json?.data?.ids ?? []).length === 0);

  const card1 = JSON.stringify({ id: 'c1', card: { data: { name: 'A' } }, updatedAt: 1 });
  const card2 = JSON.stringify({ id: 'c2', card: { data: { name: 'B' } }, updatedAt: 2 });
  r = await fetchJson(`${base}/api/sync/card/${UID}/c1`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: card1 });
  check('S3 putCard c1 → 200', r.status === 200);
  r = await fetchJson(`${base}/api/sync/card/${UID}/c2`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: card2 });
  check('S3 putCard c2 → 200', r.status === 200);

  r = await fetchJson(`${base}/api/sync/card/${UID}/c1`);
  check('S3 getCard c1 返回上传内容', r.ok && r.json?.data?.data === card1);

  r = await fetchJson(`${base}/api/sync/cards/${UID}`);
  {
    const ids = r.json?.data?.ids ?? [];
    check('S3 listCards 含 c1,c2', r.ok && ids.length === 2 && ids.includes('c1') && ids.includes('c2'));
  }

  r = await fetchJson(`${base}/api/sync/card/${UID}/c1`, { method: 'DELETE' });
  check('S3 deleteCard c1 → 200', r.status === 200);

  r = await fetchJson(`${base}/api/sync/card/${UID}/c1`);
  check('S3 getCard c1 删除后 → 404', r.status === 404);

  r = await fetchJson(`${base}/api/sync/cards/${UID}`);
  {
    const ids = r.json?.data?.ids ?? [];
    check('S3 listCards 删除后仅剩 c2', r.ok && ids.includes('c2') && !ids.includes('c1'));
  }

  // ── S3 同步非角色数据(characters 走粒度,不在此)──
  const payload = {
    version: 1, exportedAt: 123, userId: UID,
    characters: [],
    worldinfo: [{ uid: 1, content: 'WI测试' }],
    chats: [{ role: 'user', content: 'hi', ts: 1 }],
    presets: [], config: { model: 'test-model' },
  };
  r = await fetchJson(`${base}/api/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  check('S3 sync POST 非角色数据 → 200', r.ok);

  r = await fetchJson(`${base}/api/sync/${UID}`);
  {
    const p = r.json?.data;
    check('S3 sync GET characters=[](角色走粒度路由)', r.ok && (p?.characters ?? []).length === 0);
    check('S3 sync GET worldinfo 往返一致', r.ok && (p?.worldinfo ?? []).length === 1 && p.worldinfo[0]?.content === 'WI测试');
    check('S3 sync GET chats 往返一致', r.ok && (p?.chats ?? []).length === 1);
  }

  summarize(TAG, results);
} catch (e) {
  console.error(`[${TAG}] ❌ 异常: ${e?.stack || e}`);
  hadFail = true;
} finally {
  wrangler.kill('SIGTERM');
  // SIGTERM 父进程不一定带走 workerd/miniflare 子进程,补一刀(正则避免自匹配)
  try { execSync('pkill -9 -f "[w]orkerd" || true', { stdio: 'ignore' }); } catch { /* ignore */ }
  setTimeout(() => process.exit(hadFail ? 1 : 0), 800);
}
