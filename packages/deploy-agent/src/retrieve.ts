/**
 * @minist/deploy-agent — 关键词命中数检索
 *
 * 纯 TS,无向量依赖。query 分词后,对每条 entry 的 keywords 做命中数排序。
 * 简单但有效:对部署排障类问题(关键词集中在"kv/超时/微信/计费"等)召回足够。
 */
import { KNOWLEDGE, type KnowledgeEntry, type KnowledgePlatform } from './knowledge';

/** 把 query 拆成小写 token(中英文混合:英文按空格/标点,中文按字 + 词)。 */
export function tokenize(query: string): string[] {
  if (!query) return [];
  const lower = query.toLowerCase().trim();
  const tokens = new Set<string>();
  // 英文/数字 token
  const ascii = lower.match(/[a-z0-9][a-z0-9-]{1,}/g) ?? [];
  ascii.forEach((t) => tokens.add(t));
  // 中文:按字 + 按常见 2-4 字滑窗(粗粒度,覆盖关键词命中)
  const cjk = lower.match(/[一-龥]+/g) ?? [];
  for (const seg of cjk) {
    for (let i = 0; i < seg.length; i += 1) {
      tokens.add(seg[i] as string); // 单字
    }
    for (let i = 0; i + 2 <= seg.length; i += 1) {
      tokens.add(seg.slice(i, i + 2)); // 双字词
    }
    for (let i = 0; i + 3 <= seg.length; i += 1) {
      tokens.add(seg.slice(i, i + 3)); // 三字词
    }
  }
  return Array.from(tokens);
}

/** 单条 entry 的命中数 = tokens 中命中其 keywords 的数量(去重)。 */
function scoreEntry(entry: KnowledgeEntry, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const kwSet = new Set(entry.keywords);
  let score = 0;
  for (const t of tokens) {
    if (kwSet.has(t)) score += 1;
    // 子串命中:token 是某 keyword 的子串(如 "kv" 命中 "kv-write")
    else {
      for (const kw of entry.keywords) {
        if (kw.includes(t)) {
          score += 0.5;
          break;
        }
      }
    }
  }
  return score;
}

/**
 * 检索 top-K 相关条目。
 * @param query 用户问题(自然语言)
 * @param topK 默认 5
 * @param platform 可选平台过滤,只返回该平台 + common
 */
export function retrieve(
  query: string,
  topK = 5,
  platform?: KnowledgePlatform,
): KnowledgeEntry[] {
  const tokens = tokenize(query);
  const candidates = platform
    ? KNOWLEDGE.filter((e) => e.platform === platform || e.platform === 'common')
    : KNOWLEDGE;
  return candidates
    .map((e) => ({ entry: e, score: scoreEntry(e, tokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      // 同分时:severity 优先(critical > high > medium > low)
      if (b.score === a.score) {
        const sev: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
        return (sev[b.entry.severity] ?? 0) - (sev[a.entry.severity] ?? 0);
      }
      return b.score - a.score;
    })
    .slice(0, topK)
    .map((x) => x.entry);
}
