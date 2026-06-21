/**
 * chat 请求体构造 — local / cloudflare / tencent 三适配器共享。
 *
 * 把 model / messages / stream / temperature / max_tokens 的拼装与魔法默认值集中一处,
 * 适配器只负责 URL / header / transport 差异,避免三处重复维护。
 */
import type { ChatMessage, TavernConfig } from '@minist/shared';
import type { ChatOptions } from './types';

/** 默认采样温度(config 未设时的兜底,与 config store DEFAULT_CONFIG 对齐)。 */
export const DEFAULT_TEMPERATURE = 0.8;
/** 默认最大 token(config 未设时的兜底)。 */
export const DEFAULT_MAX_TOKENS = 1024;

/** OpenAI 兼容 chat/completions 请求体。 */
export interface ChatPayload {
  model: string;
  messages: ChatMessage[];
  stream: boolean;
  temperature: number;
  max_tokens: number;
}

/** 按 config + opts 构造统一 chat 请求体。 */
export function buildChatPayload(
  cfg: TavernConfig,
  messages: ChatMessage[],
  opts: ChatOptions = {},
): ChatPayload {
  return {
    model: cfg.model,
    messages,
    stream: opts.stream !== false,
    temperature: opts.temperature ?? cfg.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: opts.maxTokens ?? cfg.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

/**
 * 直连模式下把用户填的 LLM base 地址规范化为完整 chat/completions URL。
 *
 * 规则(覆盖常见填法,修复智谱等非 /v1 厂商拼错的历史 bug):
 *   - 已是 /chat/completions 结尾:原样返回
 *   - 以版本段结尾(/v1、/v4 …,如智谱 …/paas/v4):只补 /chat/completions
 *   - 其余(裸域名,如 https://api.deepseek.com):补 /v1/chat/completions
 */
export function normalizeChatUrl(base: string): string {
  const b = base.replace(/\/+$/, ''); // 自洽:先统一去尾斜杠,不依赖调用方预处理
  if (b.endsWith('/chat/completions')) return b;
  if (/\/v\d+$/.test(b)) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}
