/**
 * useStreaming — 封装流式发送:调 adapter.chat,逐 token 更新 store 最后一条 assistant 消息(打字机)。
 *
 * 重要:状态(generating/error/interrupted)为模块级单例,所有组件共享同一份。
 * 多个组件调用 useStreaming() 会拿到同一组 ref,保证 ChatView / MessageInput / Sidebar 状态同步。
 *
 * 微信专项:
 *  - AbortController 中断:用户点"停止"立即 abort fetch。
 *  - visibilitychange:微信切后台会挂起 JS 与网络,stream 会在恢复时抛错 → 触发 interrupted,
 *    UI 显示"连接已中断,点此重取"按钮。
 */
import { ref, onUnmounted } from 'vue';
import type { ChatMessage } from '@minist/shared';
import { getAdapter, type ChatStreamHandle } from '../adapters';
import { useConfigStore } from '../store/config';
import { useChatStore } from '../store/chat';
import { useCharactersStore } from '../store/characters';
import { useWorldInfoStore } from '../store/worldinfo';
import { buildMessages } from '@minist/core';

// ── 模块级共享状态(所有 useStreaming() 调用共用)─────────────────────
const generating = ref(false);
const error = ref('');
const interrupted = ref(false);
let handle: ChatStreamHandle | null = null;

export function useStreaming() {
  const configStore = useConfigStore();
  const chatStore = useChatStore();
  const charactersStore = useCharactersStore();
  const worldInfoStore = useWorldInfoStore();

  /** visibilitychange:微信后台挂起检测。 */
  function onVisibility(): void {
    // 微信 iOS 后台会冻结网络;恢复后 stream 会因 fetch 失败抛错 → 走 interrupted 分支
    // 这里无需主动处理,异常路径会捕获
  }
  document.addEventListener('visibilitychange', onVisibility);
  onUnmounted(() => document.removeEventListener('visibilitychange', onVisibility));

  /** 构造发给 LLM 的 messages(人物卡 + 历史 + 世界书)。 */
  function buildRequestMessages(history: ChatMessage[]): ChatMessage[] {
    const card = charactersStore.current?.card;
    if (!card) {
      throw new Error('未选中人物卡,请先导入或选择一个角色');
    }
    return buildMessages({
      card,
      history,
      worldInfo: worldInfoStore.book,
    });
  }

  /** 把原始错误转成对用户友好的提示(重点:CORS/网络失败时给可操作建议)。 */
  function friendlyError(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    const looksLikeNetwork =
      e instanceof TypeError || /failed to fetch|network|load failed|\bcors\b/i.test(raw);
    if (looksLikeNetwork) {
      if (configStore.effectiveBackend === 'direct') {
        return (
          `网络请求失败(很可能是浏览器跨域 CORS 被拦):${raw}\n` +
          `直连模式下部分厂商(如 OpenAI)不允许浏览器直接调用。建议:\n` +
          `① 换用支持跨域的厂商(DeepSeek / SiliconFlow / 智谱 等);\n` +
          `② 或在「设置」切换到 Cloudflare / 腾讯云 中转后端。`
        );
      }
      return `网络请求失败:${raw}\n请检查后端地址是否正确、后端是否在线。`;
    }
    return raw;
  }

  /**
   * 发送一条用户消息并流式生成回复。
   */
  async function send(text: string): Promise<void> {
    if (generating.value) return;
    error.value = '';
    interrupted.value = false;

    if (!configStore.canChat) {
      error.value =
        configStore.effectiveBackend === 'direct'
          ? '直连模式请先在"设置"填写 apiBaseUrl 与 apiKey'
          : '请在"设置"配置后端地址与密钥';
      return;
    }

    try {
      await chatStore.pushUser(text);
      const messagesForApi = buildRequestMessages(chatStore.messages);
      const adapter = getAdapter(configStore.config);
      handle = await adapter.chat(messagesForApi, {
        temperature: configStore.config.temperature,
        maxTokens: configStore.config.maxTokens,
        stream: configStore.config.stream !== false,
      });

      generating.value = true;
      chatStore.generating = true;
      const assistantIdx = chatStore.beginAssistant();

      try {
        for await (const tok of handle.stream) {
          chatStore.appendAssistantToken(assistantIdx, tok);
        }
        await chatStore.endAssistant();
      } catch (e) {
        if (handle.aborted()) {
          // 用户主动中断:保留已生成内容
          await chatStore.endAssistant();
        } else {
          // 微信后台被杀 / 网络断
          interrupted.value = true;
          error.value = friendlyError(e);
          await chatStore.removeLastIfEmptyAssistant();
        }
      } finally {
        generating.value = false;
        chatStore.generating = false;
        handle = null;
      }
    } catch (e) {
      generating.value = false;
      chatStore.generating = false;
      error.value = friendlyError(e);
    }
  }

  function stop(): void {
    handle?.abort();
  }

  /** 重取最后一条回复:删除末尾 assistant,用倒数第二条 user 重新生成。 */
  async function regenerate(): Promise<void> {
    if (generating.value) return;
    const msgs = [...chatStore.messages];
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;
    const userText = msgs[lastUserIdx].content;
    chatStore.messages = msgs.slice(0, lastUserIdx);
    await chatStore.persist();
    await send(userText);
  }

  function clearError(): void {
    error.value = '';
    interrupted.value = false;
  }

  return {
    generating,
    error,
    interrupted,
    send,
    stop,
    regenerate,
    clearError,
  };
}
