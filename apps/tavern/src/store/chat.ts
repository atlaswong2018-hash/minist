/**
 * 聊天 store — 当前会话的消息列表 + 持久化。
 *
 * 存储:IndexedDB chats store,以 characterId 为 key,值为 ChatMessage[]。
 * 流式生成时,最后一条 assistant 消息会被逐 token 更新(打字机效果)。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ChatMessage } from '@minist/shared';
import { STORES, del, getAll, put } from '../db/idb';
import { useCharactersStore } from './characters';

/** IndexedDB 中单条对话记录的结构。 */
interface ChatRecord {
  characterId: string;
  messages: ChatMessage[];
  updatedAt: number;
}

export const useChatStore = defineStore('chat', () => {
  /** 当前角色会话的消息列表(system/assistant 首条开场白 + user/assistant 历史)。 */
  const messages = ref<ChatMessage[]>([]);
  /** 当前会话绑定的角色 id。 */
  const activeCharacterId = ref<string | null>(null);
  /** 全部角色的会话索引(用于展示"有 N 个角色对话"),按 characterId 索引。 */
  const allChats = ref<Map<string, ChatRecord>>(new Map());
  /** 是否正在生成(流式中)。 */
  const generating = ref(false);

  const messageCount = computed(() => messages.value.length);

  async function load(): Promise<void> {
    const records = await getAll<ChatRecord>(STORES.chats);
    allChats.value = new Map(records.map((r) => [r.characterId, r]));
    // 默认加载第一个角色的对话(若 characters store 已加载)
    const characters = useCharactersStore();
    if (characters.currentId) {
      await loadSession(characters.currentId);
    }
  }

  /** 加载指定角色的会话;若该角色无会话且有 first_mes,自动注入开场白。 */
  async function loadSession(characterId: string): Promise<void> {
    activeCharacterId.value = characterId;
    const rec = allChats.value.get(characterId);
    if (rec) {
      messages.value = [...rec.messages];
      return;
    }
    // 新会话:尝试注入人物卡开场白
    const characters = useCharactersStore();
    const local = characters.list.find((c) => c.id === characterId);
    const firstMes = local?.card.data?.first_mes?.trim();
    messages.value = firstMes
      ? [{ role: 'assistant', content: firstMes, timestamp: Date.now() }]
      : [];
    await persist();
  }

  /** 持久化当前会话到 IndexedDB。 */
  async function persist(): Promise<void> {
    if (!activeCharacterId.value) return;
    const rec: ChatRecord = {
      characterId: activeCharacterId.value,
      messages: messages.value,
      updatedAt: Date.now(),
    };
    await put(STORES.chats, rec);
    allChats.value.set(activeCharacterId.value, rec);
  }

  /** 追加一条用户消息。 */
  async function pushUser(text: string): Promise<void> {
    if (!text.trim()) return;
    messages.value = [
      ...messages.value,
      { role: 'user', content: text, timestamp: Date.now() },
    ];
    await persist();
  }

  /** 追加一条空的 assistant 消息(流式开始前的占位),返回其 index。 */
  function beginAssistant(): number {
    messages.value = [
      ...messages.value,
      { role: 'assistant', content: '', timestamp: Date.now() },
    ];
    return messages.value.length - 1;
  }

  /** 流式更新最后一条 assistant 消息内容(增量拼接)。 */
  function appendAssistantToken(index: number, token: string): void {
    const arr = [...messages.value];
    if (arr[index] && arr[index].role === 'assistant') {
      arr[index] = { ...arr[index], content: arr[index].content + token };
      messages.value = arr;
    }
  }

  /** 替换指定 index 的 assistant 消息(重试/完整接收后)。 */
  function setAssistantContent(index: number, content: string): void {
    const arr = [...messages.value];
    if (arr[index] && arr[index].role === 'assistant') {
      arr[index] = { ...arr[index], content };
      messages.value = arr;
    }
  }

  /** 流式完成:持久化。 */
  async function endAssistant(): Promise<void> {
    await persist();
  }

  /** 移除最后一条 assistant 消息(用于中断后清理空消息)。 */
  async function removeLastIfEmptyAssistant(): Promise<void> {
    const last = messages.value[messages.value.length - 1];
    if (last && last.role === 'assistant' && !last.content) {
      messages.value = messages.value.slice(0, -1);
      await persist();
    }
  }

  /** 删除当前角色会话。 */
  async function clearSession(characterId: string): Promise<void> {
    await del(STORES.chats, characterId);
    allChats.value.delete(characterId);
    if (activeCharacterId.value === characterId) {
      messages.value = [];
    }
  }

  /** 重置(切换角色时调用)。 */
  function reset(): void {
    messages.value = [];
    activeCharacterId.value = null;
  }

  return {
    messages,
    activeCharacterId,
    messageCount,
    generating,
    load,
    loadSession,
    persist,
    pushUser,
    beginAssistant,
    appendAssistantToken,
    setAssistantContent,
    endAssistant,
    removeLastIfEmptyAssistant,
    clearSession,
    reset,
  };
});
