/**
 * 世界书(World Info / Lorebook)类型。
 *
 * 与人物卡内嵌 `CharacterBook` 并行存在:独立世界书是用户自建的 lorebook,
 * 人物卡内嵌世界书来自 V3 data.character_book。两者条目结构兼容,
 * 故 `WorldInfoEntry` 与 `CharacterBookEntry` 字段对齐(独立定义避免循环依赖)。
 */

/** 注入位置:角色定义前 / 角色定义后 / 指定消息偏移编号。 */
export type WorldInfoPosition = 'before_char' | 'after_char' | number;

/** 单条世界书条目(独立世界书版本,带 uid)。 */
export interface WorldInfoEntry {
  /** 唯一 ID(前端生成,稳定引用)。 */
  uid: number | string;
  /** 主关键词(命中任一即激活)。 */
  key: string[];
  /** 次级关键词(selective 模式二次过滤)。 */
  secondary_keys: string[];
  /** 注入正文。 */
  content: string;
  /** 注释/备注。 */
  comment: string;
  /** 排序权重(数值越小越靠前;常用于多个命中条目排序)。 */
  order: number;
  /** 注入位置。 */
  position: WorldInfoPosition;
  /** 是否启用(禁用条目永不参与匹配)。 */
  enabled: boolean;
  /** 常驻激活(无需关键词命中,恒注入)。 */
  constant: boolean;
  /** 是否选择性激活(需 secondary_keys 配合位置逻辑)。 */
  selective: boolean;
  /** 是否大小写敏感匹配。 */
  case_sensitive: boolean;
  /** 扩展字段(各前端自定义)。 */
  extensions?: Record<string, unknown>;
}

/** 世界书(条目集合 + 可选名)。 */
export interface WorldInfoBook {
  /** 条目数组。 */
  entries: WorldInfoEntry[];
  /** 世界书名。 */
  name?: string;
  /** 额外元信息(扫描深度、token 预算等,可选)。 */
  [key: string]: unknown;
}
