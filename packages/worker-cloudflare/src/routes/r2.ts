/**
 * worker-cloudflare/src/routes/r2.ts — R2 对象存储路由(人物卡 PNG)
 *
 * 路由:PUT  /api/r2/:key → 存二进制(图片)
 *       GET  /api/r2/:key → 取并返回(带正确 Content-Type)
 *       DELETE /api/r2/:key → 删除(可选)
 *
 * 设计:人物卡 PNG 图片放 R2。
 * ✅ R2 真实约束:无出流量费(egress free),手机加载图片免费;
 *    存储免费版 10GB,足够大量人物卡。
 *
 * 相比把图片转 Base64 塞进 KV/KV 受限体积,R2 是更合适的二进制存储。
 */
import { ok, err } from '@minist/shared';
import type { Env } from '../env';
import { withCors, jsonCors } from '../cors';

/** 从路径提取 key。 */
function extractKey(pathname: string): string | null {
  const prefix = '/api/r2/';
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  const key = decodeURIComponent(raw);
  return key || null;
}

/** 根据 key 后缀推断 Content-Type。 */
function guessContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

/** R2 路由分发。 */
export async function handleR2(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = extractKey(url.pathname);
  if (key === null) {
    return jsonCors(err('missing key in path', 'BAD_REQUEST'), 400);
  }

  // 读取。
  if (request.method === 'GET') {
    const object = await env.SillyR2.get(key);
    if (object === null) {
      return jsonCors(err(`object not found: ${key}`, 'NOT_FOUND'), 404);
    }
    const headers = new Headers();
    // R2 对象自带写入时的元数据(writeHttpMetadata 注入 Content-Type 等)。
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', headers.get('Content-Type') ?? guessContentType(key));
    headers.set('Cache-Control', 'public, max-age=86400');
    headers.set('etag', object.httpEtag);
    return withCors(
      new Response(object.body, { status: 200, headers }),
    );
  }

  // 写入。
  if (request.method === 'PUT') {
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) {
      return jsonCors(err('empty body', 'BAD_REQUEST'), 400);
    }
    // customMetadata 记录上传时间,便于后续审计。
    await env.SillyR2.put(key, body, {
      httpMetadata: {
        contentType: request.headers.get('Content-Type') ?? guessContentType(key),
      },
      customMetadata: { uploadedAt: String(Date.now()) },
    });
    return jsonCors(ok({ key, size: body.byteLength }), 200);
  }

  // 删除(可选)。
  if (request.method === 'DELETE') {
    await env.SillyR2.delete(key);
    return jsonCors(ok({ key, deleted: true }), 200);
  }

  return jsonCors(err(`method not allowed: ${request.method}`, 'METHOD_NOT_ALLOWED'), 405);
}
