/**
 * 世界书 store — 独立世界书条目 CRUD。
 *
 * 与人物卡内嵌 CharacterBook 区分:这里是用户自建的 lorebook,存 IndexedDB。
 * buildMessages 时把当前 list 转为 WorldInfoBook 喂给 activateEntries。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { WorldInfoBook, WorldInfoEntry } from '@minist/core';
import { STORES, del, getAll, put } from '../db/idb';

export const useWorldInfoStore = defineStore('worldinfo', () => {
  const entries = ref<WorldInfoEntry[]>([]);

  /** 转为 WorldInfoBook 供 buildMessages 使用。 */
  const book = computed<WorldInfoBook>(() => ({
    name: '我的世界书',
    entries: entries.value,
  }));

  async function load(): Promise<void> {
    entries.value = await getAll<WorldInfoEntry>(STORES.worldinfo);
  }

  /** 生成下一个 uid(整数递增)。 */
  function nextUid(): number {
    const maxUid = entries.value.reduce((m, e) => {
      const n = typeof e.uid === 'number' ? e.uid : parseInt(String(e.uid), 10);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return maxUid + 1;
  }

  /** 新建空条目(带默认值)。 */
  function createEntry(partial: Partial<WorldInfoEntry> = {}): WorldInfoEntry {
    return {
      uid: nextUid(),
      key: [],
      secondary_keys: [],
      content: '',
      comment: '',
      order: 100,
      position: 'before_char',
      enabled: true,
      constant: false,
      selective: false,
      case_sensitive: false,
      ...partial,
    };
  }

  async function add(entry: WorldInfoEntry): Promise<void> {
    const e = { ...entry, uid: entry.uid ?? nextUid() };
    await put(STORES.worldinfo, e);
    entries.value = [...entries.value, e];
  }

  async function update(entry: WorldInfoEntry): Promise<void> {
    await put(STORES.worldinfo, entry);
    entries.value = entries.value.map((e) => (e.uid === entry.uid ? entry : e));
  }

  async function remove(uid: number | string): Promise<void> {
    await del(STORES.worldinfo, uid);
    entries.value = entries.value.filter((e) => e.uid !== uid);
  }

  async function clear(): Promise<void> {
    const snapshot = [...entries.value];
    entries.value = [];
    // 逐条删
    for (const e of snapshot) await del(STORES.worldinfo, e.uid);
  }

  return {
    entries,
    book,
    load,
    createEntry,
    add,
    update,
    remove,
    clear,
  };
});
