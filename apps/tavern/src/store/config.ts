/**
 * 配置 store — 后端模式 / API 凭据 / 模型 / 采样参数 / userId。
 *
 * 持久化在 IndexedDB kv(config key)。首次进入若无配置,生成默认值:
 *  - backend = 'local'(零配置即可用,聊天走 direct 透传提示填 Key)
 *  - userId 自动 generateUserId 持久化
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { BackendType, TavernConfig } from '@minist/shared';
import { generateUserId } from '@minist/shared';
import { KV_CONFIG_KEY, kvGet, kvPut } from '../db/idb';

const DEFAULT_CONFIG: TavernConfig = {
  backend: 'local',
  apiBaseUrl: '',
  apiKey: '',
  model: 'deepseek-chat',
  crypto: false,
  userId: '',
  temperature: 0.8,
  maxTokens: 1024,
  stream: true,
};

export const useConfigStore = defineStore('config', () => {
  const config = ref<TavernConfig>({ ...DEFAULT_CONFIG, userId: generateUserId() });
  const loaded = ref(false);

  /** 生效的后端模式:local 视为 direct(本地无中转,直连 LLM)。 */
  const effectiveBackend = computed<BackendType>(() =>
    config.value.backend === 'local' ? 'direct' : config.value.backend,
  );

  /** 是否已配置可发聊天:direct/cloudflare/tencent 都需要 apiBaseUrl + apiKey。 */
  const canChat = computed(() => {
    if (!config.value.apiKey) return false;
    if (effectiveBackend.value === 'direct' || effectiveBackend.value === 'cloudflare' || effectiveBackend.value === 'tencent') {
      return Boolean(config.value.apiBaseUrl);
    }
    return false;
  });

  async function load(): Promise<void> {
    const saved = await kvGet<TavernConfig>(KV_CONFIG_KEY);
    if (saved) {
      // 合并以兼容新增字段
      config.value = { ...DEFAULT_CONFIG, ...saved };
    } else {
      // 首次进入,持久化默认 userId
      await kvPut(KV_CONFIG_KEY, config.value);
    }
    loaded.value = true;
  }

  async function save(): Promise<void> {
    await kvPut(KV_CONFIG_KEY, config.value);
  }

  /** 局部更新并持久化。 */
  async function update(patch: Partial<TavernConfig>): Promise<void> {
    config.value = { ...config.value, ...patch };
    await save();
  }

  /** 重置 userId(换设备/清除身份时)。 */
  async function regenerateUserId(): Promise<void> {
    config.value = { ...config.value, userId: generateUserId() };
    await save();
  }

  return {
    config,
    loaded,
    effectiveBackend,
    canChat,
    load,
    save,
    update,
    regenerateUserId,
  };
});
