/**
 * @minist/core —— minist 纯逻辑核心库。
 *
 * 纯 TypeScript,零 Node 专有 API,浏览器直接可用。被 `@minist/tavern` 引用。
 * 三大子模块:
 *   - character-card:人物卡解析(PNG/JSON,V1/V2/V3)+ 规范化 + 校验
 *   - worldinfo:世界书条目激活
 *   - prompt:Token 估算、历史裁剪、OpenAI 兼容 messages 构建
 *
 * 依赖:`@minist/shared`(Base64 / ChatMessage 等契约)。
 */
export * from './character-card/index.js';
export * from './worldinfo/index.js';
export * from './prompt/index.js';
