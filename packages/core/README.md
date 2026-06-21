# @minist/core

minist 的纯逻辑核心库——**纯 TypeScript,零 Node 专有 API,浏览器直接可用**。
被前端酒馆(`@minist/tavern`)引用,承担三件事:解析人物卡、激活世界书、构建对话 Prompt。

不依赖任何 npm 第三方包,PNG chunk 解析完全自包含(CRC32 表手写实现)。

## 导出

| 子模块 | 主要导出 |
|---|---|
| `character-card` | `CharacterCard` `CharacterCardV1/V2/V3` `CharacterBook` `parseCardFile` `parseArrayBuffer` `normalizeCard` `validateCard` `isV2` `isV3` `parseCharacterFromPng` `writeCharacterToPng` `extractTextChunks` |
| `worldinfo` | `WorldInfoEntry` `WorldInfoBook` `activateEntries` |
| `prompt` | `Preset` `estimateTokens` `trimHistory` `buildMessages` |

## 用法

```ts
import {
  parseCardFile, normalizeCard, activateEntries, buildMessages,
  type CharacterCard, type WorldInfoBook,
} from '@minist/core';

// 1. 解析人物卡(PNG 或 JSON,V1/V2/V3 自动识别)
const { card, spec } = await parseCardFile(file);
const { card: normalized } = normalizeCard(card);

// 2. 激活世界书(基于最近对话上下文)
const active = activateEntries(worldBook, recentContext);

// 3. 构建 OpenAI 兼容 messages
const messages = buildMessages({ card: normalized, history, worldInfo: worldBook });
```

## 设计要点

- **PNG 解析自包含**:不依赖 `pngjs` / `upng-js`,手写 chunk 遍历 + CRC32 表,兼容浏览器 `Uint8Array`。
- **V3 优先**:`ccv3` chunk 优先级高于 `chara`(参考 SillyTavern 行为)。
- **容错归一化**:`normalizeCard` 接受任意 `unknown`,把 V1 扁平字段提升进 `data`,补默认值,永不抛异常。
- **严格类型**:全程 `strict`,无 `any`;边界输入用 `unknown` + 类型守卫。

## 许可证

AGPL-3.0-only
