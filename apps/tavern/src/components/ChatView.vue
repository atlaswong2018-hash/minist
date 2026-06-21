<script setup lang="ts">
/**
 * ChatView.vue — 消息列表(气泡)+ 流式光标 + 自动滚动到底。
 *
 * assistant 流式生成时,末尾显示闪烁光标,生成完消失。
 * 中断后若 interrupted=true,显示"重取"按钮。
 */
import { ref, watch, nextTick, computed } from 'vue';
import { useChatStore } from '../store/chat';
import { useStreaming } from '../composables/useStreaming';
import { useCharactersStore } from '../store/characters';

const chat = useChatStore();
const { generating, interrupted, error, regenerate } = useStreaming();
const characters = useCharactersStore();

const scroller = ref<HTMLElement | null>(null);

const messages = computed(() => chat.messages);

function scrollToBottom(): void {
  nextTick(() => {
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight;
  });
}
// 消息变化即滚到底(流式 token 更新会频繁触发,但 DOM 操作廉价)
watch(
  () => messages.value.map((m) => m.content).join('|'),
  scrollToBottom,
);
watch(() => messages.value.length, scrollToBottom);

function onRegenerate(): void {
  void regenerate();
}

/** 无角色时引导。 */
function goImport(): void {
  // 简单:提示用户打开角色面板(由父组件提供入口,这里仅文案)
  alert('请点击左上角 ☰ → 角色,导入人物卡(PNG/JSON)');
}
</script>

<template>
  <div class="tavern-chat">
    <div v-if="!characters.current" class="tavern-chat__empty">
      <div class="tavern-chat__empty-icon">🎭</div>
      <p class="tavern-chat__empty-text">尚未选择角色</p>
      <button class="tavern-chat__empty-btn" @click="goImport">导入人物卡</button>
    </div>

    <div v-else ref="scroller" class="tavern-chat__scroller">
      <div
        v-for="(m, i) in messages"
        :key="i"
        class="tavern-bubble"
        :class="`is-${m.role}`"
      >
        <div class="tavern-bubble__role">
          {{ m.role === 'user' ? '我' : m.role === 'assistant' ? (characters.current?.card.data?.name || 'AI') : '系统' }}
        </div>
        <div class="tavern-bubble__content">
          <span>{{ m.content }}</span>
          <span
            v-if="generating && i === messages.length - 1 && m.role === 'assistant'"
            class="tavern-bubble__cursor"
          >▋</span>
        </div>
      </div>

      <!-- 中断提示 -->
      <div v-if="interrupted || error" class="tavern-chat__notice">
        <span>{{ interrupted ? '连接已中断(可能因微信切到后台)' : error }}</span>
        <button class="tavern-chat__retry" @click="onRegenerate">重取最后回复</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tavern-chat {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #15151f;
}
.tavern-chat__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: #71717a;
}
.tavern-chat__empty-icon {
  font-size: 48px;
}
.tavern-chat__empty-text {
  margin: 0;
  font-size: 15px;
}
.tavern-chat__empty-btn {
  background: #8b5cf6;
  color: #fff;
  border: none;
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
}
.tavern-chat__scroller {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  padding-bottom: calc(14px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tavern-bubble {
  max-width: 85%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tavern-bubble.is-user {
  align-self: flex-end;
  align-items: flex-end;
}
.tavern-bubble.is-assistant,
.tavern-bubble.is-system {
  align-self: flex-start;
  align-items: flex-start;
}
.tavern-bubble__role {
  font-size: 11px;
  color: #71717a;
  padding: 0 4px;
}
.tavern-bubble__content {
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 15px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
.is-user .tavern-bubble__content {
  background: #8b5cf6;
  color: #fff;
  border-bottom-right-radius: 4px;
}
.is-assistant .tavern-bubble__content {
  background: #26263a;
  color: #e4e4e7;
  border-bottom-left-radius: 4px;
}
.is-system .tavern-bubble__content {
  background: rgba(255, 255, 255, 0.04);
  color: #a1a1aa;
  font-size: 13px;
  font-style: italic;
}
.tavern-bubble__cursor {
  display: inline-block;
  animation: tavern-blink 1s steps(2, start) infinite;
  color: #8b5cf6;
  margin-left: 1px;
}
@keyframes tavern-blink {
  to {
    visibility: hidden;
  }
}
.tavern-chat__notice {
  align-self: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #f59e0b;
  padding: 10px;
  text-align: center;
}
.tavern-chat__retry {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.3);
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
</style>
