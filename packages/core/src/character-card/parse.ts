/**
 * 人物卡文件解析入口。
 *
 * 支持两种来源:
 *   - PNG 图片(.png):走 png.ts 提取 tEXt chunk → Base64 解码 → JSON
 *   - JSON 文件(.json):直接 file.text() → JSON.parse
 * 解析后统一经 `normalizeCard` 归一化,返回合法 `CharacterCard`。
 */

import type { CharacterCard } from './types.js';
import { parseCharacterFromPng } from './png.js';
import { normalizeCard } from './validate.js';

/** 解析结果。 */
export interface ParseCardResult {
  /** 归一化后的合法卡片。 */
  card: CharacterCard;
  /** 来源版本(v1/v2/v3),来自 normalizeCard 的推断。 */
  spec: 'v1' | 'v2' | 'v3';
  /** 图片 dataURL(PNG 来源时携带,便于前端直接显示头像;JSON 来源时为 undefined)。 */
  image?: string;
  /** PNG 原始字节(PNG 来源时携带,供前端按需上传到对象存储外置;JSON 来源时为 undefined)。 */
  imageBytes?: Uint8Array;
}

/** PNG 签名前 8 字节,用于类型嗅探(不依赖文件扩展名)。 */
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** 判断字节流是否为 PNG(检查 8 字节签名)。 */
function looksLikePng(buf: Uint8Array): boolean {
  if (buf.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIG[i]) return false;
  }
  return true;
}

/**
 * 解析人物卡文件(PNG 或 JSON)。
 *
 * @param file 浏览器 File 对象
 * @returns `{ card, spec, image? }`
 */
export async function parseCardFile(file: File): Promise<ParseCardResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  return parseBytes(buf, file.type);
}

/**
 * 解析人物卡字节流(更底层的入口,不依赖 File)。
 *
 * @param buf 卡片字节(PNG 或 UTF-8 JSON)
 * @param mimeHint 可选 MIME 提示(如 'image/png');未提供则按字节嗅探
 */
export function parseArrayBuffer(
  buf: ArrayBuffer,
  filename?: string,
): ParseCardResult {
  const bytes = new Uint8Array(buf);
  const hint = filename?.toLowerCase().endsWith('.png') ? 'image/png' : '';
  return parseBytes(bytes, hint);
}

/**
 * 字节流解析核心:PNG 走 png.ts,否则按 UTF-8 JSON 处理。
 * image 字段:PNG 来源时返回 dataURL 便于前端直接渲染头像。
 */
function parseBytes(buf: Uint8Array, mimeHint: string): ParseCardResult {
  if (looksLikePng(buf) || mimeHint === 'image/png') {
    const { json, spec } = parseCharacterFromPng(buf);
    const raw = safeJsonParse(json);
    const { card, spec: normSpec } = normalizeCard(raw);
    // PNG 来源:构造 dataURL 作为头像(PNG 原图)
    const image = dataUrlFromPng(buf);
    // spec 优先用 PNG chunk keyword 的粗判,但最终以 JSON 内 spec 字段为准(normSpec)
    return { card, spec: normSpec, image, imageBytes: buf };
  }

  // 按 JSON 处理
  const text = new TextDecoder('utf-8').decode(buf);
  const raw = safeJsonParse(text);
  const { card, spec } = normalizeCard(raw);
  return { card, spec };
}

/** 安全 JSON.parse,失败抛友好错误。 */
function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Failed to parse character card JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** 把 PNG 字节转为 dataURL(浏览器内联显示头像用)。 */
function dataUrlFromPng(buf: Uint8Array): string {
  // 分块转 binary string 再 btoa(避免超长 apply 栈溢出)
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      buf.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return `data:image/png;base64,${btoa(binary)}`;
}
