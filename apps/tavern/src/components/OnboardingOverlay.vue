<script setup lang="ts">
/**
 * OnboardingOverlay.vue — 首次访问引导浮层。
 *
 * 目的:降低访客上手门槛。首次打开酒馆时弹出,说明:
 *   ① minist 是纯前端酒馆,对话只存在你的浏览器(IndexedDB)
 *   ② 聊天需要一个 LLM API Key(设置里有厂商一键预设)
 *   ③ 可导入角色卡(examples/ 有示例)
 * 点击「去设置」或「先逛逛」后写入 localStorage,不再弹出。
 */
import { ref } from 'vue';

const STORAGE_KEY = 'minist_onboarded';

const visible = ref(localStorage.getItem(STORAGE_KEY) !== '1');

const emit = defineEmits<{
  (e: 'setup'): void;
  (e: 'dismiss'): void;
}>();

function done(goSetup: boolean): void {
  localStorage.setItem(STORAGE_KEY, '1');
  visible.value = false;
  // 分支调用,避免传联合类型 'setup'|'dismiss' 不匹配 emit 重载
  if (goSetup) emit('setup');
  else emit('dismiss');
}
</script>

<template>
  <div v-if="visible" class="ob-mask">
    <div class="ob-card">
      <div class="ob-emoji">🍻</div>
      <h1 class="ob-title">欢迎使用 minist 酒馆</h1>
      <p class="ob-sub">免备案 Serverless 酒馆 · 手机/微信友好 · 数据只存在你的浏览器</p>

      <ol class="ob-steps">
        <li><b>填一个 LLM Key</b> —— 设置里有「厂商一键预设」(DeepSeek/OpenAI/智谱…),点一下即填地址与模型,你再粘 Key。</li>
        <li><b>(可选)导入角色</b> —— 侧栏「角色」→ 导入,选 <code>examples/characters/sample-xiaoman.json</code>。</li>
        <li><b>发消息</b> —— 回到聊天,流式打字机回复。</li>
      </ol>

      <div class="ob-tip">
        🔒 你的 API Key 与对话记录只存在<b>本浏览器</b>,服务端不落盘。换设备前可用「同步」备份。
      </div>

      <div class="ob-actions">
        <button class="ob-btn ob-btn--ghost" @click="done(false)">先逛逛</button>
        <button class="ob-btn ob-btn--primary" @click="done(true)">去设置填 Key</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ob-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.ob-card {
  background: #1f1f2e;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 28px 24px calc(24px + env(safe-area-inset-bottom));
  max-width: 420px;
  width: 100%;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  text-align: center;
  color: #e4e4e7;
}
.ob-emoji {
  font-size: 44px;
  line-height: 1;
}
.ob-title {
  font-size: 22px;
  margin: 12px 0 4px;
  color: #fff;
}
.ob-sub {
  font-size: 13px;
  color: #a1a1aa;
  margin: 0 0 18px;
  line-height: 1.5;
}
.ob-steps {
  text-align: left;
  font-size: 14px;
  line-height: 1.7;
  color: #d4d4d8;
  margin: 0 0 18px;
  padding-left: 20px;
}
.ob-steps code {
  background: #26263a;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: #c4b5fd;
}
.ob-tip {
  font-size: 12px;
  color: #71717a;
  background: rgba(139, 92, 246, 0.08);
  border: 1px solid rgba(139, 92, 246, 0.2);
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 20px;
  line-height: 1.6;
  text-align: left;
}
.ob-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}
.ob-btn {
  border: none;
  padding: 11px 18px;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
}
.ob-btn--ghost {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #d4d4d8;
}
.ob-btn--primary {
  background: #8b5cf6;
  color: #fff;
  flex: 1;
}
</style>
