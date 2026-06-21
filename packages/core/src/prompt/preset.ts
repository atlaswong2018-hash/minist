/**
 * 预设(Preset)类型——把一组系统提示词与采样参数打包。
 *
 * 用户在前端"预设"面板编辑,持久化在 IndexedDB。
 * `buildMessages` 会把 preset.system_prompt 拼到 system 段尾部。
 */

/** 对话预设。 */
export interface Preset {
  /** 预设名(展示用)。 */
  name: string;
  /** 系统提示词(拼在人物描述 + 世界书之后)。 */
  system_prompt?: string;
  /**
   * 提示词顺序(高级:自定义各段拼接顺序)。
   * MVP 阶段可忽略,保留字段供后续扩展。
   */
  prompt_order?: Array<{
    identifier: string;
    enabled: boolean;
  }>;
  /** 采样温度(覆盖 config.temperature)。 */
  temperature?: number;
  /** 最大 token(覆盖 config.maxTokens)。 */
  max_tokens?: number;
  /** top_p(部分模型支持)。 */
  top_p?: number;
  /** 频率惩罚。 */
  frequency_penalty?: number;
  /** 存在惩罚。 */
  presence_penalty?: number;
  /** 扩展字段。 */
  extensions?: Record<string, unknown>;
}
