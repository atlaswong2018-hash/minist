<script setup lang="ts">
/**
 * WorldInfoManager.vue — 独立世界书条目 CRUD。
 *
 * 每条:主关键词(key,逗号分隔)、次级关键词、正文、常驻、启用、顺序。
 * buildMessages 时会把所有条目喂给 activateEntries 做关键词激活。
 */
import { ref } from 'vue';
import { useWorldInfoStore } from '../store/worldinfo';
import type { WorldInfoEntry } from '@minist/core';

const store = useWorldInfoStore();
const editing = ref<WorldInfoEntry | null>(null);

/** 把逗号分隔字符串转数组。 */
function splitKeys(s: string): string[] {
  return s
    .split(/[,，]/)
    .map((k) => k.trim())
    .filter(Boolean);
}
/** 数组转逗号字符串。 */
function joinKeys(arr: string[]): string {
  return arr.join(', ');
}

function startCreate(): void {
  editing.value = store.createEntry();
}

function startEdit(entry: WorldInfoEntry): void {
  editing.value = { ...entry };
}

async function save(): Promise<void> {
  if (!editing.value) return;
  const e = editing.value;
  if (!e.content.trim()) {
    alert('正文不能为空');
    return;
  }
  // uid 已存在 → update,否则 add
  const exists = store.entries.some((x) => x.uid === e.uid);
  if (exists) await store.update(e);
  else await store.add(e);
  editing.value = null;
}

function cancel(): void {
  editing.value = null;
}

async function remove(entry: WorldInfoEntry): Promise<void> {
  if (!confirm(`删除条目「${entry.comment || entry.key.join(',') || entry.uid}」?`)) return;
  await store.remove(entry.uid);
}
</script>

<template>
  <div class="tavern-wi">
    <div class="tavern-wi__bar">
      <span class="tavern-wi__count">共 {{ store.entries.length }} 条</span>
      <button class="tavern-wi__add" @click="startCreate">+ 新建条目</button>
    </div>

    <!-- 编辑表单 -->
    <div v-if="editing" class="tavern-wi__form">
      <div class="tavern-wi__field">
        <label>主关键词(逗号分隔,命中任一即激活)</label>
        <input
          type="text"
          :value="joinKeys(editing.key)"
          placeholder="剑,魔法,城堡"
          @input="editing.key = splitKeys(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="tavern-wi__field">
        <label>次级关键词(selective 模式二次过滤)</label>
        <input
          type="text"
          :value="joinKeys(editing.secondary_keys)"
          placeholder="(可选)"
          @input="editing.secondary_keys = splitKeys(($event.target as HTMLInputElement).value)"
        />
      </div>
      <div class="tavern-wi__field">
        <label>正文(注入到 prompt)</label>
        <textarea v-model="editing.content" rows="4" placeholder="此条目激活后注入的内容…" />
      </div>
      <div class="tavern-wi__field">
        <label>备注(可选)</label>
        <input v-model="editing.comment" type="text" placeholder="条目说明" />
      </div>
      <div class="tavern-wi__row">
        <label class="tavern-wi__check">
          <input type="checkbox" v-model="editing.constant" /> 常驻(无需关键词命中)
        </label>
        <label class="tavern-wi__check">
          <input type="checkbox" v-model="editing.enabled" /> 启用
        </label>
        <label class="tavern-wi__check">
          <input type="checkbox" v-model="editing.selective" /> selective(需次级关键词)
        </label>
        <label class="tavern-wi__check">
          <input type="checkbox" v-model="editing.case_sensitive" /> 大小写敏感
        </label>
      </div>
      <div class="tavern-wi__field">
        <label>顺序({{ editing.order }},越小越靠前)</label>
        <input
          type="range"
          min="0"
          max="999"
          v-model.number="editing.order"
        />
      </div>
      <div class="tavern-wi__actions">
        <button class="tavern-wi__save" @click="save">保存</button>
        <button class="tavern-wi__cancel" @click="cancel">取消</button>
      </div>
    </div>

    <!-- 列表 -->
    <div v-if="!editing" class="tavern-wi__list">
      <div v-if="store.entries.length === 0" class="tavern-wi__empty">
        暂无世界书条目。点击「+ 新建条目」开始。
      </div>
      <div v-for="e in store.entries" :key="e.uid" class="tavern-wi__entry" :class="{ 'is-off': !e.enabled }">
        <div class="tavern-wi__entry-head">
          <span class="tavern-wi__entry-title">{{ e.comment || e.key.join(', ') || `#${e.uid}` }}</span>
          <div class="tavern-wi__entry-tags">
            <span v-if="e.constant" class="tavern-wi__tag is-const">常驻</span>
            <span v-if="e.selective" class="tavern-wi__tag">selective</span>
            <span v-if="!e.enabled" class="tavern-wi__tag is-off">禁用</span>
          </div>
        </div>
        <div class="tavern-wi__entry-keys">{{ e.key.join(', ') || '(无关键词)' }}</div>
        <div class="tavern-wi__entry-content">{{ e.content.slice(0, 80) }}{{ e.content.length > 80 ? '…' : '' }}</div>
        <div class="tavern-wi__entry-actions">
          <button @click="startEdit(e)">编辑</button>
          <button class="tavern-wi__del" @click="remove(e)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tavern-wi {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tavern-wi__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tavern-wi__count {
  font-size: 13px;
  color: #a1a1aa;
}
.tavern-wi__add {
  background: #8b5cf6;
  color: #fff;
  border: none;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.tavern-wi__form {
  background: #26263a;
  padding: 14px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tavern-wi__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tavern-wi__field > label {
  font-size: 12px;
  color: #a1a1aa;
}
.tavern-wi__field input,
.tavern-wi__field textarea {
  background: #1f1f2e;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e4e4e7;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  resize: vertical;
}
.tavern-wi__field input + input {
  margin-top: 4px;
}
.tavern-wi__row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.tavern-wi__check {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: #d4d4d8;
  cursor: pointer;
}
.tavern-wi__actions {
  display: flex;
  gap: 8px;
}
.tavern-wi__save {
  background: #8b5cf6;
  color: #fff;
  border: none;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.tavern-wi__cancel {
  background: transparent;
  color: #a1a1aa;
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}
.tavern-wi__empty {
  font-size: 13px;
  color: #71717a;
  padding: 16px;
  text-align: center;
}
.tavern-wi__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tavern-wi__entry {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 10px 12px;
}
.tavern-wi__entry.is-off {
  opacity: 0.55;
}
.tavern-wi__entry-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.tavern-wi__entry-title {
  font-size: 14px;
  font-weight: 500;
  color: #e4e4e7;
}
.tavern-wi__entry-tags {
  display: flex;
  gap: 4px;
}
.tavern-wi__tag {
  font-size: 11px;
  background: rgba(139, 92, 246, 0.15);
  color: #c4b5fd;
  padding: 1px 6px;
  border-radius: 6px;
}
.tavern-wi__tag.is-const {
  background: rgba(34, 197, 94, 0.15);
  color: #86efac;
}
.tavern-wi__tag.is-off {
  background: rgba(113, 113, 122, 0.2);
  color: #a1a1aa;
}
.tavern-wi__entry-keys {
  font-size: 12px;
  color: #a78bfa;
  margin-top: 4px;
}
.tavern-wi__entry-content {
  font-size: 13px;
  color: #d4d4d8;
  margin-top: 4px;
  line-height: 1.5;
}
.tavern-wi__entry-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.tavern-wi__entry-actions button {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #d4d4d8;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}
.tavern-wi__del {
  color: #fca5a5 !important;
  border-color: rgba(239, 68, 68, 0.3) !important;
}
</style>
