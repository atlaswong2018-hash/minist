<script setup lang="ts">
/**
 * CharacterList.vue — 角色列表 / 切换 / 删除。
 */
import { useCharactersStore } from '../store/characters';

const characters = useCharactersStore();

function select(id: string): void {
  characters.select(id);
}

async function remove(id: string, name: string): Promise<void> {
  if (!confirm(`删除角色「${name}」?该角色的对话也会一并清除。`)) return;
  await characters.remove(id);
}
</script>

<template>
  <div class="tavern-charlist">
    <div v-if="characters.list.length === 0" class="tavern-charlist__empty">
      暂无角色,请先导入人物卡。
    </div>
    <div
      v-for="c in characters.list"
      :key="c.id"
      class="tavern-charlist__item"
      :class="{ 'is-active': c.id === characters.currentId }"
    >
      <button class="tavern-charlist__main" @click="select(c.id)">
        <div class="tavern-charlist__avatar">
          <img v-if="c.image" :src="c.image" :alt="c.card.data?.name" />
          <span v-else>{{ (c.card.data?.name || '?').charAt(0) }}</span>
        </div>
        <div class="tavern-charlist__info">
          <div class="tavern-charlist__name">{{ c.card.data?.name || '未命名' }}</div>
          <div class="tavern-charlist__spec">{{ c.spec.toUpperCase() }}</div>
        </div>
      </button>
      <button class="tavern-charlist__del" @click="remove(c.id, c.card.data?.name || '未命名')">×</button>
    </div>
  </div>
</template>

<style scoped>
.tavern-charlist {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tavern-charlist__empty {
  font-size: 13px;
  color: #71717a;
  padding: 16px 4px;
  text-align: center;
}
.tavern-charlist__item {
  display: flex;
  align-items: center;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid transparent;
}
.tavern-charlist__item.is-active {
  border-color: rgba(139, 92, 246, 0.5);
  background: rgba(139, 92, 246, 0.1);
}
.tavern-charlist__main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  color: #e4e4e7;
  cursor: pointer;
  text-align: left;
  min-width: 0;
}
.tavern-charlist__avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  overflow: hidden;
  background: #3f3f5a;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c4b5fd;
  font-weight: 600;
}
.tavern-charlist__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tavern-charlist__info {
  min-width: 0;
}
.tavern-charlist__name {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tavern-charlist__spec {
  font-size: 11px;
  color: #71717a;
}
.tavern-charlist__del {
  background: transparent;
  border: none;
  color: #71717a;
  font-size: 18px;
  width: 32px;
  height: 32px;
  cursor: pointer;
  border-radius: 8px;
  flex-shrink: 0;
}
.tavern-charlist__del:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #fca5a5;
}
</style>
