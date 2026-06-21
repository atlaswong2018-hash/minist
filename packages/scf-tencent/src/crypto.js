/**
 * @minist/scf-tencent — Base64 混淆协议(Node 版)
 *
 * ⚠️ 行为须与 @minist/shared/src/crypto.ts 的 encodeBase64/decodeBase64 保持一致。
 * 浏览器/Worker 用 TextEncoder + atob/btoa;Node 用 Buffer,二者输出等价(UTF-8 安全)。
 *
 * 这是"混淆"而非"加密",仅用于规避国内免备案链路上的明文敏感词审查,
 * 不能防御主动攻击者。真正的 API Key 始终走 Authorization 头(HTTPS)。
 */

'use strict';

/**
 * UTF-8 安全的 Base64 编码。
 * @param {string} str 原始字符串
 * @returns {string} Base64 字符串
 */
function encodeB64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

/**
 * UTF-8 安全的 Base64 解码。
 * @param {string} b64 Base64 字符串
 * @returns {string} 原始字符串
 */
function decodeB64(b64) {
  if (typeof b64 !== 'string') return '';
  return Buffer.from(b64.trim(), 'base64').toString('utf8');
}

/**
 * 判断请求是否启用了 Base64 混淆(X-Crypto-Data: true)。
 * @param {object} headers express req.headers(小写键)
 * @returns {boolean}
 */
function isCryptoEnabled(headers) {
  if (!headers) return false;
  const v = headers['x-crypto-data'];
  return String(v || '').toLowerCase() === 'true';
}

module.exports = { encodeB64, decodeB64, isCryptoEnabled };
