/**
 * Prompt 构建器:把人物卡 + 世界书 + 预设 + 历史拼成 OpenAI 兼容 messages。
 *
 * 输出结构(OpenAI Chat Completions 兼容):
 *   [
 *     { role: 'system', content: <人物描述+性格+场景+system_prompt + 激活世界书> },
 *     ...history(user / assistant),
 *   ]
 *
 * 设计决策:
 *   - 人物卡的 first_mes(开场白)不放入 messages——它由前端作为"首条 assistant
 *     消息"单独渲染与存储,避免每次请求都把它当 system 注入。
 *   - 多个 system 段合并为单条 system message(部分 API 对多条 system 容忍度不一)。
 *   - 世界书激活用 activateEntries,基于 history 拼接的上下文扫描。
 *   - post_history_instructions 作为最后一条 system 追加(规范语义:插在历史之后)。
 */

import type { ChatMessage } from '@minist/shared';
import type { CharacterCard, CharacterCardV2Data } from '../character-card/types.js';
import type { WorldInfoBook } from '../worldinfo/types.js';
import { activateEntries } from '../worldinfo/activate.js';
import type { Preset } from './preset.js';

/** buildMessages 输入。 */
export interface BuildMessagesOptions {
  /** 归一化后的人物卡。 */
  card: CharacterCard;
  /** 对话历史(不含 system,system 由本函数构造)。 */
  history: ChatMessage[];
  /** 世界书(可选)。若提供,基于 history 扫描激活。 */
  worldInfo?: WorldInfoBook;
  /** 预设(可选)。system_prompt 追加在人物 system 之后。 */
  preset?: Preset;
  /**
   * 世界书扫描时往回看几条历史(默认全部历史)。
   * SillyTavern 默认 scan_depth 较小以省 token;这里默认全量扫描。
   */
  worldInfoScanDepth?: number;
}

/**
 * 构造 OpenAI 兼容 messages 数组。
 *
 * @returns messages,首条恒为 system;若 card 有 post_history_instructions,
 *          会在 history 末尾再追加一条 system。
 */
export function buildMessages(opts: BuildMessagesOptions): ChatMessage[] {
  const { card, history, worldInfo, preset, worldInfoScanDepth } = opts;

  const data = (card as { data: CharacterCardV2Data }).data;

  // ── 世界书激活:基于历史拼接上下文 ────────────────────────────────────
  let activeWorldInfoText = '';
  if (worldInfo && worldInfo.entries.length > 0) {
    const ctxHistory =
      typeof worldInfoScanDepth === 'number'
        ? history.slice(-Math.max(0, worldInfoScanDepth))
        : history;
    const recentContext = ctxHistory.map((m) => m.content).join('\n');
    const active = activateEntries(worldInfo, recentContext);
    if (active.length > 0) {
      // 每条激活条目内容用分隔符隔开
      activeWorldInfoText = active
        .map((e) => e.content)
        .filter(Boolean)
        .join('\n\n');
    }
  }

  // ── 拼装 system 正文 ──────────────────────────────────────────────────
  const systemParts: string[] = [];
  const description = data.description?.trim();
  if (description) systemParts.push(description);

  const personality = data.personality?.trim();
  if (personality) systemParts.push(personality);

  const scenario = data.scenario?.trim();
  if (scenario) systemParts.push(scenario);

  // 卡内 system_prompt(规范字段:角色专属系统指令)
  const cardSystem = data.system_prompt?.trim();
  if (cardSystem) systemParts.push(cardSystem);

  // 激活的世界书内容
  if (activeWorldInfoText) systemParts.push(activeWorldInfoText);

  // 预设 system_prompt(用户全局指令,放最后覆盖优先级最高)
  const presetSystem = preset?.system_prompt?.trim();
  if (presetSystem) systemParts.push(presetSystem);

  const messages: ChatMessage[] = [];

  // 拼接为单条 system(空 system 仍保留占位,避免空 messages)
  const systemContent = systemParts.join('\n\n');
  if (systemContent) {
    messages.push({ role: 'system', content: systemContent });
  }

  // ── 历史消息(过滤掉传入的 system,避免重复) ────────────────────────
  for (const m of history) {
    if (m.role === 'system') continue;
    messages.push({ role: m.role, content: m.content, name: m.name, timestamp: m.timestamp });
  }

  // ── post_history_instructions:作为末尾 system 注入 ──────────────────
  const postInstr = data.post_history_instructions?.trim();
  if (postInstr) {
    messages.push({ role: 'system', content: postInstr });
  }

  return messages;
}
