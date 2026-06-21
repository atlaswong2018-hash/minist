<script setup lang="ts">
/**
 * SyncCenter — 角色卡 & 世界书同步。
 * - 上传:本地导出的 SyncPayload JSON → 推送到 CF (POST /api/sync) 或腾讯 (POST /api/sync)
 * - 拉取:从云端按 userId 恢复
 * 含进度与结果展示。
 */
import { computed, reactive, ref } from 'vue';
import {
  platformConfig,
  pushSync,
  pullSync,
  usePlatformApi,
} from '../composables/usePlatformApi';
import type { SyncPayload, DeployTarget } from '@minist/shared';

const target = ref<DeployTarget>('cloudflare');

const targetBaseUrl = computed(() =>
  target.value === 'cloudflare' ? platformConfig.cfWorkerUrl : platformConfig.tencentScfUrl,
);

// 上传
const uploadState = reactive({
  fileName: '',
  payload: null as SyncPayload | null,
  parseError: '',
});

const { loading: pushLoading, error: pushError, run: runPush } = usePlatformApi();
const pushResult = ref<unknown>(null);

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploadState.fileName = file.name;
  uploadState.parseError = '';
  pushResult.value = null;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result)) as SyncPayload;
      if (!parsed.version || !parsed.userId) {
        throw new Error('缺少 version 或 userId 字段,不是有效的 SyncPayload');
      }
      uploadState.payload = parsed;
    } catch (err) {
      uploadState.parseError = `解析失败: ${(err as Error).message}`;
      uploadState.payload = null;
    }
  };
  reader.onerror = () => (uploadState.parseError = '文件读取失败');
  reader.readAsText(file);
}

async function doPush() {
  if (!uploadState.payload) {
    alert('请先选择有效的 SyncPayload JSON 文件');
    return;
  }
  if (!targetBaseUrl.value) {
    alert(`请先在"配置"页填写${target.value === 'cloudflare' ? 'CF Worker' : '腾讯 SCF'} URL`);
    return;
  }
  const userId = platformConfig.userId || uploadState.payload.userId;
  const result = await runPush(() => pushSync(targetBaseUrl.value, uploadState.payload!, userId));
  pushResult.value = result;
}

// 拉取
const pullUserId = ref(platformConfig.userId);
const { loading: pullLoading, error: pullError, run: runPull } = usePlatformApi();
const pullResult = ref<SyncPayload | null>(null);

async function doPull() {
  if (!pullUserId.value) {
    alert('请填写 userId');
    return;
  }
  if (!targetBaseUrl.value) {
    alert(`请先在"配置"页填写${target.value === 'cloudflare' ? 'CF Worker' : '腾讯 SCF'} URL`);
    return;
  }
  pullResult.value = await runPull(() => pullSync(targetBaseUrl.value, pullUserId.value));
}

function downloadPulled() {
  if (!pullResult.value) return;
  const blob = new Blob([JSON.stringify(pullResult.value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `minist-sync-${pullUserId.value}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function stats(p: SyncPayload | null) {
  if (!p) return '';
  return `角色卡 ${p.characters.length} / 聊天 ${p.chats.length} / 世界书 ${p.worldinfo.length} / 预设 ${p.presets.length}`;
}
</script>

<template>
  <div>
    <section class="card">
      <h1 class="card-title">同步中心</h1>
      <p class="card-subtitle">
        在本地酒馆与云端之间同步角色卡、世界书、聊天记录与预设。
        数据格式遵循 <code>@minist/shared</code> 的 <code>SyncPayload</code>。
      </p>
    </section>

    <!-- 目标选择 -->
    <section class="card">
      <h2 class="card-title">选择同步目标</h2>
      <div class="flex gap-3 flex-wrap">
        <label class="check-item" style="flex: 1; min-width: 200px">
          <input type="radio" :checked="target === 'cloudflare'" @change="target = 'cloudflare'" />
          <div class="check-item-body">
            <div class="check-item-title"><span class="badge badge-cf">Cloudflare</span></div>
            <div class="check-item-meta">{{ platformConfig.cfWorkerUrl || '(未配置)' }}</div>
          </div>
        </label>
        <label class="check-item" style="flex: 1; min-width: 200px">
          <input type="radio" :checked="target === 'tencent'" @change="target = 'tencent'" />
          <div class="check-item-body">
            <div class="check-item-title"><span class="badge badge-tencent">腾讯云</span></div>
            <div class="check-item-meta">{{ platformConfig.tencentScfUrl || '(未配置)' }}</div>
          </div>
        </label>
      </div>
      <div v-if="!targetBaseUrl" class="alert alert-warning mt-3">
        该目标地址未配置,请到"配置"页填写。
      </div>
    </section>

    <!-- 上传 -->
    <section class="card">
      <h2 class="card-title">上传(本地 → 云端)</h2>
      <p class="card-subtitle">
        在本地酒馆"导出"得到 SyncPayload JSON,选择文件后推送到 <code>POST {{ '/api/sync' }}</code>。
      </p>
      <div class="field">
        <label>选择导出的 JSON 文件</label>
        <input type="file" accept=".json,application/json" class="input" @change="onFileChange" />
      </div>
      <div v-if="uploadState.fileName" class="text-sm text-dim mb-2">
        文件:{{ uploadState.fileName }}
      </div>
      <div v-if="uploadState.parseError" class="alert alert-danger">{{ uploadState.parseError }}</div>
      <div v-if="uploadState.payload" class="alert alert-info">
        解析成功:{{ stats(uploadState.payload) }}
        <br />userId: <code>{{ uploadState.payload.userId }}</code>
        <br />version: {{ uploadState.payload.version }}
      </div>
      <button class="btn btn-primary" :disabled="pushLoading || !uploadState.payload" @click="doPush">
        {{ pushLoading ? '推送中...' : `推送到 ${target === 'cloudflare' ? 'CF' : '腾讯云'}` }}
      </button>
      <div v-if="pushError" class="alert alert-danger mt-3">{{ pushError }}</div>
      <div v-if="pushResult" class="alert alert-success mt-3">
        推送成功:
        <pre>{{ JSON.stringify(pushResult, null, 2) }}</pre>
      </div>
    </section>

    <!-- 拉取 -->
    <section class="card">
      <h2 class="card-title">拉取恢复(云端 → 本地)</h2>
      <p class="card-subtitle">
        按 userId 从 <code>GET {{ '/api/sync/:userId' }}</code> 拉取,可下载为 JSON 后在酒馆"导入"。
      </p>
      <div class="field">
        <label>userId</label>
        <input v-model="pullUserId" class="input" placeholder="u_xxxxxxxx" />
      </div>
      <button class="btn btn-primary" :disabled="pullLoading" @click="doPull">
        {{ pullLoading ? '拉取中...' : `从 ${target === 'cloudflare' ? 'CF' : '腾讯云'} 拉取` }}
      </button>
      <div v-if="pullError" class="alert alert-danger mt-3">{{ pullError }}</div>
      <div v-if="pullResult" class="alert alert-success mt-3">
        拉取成功:{{ stats(pullResult) }}
        <button class="btn btn-sm ml-2" @click="downloadPulled">下载为 JSON</button>
      </div>
    </section>

    <div class="alert alert-info">
      <strong>说明:</strong>同步是全量覆盖(按 userId 分区)。CF 侧聊天存 D1(10 万写/天),
      腾讯侧存用户自有 COS。大文件同步注意 KV 写次数瓶颈(CF)与响应流量费(腾讯)。
    </div>
  </div>
</template>
