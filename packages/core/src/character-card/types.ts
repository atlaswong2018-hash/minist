/**
 * 人物卡类型——严格遵循 SillyTavern / Character Card 社区规范。
 *
 * 规范来源:
 *  - V2: `chara_card_v2` / spec_version `2.0`(社区广泛事实标准)
 *  - V3: `chara_card_v3` / spec_version `3.0`(V2 + 内嵌世界书 + 资源 + 多语言注)
 *
 * 联合类型 `CharacterCard = CharacterCardV2 | CharacterCardV3` 是包内"合法卡"的对外形态;
 * V1 仅作为解析入口(`normalizeCard` 会把 V1 提升为 V2)。
 */

// ─────────────────────────────────────────────────────────────────────────────
// V1(扁平简版,无 spec 字段)
// ─────────────────────────────────────────────────────────────────────────────

/** V1 简版人物卡:扁平字段,无 spec 包装。 */
export interface CharacterCardV1 {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// 内嵌世界书(V3 data.character_book)
// ─────────────────────────────────────────────────────────────────────────────

/** 世界书单条条目(内嵌在 V3 人物卡 data.character_book.entries 里)。 */
export interface CharacterBookEntry {
  /** 主关键词,命中即激活。 */
  keys: string[];
  /** 注入正文。 */
  content: string;
  /** 扩展字段(各前端自定义)。 */
  extensions?: Record<string, unknown>;
  /** 是否启用。 */
  enabled?: boolean;
  /** 插入顺序(数值越小越靠前)。 */
  insertion_order?: number;
  /** 是否大小写敏感。 */
  case_sensitive?: boolean;
  /** 条目名。 */
  name?: string;
  /** 优先级(部分实现用此字段替代 insertion_order)。 */
  priority?: number;
  /** 注释/备注。 */
  comment?: string;
  /** 是否为选择性激活(需配合 secondary_keys 与位置逻辑)。 */
  selective?: boolean;
  /** 次级关键词(selective=true 时用于二次过滤)。 */
  secondary_keys?: string[];
  /** 常驻激活(无需关键词命中)。 */
  constant?: boolean;
  /** 注入位置:字符串角色位置,或数字偏移(各实现语义不同,这里宽松保留)。 */
  position?: 'before_char' | 'after_char' | number;
}

/** 内嵌世界书(V3 data.character_book)。 */
export interface CharacterBook {
  /** 条目数组或 keyed 字典(规范允许两种;这里归一化为数组,解析时处理)。 */
  entries: CharacterBookEntry[];
  /** 世界书名。 */
  name?: string;
  /** 描述。 */
  description?: string;
  /** 扫描深度(往回看几条消息)。 */
  scan_depth?: number;
  /** token 预算上限。 */
  token_budget?: number;
  /** 是否递归扫描(扫描结果本身再参与匹配)。 */
  recursive_scanning?: boolean;
  /** 扩展字段。 */
  extensions?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// V2 / V3 共享 data 结构
// ─────────────────────────────────────────────────────────────────────────────

/** V2 人物卡 data 字段(spec `chara_card_v2`)。 */
export interface CharacterCardV2Data {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  tags: string[];
  creator: string;
  character_version: string;
  extensions: Record<string, unknown>;
  /** 话痨程度(0~1,部分前端用;非规范强制)。 */
  talkativeness?: string;
}

/** V3 人物卡 data 字段:在 V2 基础上扩展。 */
export interface CharacterCardV3Data extends CharacterCardV2Data {
  /** 内嵌世界书。 */
  character_book?: CharacterBook;
  /** 资源(图片/音频等附加素材的引用)。 */
  assets?: Array<{
    type: string;
    uri: string;
    name: string;
    ext: string;
  }>;
  /** 昵称。 */
  nickname?: string;
  /** 创作注多语言版本(key=语言码,value=文本)。 */
  creator_notes_multilingual?: Record<string, string>;
  /** 来源(多卡合并时记录出处)。 */
  source?: string[];
  /** 分组(把多个卡组织成卡组的标识)。 */
  group?: string;
  /** 分组内仅允许的发言者(generation 限制)。 */
  allow_group_only?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 卡片顶层结构
// ─────────────────────────────────────────────────────────────────────────────

/** V2 顶层:spec + spec_version + data。 */
export interface CharacterCardV2 {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: CharacterCardV2Data;
  /** 扩展字段(顶层,与 data.extensions 并存)。 */
  [key: string]: unknown;
}

/** V3 顶层:spec + spec_version + data(含 character_book)。 */
export interface CharacterCardV3 {
  spec: 'chara_card_v3';
  spec_version: '3.0';
  data: CharacterCardV3Data;
  [key: string]: unknown;
}

/** 合法卡片联合类型(对外暴露)。 */
export type CharacterCard = CharacterCardV2 | CharacterCardV3;

// ─────────────────────────────────────────────────────────────────────────────
// 类型守卫
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 判断卡片是否为 V3(`spec === 'chara_card_v3'`)。
 * 仅检查 spec 字段,不深校验 data 结构。
 */
export function isV3(card: unknown): card is CharacterCardV3 {
  if (typeof card !== 'object' || card === null) return false;
  return (card as { spec?: unknown }).spec === 'chara_card_v3';
}

/**
 * 判断卡片是否为 V2(`spec === 'chara_card_v2'`)。
 * 注意:V3 卡不会被此守卫命中(显式区分版本)。
 */
export function isV2(card: unknown): card is CharacterCardV2 {
  if (typeof card !== 'object' || card === null) return false;
  return (card as { spec?: unknown }).spec === 'chara_card_v2';
}
