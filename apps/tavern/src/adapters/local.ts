/**
 * Local / Direct 适配器。
 *
 * - backend = 'local':零配置本地模式。数据全在 IndexedDB。
 *   聊天走 direct 直连 LLM(需用户填官方 apiBaseUrl + apiKey)。
 * - backend = 'direct':同上,显式直连 LLM(直连 OpenAI/DeepSeek/智谱官方)。
 *
 * saveCard/sync/pull 在本地模式下走 IndexedDB(由 store 层负责),
 * 此适配器对这些方法为 no-op / 返回空,避免重复持久化。
 */
import type { BackendAdapter, AdapterArgs, ChatOptions, ChatStreamHandle } from './types';
import { fetchStream } from './stream';
import { buildChatPayload, normalizeChatUrl } from './payload';
import type { ChatMessage, SyncPayload } from '@minist/shared';
import type { CharacterCard } from '@minist/core';

export class LocalAdapter implements BackendAdapter {
  readonly name = '本地 / 直连';
  readonly backend = 'local' as const;
  protected cfg: AdapterArgs['config'];

  constructor(args: AdapterArgs) {
    this.cfg = args.config;
  }

  async health(): Promise<boolean> {
    return true; // direct/local 不依赖后端
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatStreamHandle> {
    const base = (this.cfg.apiBaseUrl || '').replace(/\/$/, '');
    const apiKey = this.cfg.apiKey;
    if (!base || !apiKey) {
      throw new Error('直连模式未配置 apiBaseUrl / apiKey,请在设置中填写 LLM 服务地址与密钥');
    }
    const stream = opts.stream !== false;
    return fetchStream({
      url: normalizeChatUrl(base),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(buildChatPayload(this.cfg, messages, opts)),
      stream,
    });
  }

  // 本地模式:卡/同步由 store 直接操作 IndexedDB,这里 no-op
  async saveCard(_card: CharacterCard): Promise<void> {}
  async sync(_payload: SyncPayload): Promise<void> {}
  async pull(): Promise<SyncPayload | null> {
    return null;
  }
}
