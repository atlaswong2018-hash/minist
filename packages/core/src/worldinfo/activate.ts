/**
 * 世界书条目激活算法(简化版,够用即可)。
 *
 * 激活规则:
 *   1. `enabled === false` 的条目永不激活。
 *   2. `constant === true` 的条目恒激活(无视关键词)。
 *   3. 其余条目:任一 `key` 在 `recentContext` 中命中即激活;
 *      若 `selective === true`,还需至少一个 `secondary_keys` 也命中。
 *   4. 大小写由 `case_sensitive` 控制。
 *   5. 命中条目按 `order` 升序排序(order 小的优先注入)。
 *
 * 这是 SillyTavern 完整 WI 引擎的子集:不实现递归扫描、token 预算、
 * 深度/广度优先、概率激活等高级特性——MVP 阶段够用。
 */

import type { WorldInfoBook, WorldInfoEntry } from './types.js';

/**
 * 根据最近对话上下文,计算应激活的世界书条目。
 *
 * @param book 世界书
 * @param recentContext 最近 N 条对话拼接的文本(用于关键词扫描)
 * @returns 激活条目数组(按 order 升序,constant 条目排在最前)
 */
export function activateEntries(book: WorldInfoBook, recentContext: string): WorldInfoEntry[] {
  const entries = book.entries || [];
  // 预计算小写上下文:每条目按自身 case_sensitive 决定是否 toLowerCase 扫描
  const ctxLower = recentContext.toLowerCase();

  const active: WorldInfoEntry[] = [];

  for (const entry of entries) {
    if (entry.enabled === false) continue;

    // 常驻条目恒激活(无视关键词)
    if (entry.constant) {
      active.push(entry);
      continue;
    }

    // 关键词匹配
    if (matchKeywords(entry, recentContext, ctxLower)) {
      active.push(entry);
    }
  }

  // 排序:constant 优先(在前),其余按 order 升序,order 相同按 uid 稳定
  active.sort((a, b) => {
    const ac = a.constant ? 0 : 1;
    const bc = b.constant ? 0 : 1;
    if (ac !== bc) return ac - bc;
    if (a.order !== b.order) return a.order - b.order;
    return String(a.uid).localeCompare(String(b.uid));
  });

  return active;
}

/**
 * 单条目关键词匹配。
 *
 * 非 selective:任一 key 命中即激活。
 * selective:任一 key 命中 且 任一 secondary_keys 命中。
 */
function matchKeywords(
  entry: WorldInfoEntry,
  ctx: string,
  ctxLower: string,
): boolean {
  const primaryHit = entry.key.some((k) => containsKeyword(k, entry, ctx, ctxLower));
  if (!primaryHit) return false;
  if (!entry.selective) return true;
  // selective:secondary_keys 需至少一个命中;secondary 为空时退化为非 selective
  if (entry.secondary_keys.length === 0) return true;
  return entry.secondary_keys.some((k) =>
    containsKeyword(k, entry, ctx, ctxLower),
  );
}

/** 单关键词包含检测,按 case_sensitive 切换上下文。 */
function containsKeyword(
  keyword: string,
  entry: WorldInfoEntry,
  ctx: string,
  ctxLower: string,
): boolean {
  if (!keyword) return false;
  if (entry.case_sensitive) {
    return ctx.includes(keyword);
  }
  return ctxLower.includes(keyword.toLowerCase());
}
