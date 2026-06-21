/**
 * worker-cloudflare/src/cors.ts — CORS 预检与响应头注入
 *
 * 所有路由响应都必须注入 CORS,允许手机/微信内置浏览器跨域访问 Worker。
 * CORS 常量来自 @minist/shared,保证前后端一致。
 */
import { CORS_HEADERS } from '@minist/shared';

/**
 * 处理 OPTIONS 预检请求。
 * @returns 若是 OPTIONS,返回 204 空 CORS 响应;否则返回 null 由调用方继续路由。
 */
export function handleCors(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return null;
}

/**
 * 给任意 Response 注入 CORS 头(覆盖式合并)。
 * 用于所有业务路由的最终响应。
 */
export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * 用给定 body + status 构造一个已注入 CORS 的 JSON 响应。
 */
export function jsonCors(body: unknown, status = 200): Response {
  return withCors(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }),
  );
}
