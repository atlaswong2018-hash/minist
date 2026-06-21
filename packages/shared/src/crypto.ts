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
  // 逐字节填入数组再 join:避免 String.fromCharCode.apply 在大 subarray 上
  // 触发参数列表上限(部分老 iOS WKWebView >65535 抛 RangeError),且无字符串拼接 O(n²)。
  const parts: string[] = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    parts[i] = String.fromCharCode(bytes[i]);
  }
  return btoa(parts.join(''));
}

/** UTF-8 安全的 Base64 解码。 */
export function decodeBase64(b64: string): string {
  const binary = atob(b64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
