/**
 * IndexedDB 封装 — minist 酒馆本地存储。
 *
 * 用 idb 库提供 Promise 化 API。object stores:
 *  - characters:角色卡(以 id 为 key)
 *  - chats:对话(以 characterId 为 key,值为 ChatMessage[])
 *  - worldinfo:世界书条目(以 uid 为 key)
 *  - presets:预设(以 name 为 key)
 *  - kv:杂项键值(主要存 config 与元数据)
 *
 * 全部 CRUD helper + 全量导出/导入(SyncPayload),供同步面板与备份使用。
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { SyncPayload, TavernConfig } from '@minist/shared';
import { SYNC_VERSION } from '@minist/shared';

const DB_NAME = 'minist-tavern';
const DB_VERSION = 2;

/** store 名常量,供各 store 引用。 */
export const STORES = {
  characters: 'characters',
  chats: 'chats',
  worldinfo: 'worldinfo',
  presets: 'presets',
  kv: 'kv',
  /** 外置资源的本地缓存(key=sha256,内容寻址)。Phase S2 加体积预算/LRU。 */
  assets: 'assets',
} as const;

/** kv store 中存 config 的固定 key。 */
export const KV_CONFIG_KEY = 'config';
/** kv store 中存"上次同步时间"的 key。 */
export const KV_LAST_SYNC = 'lastSyncAt';

let dbPromise: Promise<IDBPDatabase> | null = null;

/** 懒加载 DB 单例(浏览器环境才打开)。 */
function getDB(): Promise<IDBPDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORES.characters)) {
        db.createObjectStore(STORES.characters, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.chats)) {
        db.createObjectStore(STORES.chats, { keyPath: 'characterId' });
      }
      if (!db.objectStoreNames.contains(STORES.worldinfo)) {
        db.createObjectStore(STORES.worldinfo, { keyPath: 'uid' });
      }
      if (!db.objectStoreNames.contains(STORES.presets)) {
        db.createObjectStore(STORES.presets, { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains(STORES.kv)) {
        db.createObjectStore(STORES.kv);
      }
      if (!db.objectStoreNames.contains(STORES.assets)) {
        // v2 新增:外置资源本地缓存,以 sha256 为 key(内容寻址,跨卡去重)
        db.createObjectStore(STORES.assets, { keyPath: 'sha256' });
      }
    },
  }).catch((e) => {
    // 打开失败(如 Safari 隐私模式 quota 拒绝):重置单例允许下次重试,
    // 避免永久持有 rejected promise 导致整个 app 不可自愈。
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

// ── 通用 CRUD ─────────────────────────────────────────────────────────

/** 读取某 store 全部记录。 */
export async function getAll<T>(store: string): Promise<T[]> {
  const db = await getDB();
  return (await db.getAll(store)) as T[];
}

/** 按 key 读取单条。 */
export async function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get(store, key)) as T | undefined;
}

/** 写入(upsert)单条。 */
export async function put(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await getDB();
  await db.put(store, value, key);
}

/** 批量写入(upsert)。 */
export async function putMany(store: string, values: unknown[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(store, 'readwrite');
  await Promise.all(values.map((v) => tx.store.put(v)));
  await tx.done;
}

/** 按 key 删除单条。 */
export async function del(store: string, key: IDBValidKey): Promise<void> {
  const db = await getDB();
  await db.delete(store, key);
}

/** 清空某 store(不删除 store 本身)。 */
export async function clearStore(store: string): Promise<void> {
  const db = await getDB();
  await db.clear(store);
}

// ── kv 便捷封装 ────────────────────────────────────────────────────────

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return get<T>(STORES.kv, key);
}

export async function kvPut(key: string, value: unknown): Promise<void> {
  await put(STORES.kv, value, key);
}

export async function kvDel(key: string): Promise<void> {
  await del(STORES.kv, key);
}

// ── 外置资源缓存(sha256 内容寻址)──────────────────────────────────────

/** 资源缓存记录。Blob 由 IndexedDB 结构化克隆直接持久化。 */
export interface AssetCacheRecord {
  sha256: string;
  blob: Blob;
  size: number;
  /** 最近使用时间(ms),LRU 淘汰依据。 */
  lastUsed: number;
}

/** 取缓存的资源 Blob(未缓存返回 undefined)。命中时顺带 touch lastUsed(LRU),fire-and-forget。 */
export async function getAsset(sha256: string): Promise<Blob | undefined> {
  const rec = await get<AssetCacheRecord>(STORES.assets, sha256);
  if (!rec) return undefined;
  // 仅在 urlCache miss 时命中此路径,频率低;异步 touch 不阻塞读
  void put(STORES.assets, { ...rec, lastUsed: Date.now() } as AssetCacheRecord);
  return rec.blob;
}

/** 写入资源缓存,并按预算 LRU 淘汰;返回被淘汰的 sha256 列表(供调用方 revoke blob URL)。 */
export async function putAsset(asset: {
  sha256: string;
  blob: Blob;
  size: number;
}): Promise<string[]> {
  await put(STORES.assets, { ...asset, lastUsed: Date.now() } as AssetCacheRecord);
  return enforceAssetBudget(await getAssetBudget());
}

/** 默认资源缓存预算(估算失败兜底)。 */
const DEFAULT_ASSET_BUDGET = 500 * 1024 * 1024; // 500MB
let budgetCache: number | null = null;

/**
 * 动态资源缓存预算(Phase S2):
 *  优先 navigator.storage.estimate() 可用配额的 ~30%;
 *  失败则按 navigator.deviceMemory 分档(≤4GB→300MB,否则→1GB);
 *  最终兜底 500MB。上下界 [100MB, 2GB],结果缓存。
 */
export async function getAssetBudget(): Promise<number> {
  if (budgetCache !== null) return budgetCache;
  let budget = DEFAULT_ASSET_BUDGET;
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.quota && est.quota > 0) budget = Math.floor(est.quota * 0.3);
    }
  } catch {
    /* 部分隐私模式 estimate 可能抛错,忽略走兜底 */
  }
  if (budget === DEFAULT_ASSET_BUDGET) {
    const dm = (navigator as { deviceMemory?: number }).deviceMemory;
    if (dm && dm <= 4) budget = 300 * 1024 * 1024;
    else if (dm) budget = 1 * 1024 * 1024 * 1024;
  }
  budget = Math.min(Math.max(budget, 100 * 1024 * 1024), 2 * 1024 * 1024 * 1024);
  budgetCache = budget;
  return budget;
}

/**
 * 按 lastUsed 升序淘汰最旧资源,直到总占用 ≤ budget(防 20GB 全库撑爆 IndexedDB)。
 * @returns 被淘汰的 sha256 列表
 */
export async function enforceAssetBudget(budget: number): Promise<string[]> {
  const db = await getDB();
  const all = (await db.getAll(STORES.assets)) as AssetCacheRecord[];
  const total = all.reduce((s, r) => s + (r.size || 0), 0);
  if (total <= budget) return [];
  const sorted = [...all].sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
  const evicted: string[] = [];
  let cur = total;
  for (const r of sorted) {
    if (cur <= budget) break;
    await db.delete(STORES.assets, r.sha256);
    cur -= r.size || 0;
    evicted.push(r.sha256);
  }
  return evicted;
}

// ── 全量导出 / 导入 / 清空 ─────────────────────────────────────────────

/** 把本地全部数据打包为 SyncPayload,用于云同步与备份下载。 */
export async function loadAll(userId: string): Promise<SyncPayload> {
  const [characters, chats, worldinfo, presets, config] = await Promise.all([
    getAll(STORES.characters),
    getAll(STORES.chats),
    getAll(STORES.worldinfo),
    getAll(STORES.presets),
    kvGet<TavernConfig>(KV_CONFIG_KEY),
  ]);
  return {
    version: SYNC_VERSION,
    exportedAt: Date.now(),
    userId,
    characters,
    chats,
    worldinfo,
    presets,
    config,
  };
}

/** 用 SyncPayload 全量替换本地数据(先清空再写入,含 config 同事务完成)。 */
export async function replaceAll(payload: SyncPayload): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    [STORES.characters, STORES.chats, STORES.worldinfo, STORES.presets, STORES.kv],
    'readwrite',
  );
  await Promise.all([
    tx.objectStore(STORES.characters).clear(),
    tx.objectStore(STORES.chats).clear(),
    tx.objectStore(STORES.worldinfo).clear(),
    tx.objectStore(STORES.presets).clear(),
  ]);
  await Promise.all([
    ...payload.characters.map((c) => tx.objectStore(STORES.characters).put(c)),
    ...payload.chats.map((c) => tx.objectStore(STORES.chats).put(c)),
    ...payload.worldinfo.map((w) => tx.objectStore(STORES.worldinfo).put(w)),
    ...payload.presets.map((p) => tx.objectStore(STORES.presets).put(p)),
    // config 与其余数据同事务写入,避免半替换不一致(kv store 无 keyPath,显式传 key)
    ...(payload.config ? [tx.objectStore(STORES.kv).put(payload.config, KV_CONFIG_KEY)] : []),
  ]);
  await tx.done;
}

/** 清空全部本地数据(慎用,设置面板"清空本地数据"调用)。 */
export async function clearAll(): Promise<void> {
  await Promise.all([
    clearStore(STORES.characters),
    clearStore(STORES.chats),
    clearStore(STORES.worldinfo),
    clearStore(STORES.presets),
    clearStore(STORES.kv),
    clearStore(STORES.assets),
  ]);
}

/** 导出为 SyncPayload(语义同 loadAll,显式命名供备份按钮调用)。 */
export async function exportJson(userId: string): Promise<SyncPayload> {
  return loadAll(userId);
}
