<script setup lang="ts">
/**
 * CharacterImport.vue — 人物卡导入(input file,支持多选 PNG/JSON)。
 *
 * 调用 @minist/core.parseCardFile 在浏览器内解析 PNG(tEXt chara/ccv3)或 JSON,
 * 不经过后端。解析结果存入 characters store。
 */
import { ref } from 'vue';
import { useCharactersStore } from '../store/characters';

const characters = useCharactersStore();
const fileInput = ref<HTMLInputElement | null>(null);

function trigger(): void {
  fileInput.value?.click();
}

async function onChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;
  await characters.importFiles(files);
  // 清空 input value 以便重复选择同一文件
  input.value = '';
}
</script>

<template>
  <div class="tavern-import">
    <button class="tavern-import__btn" :disabled="characters.importing" @click="trigger">
      {{ characters.importing ? (characters.importProgress != null ? `上传中 ${Math.round(characters.importProgress * 100)}%` : '导入中…') : '+ 导入人物卡(PNG/JSON)' }}
    </button>
    <input
      ref="fileInput"
      type="file"
      accept=".png,.json,image/png,application/json"
      multiple
      class="tavern-import__input"
      @change="onChange"
    />
    <p v-if="characters.importMessage" class="tavern-import__msg">
      {{ characters.importMessage }}
    </p>
    <p class="tavern-import__hint">
      支持 SillyTavern V1/V2/V3 人物卡。PNG 卡在本地解析,不上传后端。
    </p>
  </div>
</template>

<style scoped>
.tavern-import {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tavern-import__btn {
  background: #8b5cf6;
  color: #fff;
  border: none;
  padding: 11px 16px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.tavern-import__btn:disabled {
  background: #3f3f5a;
  color: #a1a1aa;
  cursor: not-allowed;
}
.tavern-import__input {
  display: none;
}
.tavern-import__msg {
  margin: 0;
  font-size: 13px;
  color: #a5f3a0;
}
.tavern-import__hint {
  margin: 0;
  font-size: 12px;
  color: #71717a;
  line-height: 1.5;
}
</style>
