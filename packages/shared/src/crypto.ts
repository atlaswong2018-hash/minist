/**
 * @minist/shared — Base64 混淆协议(X-Crypto-Data)
 *
 * 目的:在免备案(无 HTTPS 审查白名单)的国内移动网络下,把手机↔后端之间的
 * 聊天明文变成"乱码",降低被运营商 DNS 污染 / 明文敏感词拦截的概率。
 *
 * 注意:这是"混淆"而非"加密",不能防御主动攻击者;仅用于规避自动化审查。
 * 真正的密钥(API Key)始终通过 Authorization 头走 HTTPS 传输。
 *
 * 实现需在浏览器与 CF Worker 中均可运行(二者均有 TextEncoder / atob / btoa)。
 * 腾讯云 SCF(Node)用 Buffer 等价实现,见 scf-tencent 包。
 */

/** UTF-8 安全的 Base64 编码。 */
export function encodeBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(binary);
}

/** UTF-8 安全的 Base64 解码。 */
export function decodeBase64(b64: string): string {
  const binary = atob(b64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 简单 XOR 混淆(可选增强):用固定 key 流异或,再 Base64。 */
export function xorEncode(str: string, key: string): string {
  if (!key) return encodeBase64(str);
  const bytes = new TextEncoder().encode(str);
  const keyBytes = new TextEncoder().encode(key);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < out.length; i += chunk) {
    binary += String.fromCharCode.apply(null, out.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

export function xorDecode(b64: string, key: string): string {
  if (!key) return decodeBase64(b64);
  const binary = atob(b64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const keyBytes = new TextEncoder().encode(key);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return new TextDecoder().decode(out);
}
