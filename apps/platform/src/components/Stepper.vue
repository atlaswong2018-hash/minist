<script setup lang="ts">
/**
 * Stepper — 通用分步向导组件。
 * 用于部署向导(CF / 腾讯)的多步骤引导。
 */
import { computed } from 'vue';

interface Step {
  /** 步骤标题。 */
  title: string;
  /** 步骤描述(可选)。 */
  desc?: string;
}

const props = defineProps<{
  /** 全部步骤定义。 */
  steps: Step[];
  /** 当前步骤索引(0-based)。 */
  current: number;
}>();

const emit = defineEmits<{
  (e: 'update:current', value: number): void;
  (e: 'next'): void;
  (e: 'prev'): void;
  (e: 'finish'): void;
}>();

const isLast = computed(() => props.current === props.steps.length - 1);
const isFirst = computed(() => props.current === 0);
const progress = computed(() =>
  props.steps.length > 1 ? Math.round((props.current / (props.steps.length - 1)) * 100) : 100,
);

function goNext() {
  if (isLast.value) {
    emit('finish');
  } else {
    emit('update:current', props.current + 1);
    emit('next');
  }
}
function goPrev() {
  if (!isFirst.value) {
    emit('update:current', props.current - 1);
    emit('prev');
  }
}
</script>

<template>
  <div class="stepper">
    <!-- 步骤头:圆点 + 标题 + 连接线 -->
    <div class="stepper-head">
      <template v-for="(step, i) in steps" :key="i">
        <div
          class="step-dot"
          :class="{ active: i === current, done: i < current }"
          @click="i <= current ? emit('update:current', i) : null"
        >
          <span class="dot">{{ i < current ? '✓' : i + 1 }}</span>
          <span>{{ step.title }}</span>
        </div>
        <div v-if="i < steps.length - 1" class="step-line" />
      </template>
    </div>

    <!-- 当前步骤描述 -->
    <div v-if="steps[current]?.desc" class="text-dim text-sm mb-3">
      {{ steps[current].desc }}
    </div>

    <!-- 步骤内容(slot) -->
    <div class="stepper-body">
      <slot />
    </div>

    <!-- 导航按钮 -->
    <div class="flex justify-between mt-4">
      <button class="btn" :disabled="isFirst" @click="goPrev">上一步</button>
      <div class="text-dim text-sm flex items-center">
        进度 {{ progress }}% ({{ current + 1 }}/{{ steps.length }})
      </div>
      <button class="btn btn-primary" @click="goNext">
        {{ isLast ? '完成' : '下一步' }}
      </button>
    </div>
  </div>
</template>
