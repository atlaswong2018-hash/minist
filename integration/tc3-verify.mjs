/**
 * tc3-verify.mjs — 腾讯云 TC3-HMAC-SHA256 签名验证器(Node crypto)。
 *
 * 用途:mock 腾讯云 API 收到 Worker / SCF SDK 发来的签名请求后,用同一算法
 * 重算签名并比对,从而验证 Worker 的 signTc3(@minist/worker-cloudflare/src/tc3.ts)
 * 是否正确。这是 CAM 方案一最关键、最易错的一环,用 Node crypto 独立复现,
 * 与 Worker 的 Web Crypto 实现交叉验证。
 *
 * 算法规范:https://cloud.tencent.com/document/api/213/30654
 */
import crypto from 'node:crypto';

const sha256Hex = (m) => crypto.createHash('sha256').update(m, 'utf8').digest('hex');
const hmac = (key, m) => crypto.createHmac('sha256', key).update(m, 'utf8').digest();

/** 解析 Authorization 头,提取 SecretId / Date / Service / SignedHeaders / Signature。 */
export function parseAuthHeader(auth) {
  const m = (auth || '').match(
    /^TC3-HMAC-SHA256\s+Credential=([^,]+),\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]+)/i,
  );
  if (!m) return null;
  const [, credential, signedHeaders, signature] = m;
  const [secretId, date, service] = credential.split('/');
  return {
    secretId,
    date,
    service,
    signedHeaders: signedHeaders.split(';'),
    signature,
  };
}

/** 把 Node http.IncomingMessage 的 headers 规范化为小写 key 对象(取数组首值)。 */
export function lowerHeaders(rawHeaders) {
  const h = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    h[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  return h;
}

/**
 * 计算 TC3 签名(规范实现)。
 *
 * 关键:canonical headers 用「客户端声明的 signedHeaders 列表」构建
 * (与真实腾讯云服务器验签一致 —— 服务器按 Authorization 里的 SignedHeaders
 * 字段重算)。不同客户端签的头集合可能不同:官方 Node SDK 实测只签
 * `content-type;host`,而本项目的 Worker signTc3 签 `content-type;host;x-tc-action`
 * (+x-tc-token)。两者都合法,只要声明的 SignedHeaders 与实际签的一致。
 *
 * @param {object} o
 * @param {string} o.method
 * @param {string} o.path
 * @param {string} o.query
 * @param {Record<string,string>} o.headers  小写 key 的请求头(全量,从中取 signedHeaders)
 * @param {string[]} o.signedHeaders  客户端声明签名的头名列表(小写)
 * @param {string} o.body
 * @param {string} o.service
 * @param {string|number} o.timestamp  秒级
 * @param {string} o.secretKey
 */
export async function computeTc3Signature({ method, path, query, headers, signedHeaders, body, service, timestamp, secretKey }) {
  const sh = [...signedHeaders].sort();
  const canonicalHeaders = sh
    .map((k) => {
      let val = String(headers[k] ?? '').trim();
      // 腾讯云规范:x-tc-action 的「值」在 canonical 中转小写。
      if (k === 'x-tc-action') val = val.toLowerCase();
      return `${k}:${val}\n`;
    })
    .join('');
  const signedHeadersStr = sh.join(';');

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    query || '',
    canonicalHeaders,
    signedHeadersStr,
    sha256Hex(body),
  ].join('\n');

  const date = new Date(Number(timestamp) * 1000).toISOString().slice(0, 10);
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretTc3 = hmac(secretService, 'tc3_request');
  const signature = hmac(secretTc3, stringToSign).toString('hex');
  return { signature, canonicalRequest, stringToSign, date };
}

/**
 * 验证一个进来的请求 —— 用 Authorization 里声明的 SignedHeaders 重算并比对。
 * @param {object} o { req (Node IncomingMessage), body, secretKey, service }
 */
export async function verifyRequest({ req, body, secretKey, service }) {
  const headers = lowerHeaders(req.headers);
  const parsed = parseAuthHeader(headers['authorization']);
  if (!parsed) return { ok: false, reason: 'unparseable Authorization header' };
  const timestamp = headers['x-tc-timestamp'];
  const url = req.url || '/';
  const [path, query] = url.split('?');
  const expected = await computeTc3Signature({
    method: req.method,
    path,
    query: query || '',
    headers,
    signedHeaders: parsed.signedHeaders,
    body,
    service,
    timestamp,
    secretKey,
  });
  const ok = expected.signature === parsed.signature;
  return { ok, expected: expected.signature, got: parsed.signature, parsed, headers, canonicalRequest: expected.canonicalRequest, stringToSign: expected.stringToSign };
}

// 自检:用本模块的算法签一个请求,再用 verifyRequest 验,应当一致。
if (import.meta.url === `file://${process.argv[1]}`) {
  const secretKey = 'selfTestKey';
  const secretId = 'AKIDselftest';
  const service = 'scf';
  const timestamp = 1_700_000_000;
  const body = JSON.stringify({ FunctionName: 'fn', Timeout: 60 });
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    host: 'scf.tencentcloudapi.com',
    'x-tc-action': 'UpdateFunctionConfiguration',
    'x-tc-token': 'tok',
    'x-tc-timestamp': String(timestamp),
    authorization: '',
  };
  const sig = await computeTc3Signature({
    method: 'POST', path: '/', query: '', headers, signedHeaders: ['content-type', 'host', 'x-tc-action', 'x-tc-token'], body, service, timestamp, secretKey,
  });
  headers.authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/2023/02/scf/tc3_request, SignedHeaders=content-type;host;x-tc-action;x-tc-token, Signature=${sig.signature}`;
  const fakeReq = { method: 'POST', url: '/', headers: {} };
  for (const [k, v] of Object.entries(headers)) fakeReq.headers[k] = v; // 含 authorization
  const v = await verifyRequest({ req: fakeReq, body, secretKey, service });
  console.log(v.ok ? '[tc3-verify] 自检通过 ✅' : `[tc3-verify] 自检失败 ❌ ${JSON.stringify(v)}`);
  process.exit(v.ok ? 0 : 1);
}
