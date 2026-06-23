/**
 * worker-cloudflare/src/routes/sync.ts — 分片同步路由
 *
 * 路由:
 *   POST   /api/sync                     → 上传非角色数据(worldinfo/presets/config/chats)
 *   GET    /api/sync/:userId             → 拉取非角色数据(characters=[],角色走粒度路由)
 *   GET    /api/sync/cards/:uid          → 角色卡 id 列表(KV prefix 枚举)
 *   GET    /api/sync/card/:uid/:cardId   → 取单卡
 *   PUT    /api/sync/card/:uid/:cardId   → upsert 单卡
 *   DELETE /api/sync/card/:uid/:cardId   → 删单卡
 *
 * 分片策略(Phase S3):角色卡 per-card(`sync:<uid>:char:<id>`),避免全库
 * 单值超 KV 25MB;worldinfo/presets/config 仍单值(典型小),chats 走 D1。
 * 增量同步由前端驱动(仅 PUT/DELETE 变更卡),省 KV 1000 写/天额度。
 *
 * 同一用户的数据用统一前缀 sync:${userId}:* 隔离。
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
const KV_WORLDINFO = (uid: string) => `sync:${uid}:worldinfo`;
const KV_PRESETS = (uid: string) => `sync:${uid}:presets`;
const KV_CONFIG = (uid: string) => `sync:${uid}:config`;
const KV_META = (uid: string) => `sync:${uid}:meta`;
const KV_CARD = (uid: string, cardId: string) => `sync:${uid}:char:${cardId}`;
const KV_CARD_PREFIX = (uid: string) => `sync:${uid}:char:`;

const PATH_SYNC = '/api/sync';
const PATH_CARDS = '/api/sync/cards/';
const PATH_CARD = '/api/sync/card/';

/** 安全 decode 路径段。 */
function decodeSeg(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 同步路由分发(角色卡粒度路由优先,避免被 /:userId 吃掉)。 */
export async function handleSync(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 角色卡 id 列表
  if (path.startsWith(PATH_CARDS) && method === 'GET') {
    const uid = decodeSeg(path.slice(PATH_CARDS.length));
    if (!uid) return jsonCors(err('missing uid', 'BAD_REQUEST'), 400);
    return listCards(env, uid);
  }

  // 单卡 CRUD
  if (path.startsWith(PATH_CARD)) {
    const rest = path.slice(PATH_CARD.length);
    const sep = rest.indexOf('/');
    if (sep < 0) return jsonCors(err('missing cardId', 'BAD_REQUEST'), 400);
    const uid = decodeSeg(rest.slice(0, sep));
    const cardId = decodeSeg(rest.slice(sep + 1));
    if (!uid || !cardId) return jsonCors(err('missing uid/cardId', 'BAD_REQUEST'), 400);
    if (method === 'GET') return getCard(env, uid, cardId);
    if (method === 'PUT') return putCard(request, env, uid, cardId);
    if (method === 'DELETE') return deleteCard(env, uid, cardId);
    return jsonCors(err(`method not allowed: ${method}`, 'METHOD_NOT_ALLOWED'), 405);
  }

  // 非角色数据全量
  if (path === PATH_SYNC && method === 'POST') {
    return uploadSync(request, env);
  }
  if (path.startsWith(PATH_SYNC + '/') && method === 'GET') {
    const uid = decodeSeg(path.slice(PATH_SYNC.length + 1));
    if (uid) return downloadSync(env, uid);
  }

  return jsonCors(err(`method/path not allowed: ${method} ${path}`, 'METHOD_NOT_ALLOWED'), 405);
}

/** POST /api/sync — 非角色数据(worldinfo/presets/config/chats)。characters 不在此同步。 */
async function uploadSync(request: Request, env: Env): Promise<Response> {
  let bodyText = await request.text();
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

  // KV:worldinfo / presets / config / meta(角色卡不在此,走粒度路由)
  await env.SillyKV.put(KV_WORLDINFO(uid), JSON.stringify(payload.worldinfo ?? []));
  await env.SillyKV.put(KV_PRESETS(uid), JSON.stringify(payload.presets ?? []));
  if (payload.config !== undefined) {
    await env.SillyKV.put(KV_CONFIG(uid), JSON.stringify(payload.config));
  }
  await env.SillyKV.put(
    KV_META(uid),
    JSON.stringify({ version: payload.version ?? SYNC_VERSION, exportedAt: ts }),
  );

  // D1:chats 全量替换
  await ensureSchema(env.SillyDB);
  await env.SillyDB.prepare(`DELETE FROM chats WHERE user_id = ?`).bind(uid).run();
  const chats = Array.isArray(payload.chats) ? payload.chats : [];
  for (const msg of chats) {
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

/** GET /api/sync/:userId — 非角色数据(characters=[],由前端粒度拉取)。 */
async function downloadSync(env: Env, userId: string): Promise<Response> {
  const [worldinfoRaw, presetsRaw, configRaw, metaRaw, chatsRes] = await Promise.all([
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
    characters: [], // 角色卡走粒度路由 GET /api/sync/cards + /card
    worldinfo: parse(worldinfoRaw, []) as unknown[],
    chats: (chatsRes.results ?? []) as unknown[],
    presets: parse(presetsRaw, []) as unknown[],
    config: configRaw !== null ? (parse(configRaw, undefined) as SyncPayload['config']) : undefined,
  };

  return jsonCors(ok(payload), 200);
}

/** GET /api/sync/cards/:uid — 角色卡 id 列表(KV prefix 枚举,自动翻页)。 */
async function listCards(env: Env, uid: string): Promise<Response> {
  const prefix = KV_CARD_PREFIX(uid);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await env.SillyKV.list({ prefix, limit: 1000, cursor });
    for (const k of res.keys) {
      if (k.name.startsWith(prefix)) ids.push(k.name.slice(prefix.length));
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return jsonCors(ok({ ids }), 200);
}

/** GET /api/sync/card/:uid/:cardId — 取单卡(返回原始 JSON 字符串)。 */
async function getCard(env: Env, uid: string, cardId: string): Promise<Response> {
  const raw = await env.SillyKV.get(KV_CARD(uid, cardId));
  if (raw === null) {
    return jsonCors(err(`card not found: ${cardId}`, 'NOT_FOUND'), 404);
  }
  return jsonCors(ok({ id: cardId, data: raw }), 200);
}

/** PUT /api/sync/card/:uid/:cardId — upsert 单卡(body=卡片 JSON 字符串)。 */
async function putCard(request: Request, env: Env, uid: string, cardId: string): Promise<Response> {
  const body = await request.text();
  if (!body) {
    return jsonCors(err('empty body', 'BAD_REQUEST'), 400);
  }
  await env.SillyKV.put(KV_CARD(uid, cardId), body);
  return jsonCors(ok({ id: cardId }), 200);
}

/** DELETE /api/sync/card/:uid/:cardId — 删单卡。 */
async function deleteCard(env: Env, uid: string, cardId: string): Promise<Response> {
  await env.SillyKV.delete(KV_CARD(uid, cardId));
  return jsonCors(ok({ id: cardId, deleted: true }), 200);
}
