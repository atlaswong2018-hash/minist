/**
 * worker-cloudflare/src/routes/chat.ts — D1 聊天历史路由
 *
 * 路由:POST /api/chat/:userId → 追加一条消息
 *       GET  /api/chat/:userId → 读取该用户历史
 *
 * 设计:聊天记录频繁追加,放 D1。
 * ✅ D1 写入约束:免费版 10 万行/天,远高于 KV(1000/天),
 *    适合逐条消息追加。
 *
 * 表结构惰性创建:首次访问时 CREATE TABLE IF NOT EXISTS,无需手动迁移。
 */
import { HEADERS, ok, err, decodeBase64 } from '@minist/shared';
import type { Env } from '../env';
import { jsonCors } from '../cors';

/** 建表(幂等)。在每次写之前调用,代价极低。 */
export async function ensureSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      ts INTEGER NOT NULL
    )`,
  ).run();
  // user_id 索引:加速按用户查询(单分片 D1 索引开销可忽略)。
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, ts)`,
  ).run();
}

/** 从路径提取 userId。 */
function extractUserId(pathname: string): string | null {
  const prefix = '/api/chat/';
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  const userId = decodeURIComponent(raw);
  return userId || null;
}

/** D1 聊天路由分发。 */
export async function handleChat(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const userId =
    extractUserId(url.pathname) ??
    request.headers.get(HEADERS.userId) ??
    null;
  if (!userId) {
    return jsonCors(err('missing userId in path or X-User-Id header', 'BAD_REQUEST'), 400);
  }

  // 读历史(GET)。
  if (request.method === 'GET') {
    await ensureSchema(env.SillyDB);
    const { results } = await env.SillyDB.prepare(
      `SELECT role, content, ts FROM chats WHERE user_id = ? ORDER BY ts ASC`,
    ).bind(userId).all<{ role: string; content: string; ts: number }>();
    return jsonCors(ok({ userId, messages: results ?? [] }), 200);
  }

  // 追加消息(POST)。
  if (request.method === 'POST') {
    await ensureSchema(env.SillyDB);
    let bodyText = await request.text();
    // 支持混淆协议:若 X-Crypto-Data: true,body 是 Base64 密文,先解出 JSON。
    if (request.headers.get(HEADERS.cryptoData) === 'true') {
      try {
        bodyText = decodeBase64(bodyText);
      } catch {
        return jsonCors(err('invalid base64 body', 'BAD_REQUEST'), 400);
      }
    }
    let parsed: { role?: string; content?: string; ts?: number };
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return jsonCors(err('invalid JSON body', 'BAD_REQUEST'), 400);
    }
    const role = parsed.role ?? 'user';
    const content = parsed.content ?? '';
    if (!content) {
      return jsonCors(err('empty content', 'BAD_REQUEST'), 400);
    }
    const ts = parsed.ts ?? Date.now();
    await env.SillyDB.prepare(
      `INSERT INTO chats (user_id, role, content, ts) VALUES (?, ?, ?, ?)`,
    ).bind(userId, role, content, ts).run();
    return jsonCors(ok({ saved: true, ts }), 200);
  }

  return jsonCors(err(`method not allowed: ${request.method}`, 'METHOD_NOT_ALLOWED'), 405);
}
