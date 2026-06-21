/**
 * @minist/deploy-agent — AI 部署助手入口(barrel + 消息组装)
 *
 * 职责:
 * 1. 导出知识库 / 检索 / prompt。
 * 2. buildAssistantMessages():把用户问题 + 检索到的知识片段,组装成 OpenAI 兼容 messages。
 * 3. 导出 askAssistantStream 适配器钩子:由 platform 注入 fetch 实现,本包不直接依赖网络。
 */
import type { ChatMessage, ChatCompletionChunk, GrantMode, DeployTarget } from '@minist/shared';
import { parseSseStream } from '@minist/shared';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_ZH, SYSTEM_PROMPT_EN } from './prompts';
import { KNOWLEDGE, type KnowledgeEntry, type KnowledgePlatform, type Severity } from './knowledge';
import { retrieve, tokenize } from './retrieve';

export { SYSTEM_PROMPT, SYSTEM_PROMPT_ZH, SYSTEM_PROMPT_EN };
export { KNOWLEDGE, getEntry, type KnowledgeEntry, type KnowledgePlatform, type Severity } from './knowledge';
export { retrieve, tokenize };

/** buildAssistantMessages 的可选配置。 */
export interface AssistantOptions {
  /** 检索条目数,默认 5。 */
  topK?: number;
  /** 平台过滤(cloudflare / tencent),不传则全库检索。 */
  platform?: KnowledgePlatform;
  /** 系统语言。 */
  language?: 'zh' | 'en';
  /** 额外注入的系统级指令(追加到 system prompt 末尾)。 */
  extraSystem?: string;
}

/** 把知识条目渲染成可读的文本片段(注入到 system prompt)。 */
export function renderKnowledge(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) return '【避坑知识库】本次未检索到强相关条目,请基于通用 Serverless 经验谨慎回答,并标注"知识库未覆盖"。';
  const blocks = entries.map((e) => {
    const platformTag = e.platform === 'cloudflare' ? 'Cloudflare' : e.platform === 'tencent' ? '腾讯云' : '通用';
    return `### [KB:${e.id}] (${platformTag} / ${e.severity}) ${e.title}
问题:${e.problem}
解决方案:${e.solution}`;
  });
  return '【避坑知识库 — 回答时优先引用这些已核实的条目,引用时标注 [KB:id]】\n\n' + blocks.join('\n\n');
}

/**
 * 组装 OpenAI 兼容的 messages 数组。
 * system = 系统 prompt + 检索到的知识片段。
 * user = 用户原始问题。
 */
export function buildAssistantMessages(
  userQuestion: string,
  opts?: AssistantOptions,
): { messages: ChatMessage[]; retrieved: KnowledgeEntry[] } {
  const topK = opts?.topK ?? 5;
  const retrieved = retrieve(userQuestion, topK, opts?.platform);
  const lang = opts?.language ?? 'zh';
  const basePrompt = lang === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ZH;
  const knowledgeBlock = renderKnowledge(retrieved);
  const systemContent = [basePrompt, knowledgeBlock, opts?.extraSystem ?? '']
    .filter(Boolean)
    .join('\n\n---\n\n');
  return {
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: userQuestion },
    ],
    retrieved,
  };
}

/**
 * askAssistantStream 适配器钩子:由 platform 注入 fetch 实现。
 * platform 持有用户的 LLM Base URL / Key / Model,调用 OpenAI 兼容 /v1/chat/completions(stream=true)。
 * 本包不直接依赖网络,保持纯逻辑可测。
 *
 * @param fetchImpl platform 注入的 fetch(已绑定 Base URL + Authorization)
 * @param messages buildAssistantMessages 产出的 messages
 * @param onToken 流式 token 回调
 * @param onDone 完成回调(chunk 或 null)
 */
export async function askAssistantStream(
  fetchImpl: (body: unknown) => Promise<Response>,
  messages: ChatMessage[],
  onToken: (text: string) => void,
  onDone?: (chunk: ChatCompletionChunk | null) => void,
): Promise<void> {
  const resp = await fetchImpl({
    model: undefined, // model 由 platform 在 fetchImpl 闭包里填
    messages,
    stream: true,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`LLM 请求失败: ${resp.status} ${resp.statusText}`);
  }
  await parseSseStream(resp.body, onToken, onDone);
}

/** 平台/授权方式联合类型(便于 platform 路由)。 */
export type DeployContext = {
  target: DeployTarget;
  mode?: GrantMode;
};

export { type DeployTarget, type GrantMode };
