/**
 * useStreaming — 封装流式发送:调 adapter.chat,逐 token 更新 store 最后一条 assistant 消息(打字机)。
 *
 * 重要:状态(generating/error/interrupted)为模块级单例,所有组件共享同一份。
 * 多个组件调用 useStreaming() 会拿到同一组 ref,保证 ChatView / MessageInput / Sidebar 状态同步。
 *
 * 微信专项:
 *  - AbortController 中断:用户点"停止"立即 abort fetch。
 *  - visibilitychange:微信切后台会冻结网络,fetch 可能无限挂起;恢复可见时若仍在生成,
 *    模块级监听主动 abort,避免 generating 永远为 true(已生成内容保留,可重取)。
 */
import { ref } from 'vue';
import type { ChatMessage } from '@minist/shared';
import { getAdapter, type ChatStreamHandle } from '../adapters';
import { useConfigStore } from '../store/config';
import { useChatStore } from '../store/chat';
import { useCharactersStore } from '../store/characters';
import { useWorldInfoStore } from '../store/worldinfo';
import { buildMessages, estimateTokens, trimHistory } from '@minist/core';

// ── 模块级共享状态(所有 useStreaming() 调用共用)─────────────────────
const generating = ref(false);
const error = ref('');
const interrupted = ref(false);
let handle: ChatStreamHandle | null = null;

// 微信 iOS 后台冻结网络时,流式 fetch 可能无限挂起。模块级单监听:后台时记录时间戳,
// 恢复可见时若已后台较久(≥5s,典型为微信冻结;桌面快速切 tab 不受影响)且仍在生成则主动 abort,
// 避免 generating 永远为 true。已生成内容保留,用户可重取。
let hiddenAt = 0;
function onVisibility(): void {
  if (document.hidden) {
    if (generating.value) hiddenAt = Date.now();
  } else if (hiddenAt && Date.now() - hiddenAt >= 5000) {
    hiddenAt = 0;
    handle?.abort();
  } else {
    hiddenAt = 0;
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', onVisibility);
  // dev HMR:卸载旧模块时移除监听,避免叠加注册(生产构建无 import.meta.hot)
  if (import.meta.hot) {
    import.meta.hot.dispose(() => document.removeEventListener('visibilitychange', onVisibility));
  }
}

export function useStreaming() {
  const configStore = useConfigStore();
  const chatStore = useChatStore();
  const charactersStore = useCharactersStore();
  const worldInfoStore = useWorldInfoStore();

  /** 构造发给 LLM 的 messages(人物卡 + 历史 + 世界书)。 */
  function buildRequestMessages(history: ChatMessage[]): ChatMessage[] {
    const card = charactersStore.current?.card;
    if (!card) {
      throw new Error('未选中人物卡,请先导入或选择一个角色');
    }
    const built = buildMessages({ card, history, worldInfo: worldInfoStore.book });
    // 历史裁剪:总 token 超(上下文窗口 − 生成预算)才裁剪,正常对话走快路径零成本;
    // system 段(人物卡 + 世界书)实际大小动态计入预算,不再用拍脑袋的 reserve 常数。
    const rawCw = configStore.config.contextWindow;
    const ctxWindow = typeof rawCw === 'number' && Number.isFinite(rawCw) && rawCw > 0 ? rawCw : 32768;
    const limit = Math.max(0, ctxWindow - (configStore.config.maxTokens ?? 1024));
    if (built.reduce((s, m) => s + estimateTokens(m.content), 0) <= limit) return built;
    const systemTokens = built
      .filter((m) => m.role === 'system')
      .reduce((s, m) => s + estimateTokens(m.content), 0);
    return trimHistory(built, Math.max(0, limit - systemTokens));
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
