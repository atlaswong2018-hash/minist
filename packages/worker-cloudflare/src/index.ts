/**
 * worker-cloudflare/src/index.ts — Worker 主入口
 *
 * 职责:
 *   1. OPTIONS 预检 → CORS 204。
 *   2. 按 method + pathname 分发到各路由 handler。
 *   3. 全局 try/catch → 返回统一错误信封(注入 CORS)。
 *   4. 未匹配 → 404。
 *
 * 路由清单(与 @minist/shared ROUTES 常量一致):
 *   GET    /api/health               → health
 *   GET|POST /api/storage/:key       → KV 存储
 *   GET|POST /api/chat/:userId       → D1 聊天
 *   GET|PUT|DELETE /api/r2/:key      → R2 图片
 *   GET|POST /api/sync[/:userId]     → 全量同步
 *   POST   /v1/chat/completions      → LLM 流式中转
 *   POST   /api/grant-config         → 腾讯云 CAM 方案一
 *   POST   /api/cf-setup             → CF 方案一(自动建 KV/D1/R2)
 *   POST   /api/admin/set-timeout    → 方案二(占位,见 scf-tencent 包)
 */
import { ROUTES, err } from '@minist/shared';
import type { Env } from './env';
import { handleCors, jsonCors } from './cors';
import { handleHealth } from './health';
import { handleStorage } from './routes/storage';
import { handleChat } from './routes/chat';
import { handleR2 } from './routes/r2';
import { handleSync } from './routes/sync';
import { handleCompletions } from './routes/completions';
import { handleGrantConfig } from './routes/grant';
import { handleCfSetup } from './routes/cf-setup';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // ─── 1. CORS 预检 ──────────────────────────────────────────────
    const corsRes = handleCors(request);
    if (corsRes) return corsRes;

    let response: Response;
    try {
      response = await route(request, env);
    } catch (e) {
      // 全局兜底:任何未捕获异常转统一错误信封。
      response = jsonCors(
        err(`internal error: ${(e as Error).message}`, 'INTERNAL'),
        500,
      );
    }
    return response;
  },
};

/** 路由分发。 */
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // ─── 健康检查 ────────────────────────────────────────────────────
  if (path === ROUTES.health && method === 'GET') {
    return handleHealth();
  }

  // ─── KV 存储:/api/storage/:key ───────────────────────────────────
  if (path.startsWith(ROUTES.storage + '/') && (method === 'GET' || method === 'POST')) {
    return handleStorage(request, env);
  }

  // ─── D1 聊天:/api/chat/:userId ───────────────────────────────────
  if (path.startsWith(ROUTES.chat + '/') && (method === 'GET' || method === 'POST')) {
    return handleChat(request, env);
  }

  // ─── R2 图片:/api/r2/:key ────────────────────────────────────────
  if (
    path.startsWith(ROUTES.r2 + '/') &&
    (method === 'GET' || method === 'PUT' || method === 'DELETE')
  ) {
    return handleR2(request, env);
  }

  // ─── 全量同步:/api/sync 或 /api/sync/:userId ─────────────────────
  if (path === ROUTES.sync || path.startsWith(ROUTES.sync + '/')) {
    return handleSync(request, env);
  }

  // ─── LLM 流式中转:/v1/chat/completions ───────────────────────────
  if (path === ROUTES.completions && method === 'POST') {
    return handleCompletions(request, env);
  }

  // ─── 腾讯云 CAM 方案一 ────────────────────────────────────────────
  if (path === ROUTES.grantConfig && method === 'POST') {
    return handleGrantConfig(request, env);
  }

  // ─── CF 方案一(自动建 KV/D1/R2)─────────────────────────────────
  if (path === ROUTES.cfSetup && method === 'POST') {
    return handleCfSetup(request, env);
  }

  // ─── 方案二:Token 自改超时 ────────────────────────────────────────
  // 占位:方案二主体逻辑在 scf-tencent 包(用户持有 SCF 函数直接改)。
  // Worker 侧仅作路由存在性标记,返回提示。
  if (path === ROUTES.adminTimeout) {
    return jsonCors(
      err('方案二(set-timeout)在 scf-tencent 包实现,Worker 不处理', 'NOT_IMPLEMENTED'),
      501,
    );
  }

  // ─── 未匹配 → 404 ────────────────────────────────────────────────
  return jsonCors(err(`not found: ${method} ${path}`, 'NOT_FOUND'), 404);
}
