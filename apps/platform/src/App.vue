<script setup lang="ts">
/**
 * App.vue — minist 部署平台外壳。
 * 顶部导航:首页 / 部署CF / 部署腾讯 / 配置 / 同步 / AI助手。
 * 单页内 tab 切换(无路由库,首屏快、构建简单)。响应式移动友好。
 */
import { ref } from 'vue';
import Home from './views/Home.vue';
import DeployCloudflare from './views/DeployCloudflare.vue';
import DeployTencent from './views/DeployTencent.vue';
import BatchManage from './views/BatchManage.vue';
import ConfigPanel from './views/ConfigPanel.vue';
import SyncCenter from './views/SyncCenter.vue';
import AiAssistant from './views/AiAssistant.vue';

type TabId = 'home' | 'cf' | 'tencent' | 'batch' | 'config' | 'sync' | 'ai';

const tabs: { id: TabId; label: string }[] = [
  { id: 'home', label: '首页' },
  { id: 'cf', label: '部署 CF' },
  { id: 'tencent', label: '部署腾讯云' },
  { id: 'batch', label: '🗂️ 批量管理' },
  { id: 'config', label: '配置' },
  { id: 'sync', label: '同步' },
  { id: 'ai', label: 'AI 助手' },
];

const active = ref<TabId>('home');

function switchTo(id: TabId) {
  active.value = id;
  // 滚动到顶(移动端体验)
  if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<template>
  <div>
    <header class="navbar">
      <div class="navbar-inner">
        <div class="brand">
          minist<span class="brand-tag">部署平台</span>
        </div>
        <nav class="nav-tabs">
          <button
            v-for="t in tabs"
            :key="t.id"
            class="nav-tab"
            :class="{ active: active === t.id }"
            @click="switchTo(t.id)"
          >
            {{ t.label }}
          </button>
        </nav>
      </div>
    </header>

    <main class="container">
      <Home v-if="active === 'home'" @navigate="switchTo" />
      <DeployCloudflare v-else-if="active === 'cf'" />
      <DeployTencent v-else-if="active === 'tencent'" />
      <BatchManage v-else-if="active === 'batch'" />
      <ConfigPanel v-else-if="active === 'config'" />
      <SyncCenter v-else-if="active === 'sync'" />
      <AiAssistant v-else-if="active === 'ai'" />
    </main>

    <footer class="container text-mute text-sm" style="padding-top: 0">
      <hr style="border: none; border-top: 1px solid var(--border); margin-bottom: 16px" />
      <p>
        minist 部署平台 — 一键把 minist 酒馆部署到你自己的 CF / 腾讯云账号。AGPL-3.0-only。
      </p>
      <p class="mt-2">
        本平台是纯静态站,自身部署在 CF Pages / Vercel / GitHub Pages(也免备案友好)。
        AI 助手连接你自填的 LLM,知识库检索结果对你透明可见。
      </p>
    </footer>
  </div>
</template>
