<script setup lang="ts">
/**
 * ConfigPanel — 展示/调整部署后的配置。
 * 只读为主(直接调 SCF/Worker 的写接口有风险),提供文档指引。
 * 持久化平台自身的连接配置到 localStorage。
 */
import { reactive, ref } from 'vue';
import {
  platformConfig,
  persistConfig,
  healthCheck,
  usePlatformApi,
} from '../composables/usePlatformApi';

// 编辑副本(避免直接改全局,显式保存)
const edit = reactive({ ...platformConfig });

function save() {
  Object.assign(platformConfig, edit);
  persistConfig();
  saved.value = true;
  setTimeout(() => (saved.value = false), 2000);
}
const saved = ref(false);

// 健康检查
const cfHealth = ref<unknown>(null);
const tencentHealth = ref<unknown>(null);
const { loading: cfLoading, error: cfErr, run: runCf } = usePlatformApi();
const { loading: tLoading, error: tErr, run: runT } = usePlatformApi();

async function checkCf() {
  cfHealth.value = await runCf(() => healthCheck(edit.cfWorkerUrl));
}
async function checkTencent() {
  tencentHealth.value = await runT(() => healthCheck(edit.tencentScfUrl));
}
</script>

<template>
  <div>
    <section class="card">
      <h1 class="card-title">配置</h1>
      <p class="card-subtitle">
        管理 minist 平台与各后端的连接配置。所有配置仅存在<strong>你浏览器的 localStorage</strong>,
        不上传任何服务器。
      </p>

      <h3 class="mt-3">连接配置</h3>
      <div class="field">
        <label>CF Worker URL(minist API 后端)</label>
        <input v-model="edit.cfWorkerUrl" class="input" placeholder="https://minist-api.workers.dev" />
      </div>
      <div class="field">
        <label>腾讯云 SCF URL</label>
        <input v-model="edit.tencentScfUrl" class="input" placeholder="https://xxx.service.tencentcloudapi.com" />
      </div>
      <div class="field">
        <label>平台中转 CF Worker URL(CAM 方案一 / CF 一键配置用)</label>
        <input v-model="edit.relayWorkerUrl" class="input" placeholder="https://minist-relay.workers.dev" />
      </div>
      <div class="field">
        <label>ADMIN_TOKEN(腾讯方案二,SCF 环境变量里设的)</label>
        <input v-model="edit.adminToken" class="input" type="password" />
      </div>
      <div class="field">
        <label>运营方 Operator Token(批量管理用,中转 Worker 上配 OPERATOR_TOKEN env)</label>
        <input v-model="edit.operatorToken" class="input" type="password" />
      </div>
      <div class="field">
        <label>同步分区 userId(留空则由酒馆生成)</label>
        <input v-model="edit.userId" class="input" placeholder="u_xxxxxxxx" />
      </div>

      <button class="btn btn-primary" @click="save">保存配置</button>
      <span v-if="saved" class="badge badge-low ml-2">已保存</span>
    </section>

    <!-- 健康检查 -->
    <section class="card">
      <h2 class="card-title">后端健康检查</h2>
      <div class="grid-2">
        <div>
          <h4 class="mb-2"><span class="badge badge-cf">CF Worker</span></h4>
          <button class="btn btn-sm" :disabled="cfLoading" @click="checkCf">
            {{ cfLoading ? '探测中...' : 'GET /api/health' }}
          </button>
          <div v-if="cfErr" class="alert alert-danger mt-2 text-sm">{{ cfErr }}</div>
          <pre v-if="cfHealth" class="mt-2">{{ JSON.stringify(cfHealth, null, 2) }}</pre>
        </div>
        <div>
          <h4 class="mb-2"><span class="badge badge-tencent">腾讯 SCF</span></h4>
          <button class="btn btn-sm" :disabled="tLoading" @click="checkTencent">
            {{ tLoading ? '探测中...' : 'GET /api/health' }}
          </button>
          <div v-if="tErr" class="alert alert-danger mt-2 text-sm">{{ tErr }}</div>
          <pre v-if="tencentHealth" class="mt-2">{{ JSON.stringify(tencentHealth, null, 2) }}</pre>
        </div>
      </div>
    </section>

    <!-- 只读的运行时配置说明 -->
    <section class="card">
      <h2 class="card-title">运行时配置调整(只读指引)</h2>
      <p class="card-subtitle">
        改 SCF 的超时/内存/并发有计费影响,平台不直接改。请用以下方式:
      </p>
      <table class="table">
        <thead>
          <tr>
            <th>配置项</th>
            <th>推荐值</th>
            <th>调整方式</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>SCF 超时</td>
            <td>60s</td>
            <td>方案二 Token 自改(见"部署腾讯云" Tab),或控制台手动</td>
          </tr>
          <tr>
            <td>SCF 内存</td>
            <td>128MB</td>
            <td>同上(内存翻倍 = 价格翻倍)</td>
          </tr>
          <tr>
            <td>SCF 并发</td>
            <td>1</td>
            <td>同上(防爆产,避免冷启动风暴)</td>
          </tr>
          <tr>
            <td>SCF 失败重试</td>
            <td>关闭</td>
            <td>控制台 → 异步配置 → 重试次数 = 0</td>
          </tr>
          <tr>
            <td>CF Worker 变量</td>
            <td>—</td>
            <td>wrangler secret put / 控制台 → Settings → Variables</td>
          </tr>
          <tr>
            <td>加密(X-Crypto-Data)</td>
            <td>开</td>
            <td>酒馆 Settings → crypto = true</td>
          </tr>
        </tbody>
      </table>
      <div class="alert alert-info mt-3">
        <strong>提示:</strong>对计费敏感的配置(超时/内存),平台只提供指引不代改,
        避免误操作导致爆产。改前请先看
        <a href="#" @click.prevent>AI 助手</a> 里的对应知识条目。
      </div>
    </section>
  </div>
</template>
