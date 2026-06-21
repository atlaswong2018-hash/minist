<script setup lang="ts">
/**
 * App.vue — minist 酒馆主壳。
 *
 * 布局:左侧抽屉导航(角色/世界书/设置/同步)+ 右侧主聊天区。
 * 移动端:抽屉默认收起,点汉堡按钮滑出(overlay 遮罩)。
 * 桌面端:抽屉常驻(响应式断点)。
 */
import { ref, computed, watch } from 'vue';
import Sidebar from './components/Sidebar.vue';
import ChatView from './components/ChatView.vue';
import MessageInput from './components/MessageInput.vue';
import CharacterCard from './components/CharacterCard.vue';
import OnboardingOverlay from './components/OnboardingOverlay.vue';
import { useCharactersStore } from './store/characters';
import { useChatStore } from './store/chat';
import { useMobile } from './composables/useMobile';

const characters = useCharactersStore();
const chat = useChatStore();
const { isMobile } = useMobile();

// 抽屉开关(移动端):chat | characters | worldinfo | settings | sync | null
const drawerOpen = ref(false);
type Panel = 'chat' | 'characters' | 'worldinfo' | 'settings' | 'sync';
const activePanel = ref<Panel>('chat');

const showSidebar = computed(() => !isMobile.value || drawerOpen.value);

// 切换角色时加载该角色会话
watch(
  () => characters.currentId,
  async (id) => {
    if (id) await chat.loadSession(id);
  },
);

function openDrawer(): void {
  drawerOpen.value = true;
}
function closeDrawer(): void {
  drawerOpen.value = false;
}
function selectPanel(p: Panel): void {
  activePanel.value = p;
  if (isMobile.value) drawerOpen.value = false;
}

// GitHub Pages 在线 demo 标识 + 引导横幅
const isDemo = computed(() => location.hostname.endsWith('github.io'));
const demoBannerDismissed = ref(localStorage.getItem('minist_demo_banner_dismissed') === '1');
function dismissBanner(): void {
  localStorage.setItem('minist_demo_banner_dismissed', '1');
  demoBannerDismissed.value = true;
}
/** 引导浮层"去设置"按钮:切到设置面板并(移动端)打开抽屉。 */
function onSetup(): void {
  selectPanel('settings');
  if (isMobile.value) drawerOpen.value = true;
}
</script>

<template>
  <div class="tavern-app">
    <!-- 侧边抽屉 -->
    <aside class="tavern-sidebar" :class="{ 'is-open': showSidebar }">
      <Sidebar
        :active-panel="activePanel"
        @select-panel="selectPanel"
        @close="closeDrawer"
      />
    </aside>

    <!-- 移动端遮罩 -->
    <div
      v-if="isMobile && drawerOpen"
      class="tavern-overlay"
      @click="closeDrawer"
    />

    <!-- 主区 -->
    <main class="tavern-main">
      <!-- GitHub Pages 在线 demo 横幅(仅 *.github.io 显示) -->
      <div v-if="isDemo && !demoBannerDismissed" class="tavern-demobanner">
        <span class="tavern-demobanner__text">🌐 在线 demo · 数据只存你的浏览器 · 填自己的 LLM Key 即可聊天</span>
        <a href="./platform/" target="_blank" rel="noopener" class="tavern-demobanner__link">部署到自己云 →</a>
        <button class="tavern-demobanner__close" aria-label="关闭" @click="dismissBanner">×</button>
      </div>

      <header class="tavern-topbar">
        <button
          v-if="isMobile"
          class="tavern-iconbtn"
          aria-label="菜单"
          @click="openDrawer"
        >
          ☰
        </button>
        <div class="tavern-topbar__title">
          <CharacterCard />
        </div>
      </header>

      <section class="tavern-content">
        <!-- 角色管理面板 -->
        <div v-if="activePanel === 'characters'" class="tavern-panel">
          <Sidebar mode="full" :active-panel="activePanel" @select-panel="selectPanel" />
        </div>
        <div v-else-if="activePanel === 'worldinfo'" class="tavern-panel">
          <Sidebar mode="full" :active-panel="activePanel" @select-panel="selectPanel" />
        </div>
        <div v-else-if="activePanel === 'settings'" class="tavern-panel">
          <Sidebar mode="full" :active-panel="activePanel" @select-panel="selectPanel" />
        </div>
        <div v-else-if="activePanel === 'sync'" class="tavern-panel">
          <Sidebar mode="full" :active-panel="activePanel" @select-panel="selectPanel" />
        </div>

        <!-- 聊天视图(始终渲染,面板切换在 Sidebar 内部展开) -->
        <template v-else>
          <ChatView />
          <MessageInput />
        </template>
      </section>
    </main>

    <!-- 首次访问引导浮层 -->
    <OnboardingOverlay @setup="onSetup" />
  </div>
</template>

<style scoped>
.tavern-app {
  display: flex;
  height: 100vh;
  height: calc(var(--vh, 1vh) * 100);
  width: 100vw;
  background: #15151f;
  color: #e4e4e7;
  overflow: hidden;
}
.tavern-sidebar {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  background: #1f1f2e;
  overflow-y: auto;
}
/* 移动端抽屉滑出 */
@media (max-width: 768px) {
  .tavern-sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
  }
  .tavern-sidebar.is-open {
    transform: translateX(0);
  }
}
.tavern-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 90;
}
.tavern-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.tavern-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  padding-top: calc(10px + env(safe-area-inset-top));
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: #1a1a26;
  min-height: 52px;
}
.tavern-iconbtn {
  background: transparent;
  border: none;
  color: #e4e4e7;
  font-size: 22px;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 8px;
}
.tavern-iconbtn:active {
  background: rgba(255, 255, 255, 0.06);
}
.tavern-topbar__title {
  flex: 1;
  min-width: 0;
}
.tavern-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.tavern-panel {
  flex: 1;
  overflow-y: auto;
}
/* 在线 demo 横幅 */
.tavern-demobanner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 14px;
  background: linear-gradient(90deg, rgba(139, 92, 246, 0.18), rgba(59, 130, 246, 0.12));
  border-bottom: 1px solid rgba(139, 92, 246, 0.25);
  font-size: 12px;
  color: #ddd6fe;
}
.tavern-demobanner__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tavern-demobanner__link {
  color: #c4b5fd;
  text-decoration: none;
  white-space: nowrap;
  font-weight: 500;
}
.tavern-demobanner__link:hover {
  text-decoration: underline;
}
.tavern-demobanner__close {
  background: transparent;
  border: none;
  color: #a1a1aa;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.tavern-demobanner__close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
</style>
