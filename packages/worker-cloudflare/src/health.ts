/**
 * worker-cloudflare/src/health.ts — 健康检查
 *
 * 路由:GET /api/health
 *
 * Worker 环境中 Date.now() 可用(返回墙钟时间)。
 * 不依赖任何绑定资源,始终 200,供前端/部署平台探活。
 */
import { ok } from '@minist/shared';
import { jsonCors } from './cors';

export function handleHealth(): Response {
  return jsonCors(ok({ ok: true, ts: Date.now() }), 200);
}
