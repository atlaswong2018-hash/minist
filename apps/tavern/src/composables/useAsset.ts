/**
 * useAsset — 头像(外置资源)懒加载与缓存。
 *
 * 角色卡头像两种形态:
 *  - 内嵌 dataURL(`LocalCharacter.image`,≤1MB 小图 / local 模式):直接用作 src。
 *  - 外置引用(`LocalCharacter.imageRef`,>1MB 大图 + cloudflare/tencent 后端):
 *    先查会话缓存 → IndexedDB 缓存 → 回源对象存储(GET),Blob → objectURL。
 *
 * 会话内 urlCache(sha256→objectURL)避免重复 createObjectURL;
 * IndexedDB assets store 提供跨会话缓存(Phase S2 加体积预算/LRU 淘汰)。
 */
import { ref, watch, type Ref } from 'vue';
import type { LocalCharacter } from '../store/characters';
import { getAdapter } from '../adapters';
import { useConfigStore } from '../store/config';
import { getAsset, putAsset } from '../db/idb';

/** 会话内 sha256 → objectURL 缓存(同图多组件共享,避免重复创建/下载)。 */
const urlCache = new Map<string, string>();

/** 把一个角色的头像解析为可直接用作 <img src> 的字符串(内嵌 dataURL 或 objectURL)。 */
export async function resolveAvatar(c: LocalCharacter): Promise<string | undefined> {
  // 1. 内嵌 dataURL:直接返回(小图 / local 模式)
  if (c.image) return c.image;
  // 2. 既无内嵌也无引用:无头像
  if (!c.imageRef) return undefined;

  const { sha256 } = c.imageRef;
  const cached = urlCache.get(sha256);
  if (cached) return cached;

  try {
    // IndexedDB 跨会话缓存
    let blob = await getAsset(sha256);
    if (!blob) {
      // 回源对象存储
      const config = useConfigStore();
      const adapter = getAdapter(config.config);
      blob = await adapter.downloadAsset(c.imageRef);
      const evicted = await putAsset({ sha256, blob, size: c.imageRef.size });
      // 缓存治理淘汰的资源:revoke 会话内 blob URL,释放内存
      for (const sha of evicted) {
        const u = urlCache.get(sha);
        if (u) {
          URL.revokeObjectURL(u);
          urlCache.delete(sha);
        }
      }
    }
    const url = URL.createObjectURL(blob);
    urlCache.set(sha256, url);
    return url;
  } catch (e) {
    console.warn('[minist] 头像加载失败:', e);
    return undefined;
  }
}

/**
 * 响应式头像:传入指向角色的 Ref,返回解析后的 src Ref。
 * 角色变化时自动重新解析。
 */
export function useAvatar(char: Ref<LocalCharacter | null | undefined>): Ref<string | undefined> {
  const url = ref<string | undefined>(undefined);
  watch(
    char,
    async (c) => {
      url.value = c ? await resolveAvatar(c) : undefined;
    },
    { immediate: true },
  );
  return url;
}
