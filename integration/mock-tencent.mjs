/**
 * mock-tencent.mjs — mock 腾讯云 API(联调用)。
 *
 * 职责:
 *   1. 收到 Worker / SCF SDK 的 TC3 签名请求 → 用 tc3-verify 反向验签。
 *   2. 按 X-TC-Action 分发:
 *      - GetFederationToken (sts)      → 签发临时凭证并登记(供后续 SCF/COS 用临时密钥验签)
 *      - UpdateFunctionConfiguration (scf) → 记录调用参数,返回 RequestId
 *      - CreateBucket (cos)            → 返回 RequestId
 *
 * 这是 CAM 方案一与方案二端到端联调的"对端"。
 *
 * 测试主密钥默认值(env 可覆盖),Worker / SCF 侧必须用同一组。
 */
import http from 'node:http';
import https from 'node:https';
import { verifyRequest, parseAuthHeader } from './tc3-verify.mjs';
import { verifyCosRequest, parseCosAuth } from './cos-sign-verify.mjs';
import { ensureSelfSigned } from './cert.mjs';

const DEFAULT_MAIN_ID = 'AKIDmockMAINid000000000000000000000';
const DEFAULT_MAIN_KEY = 'mockMAINkey000000000000000000000000000';

const ACTION_TO_SERVICE = {
  GetFederationToken: 'sts',
  AssumeRole: 'sts',
  ListFunctions: 'scf',
  UpdateFunctionConfiguration: 'scf',
  CreateBucket: 'cos',
  GetFunction: 'scf',
};

/** 记录所有收到的调用(供测试断言)。 */
const calls = [];

/** 已签发的临时凭证,按 TmpSecretId 索引(供 SCF/COS 用临时密钥验签)。 */
const issuedCreds = new Map();

export function getCalls() {
  return calls;
}

export function startMockTencent(
  port = 9999,
  { mainSecretId = process.env.MOCK_TENCENT_SECRET_ID || DEFAULT_MAIN_ID, mainSecretKey = process.env.MOCK_TENCENT_SECRET_KEY || DEFAULT_MAIN_KEY, lenient = false, tls = false } = {},
) {
  const handler = async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');

    // ── COS XML API v5 分支(Authorization 以 q-sign-algorithm= 开头)──────────
    // COS 用独立签名(HMAC-SHA1),与 TC3 不同;PutBucket 等走这里。
    const rawAuth = req.headers['authorization'] || '';
    if (rawAuth.startsWith('q-sign-algorithm=')) {
      const parsed = parseCosAuth(rawAuth);
      const credSecretId = parsed?.['q-ak'] ?? null;
      const cred = issuedCreds.get(credSecretId);
      const verifyKey = cred ? cred.TmpSecretKey : mainSecretKey;
      let cosOk = lenient;
      if (!lenient) {
        const v = verifyCosRequest({ req, secretKey: verifyKey });
        cosOk = v.ok;
        if (!v.ok && process.env.MOCK_DEBUG) {
          process.stderr.write(`[mock-tencent] COS 验签失败 ${req.method} ${req.url}\n  got=${v.got} expected=${v.expected}\n`);
        }
      }
      calls.push({ action: 'PutBucket', service: 'cos', sigOk: cosOk, body: null, credSecretId });
      if (!cosOk) {
        res.writeHead(401, { 'Content-Type': 'application/xml' });
        return res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureMismatch</Code><Message>mock cos 验签失败</Message></Error>`);
      }
      res.writeHead(200, { 'Content-Type': 'application/xml', 'x-cos-request-id': 'mock-cos-' + Date.now().toString(36) });
      return res.end('');
    }

    const actionLower = req.headers['x-tc-action'];
    const action = actionLower ? actionLower[0].toUpperCase() + actionLower.slice(1) : '';

    // service 必须取自客户端 Authorization 头的 Credential scope(Date/Service/tc3_request),
    // 而非由 action 推断 —— 这与真实腾讯云服务器一致,也能兼容 SDK 从 endpoint 派生
    // service 的行为(如本联调里 endpoint=127.0.0.1:9999 时 SDK 会用 service="127")。
    const auth = req.headers['authorization'] || '';
    const parsedAuth = parseAuthHeader(auth);
    const service = parsedAuth?.service || ACTION_TO_SERVICE[action] || 'unknown';

    // 选择验签密钥:STS 用主密钥;SCF/COS 用对应临时密钥(按 credential 里的 SecretId 查)。
    const credSecretId = parsedAuth?.secretId ?? null;
    let verifyKey = mainSecretKey;
    if (action !== 'GetFederationToken' && action !== 'AssumeRole') {
      const cred = issuedCreds.get(credSecretId);
      if (cred) verifyKey = cred.TmpSecretKey;
    }

    let sigOk = lenient;
    let sigDetail = null;
    if (!lenient) {
      const v = await verifyRequest({ req, body, secretKey: verifyKey, service });
      sigOk = v.ok;
      sigDetail = v;
      if (!v.ok && process.env.MOCK_DEBUG) {
        const h = v.headers || {};
        process.stderr.write(
          `[mock-tencent] 验签失败 ${action}\n` +
            `  signedHeaders(client)=${v.parsed?.signedHeaders?.join(';')}\n` +
            `  host=${h['host']}  content-type=${h['content-type']}  x-tc-timestamp=${h['x-tc-timestamp']}\n` +
            `  body=${body}\n` +
            `  --- canonicalRequest ---\n${v.canonicalRequest}\n  --- end ---\n` +
            `  expected=${v.expected}\n  got     =${v.got}\n`,
        );
      }
    }

    calls.push({ action, service, sigOk, body: tryJson(body), credSecretId });

    if (!sigOk) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          Response: {
            Error: {
              Code: 'AuthFailure.SignatureFailure',
              Message: `mock 验签失败:got=${String(sigDetail?.got).slice(0, 16)} expected=${String(sigDetail?.expected).slice(0, 16)}`,
            },
            RequestId: 'mock-sig-fail',
          },
        }),
      );
    }

    if (action === 'GetFederationToken' || action === 'AssumeRole') {
      const rnd = Math.random().toString(36).slice(2, 12);
      const tmpId = 'AKIDmockTMP' + rnd;
      const tmpKey = 'mockTMPkey' + rnd + rnd;
      const token = 'mockTMPtoken' + rnd;
      issuedCreds.set(tmpId, { TmpSecretId: tmpId, TmpSecretKey: tmpKey, Token: token });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          Response: {
            Credentials: { TmpSecretId: tmpId, TmpSecretKey: tmpKey, Token: token, ExpiredTime: 3600, Expiration: '1h' },
            RequestId: 'mock-sts-' + rnd,
          },
        }),
      );
    }

    if (action === 'UpdateFunctionConfiguration') {
      const payload = tryJson(body) || {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          Response: {
            RequestId: 'mock-scf-' + Date.now().toString(36),
            FunctionName: payload.FunctionName,
            Timeout: payload.Timeout,
            MemorySize: payload.MemorySize,
          },
        }),
      );
    }

    if (action === 'ListFunctions') {
      // 返回一组 mock 云函数(按 Limit 截断),供批量管理 list / set-config(全量自锁)联调。
      const payload = tryJson(body) || {};
      const limit = Number(payload.Limit) || 20;
      const allFns = [
        { FunctionId: 'fn-1', FunctionName: 'minist-tavern-a', Runtime: 'Nodejs18.15' },
        { FunctionId: 'fn-2', FunctionName: 'minist-tavern-b', Runtime: 'Nodejs18.15' },
        { FunctionId: 'fn-3', FunctionName: 'minist-tavern-c', Runtime: 'Python3.9' },
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          Response: {
            TotalCount: allFns.length,
            Functions: allFns.slice(0, limit),
            RequestId: 'mock-list-' + Date.now().toString(36),
          },
        }),
      );
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ Response: { RequestId: 'mock-ok-' + Date.now().toString(36) } }));
  };

  const server = tls ? https.createServer({ ...ensureSelfSigned() }, handler) : http.createServer(handler);

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port, mainSecretId, mainSecretKey, getCalls }));
  });
}

function tryJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// 直接运行:node mock-tencent.mjs [port]
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || 9999;
  startMockTencent(port).then(({ port: p }) => {
    console.log(`[mock-tencent] listening on http://127.0.0.1:${p} (mainId=${DEFAULT_MAIN_ID})`);
  });
}
