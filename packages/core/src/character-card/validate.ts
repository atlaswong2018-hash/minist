/**
 * 人物卡规范化与校验。
 *
 * `normalizeCard` 接受任意 `unknown`(JSON.parse 的结果),做容错归一化,永不抛异常。
 * `validateCard` 返回问题字符串列表(空数组 = 合法)。
 */

import type {
  CharacterCard,
  CharacterCardV2,
  CharacterCardV3,
  CharacterCardV2Data,
  CharacterCardV3Data,
  CharacterBook,
  CharacterBookEntry,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// 工具:从 unknown 安全取值
// ─────────────────────────────────────────────────────────────────────────────

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string');
  }
  return [];
}

function asRecord(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

/** 把可能是对象或数组的 entries 字段归一化为数组。 */
function normalizeBookEntries(raw: unknown): CharacterBookEntry[] {
  // 规范允许 entries 是数组或 keyed 字典,统一拍平成数组
  if (Array.isArray(raw)) {
    return raw
      .map((item: unknown) => normalizeBookEntry(item))
      .filter((e): e is CharacterBookEntry => e !== null);
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    return Object.keys(obj)
      .map((k) => normalizeBookEntry(obj[k], k))
      .filter((e): e is CharacterBookEntry => e !== null);
  }
  return [];
}

/** 归一化单条世界书条目。 */
function normalizeBookEntry(raw: unknown, key?: string): CharacterBookEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  // 规范字段 keys,部分旧实现用单数 key
  let keys = asStringArray(o.keys);
  if (keys.length === 0 && typeof o.key === 'string') keys = [o.key];
  if (keys.length === 0 && Array.isArray(o.key)) keys = asStringArray(o.key);
  return {
    keys,
    content: asString(o.content),
    extensions: asRecord(o.extensions),
    enabled: typeof o.enabled === 'boolean' ? o.enabled : true,
    insertion_order: typeof o.insertion_order === 'number' ? o.insertion_order : 100,
    case_sensitive: typeof o.case_sensitive === 'boolean' ? o.case_sensitive : false,
    name: typeof o.name === 'string' ? o.name : undefined,
    priority: typeof o.priority === 'number' ? o.priority : undefined,
    comment: typeof o.comment === 'string' ? o.comment : undefined,
    selective: typeof o.selective === 'boolean' ? o.selective : false,
    secondary_keys: asStringArray(o.secondary_keys),
    constant: typeof o.constant === 'boolean' ? o.constant : false,
    position: typeof o.position === 'string' || typeof o.position === 'number'
      ? (o.position as CharacterBookEntry['position'])
      : 'before_char',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// normalizeCard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把任意 `unknown` 归一化为合法 `CharacterCard`。
 *
 * 策略:
 *   - 若顶层带 `spec === 'chara_card_v3'` 且有 `data` → 构造 V3。
 *   - 若顶层带 `spec === 'chara_card_v2'` 且有 `data` → 构造 V2。
 *   - 否则视为 V1(扁平字段):提升进 `data`,升级为 V2 卡返回(spec='v1')。
 *   - 补默认值:`extensions:{}`、`alternate_greetings:[]`、`tags:[]`、空字符串字段。
 *   - 永不抛异常;输入完全无法识别时返回最小合法 V2 卡。
 *
 * @returns `{ card, spec }` —— spec 为卡片"来源版本",便于上层 UI 提示
 */
export function normalizeCard(raw: unknown): {
  card: CharacterCard;
  spec: 'v1' | 'v2' | 'v3';
} {
  const obj = asRecord(raw);
  const spec = typeof obj.spec === 'string' ? obj.spec : '';
  const dataRaw = obj.data;

  // ── V3 ────────────────────────────────────────────────────────────────
  if (spec === 'chara_card_v3' || spec === 'chara_card_v3r') {
    const d = asRecord(dataRaw);
    const v2base = buildV2Data(d);
    const v3data: CharacterCardV3Data = {
      ...v2base,
      character_book: normalizeBook(asRecord(d.character_book)),
      assets: Array.isArray(d.assets)
        ? d.assets
            .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
            .map((a) => ({
              type: asString(a.type),
              uri: asString(a.uri),
              name: asString(a.name),
              ext: asString(a.ext),
            }))
        : undefined,
      nickname: typeof d.nickname === 'string' ? d.nickname : undefined,
      creator_notes_multilingual:
        d.creator_notes_multilingual && typeof d.creator_notes_multilingual === 'object'
          ? (d.creator_notes_multilingual as Record<string, string>)
          : undefined,
      source: asStringArray(d.source).length ? asStringArray(d.source) : undefined,
      group: typeof d.group === 'string' ? d.group : undefined,
    };
    const card: CharacterCardV3 = {
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: v3data,
    };
    // 透传顶层扩展字段(排除已处理字段)
    copyExtraTopFields(obj, card, ['spec', 'spec_version', 'data']);
    return { card, spec: 'v3' };
  }

  // ── V2 ────────────────────────────────────────────────────────────────
  if (spec === 'chara_card_v2') {
    const d = asRecord(dataRaw);
    const v2data = buildV2Data(d);
    const card: CharacterCardV2 = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: v2data,
    };
    copyExtraTopFields(obj, card, ['spec', 'spec_version', 'data']);
    return { card, spec: 'v2' };
  }

  // ── V1(扁平)→ 升级为 V2 ───────────────────────────────────────────
  // V1 卡可能直接扁平,也可能 data 里扁平(规范外);统一取 obj 兜底
  // 注:V1 字段名与 V2 data 字段名一致(name/description/...),直接用 flat 喂 buildV2Data
  const flat = asRecord(
    dataRaw && typeof dataRaw === 'object' ? { ...obj, ...(dataRaw as object) } : obj,
  );
  const v2data = buildV2Data(flat);
  const card: CharacterCardV2 = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: v2data,
  };
  return { card, spec: 'v1' };
}

/** 从未知对象构造 V2 data(字段容错 + 默认值)。 */
function buildV2Data(d: Record<string, unknown>): CharacterCardV2Data {
  return {
    name: asString(d.name),
    description: asString(d.description),
    personality: asString(d.personality),
    scenario: asString(d.scenario),
    first_mes: asString(d.first_mes ?? d.firstMes),
    mes_example: asString(d.mes_example ?? d.mesExample),
    creator_notes: asString(d.creator_notes ?? d.creatorNotes),
    system_prompt: asString(d.system_prompt ?? d.systemPrompt),
    post_history_instructions: asString(
      d.post_history_instructions ?? d.postHistoryInstructions,
    ),
    alternate_greetings: asStringArray(d.alternate_greetings ?? d.alternateGreetings),
    tags: asStringArray(d.tags),
    creator: asString(d.creator),
    character_version: asString(d.character_version ?? d.characterVersion),
    extensions: asRecord(d.extensions),
    talkativeness: typeof d.talkativeness === 'string' ? d.talkativeness : undefined,
  };
}

/** 归一化内嵌世界书为 CharacterBook(entries 数组形式)。 */
function normalizeBook(raw: Record<string, unknown>): CharacterBook | undefined {
  if (!raw.entries && !raw['entries']) return undefined;
  return {
    entries: normalizeBookEntries(raw.entries),
    name: typeof raw.name === 'string' ? raw.name : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    scan_depth: typeof raw.scan_depth === 'number' ? raw.scan_depth : undefined,
    token_budget: typeof raw.token_budget === 'number' ? raw.token_budget : undefined,
    recursive_scanning:
      typeof raw.recursive_scanning === 'boolean' ? raw.recursive_scanning : undefined,
    extensions: Object.keys(raw.extensions || {}).length
      ? asRecord(raw.extensions)
      : undefined,
  };
}

/** 把顶层除已知字段外的属性透传到目标卡(保留扩展字段)。 */
function copyExtraTopFields(
  src: Record<string, unknown>,
  dst: CharacterCard,
  exclude: string[],
): void {
  for (const k of Object.keys(src)) {
    if (!exclude.includes(k)) {
      (dst as Record<string, unknown>)[k] = src[k];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// validateCard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 校验人物卡合法性,返回问题字符串列表(空数组 = 合法)。
 *
 * 检查项:必备字段存在性、spec 一致性、内嵌世界书条目最小完整性。
 * 不做严格 schema 校验(社区卡良莠不齐,过严会误杀)。
 */
export function validateCard(card: unknown): string[] {
  const issues: string[] = [];
  if (!card || typeof card !== 'object') {
    return ['card is not an object'];
  }
  const o = card as Record<string, unknown>;

  // spec 校验
  if (o.spec !== 'chara_card_v2' && o.spec !== 'chara_card_v3') {
    issues.push(`unknown spec: ${String(o.spec)}`);
  }

  const data = asRecord(o.data);
  if (!data.name) issues.push('data.name is empty');
  if (typeof data.name !== 'string') issues.push('data.name is not a string');

  // V3 内嵌世界书条目校验
  if (o.spec === 'chara_card_v3') {
    const book = asRecord(data.character_book);
    if (book.entries) {
      const entries = normalizeBookEntries(book.entries);
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.keys || e.keys.length === 0) {
          if (!e.constant) {
            issues.push(`character_book entry[${i}] has no keys and is not constant`);
          }
        }
        if (typeof e.content !== 'string') {
          issues.push(`character_book entry[${i}].content is not a string`);
        }
      }
    }
  }

  return issues;
}
