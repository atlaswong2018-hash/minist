/**
 * run-batch.mjs — 运营方【跨账号批量管理】端到端联调(STS AssumeRole 正确姿势)。
 *
 * 拓扑:
 *   测试脚本 ──> CF Worker(真实,/api/admin/batch-scf,OPERATOR_TOKEN 鉴权)
 *                  └──> 对每个外部账号:assumeRole(uin,role) → 临时凭证 → SCF List/Update
 *                         全部打到 mock 腾讯云 API(strict 验签)
 *
 * 验证点:
 *   1. 鉴权门:无/错 OPERATOR_TOKEN → 403;未配置 → 503。
 *   2. AssumeRole:用平台主密钥签名(service=sts),mock 独立验签通过,签发临时凭证。
 *   3. ListFunctions:用临时凭证签名(service=scf),mock 验签通过,返回函数列表。
 *   4. 全量自锁:set-config 不指定函数 → 先 List 再对每个函数 UpdateFunctionConfiguration。
 *   5. 多账号循环:2 个账号各自 AssumeRole+List,结果聚合。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockTencent } from './mock-tencent.mjs';
import { log, fail, pass, fetchJson, waitFor, spawnLong } from './lib.mjs';

const TAG = '批量管理';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'packages', 'worker-cloudflare');
const WORKER_PORT = 8787;
const MOCK_PORT = 9999;
const OPERATOR_TOKEN = 'op-test-token-xyz';

const TEST_ID = 'AKIDtestBATCHmain000000000000000000';
const TEST_KEY = 'testBATCHmainKey000000000000000000000';

const mock = await startMockTencent(MOCK_PORT, { mainSecretId: TEST_ID, mainSecretKey: TEST_KEY });
log(TAG, `mock 腾讯云 API(http,strict) on :${MOCK_PORT}`);

const wrangler = spawnLong(
  'npx',
  [
    'wrangler', 'dev', '-c', 'wrangler.test.toml', '--local',
    '--port', String(WORKER_PORT), '--ip', '127.0.0.1',
    '--var', `TENCENT_API_BASE:http://127.0.0.1:${MOCK_PORT}`,
    '--var', `TENCENT_SECRET_ID:${TEST_ID}`,
    '--var', `TENCENT_SECRET_KEY:${TEST_KEY}`,
    '--var', `OPERATOR_TOKEN:${OPERATOR_TOKEN}`,
  ],
  { cwd: WORKER_DIR, env: { ...process.env, CLOUDFLARE_TELEMETRY_DISABLED: '1', CI: '1' } },
);

const base = `http://127.0.0.1:${WORKER_PORT}`;
const results = [];
try {
  await waitFor(TAG, `${base}/api/health`, 30000);
  log(TAG, 'Worker 已启动');

  // ① 鉴权门:错误 token → 403
  const bad = await fetchJson(`${base}/api/admin/batch-scf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Operator-Token': 'WRONG' },
    body: JSON.stringify({ accounts: [{ uin: '1', roleName: 'R' }], operation: 'list' }),
  });
  if (bad.status !== 403) fail(TAG, `错误 token 应 403,实际 ${bad.status}`);
  pass(TAG, 'OPERATOR_TOKEN 鉴权门正确(错误 token → 403)');
  results.push(true);

  // ② 批量 list(2 个账号)
  const accounts = [
    { uin: '100000000001', roleName: 'SCFManagerRole', owner: '客户A' },
    { uin: '100000000002', roleName: 'SCFManagerRole', owner: '客户B' },
  ];
  const list = await fetchJson(`${base}/api/admin/batch-scf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Operator-Token': OPERATOR_TOKEN },
    body: JSON.stringify({ accounts, operation: 'list', region: 'ap-guangzhou' }),
  });
  if (list.status !== 200 || !list.json?.success) fail(TAG, `batch list 失败: ${list.status} ${list.text}`);
  const listData = list.json.data;
  if (listData.count !== 2) fail(TAG, `结果数应为 2,实际 ${listData.count}`);
  for (const row of listData.results) {
    if (!row.assumeRole || !row.ok) fail(TAG, `账号 ${row.uin} assumeRole/ok 异常: ${JSON.stringify(row)}`);
    const fns = row.data?.Functions;
    if (!Array.isArray(fns) || fns.length === 0) fail(TAG, `账号 ${row.uin} 未返回函数列表`);
  }
  pass(TAG, `batch list 正确(2 账号 × AssumeRole+ListFunctions,各返回 ${listData.results[0].data.Functions.length} 个函数)`);
  results.push(true);

  // ③ strict 验签:AssumeRole 用主密钥(sts)、ListFunctions 用临时密钥(scf)
  const calls = mock.getCalls();
  const assumeCalls = calls.filter((c) => c.action === 'AssumeRole');
  const listCalls = calls.filter((c) => c.action === 'ListFunctions');
  if (assumeCalls.length < 2) fail(TAG, `AssumeRole 调用数 ${assumeCalls.length} < 2`);
  if (assumeCalls.some((c) => !c.sigOk)) fail(TAG, 'AssumeRole strict 验签失败(主密钥签名未被独立 Node crypto 验证)');
  if (assumeCalls.some((c) => c.service !== 'sts')) fail(TAG, 'AssumeRole service 应为 sts');
  if (listCalls.length < 2) fail(TAG, `ListFunctions 调用数 ${listCalls.length} < 2`);
  if (listCalls.some((c) => !c.sigOk)) fail(TAG, 'ListFunctions strict 验签失败(临时密钥签名未被验证)');
  // 临时凭证链路:ListFunctions 的 SecretId 必须是 AssumeRole 签发的临时 id(非主密钥 id)
  if (listCalls.some((c) => c.credSecretId === TEST_ID)) fail(TAG, 'ListFunctions 仍用主密钥,未切换到 AssumeRole 临时凭证');
  pass(TAG, 'strict 验签通过:AssumeRole(主密钥/sts) + ListFunctions(临时密钥/scf),临时凭证链路正确');
  results.push(true);

  // ④ 全量自锁:set-config 不指定函数 → List 后对每个函数 Update
  const before = mock.getCalls().length;
  const setcfg = await fetchJson(`${base}/api/admin/batch-scf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Operator-Token': OPERATOR_TOKEN },
    body: JSON.stringify({
      accounts: [{ uin: '100000000003', roleName: 'SCFManagerRole', owner: '客户C' }],
      operation: 'set-config',
      timeout: 60,
      memorySize: 128,
    }),
  });
  if (setcfg.status !== 200 || !setcfg.json?.success) fail(TAG, `set-config 失败: ${setcfg.text}`);
  const row3 = setcfg.json.data.results[0];
  if (!row3.functions || !Array.isArray(row3.functions) || row3.functions.length === 0)
    fail(TAG, `全量自锁未逐函数处理: ${JSON.stringify(row3)}`);
  if (!row3.functions.every((f) => f.ok)) fail(TAG, `部分函数自锁失败: ${JSON.stringify(row3.functions)}`);
  const updatesAfter = mock.getCalls().filter((c) => c.action === 'UpdateFunctionConfiguration').length;
  if (row3.functions.length < 1) fail(TAG, '应至少自锁 1 个函数');
  pass(TAG, `全量自锁正确(set-config 未指定函数 → List + 对 ${row3.functions.length} 个函数逐个 Update,全部成功)`);
  results.push(true);
} finally {
  wrangler.kill('SIGTERM');
  mock.server.close();
}

process.exit(results.every(Boolean) ? 0 : 1);
