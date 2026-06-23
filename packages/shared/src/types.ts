/**
 * @minist/shared — 跨端共享类型契约
 *
 * 这些类型是 minist 全栈(前端酒馆 / CF Worker / 腾讯云 SCF / 部署平台)的"普通话"。
 * 修改此处 = 修改全栈契约,务必同步各端。
 */

/** 后端运行模式。决定前端适配层走哪条数据通路。 */
export type BackendType = 'local' | 'cloudflare' | 'tencent' | 'direct';

/** OpenAI 兼容的对话角色。 */
export type ChatRole = 'system' | 'user' | 'assistant';

/** 单条对话消息(OpenAI 兼容格式)。 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** 前端列表稳定 key / 去重用(生成于前端,后端透传忽略)。 */
  id?: string;
  /** 角色名(多角色组队时用)。 */
  name?: string;
  /** 前端展示用的时间戳(ms)。 */
  timestamp?: number;
}

/**
 * 二进制资源(角色卡头像/图片等)的对象存储引用。
 *
 * 大资源不内嵌 base64 进卡片 JSON(会撑爆 KV 25MB / IndexedDB 配额),
 * 而是上传到对象存储(R2/COS),卡里只存本引用。
 * sha256 内容寻址:跨卡/跨用户同图只存一份,天然去重。
 */
export interface AssetRef {
  /** 可直接 GET 的 URI(`<apiBaseUrl>/api/r2/cards/<sha256>.<ext>`)。 */
  uri: string;
  /** 内容寻址 sha256(对象 key 的一部分,去重/缓存键)。 */
  sha256: string;
  /** 字节大小。 */
  size: number;
  /** 扩展名(无点),如 `png`。 */
  ext: string;
}

/** 酒馆核心配置。前端设置面板编辑,持久化在 IndexedDB。 */
export interface TavernConfig {
  /** 后端模式。 */
  backend: BackendType;
  /** 后端基地址(Worker / SCF URL);direct 模式下为 LLM 官方地址。 */
  apiBaseUrl: string;
  /** LLM API Key(仅存本地,通过 Authorization 头透传给后端中转)。 */
  apiKey: string;
  /** 模型名,如 deepseek-chat、gpt-4o-mini、hunyuan-pro。 */
  model: string;
  /** 是否启用 Base64 混淆(X-Crypto-Data 协议),免备案防明文审查。 */
  crypto: boolean;
  /** 用户/设备标识,用作云端同步分区键。 */
  userId: string;
  temperature?: number;
  maxTokens?: number;
  /** 模型上下文窗口(token),用于历史裁剪预算,避免长对话超限报错。默认见 config store。 */
  contextWindow?: number;
  /** 流式输出开关。 */
  stream?: boolean;
}

/** 云端同步负载:把本地 IndexedDB 全量打包上传到 KV/D1/COS。 */
export interface SyncPayload {
  /** 负载结构版本,便于后续迁移。 */
  version: number;
  /** 导出时间戳(ms)。 */
  exportedAt: number;
  userId: string;
  characters: unknown[];
  chats: unknown[];
  worldinfo: unknown[];
  presets: unknown[];
  config?: Partial<TavernConfig>;
}

/** 统一 API 成功信封。 */
export interface ApiSuccess<T = unknown> {
  success: true;
  data?: T;
}

/** 统一 API 错误信封。 */
export interface ApiError {
  success: false;
  error: string;
  code?: string;
}

export type ApiEnvelope<T = unknown> = ApiSuccess<T> | ApiError;

/** LLM 流式 chunk(OpenAI 兼容 SSE data 行解析后)。 */
export interface ChatCompletionChunk {
  delta?: { content?: string; role?: ChatRole };
  finish_reason?: string | null;
}

/** 一键配置授权方式(腾讯云)。 */
export type GrantMode = 'cam' | 'token';

/** 部署平台向用户呈现的平台选项。 */
export type DeployTarget = 'cloudflare' | 'tencent';
