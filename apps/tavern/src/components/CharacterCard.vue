<script setup lang="ts">
/**
 * CharacterCard.vue — 当前角色头像 / 名 / 简介(顶栏展示)。
 */
import { computed } from 'vue';
import { useCharactersStore } from '../store/characters';
import CharacterAvatar from './CharacterAvatar.vue';

const characters = useCharactersStore();
const card = computed(() => characters.current?.card);
const name = computed(() => card.value?.data?.name || '未选择角色');
const desc = computed(() => {
  const d = card.value?.data?.description?.trim();
  if (!d) return '';
  return d.length > 40 ? d.slice(0, 40) + '…' : d;
});
</script>

<template>
  <div class="tavern-charchard">
    <div class="tavern-charchard__avatar">
      <CharacterAvatar :character="characters.current" />
    </div>
    <div class="tavern-charchard__meta">
      <div class="tavern-charchard__name">{{ name }}</div>
      <div v-if="desc" class="tavern-charchard__desc">{{ desc }}</div>
    </div>
  </div>
</template>

<style scoped>
.tavern-charchard {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.tavern-charchard__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  overflow: hidden;
  background: #3f3f5a;
  flex-shrink: 0;
}
.tavern-charchard__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.tavern-charchard__avatar--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #c4b5fd;
  font-size: 16px;
  font-weight: 600;
}
.tavern-charchard__meta {
  min-width: 0;
}
.tavern-charchard__name {
  font-size: 15px;
  font-weight: 600;
  color: #e4e4e7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tavern-charchard__desc {
  font-size: 12px;
  color: #71717a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
