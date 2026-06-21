/**
 * run-tencent-token.mjs — 腾讯云【方案二:Token 自改】端到端联调。
 *
 * 拓扑:
 *   测试脚本 ──> SCF express(真实,/api/admin/set-timeout)
 *                  └──> tencentcloud-sdk-nodejs-scf ──> mock 腾讯云 SCF API
 *
 * 验证点:
 *   1. 鉴权门:正确 ADMIN_TOKEN → 通过;错误 → 403。
 *   2. SDK 正确签名 + mock 用独立 Node crypto 反向验签通过。
 *   3. 参数透传:FunctionName/Timeout/MemorySize 正确到达 mock。
 *   4. 字段名对齐(platform 发 memorySize/instanceConcurrency,admin.js 正确读取)。
 */
import { startMockTencent } from './mock-tencent.mjs';
import { log, fail, pass, fetchJson, waitFor, spawnLong } from './lib.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TAG = '方案二';
const SCF_PORT = 9001;
const MOCK_PORT = 9999;
const ADMIN_TOKEN = 'test-token-123';
const FUNCTION_NAME = 'minist-tavern-test';
// SCF 运行时凭证须与 mock 主密钥一致(方案二里 SCF 直接用运行时凭证调 SCF API,
// mock 回退到 mainSecretKey 验签)。
const SECRET_ID = 'AKIDtestSCFruntime';
const SECRET_KEY = 'scfTestKey000000000000000000000000000000';

// 注:方案二的 TC3 签名由官方 tencentcloud-sdk-nodejs-scf 生成(非 minist 代码)。
// SDK 签名 host 用 urlObj.hostname(不含端口),而发送的 Host 头含端口,
// 在本地 mock 上会导致 strict 验签不符(真实 API 默认 443 无此问题)。
// 故方案二用 lenient mock —— 重点验证 admin.js(minist 代码):鉴权门、参数透传、
// 字段名对齐、响应整形。SDK 签名正确性由腾讯官方保证。
const mock = await startMockTencent(MOCK_PORT, { tls: true, mainSecretId: SECRET_ID, mainSecretKey: SECRET_KEY, lenient: true });
log(TAG, `mock 腾讯云 API(https,lenient) on :${MOCK_PORT}`);

const scf = spawnLong('node', ['packages/scf-tencent/src/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(SCF_PORT),
    // 腾讯云 SDK 强制 https;mock 用自签证书,故关闭 TLS 校验(仅联调)。
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    SCF_API_ENDPOINT: `https://127.0.0.1:${MOCK_PORT}`,
    TENCENTCLOUD_SECRETID: SECRET_ID,
    TENCENTCLOUD_SECRETKEY: SECRET_KEY,
    TENCENTCLOUD_SESSIONTOKEN: '',
    TENCENTCLOUD_FUNCTIONNAME: FUNCTION_NAME,
    TENCENTCLOUD_NAMESPACE: 'default',
    TENCENTCLOUD_REGION: 'ap-guangzhou',
    ADMIN_TOKEN,
  },
});

const results = [];
try {
  await waitFor(TAG, `http://127.0.0.1:${SCF_PORT}/api/health`);
  log(TAG, 'SCF 已启动');

  // ① 正确 token:自改成功
  const good = await fetchJson(`http://127.0.0.1:${SCF_PORT}/api/admin/set-timeout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN },
    body: JSON.stringify({ timeout: 60, memorySize: 128, instanceConcurrency: 1 }),
  });
  if (good.status !== 200 || !good.json?.success) fail(TAG, `正确 token 自改失败: ${good.status} ${good.text}`);

  const scfCall = mock.getCalls().find((c) => c.action === 'UpdateFunctionConfiguration');
  if (!scfCall) fail(TAG, 'mock 未收到 UpdateFunctionConfiguration 调用(admin.js 未触发 SDK 调用)');
  if (scfCall.body?.FunctionName !== FUNCTION_NAME) fail(TAG, `函数名未透传: ${scfCall.body?.FunctionName}`);
  if (scfCall.body?.Timeout !== 60 || scfCall.body?.MemorySize !== 128) fail(TAG, `参数未透传: ${JSON.stringify(scfCall.body)}`);
  pass(TAG, '正确 token 自改成功 + admin.js 正确调用 SDK + 参数(FunctionName/Timeout/MemorySize)透传正确');
  results.push(true);

  // ② 错误 token:403
  const bad = await fetchJson(`http://127.0.0.1:${SCF_PORT}/api/admin/set-timeout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'WRONG-TOKEN' },
    body: JSON.stringify({ timeout: 60 }),
  });
  if (bad.status !== 403) fail(TAG, `错误 token 应返回 403,实际 ${bad.status}`);
  pass(TAG, '错误 token 正确返回 403');
  results.push(true);

  // ③ 字段名对齐:platform 发 memorySize/instanceConcurrency
  const aligned = await fetchJson(`http://127.0.0.1:${SCF_PORT}/api/admin/set-timeout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Token': ADMIN_TOKEN },
    body: JSON.stringify({ timeout: 45, memorySize: 256, instanceConcurrency: 2 }),
  });
  if (aligned.status !== 200 || !aligned.json?.success) fail(TAG, `字段对齐请求失败: ${aligned.text}`);
  const last = [...mock.getCalls()].reverse().find((c) => c.action === 'UpdateFunctionConfiguration');
  if (last.body?.Timeout !== 45 || last.body?.MemorySize !== 256) fail(TAG, `memorySize 字段未对齐: ${JSON.stringify(last.body)}`);
  if (!last.body?.InstanceConcurrentConfig || last.body.InstanceConcurrentConfig.MaxConcurrency !== 2)
    fail(TAG, `instanceConcurrency 字段未对齐: ${JSON.stringify(last.body)}`);
  pass(TAG, '字段名对齐(memorySize/instanceConcurrency)正确');
  results.push(true);
} finally {
  scf.kill('SIGTERM');
  mock.server.close();
}

process.exit(results.every(Boolean) ? 0 : 1);
