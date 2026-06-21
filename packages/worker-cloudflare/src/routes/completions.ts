/**
 * worker-cloudflare/src/routes/completions.ts — LLM 流式中转
 *
 * 路由:POST /v1/chat/completions → 透传到上游 LLM,流式原样回写
 *
 * 职责:
 *   1. 解析上游目标 URL(env.DEFAULT_LLM_URL 或请求头 X-LLM-Url)。
 *   2. 透传 Authorization(密钥始终 HTTPS,不进 Worker 日志)。
 *   3. 混淆协议:若 X-Crypto-Data: true,请求 body 是 Base64 混淆后的真实 JSON,
 *      Worker 先 decodeBase64 还原再转发(请求侧解混淆)。
 *   4. ✅ 流式回写:直接把上游 response.body(ReadableStream)原样透传,
 *      不 buffer、不二次加密(免备案下原样流式最不易断连;
 *      SSE 一旦中途修改字节会破坏 chunk 边界)。
 *   5. 响应头加 CORS + SSE 头,确保手机/微信浏览器可接收流。
 *
 * CF Worker 约束:免费版 CPU 时间 10ms/请求,但流式转发是等网络(I/O),
 * 不计 CPU 时间,因此长流式补全完全可行。
 */
import {
  HEADERS,
  CORS_HEADERS,
  SSE_HEADERS,
  decodeBase64,
  err,
} from '@minist/shared';
import type { Env } from '../env';
import { jsonCors } from '../cors';

/** 请求头名:允许调用方覆盖默认 LLM 地址(可选增强)。 */
const LLM_URL_HEADER = 'X-LLM-Url';

/** 流式中转主处理。 */
export async function handleCompletions(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonCors(err(`method not allowed: ${request.method}`, 'METHOD_NOT_ALLOWED'), 405);
  }

  // ─── 1. 解析上游地址 ────────────────────────────────────────────
  const targetUrl =
    request.headers.get(LLM_URL_HEADER) ??
    env.DEFAULT_LLM_URL ??
    null;
  if (!targetUrl) {
    return jsonCors(
      err('no upstream LLM url (set DEFAULT_LLM_URL or pass X-LLM-Url)', 'NO_UPSTREAM'),
      500,
    );
  }
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return jsonCors(err('invalid upstream url', 'BAD_UPSTREAM'), 500);
  }

  // ─── 2. 读取并(可选)解混淆 body ────────────────────────────────
  let rawBody = await request.text();
  const isCrypto = request.headers.get(HEADERS.cryptoData) === 'true';
  if (isCrypto) {
    try {
      rawBody = decodeBase64(rawBody);
    } catch {
      return jsonCors(err('invalid base64 request body', 'BAD_REQUEST'), 400);
    }
  }

  // ─── 3. 构造转发请求 ────────────────────────────────────────────
  // 仅透传必要头,丢弃浏览器默认头(避免污染上游)。
  const auth = request.headers.get('Authorization');
  const upstreamHeaders: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    Accept: 'text/event-stream, application/json',
  };
  if (auth) upstreamHeaders['Authorization'] = auth;

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(target.toString(), {
      method: 'POST',
      headers: upstreamHeaders,
      body: rawBody,
    });
  } catch (e) {
    return jsonCors(
      err(`upstream fetch failed: ${(e as Error).message}`, 'UPSTREAM_ERROR'),
      502,
    );
  }

  // ─── 4. 上游错误:转 JSON 错误信封 ────────────────────────────────
  if (!upstreamRes.ok) {
    const errText = await upstreamRes.text().catch(() => '');
    return jsonCors(
      err(
        `upstream ${upstreamRes.status}: ${errText.slice(0, 500) || upstreamRes.statusText}`,
        'UPSTREAM_HTTP_ERROR',
      ),
      upstreamRes.status,
    );
  }

  // ─── 5. ✅ 流式透传:response.body 原样回写 ────────────────────────
  // 关键:不 await text()/json(),直接把 ReadableStream 交给新 Response。
  // 这样 Worker 在 chunk 到达时即转发,首字延迟最低。
  const isStream =
    (upstreamRes.headers.get('Content-Type') ?? '').includes('text/event-stream') ||
    rawBody.includes('"stream":true');

  const passHeaders = new Headers();
  if (isStream) {
    for (const [k, v] of Object.entries(SSE_HEADERS)) passHeaders.set(k, v);
  } else {
    passHeaders.set('Content-Type', upstreamRes.headers.get('Content-Type') ?? 'application/json; charset=utf-8');
  }
  for (const [k, v] of Object.entries(CORS_HEADERS)) passHeaders.set(k, v);

  // body 可能为 null(空响应),兜底为空流。
  const passBody = upstreamRes.body ?? new ReadableStream({
    start(controller) {
      controller.close();
    },
  });

  return new Response(passBody, {
    status: upstreamRes.status,
    headers: passHeaders,
  });
}
