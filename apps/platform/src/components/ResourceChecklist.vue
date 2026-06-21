<script setup lang="ts">
/**
 * ResourceChecklist — 两平台资源清单可勾选组件。
 * 每项:名称、用途、免费额度、开通入口。
 * 勾选状态持久化到 localStorage(按 key 分区)。
 */
import { computed, ref, watch } from 'vue';

export interface ResourceItem {
  /** 资源名称。 */
  name: string;
  /** 用途说明。 */
  purpose: string;
  /** 免费额度(或计费要点)。 */
  freeTier: string;
  /** 开通入口(URL 或控制台路径)。 */
  entry: string;
  /** 入口链接(可点)。 */
  url?: string;
  /** 计费风险标记(高亮)。 */
  risk?: 'critical' | 'high' | 'medium' | 'low';
}

const props = defineProps<{
  /** 清单项。 */
  items: ResourceItem[];
  /** localStorage 分区 key(用于持久化勾选)。 */
  storageKey: string;
  /** 标题。 */
  title?: string;
}>();

const STORAGE_PREFIX = 'minist-checklist-';

/** 加载已勾选项 id(用 name 做 id)。 */
function loadChecked(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + props.storageKey);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

const checked = ref<Set<string>>(loadChecked());

// 持久化
watch(
  checked,
  (val) => {
    localStorage.setItem(STORAGE_PREFIX + props.storageKey, JSON.stringify([...val]));
  },
  { deep: true },
);

function toggle(name: string) {
  const next = new Set(checked.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  checked.value = next;
}

const doneCount = computed(() => checked.value.size);
const totalCount = computed(() => props.items.length);
const allDone = computed(() => doneCount.value === totalCount.value);

function riskClass(r?: ResourceItem['risk']): string {
  if (!r) return '';
  return `badge-${r}`;
}
</script>

<template>
  <div class="card">
    <div class="card-title">
      {{ title ?? '资源清单' }}
      <span class="text-mute text-sm">
        {{ doneCount }}/{{ totalCount }} 已开通
      </span>
      <span v-if="allDone" class="badge badge-low">全部就绪</span>
    </div>
    <div class="checklist">
      <label
        v-for="item in items"
        :key="item.name"
        class="check-item"
        :class="{ checked: checked.has(item.name) }"
      >
        <input
          type="checkbox"
          :checked="checked.has(item.name)"
          @change="toggle(item.name)"
        />
        <div class="check-item-body">
          <div class="check-item-title">
            <span>{{ item.name }}</span>
            <span v-if="item.risk" class="badge" :class="riskClass(item.risk)">
              {{ item.risk === 'critical' ? '高风险' : item.risk === 'high' ? '注意' : item.risk }}
            </span>
          </div>
          <div class="check-item-meta">{{ item.purpose }}</div>
          <div class="check-item-meta">
            <strong>免费额度:</strong>{{ item.freeTier }}
          </div>
          <a
            v-if="item.url"
            :href="item.url"
            target="_blank"
            rel="noopener noreferrer"
            class="check-item-link"
          >
            开通入口:{{ item.entry }} ↗
          </a>
          <div v-else class="check-item-meta">
            <strong>开通:</strong>{{ item.entry }}
          </div>
        </div>
      </label>
    </div>
  </div>
</template>
