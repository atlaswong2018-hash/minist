<script setup lang="ts">
/**
 * Sidebar.vue — 抽屉导航 + 面板内容渲染。
 *
 * 两种使用方式:
 *  - 默认(抽屉内):渲染导航标签 + 当前激活面板的预览。
 *  - mode="full":渲染完整面板内容(主区使用)。
 *
 * 面板:角色(characters)、世界书(worldinfo)、设置(settings)、同步(sync)。
 * chat 面板由主区 ChatView 直接渲染,Sidebar 仅显示导航项。
 */
import { computed } from 'vue';
import CharacterList from './CharacterList.vue';
import CharacterImport from './CharacterImport.vue';
import WorldInfoManager from './WorldInfoManager.vue';
import SettingsPanel from './SettingsPanel.vue';
import SyncPanel from './SyncPanel.vue';
import { useCharactersStore } from '../store/characters';

const props = defineProps<{
  activePanel: string;
  mode?: 'nav' | 'full';
}>();
const emit = defineEmits<{
  (e: 'select-panel', p: 'chat' | 'characters' | 'worldinfo' | 'settings' | 'sync'): void;
  (e: 'close'): void;
}>();

const characters = useCharactersStore();
const mode = computed(() => props.mode ?? 'nav');

interface NavItem {
  key: 'chat' | 'characters' | 'worldinfo' | 'settings' | 'sync';
  label: string;
  icon: string;
}
const navItems: NavItem[] = [
  { key: 'chat', label: '对话', icon: '💬' },
  { key: 'characters', label: '角色', icon: '🎭' },
  { key: 'worldinfo', label: '世界书', icon: '📚' },
  { key: 'sync', label: '同步', icon: '☁️' },
  { key: 'settings', label: '设置', icon: '⚙️' },
];

function select(key: NavItem['key']): void {
  emit('select-panel', key);
}
</script>

<template>
  <div class="tavern-side" :class="{ 'is-full': mode === 'full' }">
    <!-- 导航标签(始终显示) -->
    <nav v-if="mode === 'nav'" class="tavern-side__nav">
      <button
        v-for="item in navItems"
        :key="item.key"
        class="tavern-side__item"
        :class="{ 'is-active': activePanel === item.key }"
        @click="select(item.key)"
      >
        <span class="tavern-side__icon">{{ item.icon }}</span>
        <span class="tavern-side__label">{{ item.label }}</span>
        <span v-if="item.key === 'characters' && characters.list.length" class="tavern-side__badge">
          {{ characters.list.length }}
        </span>
      </button>
    </nav>

    <!-- full 模式:渲染面板内容 -->
    <div v-if="mode === 'full'" class="tavern-side__panel">
      <div v-if="activePanel === 'characters'" class="tavern-side__section">
        <h3 class="tavern-side__h">角色管理</h3>
        <CharacterImport />
        <CharacterList />
      </div>
      <div v-else-if="activePanel === 'worldinfo'" class="tavern-side__section">
        <h3 class="tavern-side__h">世界书</h3>
        <WorldInfoManager />
      </div>
      <div v-else-if="activePanel === 'settings'" class="tavern-side__section">
        <h3 class="tavern-side__h">设置</h3>
        <SettingsPanel />
      </div>
      <div v-else-if="activePanel === 'sync'" class="tavern-side__section">
        <h3 class="tavern-side__h">云同步</h3>
        <SyncPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tavern-side {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.tavern-side__nav {
  padding: 12px 10px;
  padding-top: calc(12px + env(safe-area-inset-top));
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tavern-side__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  background: transparent;
  border: none;
  color: #a1a1aa;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
  border-radius: 10px;
  width: 100%;
}
.tavern-side__item.is-active {
  background: rgba(139, 92, 246, 0.14);
  color: #c4b5fd;
}
.tavern-side__item:active {
  background: rgba(255, 255, 255, 0.05);
}
.tavern-side__icon {
  font-size: 18px;
  width: 22px;
  text-align: center;
}
.tavern-side__label {
  flex: 1;
}
.tavern-side__badge {
  background: rgba(139, 92, 246, 0.3);
  color: #ddd6fe;
  font-size: 12px;
  padding: 1px 7px;
  border-radius: 10px;
  min-width: 18px;
  text-align: center;
}
.tavern-side__panel {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  padding-bottom: calc(14px + env(safe-area-inset-bottom));
}
.tavern-side__section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.tavern-side__h {
  margin: 0;
  font-size: 16px;
  color: #e4e4e7;
  font-weight: 600;
}
</style>
