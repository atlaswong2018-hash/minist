/**
 * worker-cloudflare/src/routes/sync.ts — 全量同步路由
 *
 * 路由:POST /api/sync             → 上传全量负载(拆分存储)
 *       GET  /api/sync/:userId    → 组装返回全量负载
 *
 * 拆分策略(基于 CF 各资源额度优化):
 *   - characters / worldinfo / presets / config → KV(读多写少,KV 适合)
 *   - chats → D1(频繁追加,D1 10 万写/天 vs KV 1000/天)
 *
 * 同一用户的数据用统一前缀 sync:${userId}:* 隔离。
 * ⚠️ 注意:characters/worldinfo 数组整体序列化为单值存 KV,
 *    每次全量同步覆盖写。单 key 上限 25MB(KV 限制),足够个人角色库。
 *    若超限,后续可拆分为多 key 分页。
 */
import {
  HEADERS,
  SYNC_VERSION,
  decodeBase64,
  ok,
  err,
} from '@minist/shared';
import type { SyncPayload } from '@minist/shared';
import type { Env } from '../env';
import { jsonCors } from '../cors';
import { ensureSchema } from './chat';

/** KV key 前缀。 */
const KV_CHARACTERS = (uid: string) => `sync:${uid}:characters`;
const KV_WORLDINFO = (uid: string) => `sync:${uid}:worldinfo`;
const KV_PRESETS = (uid: string) => `sync:${uid}:presets`;
const KV_CONFIG = (uid: string) => `sync:${uid}:config`;
const KV_META = (uid: string) => `sync:${uid}:meta`;

/** 从路径提取 userId。 */
function extractUserId(pathname: string): string | null {
  const prefix = '/api/sync/';
  if (!pathname.startsWith(prefix)) return null;
  const raw = pathname.slice(prefix.length);
  return raw ? decodeURIComponent(raw) : null;
}

/** 同步路由分发。 */
export async function handleSync(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // 上传全量。
  if (url.pathname === '/api/sync' && request.method === 'POST') {
    return uploadSync(request, env);
  }

  // 拉取全量。
  const userId = extractUserId(url.pathname);
  if (userId && request.method === 'GET') {
    return downloadSync(env, userId);
  }

  return jsonCors(err(`method/path not allowed: ${request.method} ${url.pathname}`, 'METHOD_NOT_ALLOWED'), 405);
}

/** POST /api/sync — 拆分存储。 */
async function uploadSync(request: Request, env: Env): Promise<Response> {
  let bodyText = await request.text();
  // 支持混淆:若 X-Crypto-Data: true,body 为 Base64 密文。
  if (request.headers.get(HEADERS.cryptoData) === 'true') {
    try {
      bodyText = decodeBase64(bodyText);
    } catch {
      return jsonCors(err('invalid base64 body', 'BAD_REQUEST'), 400);
    }
  }
  let payload: SyncPayload;
  try {
    payload = JSON.parse(bodyText) as SyncPayload;
  } catch {
    return jsonCors(err('invalid JSON body', 'BAD_REQUEST'), 400);
  }
  if (!payload.userId) {
    return jsonCors(err('missing userId in payload', 'BAD_REQUEST'), 400);
  }

  const uid = payload.userId;
  const ts = payload.exportedAt ?? Date.now();

  // KV 部分:characters / worldinfo / presets / config。
  // ⚠️ KV 写额度仅 1000/天,频繁全量同步会快速耗尽。
  //    建议:前端做"脏数据"检测,仅在角色卡变更时才上传这部分。
  await env.SillyKV.put(KV_CHARACTERS(uid), JSON.stringify(payload.characters ?? []));
  await env.SillyKV.put(KV_WORLDINFO(uid), JSON.stringify(payload.worldinfo ?? []));
  await env.SillyKV.put(KV_PRESETS(uid), JSON.stringify(payload.presets ?? []));
  if (payload.config !== undefined) {
    await env.SillyKV.put(KV_CONFIG(uid), JSON.stringify(payload.config));
  }
  await env.SillyKV.put(
    KV_META(uid),
    JSON.stringify({ version: payload.version ?? SYNC_VERSION, exportedAt: ts }),
  );

  // D1 部分:chats 全量替换(先删后插,保证一致性)。
  // ✅ D1 写额度 10 万/天,适合频繁聊天同步。
  await ensureSchema(env.SillyDB);
  await env.SillyDB.prepare(
    `DELETE FROM chats WHERE user_id = ?`,
  ).bind(uid).run();
  const chats = Array.isArray(payload.chats) ? payload.chats : [];
  for (const msg of chats) {
    // 容错:消息结构可能多样,提取 role/content/ts,缺失给默认。
    const m = msg as { role?: string; content?: string; ts?: number };
    const role = m.role ?? 'user';
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
    const msgTs = m.ts ?? ts;
    await env.SillyDB.prepare(
      `INSERT INTO chats (user_id, role, content, ts) VALUES (?, ?, ?, ?)`,
    ).bind(uid, role, content, msgTs).run();
  }

  return jsonCors(ok({ synced: true, userId: uid, chatCount: chats.length, ts }), 200);
}

/** GET /api/sync/:userId — 组装返回。 */
async function downloadSync(env: Env, userId: string): Promise<Response> {
  // 并行从 KV 与 D1 取数。
  const [charactersRaw, worldinfoRaw, presetsRaw, configRaw, metaRaw, chatsRes] =
    await Promise.all([
      env.SillyKV.get(KV_CHARACTERS(userId)),
      env.SillyKV.get(KV_WORLDINFO(userId)),
      env.SillyKV.get(KV_PRESETS(userId)),
      env.SillyKV.get(KV_CONFIG(userId)),
      env.SillyKV.get(KV_META(userId)),
      env.SillyDB.prepare(
        `SELECT role, content, ts FROM chats WHERE user_id = ? ORDER BY ts ASC`,
      ).bind(userId).all<{ role: string; content: string; ts: number }>(),
    ]);

  const parse = (s: string | null, fallback: unknown) => {
    if (s === null) return fallback;
    try {
      return JSON.parse(s);
    } catch {
      return fallback;
    }
  };

  const meta = parse(metaRaw, {}) as { version?: number; exportedAt?: number };
  const payload: SyncPayload = {
    version: meta.version ?? SYNC_VERSION,
    exportedAt: meta.exportedAt ?? Date.now(),
    userId,
    characters: parse(charactersRaw, []) as unknown[],
    worldinfo: parse(worldinfoRaw, []) as unknown[],
    chats: (chatsRes.results ?? []) as unknown[],
    presets: parse(presetsRaw, []) as unknown[],
    config: configRaw !== null ? (parse(configRaw, undefined) as SyncPayload['config']) : undefined,
  };

  return jsonCors(ok(payload), 200);
}
