/**
 * Token 估算与历史裁剪。
 *
 * 真实 token 计数依赖具体 tokenizer(BPE / tiktoken),浏览器侧不便引入。
 * 这里用启发式近似,误差在可接受范围(用于裁剪预算,非精确计费)。
 */

import type { ChatMessage } from '@minist/shared';

/**
 * 估算文本 token 数(启发式)。
 *
 * 规则(取两者较大,偏保守,避免低估导致超长):
 *   - 英文启发:约 4 字符 / token → ceil(chars / 4)
 *   - 中日韩权重:约 2 字符 / token → ceil(cjkChars / 2) + 非中日韩按 4 字符
 *
 * 简化实现:同时计算 `ceil(totalChars/4)` 与 `ceil(totalChars/2)`,取较大。
 * 纯英文文本前者更准;纯中文后者更准;混合取较大保证不低估。
 *
 * @param text 待估算文本
 * @returns 估算 token 数(>=0 整数)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  const byEnglish = Math.ceil(chars / 4);
  const byCjk = Math.ceil(chars / 2);
  return Math.max(byEnglish, byCjk);
}

/**
 * 按预算从最旧消息开始裁剪对话历史,保留 system 消息。
 *
 * 行为:
 *   - system 消息永不裁剪(始终保留在结果中)。
 *   - 其余消息按"从最新到最旧"累加 token,超出 budget 时丢弃更早的。
 *   - 结果保持原始顺序。
 *   - budget <= 0 时返回仅含 system 的前缀。
 *
 * 注意:此函数不重新拼接 system——它只裁剪 history 数组本身。
 * system 段的拼装由 buildMessages 负责。
 *
 * @param messages 完整历史(含可能的 system)
 * @param budget 非 system 消息允许的最大 token 总和
 * @returns 裁剪后的消息数组(顺序保留,system 全保留)
 */
export function trimHistory(messages: ChatMessage[], budget: number): ChatMessage[] {
  if (budget <= 0) {
    return messages.filter((m) => m.role === 'system');
  }

  // 先抽出 system(system 全保留,不占 budget)
  const systems: ChatMessage[] = [];
  const others: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') systems.push(m);
    else others.push(m);
  }

  // 从最新向最旧累加,超出 budget 停止
  const kept: ChatMessage[] = [];
  let used = 0;
  for (let i = others.length - 1; i >= 0; i--) {
    const cost = estimateTokens(others[i].content);
    if (used + cost > budget) break;
    used += cost;
    kept.unshift(others[i]);
  }

  // 保持原顺序:system 在前(它们原本也在前),后接保留的非 system
  return [...systems, ...kept];
}
