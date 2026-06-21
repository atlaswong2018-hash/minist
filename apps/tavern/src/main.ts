/**
 * minist 酒馆前端入口。
 *
 * 职责:
 *  - 创建 Vue 应用 + 注册 Pinia。
 *  - 全局样式注入。
 *  - 移动端 viewport 修正(微信内置浏览器对 viewport-fit 支持差异)。
 *  - 生产环境注册 service worker(PWA 离线)。
 *  - 首屏挂载后,初始化本地存储(config / 角色 / 世界书)。
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { useConfigStore } from './store/config';
import { useCharactersStore } from './store/characters';
import { useWorldInfoStore } from './store/worldinfo';
import { useChatStore } from './store/chat';

import './styles/main.css';

const pinia = createPinia();

const app = createApp(App);
app.use(pinia);
app.mount('#app');

// ── 挂载后异步初始化本地存储(不阻塞首屏)──────────────────────────────
async function bootstrap(): Promise<void> {
  try {
    const config = useConfigStore();
    const characters = useCharactersStore();
    const worldinfo = useWorldInfoStore();
    const chat = useChatStore();
    // chat.load 依赖 characters.currentId,需保证 characters 先就绪
    await Promise.all([config.load(), characters.load()]);
    await Promise.all([worldinfo.load(), chat.load()]);
  } catch (e) {
    // 初始化失败不阻断 UI,仅 console
    console.error('[minist] 本地数据初始化失败:', e);
  }
}
void bootstrap();

// ── 移动端 viewport 修正 ──────────────────────────────────────────────
// 微信内置浏览器对 viewport-fit=cover 解析不一致,运行时再强制一遍安全区变量可见。
function fixViewport(): void {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
}
fixViewport();
window.addEventListener('resize', fixViewport, { passive: true });
window.addEventListener('orientationchange', fixViewport, { passive: true });

// ── Service Worker(仅生产)──────────────────────────────────────────
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => {
      console.warn('[minist] SW 注册失败:', e);
    });
  });
}
