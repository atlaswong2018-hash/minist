<script setup lang="ts">
/**
 * SyncPanel.vue — 云同步。
 *
 *  - 同步到云端:打包本地 IndexedDB → adapter.sync(payload)
 *  - 从云端恢复:adapter.pull() → replaceAll(payload)
 *  - 显示上次同步时间(本地 kv 记录)
 *
 * local/direct 后端不支持云同步,面板提示用户切换到 cloudflare/tencent。
 */
import { ref, computed, onMounted } from 'vue';
import { useConfigStore } from '../store/config';
import { loadAll, replaceAll, kvGet, kvPut } from '../db/idb';
import { getAdapter } from '../adapters';
import type { SyncPayload } from '@minist/shared';

const config = useConfigStore();

const syncing = ref(false);
const message = ref('');
const lastSync = ref<number | null>(null);
const KV_LAST_SYNC = 'lastSyncAt';

const canSync = computed(() => config.config.backend === 'cloudflare' || config.config.backend === 'tencent');

onMounted(async () => {
  lastSync.value = (await kvGet<number>(KV_LAST_SYNC)) ?? null;
});

async function syncUp(): Promise<void> {
  if (!canSync.value) {
    message.value = '当前后端不支持云同步,请切换到 Cloudflare 或腾讯云 SCF。';
    return;
  }
  if (!config.config.apiBaseUrl) {
    message.value = '请先在「设置」填写后端地址。';
    return;
  }
  syncing.value = true;
  message.value = '';
  try {
    const payload = await loadAll(config.config.userId);
    const adapter = getAdapter(config.config);
    await adapter.sync(payload);
    lastSync.value = Date.now();
    await kvPut(KV_LAST_SYNC, lastSync.value);
    message.value = `已同步 ${payload.characters.length} 角色 / ${payload.chats.length} 对话 / ${payload.worldinfo.length} 世界书条目`;
  } catch (e) {
    message.value = '同步失败:' + (e instanceof Error ? e.message : String(e));
  } finally {
    syncing.value = false;
  }
}

async function syncDown(): Promise<void> {
  if (!canSync.value) {
    message.value = '当前后端不支持云同步,请切换到 Cloudflare 或腾讯云 SCF。';
    return;
  }
  if (!confirm('从云端恢复会覆盖本地全部数据(角色/对话/世界书),确定继续?')) return;
  syncing.value = true;
  message.value = '';
  try {
    const adapter = getAdapter(config.config);
    const payload = (await adapter.pull()) as SyncPayload | null;
    if (!payload) {
      message.value = '云端无数据可恢复。';
      return;
    }
    await replaceAll(payload);
    message.value = `已恢复 ${payload.characters.length} 角色 / ${payload.chats.length} 对话 / ${payload.worldinfo.length} 世界书条目。刷新页面生效。`;
  } catch (e) {
    message.value = '恢复失败:' + (e instanceof Error ? e.message : String(e));
  } finally {
    syncing.value = false;
  }
}

function fmt(ts: number | null): string {
  if (!ts) return '从未同步';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<template>
  <div class="tavern-sync">
    <div v-if="!canSync" class="tavern-sync__warn">
      云同步仅支持 Cloudflare Worker / 腾讯云 SCF 后端。当前为「{{ config.config.backend }}」。
    </div>

    <div class="tavern-sync__meta">
      <div class="tavern-sync__row"><span>后端</span><code>{{ config.config.backend }}</code></div>
      <div class="tavern-sync__row"><span>用户 ID</span><code>{{ config.config.userId }}</code></div>
      <div class="tavern-sync__row"><span>上次同步</span><code>{{ fmt(lastSync) }}</code></div>
    </div>

    <div class="tavern-sync__actions">
      <button class="tavern-sync__btn" :disabled="syncing || !canSync" @click="syncUp">
        {{ syncing ? '处理中…' : '↑ 同步到云端' }}
      </button>
      <button class="tavern-sync__btn tavern-sync__btn--ghost" :disabled="syncing || !canSync" @click="syncDown">
        ↓ 从云端恢复
      </button>
    </div>

    <p v-if="message" class="tavern-sync__msg">{{ message }}</p>

    <p class="tavern-sync__hint">
      同步会把本地角色卡 / 对话 / 世界书 / 预设打包上传到后端 KV 存储,以用户 ID 为分区键。
      恢复时本地数据被云端覆盖。建议定期「同步到云端」并搭配设置面板的「导出 JSON 备份」双保险。
    </p>
  </div>
</template>

<style scoped>
.tavern-sync {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.tavern-sync__warn {
  background: rgba(245, 158, 11, 0.1);
  color: #fbbf24;
  font-size: 13px;
  padding: 10px 12px;
  border-radius: 8px;
}
.tavern-sync__meta {
  background: #26263a;
  border-radius: 10px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tavern-sync__row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}
.tavern-sync__row span {
  color: #71717a;
}
.tavern-sync__row code {
  color: #c4b5fd;
  font-size: 12px;
}
.tavern-sync__actions {
  display: flex;
  gap: 8px;
}
.tavern-sync__btn {
  flex: 1;
  background: #8b5cf6;
  color: #fff;
  border: none;
  padding: 10px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}
.tavern-sync__btn:disabled {
  background: #3f3f5a;
  color: #71717a;
  cursor: not-allowed;
}
.tavern-sync__btn--ghost {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #d4d4d8;
}
.tavern-sync__btn--ghost:disabled {
  background: transparent;
}
.tavern-sync__msg {
  font-size: 13px;
  color: #a5f3a0;
  margin: 0;
}
.tavern-sync__hint {
  font-size: 12px;
  color: #71717a;
  line-height: 1.6;
  margin: 0;
}
</style>
