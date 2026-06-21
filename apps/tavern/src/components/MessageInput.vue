<script setup lang="ts">
/**
 * MessageInput.vue — 输入区。
 *
 * 微信/移动专项:
 *  - 独立"发送"实体按钮(移动端禁用 Enter 发送,防误触换行)。
 *  - 桌面端:Enter 发送、Shift+Enter 换行。
 *  - 生成中:发送按钮变"停止"按钮(abort)。
 *  - "重取最后回复"按钮(删除末尾 assistant 重新生成)。
 *  - textarea 自适应高度(防输入框撑满屏幕)。
 */
import { ref, nextTick, computed } from 'vue';
import { useStreaming } from '../composables/useStreaming';
import { useMobile } from '../composables/useMobile';
import { useConfigStore } from '../store/config';

const { generating, error, send, stop, regenerate } = useStreaming();
const { enableEnterToSend } = useMobile();
const config = useConfigStore();

const text = ref('');
const ta = ref<HTMLTextAreaElement | null>(null);

const canSend = computed(() => text.value.trim().length > 0 && !generating.value);
const needConfig = computed(() => !config.canChat);

async function doSend(): Promise<void> {
  if (!canSend.value) return;
  const t = text.value.trim();
  text.value = '';
  await nextTick();
  autoResize();
  await send(t);
}

function onKeydown(e: KeyboardEvent): void {
  if (!enableEnterToSend.value) return; // 移动端不响应 Enter 发送
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void doSend();
  }
}

/** textarea 自适应高度(最多 5 行)。 */
function autoResize(): void {
  const el = ta.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
</script>

<template>
  <div class="tavern-input">
    <div v-if="needConfig" class="tavern-input__warn">
      当前未配置可聊天的后端。请在「⚙️ 设置」填写 apiBaseUrl 与 apiKey。
    </div>
    <div v-if="error && !generating" class="tavern-input__err">{{ error }}</div>

    <div class="tavern-input__row">
      <textarea
        ref="ta"
        v-model="text"
        class="tavern-input__ta"
        rows="1"
        :placeholder="generating ? '生成中…' : '输入消息(Enter 发送 / Shift+Enter 换行)'"
        :disabled="generating"
        @keydown="onKeydown"
        @input="autoResize"
      />

      <button
        v-if="!generating"
        class="tavern-input__send"
        :disabled="!canSend"
        @click="doSend"
      >
        发送
      </button>
      <button v-else class="tavern-input__stop" @click="stop">停止</button>
    </div>

    <div class="tavern-input__toolbar">
      <button class="tavern-input__tool" :disabled="generating" @click="regenerate">
        ↻ 重取最后回复
      </button>
    </div>
  </div>
</template>

<style scoped>
.tavern-input {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: #1a1a26;
  padding: 10px 12px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tavern-input__warn,
.tavern-input__err {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
}
.tavern-input__warn {
  background: rgba(245, 158, 11, 0.1);
  color: #fbbf24;
}
.tavern-input__err {
  background: rgba(239, 68, 68, 0.1);
  color: #fca5a5;
}
.tavern-input__row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.tavern-input__ta {
  flex: 1;
  resize: none;
  background: #26263a;
  color: #e4e4e7;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 15px;
  line-height: 1.5;
  font-family: inherit;
  max-height: 140px;
  outline: none;
  /* 禁用 iOS 缩放:字号 >= 16px */
}
.tavern-input__ta:focus {
  border-color: rgba(139, 92, 246, 0.5);
}
.tavern-input__send,
.tavern-input__stop {
  flex-shrink: 0;
  height: 42px;
  min-width: 64px;
  padding: 0 16px;
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.tavern-input__send {
  background: #8b5cf6;
  color: #fff;
}
.tavern-input__send:disabled {
  background: #3f3f5a;
  color: #71717a;
  cursor: not-allowed;
}
.tavern-input__stop {
  background: #ef4444;
  color: #fff;
}
.tavern-input__toolbar {
  display: flex;
  gap: 8px;
}
.tavern-input__tool {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #a1a1aa;
  font-size: 13px;
  padding: 5px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.tavern-input__tool:disabled {
  opacity: 0.4;
}
</style>
