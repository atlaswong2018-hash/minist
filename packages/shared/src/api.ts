/**
 * @minist/shared — 通用 API 工具:信封构造、SSE 流解析。
 */
import type { ApiEnvelope, ApiSuccess, ApiError, ChatCompletionChunk } from './types.js';

export function ok<T>(data?: T): ApiSuccess<T> {
  return { success: true, ...(data !== undefined ? { data } : {}) };
}

export function err(error: string, code?: string): ApiError {
  return { success: false, error, ...(code ? { code } : {}) };
}

/** 断言信封成功并取出 data,否则抛错。 */
export function unwrap<T>(env: ApiEnvelope<T>): T {
  if (env.success) return env.data as T;
  throw new Error(env.error);
}

/**
 * 解析 OpenAI 兼容的 SSE 流,逐 token 回调。
 * 适配 fetch ReadableStream(前端)与手工拼接的 data: 行。
 */
export async function parseSseStream(
  stream: ReadableStream<Uint8Array>,
  onToken: (text: string) => void,
  onDone?: (chunk: ChatCompletionChunk | null) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || !line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        onDone?.(null);
        return;
      }
      try {
        const chunk = JSON.parse(payload) as ChatCompletionChunk;
        const text = chunk.delta?.content ?? '';
        if (text) onToken(text);
        if (chunk.finish_reason) onDone?.(chunk);
      } catch {
        // 非 JSON 行(如心跳),忽略。
      }
    }
  }
  onDone?.(null);
}

/** 生成随机用户/设备 ID(无 Math.random 副作用要求的环境可用 crypto)。 */
export function generateUserId(prefix = 'u'): string {
  const rnd =
    typeof crypto !== 'undefined' && 'getRandomValues' in crypto
      ? Array.from(crypto.getRandomValues(new Uint8Array(8)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rnd}`;
}
