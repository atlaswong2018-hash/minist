/**
 * 流式聊天通用工具 — 把 fetch + parseSseStream 包装为可中断的 AsyncGenerator。
 *
 * 三个适配器(local / cloudflare / tencent)共享此逻辑,避免重复实现。
 * 设计:用 Promise 队列桥接 push-based 的 parseSseStream 回调到 pull-based 的 generator。
 */
import { parseSseStream } from '@minist/shared';
import type { ChatStreamHandle } from './types';

export interface FetchStreamArgs {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 是否流式(非流式时一次性返回完整文本)。 */
  stream?: boolean;
}

/**
 * 发起 fetch,返回可中断的 token generator。
 * stream=true 时逐 token yield;stream=false 时一次性 yield 完整文本。
 */
export function fetchStream(args: FetchStreamArgs): ChatStreamHandle {
  const controller = new AbortController();
  let aborted = false;

  const stream = (async function* () {
    const resp = await fetch(args.url, {
      method: args.method ?? 'POST',
      headers: args.headers ?? {},
      body: args.body,
      signal: controller.signal,
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`请求失败 ${resp.status}: ${txt.slice(0, 200)}`);
    }
    // 非流式:把整段响应文本一次性 yield
    if (args.stream === false) {
      const env = await resp.json().catch(() => ({}));
      const content =
        (env && typeof env === 'object' && 'choices' in env
          ? (env as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0]?.message
              ?.content
          : undefined) ?? (typeof env === 'string' ? env : '');
      if (content) yield content;
      return;
    }
    if (!resp.body) throw new Error('后端未返回流(SSE)');

    // push → pull 桥接
    const queue: string[] = [];
    let finished = false;
    let pendingErr: Error | null = null;
    let resolver: (() => void) | null = null;
    const wake = (): void => {
      resolver?.();
      resolver = null;
    };

    void parseSseStream(
      resp.body as ReadableStream<Uint8Array>,
      (tok) => {
        queue.push(tok);
        wake();
      },
      () => {
        finished = true;
        wake();
      },
    ).catch((e) => {
      pendingErr = e instanceof Error ? e : new Error(String(e));
      finished = true;
      wake();
    });

    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else if (pendingErr) {
        throw pendingErr;
      } else if (finished) {
        return;
      } else {
        await new Promise<void>((resolve) => {
          resolver = resolve;
        });
      }
      if (controller.signal.aborted) return;
    }
  })();

  return {
    stream,
    abort: () => {
      aborted = true;
      controller.abort();
    },
    aborted: () => aborted,
  };
}
