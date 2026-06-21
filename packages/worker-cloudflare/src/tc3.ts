/**
 * worker-cloudflare/src/tc3.ts — 腾讯云 TC3-HMAC-SHA256 签名实现
 *
 * 用途:CAM 方案一中,Worker 作为"可信中转",用主账号 AK/SK 调腾讯云 API
 * (如 scf UpdateFunctionConfiguration、cos CreateBucket、sts 换临时凭证)。
 * 腾讯云 API v3 统一采用 TC3-HMAC-SHA256 签名,实现规范见官方文档:
 *   https://cloud.tencent.com/document/api/213/30654
 *
 * 本文件纯 Web Crypto(crypto.subtle)实现,不依赖 Node crypto,可在 Worker 运行。
 *
 * 签名步骤(与官方一致):
 *   1. 拼接 CanonicalRequest
 *        HTTP方法\nURI\n查询串\n规范化请求头\n签名请求头\n请求体哈希
 *   2. 拼接 StringToSign
 *        TC3-HMAC-SHA256\n时间戳\nCredential\nSHA256(CanonicalRequest)
 *        其中 Credential = Date/Service/tc3_request
 *   3. 派生签名密钥(SecretDate → SecretService → SecretTC3,逐层 HMAC-SHA256)
 *   4. HMAC-SHA256(SecretTC3, StringToSign) → 十六进制签名
 *   5. 拼装 Authorization 头。
 *
 * 注意:腾讯云要求 Content-Type 为 application/json; charset=utf-8,
 * 且规范化请求头中的 key 必须小写、按字典序排列。
 */

/** Web Crypto:SHA-256 十六进制摘要。 */
async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufToHex(digest);
}

/** Web Crypto:HMAC-SHA256,返回 ArrayBuffer。 */
async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? key : new Uint8Array(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

/** ArrayBuffer → 小写十六进制字符串。 */
function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/** UTC 日期(YYYY-MM-DD),用于 Credential 与派生密钥。 */
function utcDate(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

/** 签名入参。 */
export interface Tc3SignOptions {
  /** SecretId(主账号或子账号)。 */
  secretId: string;
  /** SecretKey。 */
  secretKey: string;
  /** 服务名,如 scf / cos / sts。 */
  service: string;
  /** 地域,如 ap-guangzhou。COS 等服务必填。 */
  region: string;
  /** API 动作,如 UpdateFunctionConfiguration。 */
  action: string;
  /** API 版本,如 2018-04-16(scf)。 */
  version: string;
  /** 请求体 JSON 字符串。 */
  payload: string;
  /** 秒级时间戳。 */
  timestamp: number;
  /** 可选:HTTP 方法,默认 POST。 */
  method?: string;
  /** 可选:URI 路径,默认 /。 */
  path?: string;
  /** 可选:查询串,默认空。 */
  query?: string;
  /** 可选:Host,默认 `${service}.tencentcloudapi.com`。 */
  host?: string;
  /** 可选:额外请求头(小写 key)。会并入规范化请求头。 */
  extraHeaders?: Record<string, string>;
}

/** 签名结果:可直接用于 fetch 的关键头部。 */
export interface Tc3SignResult {
  /** Authorization 头(完整 TC3-HMAC-SHA256 串)。 */
  authorization: string;
  /** Host。 */
  host: string;
  /** Content-Type(固定 application/json; charset=utf-8)。 */
  contentType: string;
  /** 时间戳字符串,需作为 X-TC-Action / X-TC-Timestamp 头回传。 */
  timestamp: string;
  /** 完整请求头集合(含签名派生头),可直接展开进 fetch headers。 */
  headers: Record<string, string>;
}

/**
 * 计算 TC3-HMAC-SHA256 签名。
 *
 * @example
 * const sig = await signTc3({
 *   secretId: env.TENCENT_SECRET_ID!,
 *   secretKey: env.TENCENT_SECRET_KEY!,
 *   service: 'scf', region: 'ap-guangzhou',
 *   action: 'UpdateFunctionConfiguration', version: '2018-04-16',
 *   payload: JSON.stringify({ FunctionName, Timeout: 60, MemorySize: 128 }),
 *   timestamp: Math.floor(Date.now() / 1000),
 * });
 * const res = await fetch(`https://${sig.host}`, { method: 'POST', headers: sig.headers, body: payload });
 */
export async function signTc3(opts: Tc3SignOptions): Promise<Tc3SignResult> {
  const {
    secretId,
    secretKey,
    service,
    region,
    action,
    version,
    payload,
    timestamp,
    method = 'POST',
    path = '/',
    query = '',
    host = `${service}.tencentcloudapi.com`,
    extraHeaders = {},
  } = opts;

  const contentType = 'application/json; charset=utf-8';
  const date = utcDate(timestamp);

  // ─── 1. CanonicalRequest ────────────────────────────────────────
  // 规范化请求头:小写 key + 去首尾空格 + 末尾加 \n;按 key 字典序。
  const canonicalHeadersMap: Record<string, string> = {
    'content-type': contentType,
    host,
    'x-tc-action': action.toLowerCase(),
    ...Object.fromEntries(
      Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase().trim(), v.trim()]),
    ),
  };
  const sortedHeaderKeys = Object.keys(canonicalHeadersMap).sort();
  const canonicalHeaders =
    sortedHeaderKeys.map((k) => `${k}:${canonicalHeadersMap[k]}\n`).join('');
  const signedHeaders = sortedHeaderKeys.join(';');
  const hashedPayload = await sha256Hex(payload);

  const canonicalRequest = [
    method.toUpperCase(),
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    hashedPayload,
  ].join('\n');

  // ─── 2. StringToSign ────────────────────────────────────────────
  const credentialScope = `${date}/${service}/tc3_request`;
  const hashedCanonical = await sha256Hex(canonicalRequest);
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(timestamp),
    credentialScope,
    hashedCanonical,
  ].join('\n');

  // ─── 3. 派生签名密钥(SecretDate → SecretService → SecretTC3) ────
  const secretDateBuf = await hmacSha256(
    new TextEncoder().encode(`TC3${secretKey}`),
    date,
  );
  const secretServiceBuf = await hmacSha256(secretDateBuf, service);
  const secretTc3Buf = await hmacSha256(secretServiceBuf, 'tc3_request');

  // ─── 4. 计算签名 ────────────────────────────────────────────────
  const signatureBuf = await hmacSha256(secretTc3Buf, stringToSign);
  const signature = bufToHex(signatureBuf);

  // ─── 5. Authorization 头 ────────────────────────────────────────
  const authorization =
    `TC3-HMAC-SHA256 ` +
    `Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  // ─── 组装完整请求头(含 TC3 派生头与区域/版本头) ──────────────────
  const headers: Record<string, string> = {
    Authorization: authorization,
    Host: host,
    'Content-Type': contentType,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': version,
    'X-TC-Region': region,
    ...Object.fromEntries(
      Object.entries(extraHeaders).map(([k, v]) => [k, v.trim()]),
    ),
  };

  return {
    authorization,
    host,
    contentType,
    timestamp: String(timestamp),
    headers,
  };
}
