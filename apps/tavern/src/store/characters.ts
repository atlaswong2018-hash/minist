/**
 * 角色 store — 人物卡 CRUD + 文件导入。
 *
 * 导入时调用 @minist/core.parseCardFile 在浏览器内解析 PNG(tEXt chara/ccv3)
 * 与 JSON,不经过后端。解析后存入 IndexedDB characters store。
 *
 * 卡片本地结构:带 id + image(dataURL)+ card(规范化后)。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { CharacterCard } from '@minist/core';
import { parseCardFile } from '@minist/core';
import { STORES, del, getAll, put } from '../db/idb';

/** 本地存储的人物卡记录(包装规范化卡片 + 头像)。 */
export interface LocalCharacter {
  /** 本地唯一 id(用 name + 创建时间戳)。 */
  id: string;
  /** 规范化后的人物卡(V2/V3)。 */
  card: CharacterCard;
  /** 头像 dataURL(PNG 来源);无图时 undefined。 */
  image?: string;
  /** 创建时间。 */
  createdAt: number;
  /** 来源版本(v1/v2/v3),用于 UI 提示。 */
  spec: 'v1' | 'v2' | 'v3';
}

/** 当前选中角色的 id(本地持久化可选,这里仅内存)。 */
const STORAGE_CURRENT = 'tavern-current-character';

export const useCharactersStore = defineStore('characters', () => {
  const list = ref<LocalCharacter[]>([]);
  const currentId = ref<string | null>(null);
  const importing = ref(false);
  const importMessage = ref<string>('');

  const current = computed<LocalCharacter | null>(
    () => list.value.find((c) => c.id === currentId.value) ?? null,
  );

  async function load(): Promise<void> {
    list.value = await getAll<LocalCharacter>(STORES.characters);
    // 恢复上次选中
    const saved = localStorage.getItem(STORAGE_CURRENT);
    if (saved && list.value.some((c) => c.id === saved)) {
      currentId.value = saved;
    } else if (list.value.length > 0) {
      currentId.value = list.value[0].id;
    }
  }

  function select(id: string): void {
    currentId.value = id;
    localStorage.setItem(STORAGE_CURRENT, id);
  }

  async function add(card: CharacterCard, image?: string, spec: 'v1' | 'v2' | 'v3' = 'v2'): Promise<LocalCharacter> {
    const name = card.data?.name || '未命名角色';
    const rec: LocalCharacter = {
      id: `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      card,
      image,
      createdAt: Date.now(),
      spec,
    };
    await put(STORES.characters, rec);
    list.value = [...list.value, rec];
    if (!currentId.value) select(rec.id);
    return rec;
  }

  async function update(id: string, card: CharacterCard): Promise<void> {
    const idx = list.value.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const updated: LocalCharacter = { ...list.value[idx], card };
    await put(STORES.characters, updated);
    list.value = list.value.map((c) => (c.id === id ? updated : c));
  }

  async function remove(id: string): Promise<void> {
    await del(STORES.characters, id);
    list.value = list.value.filter((c) => c.id !== id);
    if (currentId.value === id) {
      currentId.value = list.value[0]?.id ?? null;
      if (currentId.value) localStorage.setItem(STORAGE_CURRENT, currentId.value);
      else localStorage.removeItem(STORAGE_CURRENT);
    }
  }

  /**
   * 从文件导入人物卡(支持多选)。
   * 浏览器内解析,不经后端。
   * @returns 成功导入数量
   */
  async function importFiles(files: File[]): Promise<number> {
    importing.value = true;
    importMessage.value = '';
    let ok = 0;
    let fail = 0;
    try {
      for (const file of files) {
        try {
          const { card, spec, image } = await parseCardFile(file);
          await add(card, image, spec);
          ok++;
        } catch (e) {
          fail++;
          console.error('[minist] 导入人物卡失败:', file.name, e);
        }
      }
      importMessage.value =
        fail > 0 ? `成功 ${ok} 个,失败 ${fail} 个` : `成功导入 ${ok} 张人物卡`;
    } finally {
      importing.value = false;
    }
    return ok;
  }

  return {
    list,
    currentId,
    current,
    importing,
    importMessage,
    load,
    select,
    add,
    update,
    remove,
    importFiles,
  };
});
