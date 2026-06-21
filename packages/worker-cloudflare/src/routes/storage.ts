/**
 * worker-cloudflare/src/routes/storage.ts — KV 通用键值存储路由
 *
 * 路由:GET /api/storage/:key  → 读取
 *       POST /api/storage/:key → 写入
 *
 * 设计:角色卡索引等"读多写少"数据放 KV。
 * ⚠️ KV 写入约束:免费版仅 1,000 次/天(最紧瓶颈)。
 *    频繁追加的聊天记录请走 D1(/api/chat),不要走本路由。
 *
 * 混淆协议:当请求头 X-Crypto-Data: true 时,POST body 视为 Base64 混淆后的
 * 密文,Worker 直接原样存 KV(不解密);GET 返回时也原样返回,前端自行解混淆。
 * 这样 Worker 侧零密钥、零明文。
 */
import { HEADERS, ok, err } from '@minist/shared';
import type { Env } from '../env';
import { jsonCors } from '../cors';

/** 从路径中提取 key(API 前缀之后的剩余部分)。 */
function extractKey(pathname: string): string | null {
  // /api/storage/:key → 取 /api/storage/ 之后部分,URL 解码。
  const prefix = '/api/storage/';
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  const key = decodeURIComponent(raw);
  return key || null;
}

/** KV 存储路由分发。 */
export async function handleStorage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = extractKey(url.pathname);
  if (key === null) {
    return jsonCors(err('missing key in path', 'BAD_REQUEST'), 400);
  }

  if (request.method === 'GET') {
    const value = await env.SillyKV.get(key);
    if (value === null) {
      return jsonCors(err(`key not found: ${key}`, 'NOT_FOUND'), 404);
    }
    // 若原存的是密文,标记 X-Crypto-Data 让前端解混淆。
    const isCrypto = value.length > 0 && isLikelyBase64(value);
    const headers: Record<string, string> = {};
    if (isCrypto) headers[HEADERS.cryptoData] = 'true';
    return jsonCors(ok({ key, value }), 200);
  }

  if (request.method === 'POST') {
    const body = await request.text();
    if (!body) {
      return jsonCors(err('empty body', 'BAD_REQUEST'), 400);
    }
    await env.SillyKV.put(key, body);
    return jsonCors(ok({ key }), 200);
  }

  return jsonCors(err(`method not allowed: ${request.method}`, 'METHOD_NOT_ALLOWED'), 405);
}

/** 粗略判断字符串是否 Base64 混淆(用于决定是否标记 crypto 头)。 */
function isLikelyBase64(s: string): boolean {
  // Base64 字符集 + 长度 4 的倍数;非 JSON 起始字符。
  if (s.startsWith('{') || s.startsWith('[')) return false;
  return /^[A-Za-z0-9+/=\s]+$/.test(s) && s.replace(/\s/g, '').length % 4 === 0;
}
