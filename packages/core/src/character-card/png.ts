/**
 * 自包含 PNG chunk 解析与写入——纯 TypeScript,零依赖,浏览器可用。
 *
 * PNG 文件结构:
 *   signature(8B: 89 50 4E 47 0D 0A 1A 0A)
 *   ┌──────────────────────────────────────────┐
 *   │ length(4B BE) │ type(4B ASCII) │ data(N) │ CRC(4B BE) │
 *   └──────────────────────────────────────────┘
 *   ...(重复)...
 *   最后必为 IEND chunk。
 *
 * CRC 覆盖 type + data(不含 length、不含 CRC 自身)。
 * tEXt chunk 内部: keyword\0text(Latin1)。
 * iTXt chunk 内部: keyword\0compressionFlag(1B)\0compressionMethod(1B)\0langTag\0translatedKeyword\0text(UTF-8)。
 *
 * 人物卡社区约定:卡片 JSON 经 Base64 编码后存于
 *   - `tEXt` keyword=`chara`(V2 事实标准)
 *   - `tEXt` keyword=`ccv3`(V3,SillyTavern 优先读)
 * 读取时 ccv3 优先级高于 chara。
 */

import { encodeBase64, decodeBase64 } from '@minist/shared';

/** PNG 8 字节签名。 */
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 从 tEXt/iTXt 解出的文本 chunk。 */
export interface PngTextChunk {
  /** keyword,如 `chara` / `ccv3`。 */
  keyword: string;
  /** 文本内容(tEXt 为 Latin1,iTXt 未压缩为 UTF-8,已统一解码为 string)。 */
  text: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRC32(标准 PNG/zlib 多项式 0xEDB88320,预计算表)
// ─────────────────────────────────────────────────────────────────────────────

/** CRC32 查找表(lazy init,模块级单例)。 */
let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      // 标准 PNG CRC: 反射多项式 0xEDB88320
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** 计算 type+data 段的 CRC32(返回无符号 32 位整数)。 */
function crc32(typeAndData: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < typeAndData.length; i++) {
    crc = table[(crc ^ typeAndData[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// 大端读写辅助
// ─────────────────────────────────────────────────────────────────────────────

/** 读 4 字节无符号大端整数。 */
function readUint32BE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset] * 0x1000000 +
      ((buf[offset + 1] << 16) |
        (buf[offset + 2] << 8) |
        buf[offset + 3])) >>>
    0
  );
}

/** 写 4 字节无符号大端整数。 */
function writeUint32BE(buf: Uint8Array, offset: number, value: number): void {
  const v = value >>> 0;
  buf[offset] = (v >>> 24) & 0xff;
  buf[offset + 1] = (v >>> 16) & 0xff;
  buf[offset + 2] = (v >>> 8) & 0xff;
  buf[offset + 3] = v & 0xff;
}

// ─────────────────────────────────────────────────────────────────────────────
// Latin1 / UTF-8 编解码(不依赖 TextEncoder/Latin1 API 差异,自实现 Latin1)
// ─────────────────────────────────────────────────────────────────────────────

/** 把字符串按 Latin1(每码元 1 字节)编码为 Uint8Array。 */
function encodeLatin1(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

/** 把 Latin1 字节流解码为字符串(保留码点 0~255)。 */
function decodeLatin1(bytes: Uint8Array): string {
  let s = '';
  // 分块拼接,避免超长字符串触发 apply 栈限制
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// chunk 定位:返回 IEND chunk 起始偏移(用于在它前面插入)
// ─────────────────────────────────────────────────────────────────────────────

interface ChunkLocation {
  /** chunk 起始偏移(length 字段所在位置)。 */
  offset: number;
  /** chunk type(4 字符 ASCII)。 */
  type: string;
  /** data 段长度。 */
  length: number;
}

/** 列举所有 chunk。校验 PNG 签名,失败抛错。 */
function enumerateChunks(buf: Uint8Array): ChunkLocation[] {
  if (buf.length < PNG_SIGNATURE.length) {
    throw new Error('Not a PNG: file too short');
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) {
      throw new Error('Not a PNG: invalid signature');
    }
  }
  const chunks: ChunkLocation[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 8 <= buf.length) {
    const length = readUint32BE(buf, offset);
    const typeBytes = buf.subarray(offset + 4, offset + 8);
    // type 为 ASCII 字母;用 Latin1 读出
    const type = decodeLatin1(typeBytes);
    chunks.push({ offset, type, length });
    // length(4) + type(4) + data(length) + crc(4)
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// 提取文本 chunk
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 提取 PNG 中所有 tEXt 与 iTXt(未压缩)chunk。
 *
 * tEXt 内部:`keyword\0text`,Latin1。
 * iTXt 内部:`keyword\0compressionFlag\0compressionMethod\0langTag\0translatedKeyword\0text`,UTF-8。
 *           仅处理 compressionFlag=0(未压缩),压缩文本跳过(避免引入 zlib 依赖)。
 *
 * @param buf PNG 文件字节
 * @returns 文本 chunk 数组(按文件中出现顺序)
 * @throws 若不是合法 PNG(签名不符)
 */
export function extractTextChunks(buf: Uint8Array): PngTextChunk[] {
  const chunks = enumerateChunks(buf);
  const out: PngTextChunk[] = [];

  for (const ch of chunks) {
    // data 段从 length+type 之后开始
    const dataStart = ch.offset + 8;
    const dataEnd = dataStart + ch.length;
    const data = buf.subarray(dataStart, dataEnd);

    if (ch.type === 'tEXt') {
      // keyword\0text —— 找第一个 \0
      const nul = data.indexOf(0);
      if (nul < 0) continue;
      const keyword = decodeLatin1(data.subarray(0, nul));
      const text = decodeLatin1(data.subarray(nul + 1));
      out.push({ keyword, text });
    } else if (ch.type === 'iTXt') {
      // keyword\0compFlag\0compMethod\0langTag\0translatedKeyword\0text
      const nul1 = data.indexOf(0);
      if (nul1 < 0) continue;
      const keyword = decodeLatin1(data.subarray(0, nul1));
      const compFlag = data[nul1 + 1];
      if (compFlag !== 0) continue; // 压缩的 iTXt 跳过
      const compMethod = data[nul1 + 2];
      if (compMethod !== 0) continue;
      // 找 langTag、translatedKeyword、text 的连续 \0
      let p = nul1 + 3;
      const nul2 = data.indexOf(0, p); // langTag 终止
      if (nul2 < 0) continue;
      p = nul2 + 1;
      const nul3 = data.indexOf(0, p); // translatedKeyword 终止
      if (nul3 < 0) continue;
      const textBytes = data.subarray(nul3 + 1);
      // iTXt 文本为 UTF-8
      const text = new TextDecoder('utf-8').decode(textBytes);
      out.push({ keyword, text });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 从 PNG 提取人物卡 JSON(ccv3 优先于 chara)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从 PNG 中提取人物卡 JSON 字符串。
 *
 * 查找顺序(参考 SillyTavern 行为):
 *   1. `ccv3` keyword(V3 卡,优先级最高)
 *   2. `chara` keyword(V2 事实标准)
 * 找到后用 `decodeBase64`(UTF-8 安全)解码得到 JSON 字符串。
 *
 * @param buf PNG 文件字节
 * @returns `{ json, spec }` —— spec 由命中的 keyword 决定
 * @throws `Error('No character metadata in PNG')` 当两个 keyword 都不存在
 */
export function parseCharacterFromPng(buf: Uint8Array): {
  json: string;
  spec: 'v2' | 'v3';
} {
  const texts = extractTextChunks(buf);
  // ccv3 优先
  const ccv3 = texts.find((t) => t.keyword === 'ccv3');
  if (ccv3) {
    return { json: decodeBase64(ccv3.text), spec: 'v3' };
  }
  const chara = texts.find((t) => t.keyword === 'chara');
  if (chara) {
    // chara 既可能存 V2 也可能存 V3,这里只能按 keyword 粗判为 v2;
    // 真实版本由上层 normalizeCard 根据 spec 字段确定。
    return { json: decodeBase64(chara.text), spec: 'v2' };
  }
  throw new Error('No character metadata in PNG');
}

// ─────────────────────────────────────────────────────────────────────────────
// 构造单个 tEXt chunk 字节
// ─────────────────────────────────────────────────────────────────────────────

/** 构造一个 tEXt chunk:`length(4) + type(4) + data + crc(4)`。 */
function buildTextChunk(keyword: string, text: string): Uint8Array {
  const keywordBytes = encodeLatin1(keyword);
  const textBytes = encodeLatin1(text);
  // data = keyword + 0x00 + text
  const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  data.set(keywordBytes, 0);
  data[keywordBytes.length] = 0;
  data.set(textBytes, keywordBytes.length + 1);

  const typeBytes = encodeLatin1('tEXt');
  // typeAndData 用于 CRC 计算
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(typeBytes, 0);
  typeAndData.set(data, 4);

  const crc = crc32(typeAndData);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length); // length
  chunk.set(typeBytes, 4); // type
  chunk.set(data, 8); // data
  writeUint32BE(chunk, 8 + data.length, crc); // crc
  return chunk;
}

/**
 * 把人物卡 JSON 写入 PNG:在 IEND 之前插入/替换 `chara` 与 `ccv3` tEXt chunk。
 *
 * 行为:
 *   - 同名 keyword 的旧 chunk 被移除(避免重复)。
 *   - 同时写入 `chara`(向后兼容)与 `ccv3`(V3 优先读)两份 Base64。
 *   - 插入点:IEND chunk 之前。
 *
 * @param buf 原 PNG 字节
 * @param json 人物卡 JSON 字符串
 * @returns 新的 PNG 字节(原 buf 不变)
 */
export function writeCharacterToPng(buf: Uint8Array, json: string): Uint8Array {
  const chunks = enumerateChunks(buf);
  const iend = chunks.find((c) => c.type === 'IEND');
  if (!iend) {
    throw new Error('PNG has no IEND chunk');
  }

  // base64 编码(UTF-8 安全)
  const b64 = encodeBase64(json);
  const charaChunk = buildTextChunk('chara', b64);
  const ccv3Chunk = buildTextChunk('ccv3', b64);

  // 收集要保留的字节区段:签名 + 各 chunk(剔除旧 chara/ccv3 tEXt),到 IEND 起点为止
  const keepRegions: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  // 1) 签名段:0 .. 签名长度
  const sigEnd = PNG_SIGNATURE.length;
  keepRegions.push({ start: cursor, end: sigEnd });
  cursor = sigEnd;

  // 2) 逐 chunk:跳过旧 chara/ccv3 tEXt,保留其余
  for (const ch of chunks) {
    const chStart = ch.offset;
    const chEnd = ch.offset + 12 + ch.length; // 含 CRC
    if (ch.type === 'tEXt') {
      // 读 keyword 判断是否要剔除
      const dataStart = ch.offset + 8;
      const nul = buf.indexOf(0, dataStart);
      let keyword = '';
      if (nul >= 0 && nul < chEnd - 4) {
        keyword = decodeLatin1(buf.subarray(dataStart, nul));
      }
      if (keyword === 'chara' || keyword === 'ccv3') {
        // 跳过此 chunk(不加入 keepRegions)
        cursor = chEnd;
        continue;
      }
    }
    keepRegions.push({ start: chStart, end: chEnd });
    cursor = chEnd;
  }

  // 3) IEND 起点即 cursor(上面循环已推进到 IEND 末尾,但我们要插在 IEND 之前)
  //    重新定位:keepRegions 最后一段应止于 IEND 起始前。
  //    由于 enumerateChunks 在 IEND 处 break,且我们把 IEND 也 push 进了 keepRegions,
  //    需要把 IEND chunk 从保留段中拆出,以便插入新 chunk。
  //    简化:从 keepRegions 中找到 IEND 所在段,截断到 IEND 起始。
  const iendStart = iend.offset;
  const trimmed: Array<{ start: number; end: number }> = [];
  for (const r of keepRegions) {
    if (r.end <= iendStart) {
      trimmed.push(r);
    } else if (r.start < iendStart) {
      // 跨越 IEND 起点的段(IEND chunk 段):截到 IEND 起始
      trimmed.push({ start: r.start, end: iendStart });
    }
    // 完全在 IEND 之后的不留(理论上没有)
  }

  // 计算总长度
  const preLen = trimmed.reduce((sum, r) => sum + (r.end - r.start), 0);
  const iendLen = buf.length - iendStart; // IEND chunk 到文件尾
  const total = preLen + charaChunk.length + ccv3Chunk.length + iendLen;

  const out = new Uint8Array(total);
  let w = 0;
  // 写入保留的前置段
  for (const r of trimmed) {
    const seg = buf.subarray(r.start, r.end);
    out.set(seg, w);
    w += r.end - r.start;
  }
  // 写入新 chara + ccv3
  out.set(charaChunk, w);
  w += charaChunk.length;
  out.set(ccv3Chunk, w);
  w += ccv3Chunk.length;
  // 写入 IEND 段(含其 CRC,到文件尾)
  out.set(buf.subarray(iendStart, buf.length), w);
  return out;
}
