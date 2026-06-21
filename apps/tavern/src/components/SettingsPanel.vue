<script setup lang="ts">
/**
 * SettingsPanel.vue — 后端配置 / 采样参数 / 数据管理。
 *
 *  - 后端切换:local / cloudflare / tencent / direct
 *  - apiBaseUrl / apiKey / model
 *  - crypto 开关(Base64 混淆,免备案防明文审查)
 *  - temperature / maxTokens / stream
 *  - userId(可重新生成)
 *  - 清空本地 IndexedDB(危险操作,二次确认)
 *  - 导出 JSON 备份 / 从 JSON 恢复
 */
import { ref, computed } from 'vue';
import { useConfigStore } from '../store/config';
import { clearAll, exportJson, replaceAll } from '../db/idb';
import { useCharactersStore } from '../store/characters';
import { useWorldInfoStore } from '../store/worldinfo';
import { useChatStore } from '../store/chat';
import type { BackendType, SyncPayload } from '@minist/shared';

const config = useConfigStore();
const characters = useCharactersStore();
const worldinfo = useWorldInfoStore();
const chat = useChatStore();

const cfg = computed(() => config.config);
const backends: Array<{ value: BackendType; label: string; hint: string }> = [
  { value: 'local', label: '本地直连', hint: '数据存本地,直连 LLM 官方(需填 Key)' },
  { value: 'direct', label: '直连 LLM', hint: '显式直连 OpenAI/DeepSeek/智谱官方' },
  { value: 'cloudflare', label: 'Cloudflare Worker', hint: '自部署 CF Worker 中转' },
  { value: 'tencent', label: '腾讯云 SCF', hint: '自部署腾讯云 SCF 中转(免备案)' },
];

/** LLM 厂商预设(均为 OpenAI 兼容接口)。点击只填 base + model + 切到本地直连,API Key 留给用户填。 */
const presets: Array<{ name: string; base: string; model: string }> = [
  { name: 'DeepSeek', base: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { name: 'OpenAI', base: 'https://api.openai.com', model: 'gpt-4o-mini' },
  { name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: 'Kimi', base: 'https://api.moonshot.cn', model: 'moonshot-v1-8k' },
  { name: '通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode', model: 'qwen-turbo' },
  { name: 'SiliconFlow', base: 'https://api.siliconflow.cn', model: 'Qwen/Qwen2.5-7B-Instruct' },
];

async function applyPreset(p: { base: string; model: string }): Promise<void> {
  await config.update({ backend: 'local', apiBaseUrl: p.base, model: p.model });
  message.value = '已填入预设,请继续填写你的 API Key';
}

const message = ref('');

async function update<K extends keyof typeof cfg.value>(key: K, value: (typeof cfg.value)[K]): Promise<void> {
  await config.update({ [key]: value } as Partial<typeof cfg.value>);
}

async function regenUser(): Promise<void> {
  if (!confirm('重新生成用户 ID?云端同步分区会改变,旧数据需用旧 ID 拉取。')) return;
  await config.regenerateUserId();
  message.value = '用户 ID 已更新';
}

async function clearLocal(): Promise<void> {
  if (!confirm('确定清空全部本地数据(角色/对话/世界书/配置)?此操作不可恢复!')) return;
  if (!confirm('再次确认:这将删除所有人物卡与对话历史。')) return;
  await clearAll();
  // 重置 store 状态
  characters.list = [];
  worldinfo.entries = [];
  chat.messages = [];
  message.value = '本地数据已清空,刷新页面后恢复默认配置';
}

async function exportBackup(): Promise<void> {
  const payload = await exportJson(cfg.value.userId);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `minist-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  message.value = '备份已下载';
}

const restoreInput = ref<HTMLInputElement | null>(null);
function triggerRestore(): void {
  restoreInput.value?.click();
}
async function onRestore(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text) as SyncPayload;
    if (typeof payload.version !== 'number' || !Array.isArray(payload.characters)) {
      throw new Error('备份文件格式不正确');
    }
    await replaceAll(payload);
    message.value = '恢复成功,刷新页面生效';
  } catch (err) {
    message.value = '恢复失败:' + (err instanceof Error ? err.message : String(err));
  }
}
</script>

<template>
  <div class="tavern-settings">
    <!-- 后端模式 -->
    <div class="tavern-settings__group">
      <label class="tavern-settings__label">后端模式</label>
      <select
        class="tavern-settings__select"
        :value="cfg.backend"
        @change="update('backend', ($event.target as HTMLSelectElement).value as BackendType)"
      >
        <option v-for="b in backends" :key="b.value" :value="b.value">{{ b.label }}</option>
      </select>
      <p class="tavern-settings__hint">{{ backends.find((b) => b.value === cfg.backend)?.hint }}</p>
    </div>

    <!-- LLM 厂商一键预设 -->
    <div class="tavern-settings__group">
      <label class="tavern-settings__label">LLM 厂商预设(一键填地址 + 模型)</label>
      <div class="tavern-settings__presets">
        <button
          v-for="p in presets"
          :key="p.name"
          type="button"
          class="tavern-settings__preset"
          :class="{ 'is-active': cfg.apiBaseUrl === p.base }"
          @click="applyPreset(p)"
        >{{ p.name }}</button>
      </div>
      <p class="tavern-settings__hint">点击即填入该厂商 API 地址与模型,你再填自己的 API Key 即可聊天(均为 OpenAI 兼容接口)。</p>
    </div>

    <!-- apiBaseUrl -->
    <div class="tavern-settings__group">
      <label class="tavern-settings__label">
        {{ cfg.backend === 'cloudflare' || cfg.backend === 'tencent' ? '后端地址' : 'LLM API 地址' }}
      </label>
      <input
        class="tavern-settings__input"
        type="text"
        :value="cfg.apiBaseUrl"
        placeholder="https://...  (直连填官方域名,如 https://api.deepseek.com)"
        @change="update('apiBaseUrl', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- apiKey -->
    <div class="tavern-settings__group">
      <label class="tavern-settings__label">API Key</label>
      <input
        class="tavern-settings__input"
        type="password"
        :value="cfg.apiKey"
        placeholder="sk-...(仅存本地,通过 Authorization 头透传)"
        @change="update('apiKey', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- model -->
    <div class="tavern-settings__group">
      <label class="tavern-settings__label">模型</label>
      <input
        class="tavern-settings__input"
        type="text"
        :value="cfg.model"
        placeholder="deepseek-chat / gpt-4o-mini / glm-4"
        @change="update('model', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- crypto 开关 -->
    <div class="tavern-settings__group tavern-settings__row">
      <div>
        <label class="tavern-settings__label">Base64 混淆(crypto)</label>
        <p class="tavern-settings__hint">请求体 Base64 编码,免备案防明文审查。仅 cloudflare/tencent 生效。</p>
      </div>
      <label class="tavern-settings__switch">
        <input type="checkbox" :checked="cfg.crypto" @change="update('crypto', ($event.target as HTMLInputElement).checked)" />
        <span></span>
      </label>
    </div>

    <!-- 流式 -->
    <div class="tavern-settings__group tavern-settings__row">
      <div>
        <label class="tavern-settings__label">流式输出</label>
        <p class="tavern-settings__hint">关闭后等完整回复一次性显示(部分 SCF 不支持流式时用)。</p>
      </div>
      <label class="tavern-settings__switch">
        <input type="checkbox" :checked="cfg.stream" @change="update('stream', ($event.target as HTMLInputElement).checked)" />
        <span></span>
      </label>
    </div>

    <!-- temperature -->
    <div class="tavern-settings__group">
      <label class="tavern-settings__label">温度 ({{ cfg.temperature?.toFixed(2) }})</label>
      <input
        type="range"
        min="0"
        max="2"
        step="0.05"
        :value="cfg.temperature"
        @change="update('temperature', parseFloat(($event.target as HTMLInputElement).value))"
      />
    </div>

    <!-- maxTokens -->
    <div class="tavern-settings__group">
      <label class="tavern-settings__label">最大 token</label>
      <input
        class="tavern-settings__input"
        type="number"
        min="64"
        max="8192"
        :value="cfg.maxTokens"
        @change="update('maxTokens', parseInt(($event.target as HTMLInputElement).value, 10))"
      />
    </div>

    <!-- contextWindow -->
    <div class="tavern-settings__group">
      <label class="tavern-settings__label">上下文窗口(历史裁剪预算)</label>
      <input
        class="tavern-settings__input"
        type="number"
        min="2048"
        step="1024"
        :value="cfg.contextWindow"
        @change="update('contextWindow', Math.max(2048, parseInt(($event.target as HTMLInputElement).value, 10) || 32768))"
      />
      <p class="tavern-settings__hint">对话历史 token 超过此值会从最旧开始裁剪,防超长报错。默认 32768。</p>
    </div>

    <!-- userId -->
    <div class="tavern-settings__group">
      <label class="tavern-settings__label">用户 ID(同步分区键)</label>
      <div class="tavern-settings__row">
        <code class="tavern-settings__code">{{ cfg.userId }}</code>
        <button class="tavern-settings__btn tavern-settings__btn--ghost" @click="regenUser">重新生成</button>
      </div>
    </div>

    <!-- 数据管理 -->
    <div class="tavern-settings__group tavern-settings__danger">
      <label class="tavern-settings__label">数据管理</label>
      <div class="tavern-settings__row">
        <button class="tavern-settings__btn" @click="exportBackup">导出 JSON 备份</button>
        <button class="tavern-settings__btn tavern-settings__btn--ghost" @click="triggerRestore">从 JSON 恢复</button>
        <input ref="restoreInput" type="file" accept=".json,application/json" class="tavern-settings__hidden" @change="onRestore" />
      </div>
      <button class="tavern-settings__btn tavern-settings__btn--danger" @click="clearLocal">
        清空本地 IndexedDB
      </button>
    </div>

    <p v-if="message" class="tavern-settings__msg">{{ message }}</p>
  </div>
</template>

<style scoped>
.tavern-settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.tavern-settings__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tavern-settings__row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.tavern-settings__label {
  font-size: 13px;
  color: #a1a1aa;
  font-weight: 500;
}
.tavern-settings__hint {
  margin: 0;
  font-size: 12px;
  color: #71717a;
  line-height: 1.5;
}
.tavern-settings__input,
.tavern-settings__select {
  background: #26263a;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e4e4e7;
  border-radius: 8px;
  padding: 9px 12px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
}
.tavern-settings__input:focus,
.tavern-settings__select:focus {
  border-color: rgba(139, 92, 246, 0.5);
}
.tavern-settings__input[type='range'] {
  padding: 0;
  background: transparent;
  border: none;
}
.tavern-settings__code {
  font-size: 12px;
  background: #26263a;
  padding: 6px 10px;
  border-radius: 6px;
  color: #c4b5fd;
  flex: 1;
  overflow-x: auto;
}
.tavern-settings__btn {
  background: #8b5cf6;
  color: #fff;
  border: none;
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.tavern-settings__btn--ghost {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #d4d4d8;
}
.tavern-settings__btn--danger {
  background: #dc2626;
  align-self: flex-start;
}
.tavern-settings__hidden {
  display: none;
}
.tavern-settings__msg {
  font-size: 13px;
  color: #a5f3a0;
  margin: 0;
}
.tavern-settings__presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tavern-settings__preset {
  background: #26263a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #d4d4d8;
  padding: 7px 12px;
  border-radius: 999px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.tavern-settings__preset:hover {
  border-color: rgba(139, 92, 246, 0.6);
  color: #fff;
}
.tavern-settings__preset.is-active {
  background: rgba(139, 92, 246, 0.2);
  border-color: #8b5cf6;
  color: #fff;
}
.tavern-settings__danger {
  padding: 14px;
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.04);
  gap: 10px;
}
/* switch */
.tavern-settings__switch {
  position: relative;
  width: 42px;
  height: 24px;
  flex-shrink: 0;
  cursor: pointer;
}
.tavern-settings__switch input {
  opacity: 0;
  position: absolute;
  inset: 0;
  cursor: pointer;
}
.tavern-settings__switch span {
  position: absolute;
  inset: 0;
  background: #3f3f5a;
  border-radius: 12px;
  transition: background 0.2s;
}
.tavern-settings__switch span::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #e4e4e7;
  top: 3px;
  left: 3px;
  transition: transform 0.2s;
}
.tavern-settings__switch input:checked + span {
  background: #8b5cf6;
}
.tavern-settings__switch input:checked + span::before {
  transform: translateX(18px);
}
</style>
