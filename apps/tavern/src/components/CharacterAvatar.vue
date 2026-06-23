<script setup lang="ts">
/**
 * CharacterAvatar.vue — 角色头像(统一渲染内嵌 dataURL 与外置对象存储引用)。
 *
 * 用 useAvatar 懒加载:小图/无后端走内嵌,大图走对象存储 + IndexedDB 缓存。
 * 父组件只需提供圆形/尺寸容器,本组件填充 img 或首字母占位。
 */
import { toRef, computed } from 'vue';
import { useAvatar } from '../composables/useAsset';
import type { LocalCharacter } from '../store/characters';

const props = defineProps<{ character?: LocalCharacter | null }>();
const charRef = toRef(props, 'character');
const url = useAvatar(charRef);
const initial = computed(() => (props.character?.card?.data?.name || '?').charAt(0));
const alt = computed(() => props.character?.card?.data?.name || '');
</script>

<template>
  <img v-if="url" class="tavern-avatar__img" :src="url" :alt="alt" />
  <span v-else class="tavern-avatar__initial">{{ initial }}</span>
</template>

<style scoped>
.tavern-avatar__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.tavern-avatar__initial {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #c4b5fd;
  font-weight: 600;
}
</style>
