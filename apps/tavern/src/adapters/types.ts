/**
 * 后端适配层契约。
 *
 * 把 local / cloudflare / tencent / direct 四种后端模式抽象为统一接口,
 * 上层组件只依赖 BackendAdapter,不感知具体后端。
 *
 * chat() 返回一个支持中断的流式句柄:stream 是 async generator,abort 可中断。
 */
import type { ChatMessage, SyncPayload, TavernConfig } from '@minist/shared';
import type { CharacterCard } from '@minist/core';

/** chat() 调用选项。 */
export interface ChatOptions {
  /** 采样温度(覆盖 config)。 */
  temperature?: number;
  /** 最大 token(覆盖 config)。 */
  maxTokens?: number;
  /** 是否流式(默认 true)。 */
  stream?: boolean;
}

/** 流式 chat 句柄。 */
export interface ChatStreamHandle {
  /** AsyncGenerator,逐 token yield;迭代结束表示流式完成。 */
  stream: AsyncGenerator<string, void, unknown>;
  /** 中断生成(用户点"停止")。 */
  abort: () => void;
  /** 当前是否已中断。 */
  aborted: () => boolean;
}

/** 统一后端适配器。 */
export interface BackendAdapter {
  /** 适配器名(展示用)。 */
  readonly name: string;
  /** 后端模式。 */
  readonly backend: TavernConfig['backend'];

  /** 健康检查(后端可达返回 true)。 */
  health(): Promise<boolean>;

  /**
   * 发起流式聊天。
   * @param messages OpenAI 兼容消息数组
   * @param opts 选项
   * @returns 流式句柄(可中断)
   */
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatStreamHandle>;

  /** 保存人物卡到云端(后端为 local/direct 时为 no-op)。 */
  saveCard(card: CharacterCard): Promise<void>;

  /** 上传全量同步负载到云端。 */
  sync(payload: SyncPayload): Promise<void>;

  /** 从云端拉取全量同步负载(若无数据返回 null)。 */
  pull(): Promise<SyncPayload | null>;
}

/** 所有适配器共享的构造入参:配置引用。 */
export interface AdapterArgs {
  config: TavernConfig;
}
