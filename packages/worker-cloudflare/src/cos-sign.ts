/**
 * worker-cloudflare/src/cos-sign.ts — 腾讯云 COS XML API v5 签名。
 *
 * COS 用【独立的 XML API + cos v5 签名(HMAC-SHA1)】,与云 API(TC3-HMAC-SHA256)
 * 完全不同。用于 grant.ts 方案一为用户自动创建 COS 存储桶(PutBucket)等操作。
 *
 * 算法(sha1,见 https://cloud.tencent.com/document/product/436/7778):
 *   SignKey      = HMAC-SHA1(SecretKey, KeyTime)
 *   FormatString = Method + "\n" + Uri + "\n" + QueryString + "\n" + HttpHeaders + "\n"
 *   StringToSign = "sha1" + "\n" + KeyTime + "\n" + SHA1(FormatString) + "\n"
 *   Signature    = HEX( HMAC-SHA1(SignKey, StringToSign) )
 *   Authorization= q-sign-algorithm=sha1&q-ak=SecretId&q-sign-time=KeyTime
 *                  &q-key-time=KeyTime&q-header-list=<hlist>&q-url-param-list=<plist>
 *                  &q-signature=Signature
 *
 * 其中 HttpHeaders = 各已签名头按字典序 `key=value&` 拼接(key 小写,值原样),
 *                    末尾含 `&`;QueryString 同理(本实现 PutBucket 无 query 参数)。
 * KeyTime = `${start};${end}`(秒)。
 * 临时凭证:把 `x-cos-security-token` 加入已签名头 + 实际请求头。
 *
 * Web Crypto(SHA-1 / HMAC-SHA1)实现,Worker 与 Node 20 均可运行。
 */
import type { TcCredentials } from './tencent';

/** Web Crypto:SHA-1 十六进制摘要。 */
async function sha1Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(message));
  return bufToHex(digest);
}

/** Web Crypto:HMAC-SHA1,返回 ArrayBuffer。 */
async function hmacSha1(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

/** ArrayBuffer → 小写十六进制。 */
function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

export interface CosSignInput {
  secretId: string;
  secretKey: string;
  /** 临时凭证 SecurityToken(来自 STS)。提供则加入已签名头 x-cos-security-token。 */
  securityToken?: string;
  /** HTTP 方法,小写,如 'put'。 */
  method: string;
  /** 请求 Host,如 `minist-1250000000.cos.ap-guangzhou.myqcloud.com`。 */
  host: string;
  /** URI 路径,默认 '/'。 */
  uri?: string;
  /** KeyTime 起止(秒)。 */
  keyTime: { start: number; end: number };
}

export interface CosSignResult {
  /** 完整 Authorization 头值。 */
  authorization: string;
  /** 实际要发送的请求头(含 host + x-cos-security-token 若有)。 */
  headersToSend: Record<string, string>;
}

/**
 * 计算 COS v5 签名(sha1)。
 * 当前实现覆盖 PutBucket 场景(无 query 参数;签名 host[+x-cos-security-token])。
 */
export async function cosSign(input: CosSignInput): Promise<CosSignResult> {
  const uri = input.uri ?? '/';
  const keyTime = `${input.keyTime.start};${input.keyTime.end}`;

  // 已签名头:host(小写);临时凭证再加 x-cos-security-token。
  const headers: Record<string, string> = { host: input.host };
  if (input.securityToken) headers['x-cos-security-token'] = input.securityToken;
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  const headerKeys = Object.keys(lower).sort();
  // HttpHeaders:各头 `key=value&` 拼接(末尾含 &)
  const httpHeaders = headerKeys.map((k) => `${k}=${lower[k]}&`).join('');
  const headerList = headerKeys.join(';');

  // 无 query 参数(COS PutBucket 的 CanonicalQueryString 为空)
  const queryString = '';
  const paramList = '';

  const formatString = `${input.method.toLowerCase()}\n${uri}\n${queryString}\n${httpHeaders}\n`;
  const signKey = await hmacSha1(new TextEncoder().encode(input.secretKey), keyTime);
  const stringToSign = `sha1\n${keyTime}\n${await sha1Hex(formatString)}\n`;
  const signature = bufToHex(await hmacSha1(signKey, stringToSign));

  const authorization =
    `q-sign-algorithm=sha1&q-ak=${input.secretId}` +
    `&q-sign-time=${keyTime}&q-key-time=${keyTime}` +
    `&q-header-list=${headerList}&q-url-param-list=${paramList}` +
    `&q-signature=${signature}`;

  return { authorization, headersToSend: headers };
}

/**
 * 用临时凭证实发 COS PutBucket(创建存储桶)。
 * @param creds  STS 临时凭证
 * @param opts   { region, bucketFullName, apiBase?(联调用,指向本地 mock) }
 * bucketFullName 形如 `minist-1250000000`(<name>-<appid>),host = `<bucketFullName>.cos.<region>.myqcloud.com`。
 */
export async function cosPutBucket(
  creds: TcCredentials,
  opts: { region: string; bucketFullName: string; apiBase?: string },
): Promise<{ ok: boolean; status: number; requestId?: string; error?: string }> {
  const defaultHost = `${opts.bucketFullName}.cos.${opts.region}.myqcloud.com`;
  // 联调:COS_API_BASE 指向本地 mock(如 http://127.0.0.1:9999)
  const host = opts.apiBase ? opts.apiBase.replace(/^https?:\/\//, '').replace(/\/+$/, '') : defaultHost;
  const url = opts.apiBase ? opts.apiBase.replace(/\/+$/, '/') : `https://${host}/`;

  const now = Math.floor(Date.now() / 1000);
  const { authorization, headersToSend } = await cosSign({
    secretId: creds.TmpSecretId,
    secretKey: creds.TmpSecretKey,
    securityToken: creds.Token,
    method: 'put',
    host,
    uri: '/',
    keyTime: { start: now, end: now + 600 },
  });

  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...headersToSend, Authorization: authorization, 'Content-Length': '0' },
    body: '',
  });

  if (res.ok) {
    return { ok: true, status: res.status, requestId: res.headers.get('x-cos-request-id') ?? undefined };
  }
  const text = await res.text().catch(() => '');
  return { ok: false, status: res.status, error: `PutBucket ${res.status}: ${text.slice(0, 300)}` };
}
