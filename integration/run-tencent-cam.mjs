/**
 * run-tencent-cam.mjs — 腾讯云【方案一:CAM 跨账号授权】端到端联调。
 *
 * 拓扑:
 *   测试脚本 ──> CF Worker(真实,grant-config)
 *                  ├──> mock 腾讯云 STS(GetFederationToken,主密钥签名)
 *                  └──> mock 腾讯云 SCF(UpdateFunctionConfiguration,临时密钥签名)
 *
 * 这是【最关键、最易错】的一条:Worker 的 signTc3(Web Crypto 实现)签名,
 * 由 mock 用【独立 Node crypto】反向验签 —— 严格(strict)模式。
 * Worker 签名 host 含端口、与发送的 Host 头一致,故 strict 验签可通过
 * (区别于方案二里官方 SDK 用 hostname 不含端口的 quirk)。
 *
 * 验证点:
 *   1. Worker 用主密钥签 STS GetFederationToken → mock 验签通过(service=sts)。
 *   2. Worker 用临时密钥签 SCF UpdateFunctionConfiguration → mock 验签通过(service=scf)。
 *   3. 参数透传:FunctionName/Timeout=60/MemorySize=128。
 *   4. 端到端:grant-config 返回 success,stsIssued + scfUpdate.ok。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockTencent } from './mock-tencent.mjs';
import { log, fail, pass, fetchJson, waitFor, spawnLong } from './lib.mjs';

const TAG = '方案一';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'packages', 'worker-cloudflare');
const WORKER_PORT = 8787;
const MOCK_PORT = 9999;

// 主密钥(Worker env 与 mock 必须一致)
const TEST_ID = 'AKIDtestCAMmain0000000000000000000';
const TEST_KEY = 'testCAMmainKey000000000000000000000000';

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
  ],
  { cwd: WORKER_DIR, env: { ...process.env, CLOUDFLARE_TELEMETRY_DISABLED: '1', CI: '1' } },
);

const results = [];
try {
  await waitFor(TAG, `http://127.0.0.1:${WORKER_PORT}/api/health`, 30000);
  log(TAG, 'Worker 已启动');

  // 触发 CAM 流程
  const r = await fetchJson(`http://127.0.0.1:${WORKER_PORT}/api/grant-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'cam-test-code', functionName: 'minist-tavern-test', region: 'ap-guangzhou' }),
  });
  if (r.status !== 200 || !r.json?.success) fail(TAG, `grant-config 失败: ${r.status} ${r.text}`);
  const res = r.json.data;
  if (!res?.stsIssued) fail(TAG, `STS 未签发: ${JSON.stringify(res)}`);
  if (!res?.scfUpdate?.ok) fail(TAG, `SCF 更新未成功: ${JSON.stringify(res.scfUpdate)}`);
  pass(TAG, 'grant-config 端到端成功(stsIssued + scfUpdate.ok)');
  results.push(true);

  // 校验 mock 收到的两次调用 + 严格验签
  const calls = mock.getCalls();
  const sts = calls.find((c) => c.action === 'GetFederationToken');
  const scf = calls.find((c) => c.action === 'UpdateFunctionConfiguration');
  if (!sts) fail(TAG, 'mock 未收到 GetFederationToken(Worker 未调 STS)');
  if (!sts.sigOk) fail(TAG, `STS 签名 strict 验签失败:Worker signTc3(主密钥)与 Node crypto 不一致`);
  if (sts.service !== 'sts') fail(TAG, `STS service 应为 sts,实际 ${sts.service}`);
  pass(TAG, 'Worker signTc3(主密钥)签名 STS GetFederationToken → 独立验签通过');
  results.push(true);

  if (!scf) fail(TAG, 'mock 未收到 UpdateFunctionConfiguration(Worker 未调 SCF)');
  if (!scf.sigOk) fail(TAG, `SCF 签名 strict 验签失败:Worker signTc3(临时密钥)与 Node crypto 不一致`);
  if (scf.service !== 'scf') fail(TAG, `SCF service 应为 scf,实际 ${scf.service}`);
  if (scf.body?.FunctionName !== 'minist-tavern-test' || scf.body?.Timeout !== 60 || scf.body?.MemorySize !== 128)
    fail(TAG, `SCF 参数异常: ${JSON.stringify(scf.body)}`);
  pass(TAG, 'Worker signTc3(临时密钥)签名 SCF UpdateFunctionConfiguration → 独立验签通过 + 参数正确');
  results.push(true);

  // 临时密钥链路:SCF 调用必须用 STS 签发的临时 SecretId(非主密钥)
  if (scf.credSecretId === TEST_ID) fail(TAG, 'SCF 调用仍用主密钥,未切换到临时凭证');
  pass(TAG, '临时凭证链路正确(SCF 调用使用 STS 签发的临时 SecretId)');
  results.push(true);
} finally {
  wrangler.kill('SIGTERM');
  mock.server.close();
}

process.exit(results.every(Boolean) ? 0 : 1);
