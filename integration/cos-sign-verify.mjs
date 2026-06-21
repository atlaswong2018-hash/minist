/**
 * cos-sign-verify.mjs — 腾讯云 COS XML API v5 签名验证器(Node crypto,独立实现)。
 *
 * 与 worker-cloudflare/src/cos-sign.ts(Web Crypto)是两套独立实现。
 * mock 腾讯云 API 收到 Worker 的 COS 请求(PutBucket)后,用本模块重算签名比对,
 * 从而验证 Worker 的 cos v5 实现正确(与 tc3-verify 验证 TC3 同款交叉验证模式)。
 *
 * 算法(sha1):https://cloud.tencent.com/document/product/436/7778
 */
import crypto from 'node:crypto';

const sha1Hex = (m) => crypto.createHash('sha1').update(m, 'utf8').digest('hex');
const hmacSha1 = (key, m) => crypto.createHmac('sha1', key).update(m, 'utf8').digest();

/** 构建 FormatString 与 headerList(签名 host[+x-cos-security-token],无 query)。 */
function buildCanonical(method, uri, host, securityToken) {
  const headers = { host };
  if (securityToken) headers['x-cos-security-token'] = securityToken;
  const keys = Object.keys(headers).sort();
  const httpHeaders = keys.map((k) => `${k}=${headers[k]}&`).join('');
  return {
    formatString: `${method.toLowerCase()}\n${uri}\n\n${httpHeaders}\n`,
    headerList: keys.join(';'),
  };
}

/** 用 SecretKey + KeyTime 计算 Signature。 */
export function computeCosSignature(secretKey, keyTime, formatString) {
  const signKey = hmacSha1(secretKey, keyTime);
  const stringToSign = `sha1\n${keyTime}\n${sha1Hex(formatString)}\n`;
  return { signature: hmacSha1(signKey, stringToSign).toString('hex'), stringToSign };
}

/** 解析 COS Authorization 头。 */
export function parseCosAuth(auth) {
  if (!auth || !auth.startsWith('q-sign-algorithm=')) return null;
  const map = {};
  for (const part of auth.split('&')) {
    const idx = part.indexOf('=');
    if (idx > 0) map[part.slice(0, idx)] = part.slice(idx + 1);
  }
  return map;
}

/**
 * 验证一个进来的 COS 请求(按 Authorization 里声明的 q-key-time / q-header-list 重算比对)。
 * @param {object} o { req (Node IncomingMessage), secretKey }
 */
export function verifyCosRequest({ req, secretKey }) {
  const auth = req.headers['authorization'] || '';
  const parsed = parseCosAuth(auth);
  if (!parsed) return { ok: false, reason: '非 COS v5 Authorization' };
  const method = req.method;
  const uri = (req.url || '/').split('?')[0];
  const host = req.headers['host'];
  const securityToken = req.headers['x-cos-security-token'];
  const { formatString, headerList } = buildCanonical(method, uri, host, securityToken);
  const { signature: expected } = computeCosSignature(secretKey, parsed['q-key-time'], formatString);
  const got = parsed['q-signature'];
  const ok = expected === got;
  return { ok, expected, got, headerList, formatString, parsed };
}

// 自检:签名 → 构造 Authorization → verifyCosRequest 验证,应一致。
if (import.meta.url === `file://${process.argv[1]}`) {
  const secretKey = 'cosSelfTestKey';
  const secretId = 'AKIDcosselftest';
  const host = 'minist-1250000000.cos.ap-guangzhou.myqcloud.com';
  const keyTime = '1700000000;1700000600';
  const { formatString, headerList } = buildCanonical('put', '/', host, 'tmp-token');
  const { signature } = computeCosSignature(secretKey, keyTime, formatString);
  const authorization =
    `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}` +
    `&q-header-list=${headerList}&q-url-param-list=&q-signature=${signature}`;
  const fakeReq = {
    method: 'PUT',
    url: '/',
    headers: { host, 'x-cos-security-token': 'tmp-token', authorization },
  };
  const v = verifyCosRequest({ req: fakeReq, secretKey });
  console.log(v.ok ? '[cos-sign] 自检通过 ✅' : `[cos-sign] 自检失败 ❌ ${JSON.stringify({ ok: v.ok, expected: v.expected, got: v.got })}`);
  process.exit(v.ok ? 0 : 1);
}
