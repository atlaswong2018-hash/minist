/**
 * @minist/scf-tencent — 大模型流式中转(最关键路由)
 *
 *   POST /v1/chat/completions  →  透传上游 OpenAI 兼容接口,SSE 流式回写。
 *
 * ⚠️ 计费警告:流式输出 = SCF「响应流量」,Web 函数的响应流量单独计费,
 *    不包含在免费额度/资源包内。长对话会持续扣费。详见 README 避坑清单。
 *
 * 防扣费核心:axios 以 responseType:'stream' 取流,response.data.pipe(res),
 *   并在 'end' 事件主动 res.end() 释放云函数实例,防空转累积运行时间费用。
 */

'use strict';

const express = require('express');
const axios = require('axios');
const { ROUTES, SSE_HEADERS } = require('../constants');
const { decodeB64, isCryptoEnabled } = require('../crypto');

const router = express.Router();

/** 默认上游(DeepSeek),可被请求体/头覆盖。 */
const DEFAULT_UPSTREAM = process.env.LLM_PROXY_URL || 'https://api.deepseek.com';

/** 统一错误信封。 */
function fail(res, status, error) {
  res.status(status).json({ success: false, error });
}

/** SSE 错误事件(流已经开始后,只能用 event 通知前端)。 */
function sendSseError(res, message) {
  try {
    res.write('event: error\ndata: ' + JSON.stringify({ error: message }) + '\n\n');
    res.end();
  } catch (_) {
    // 连接已断,忽略。
  }
}

/**
 * 解析上游地址与路径。
 * 优先级:body.apiBaseUrl > X-Api-Base-Url 头 > LLM_PROXY_URL env > 默认 DeepSeek。
 * 拼接固定路径 /v1/chat/completions。
 */
function resolveUpstream(req) {
  const body = req.body || {};
  let base =
    body.apiBaseUrl ||
    req.get('X-Api-Base-Url') ||
    req.get('X-LLM-Proxy-Url') ||
    DEFAULT_UPSTREAM;
  // 去掉末尾斜杠,避免 // 拼接。
  base = String(base || '').replace(/\/+$/, '');
  if (!base) base = DEFAULT_UPSTREAM;
  return base + ROUTES.completions; // /v1/chat/completions
}

/**
 * POST /v1/chat/completions
 * Authorization 头透传上游(API Key 仅存前端,服务端不落盘不记录)。
 * 若 X-Crypto-Data:true,body 为 Base64 字符串,解出真实 OpenAI 请求体。
 */
router.post(ROUTES.completions, async (req, res) => {
  // 1. 解析请求体
  let data = req.body;
  try {
    if (isCryptoEnabled(req.headers)) {
      const raw = typeof data === 'string' ? data : String(data || '');
      data = JSON.parse(decodeB64(raw));
    }
  } catch (e) {
    return fail(res, 400, '请求体解析失败(Base64 或 JSON 无效)');
  }

  if (!data || typeof data !== 'object') {
    return fail(res, 400, '请求体无效');
  }

  // 强制流式(本路由的职责就是流式中转)。
  data.stream = true;

  // 2. 透传 Authorization
  const authorization = req.get('Authorization') || req.get('authorization');
  const upstreamHeaders = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (authorization) upstreamHeaders['Authorization'] = authorization;
  // 某些上游(如 OpenRouter / 火山)用独立 key 头。
  const altKey = req.get('X-Api-Key');
  if (altKey) upstreamHeaders['X-Api-Key'] = altKey;

  const url = resolveUpstream(req);

  // 3. 先写 SSE 响应头,客户端立即进入事件流模式。
  for (const [k, v] of Object.entries(SSE_HEADERS)) {
    res.setHeader(k, v);
  }
  // 腾讯云 API 网关需要显式声明不压缩、不缓冲。
  res.setHeader('Content-Encoding', 'identity');
  res.flushHeaders?.();

  // 4. 发起上游请求
  let upstreamRes;
  try {
    upstreamRes = await axios({
      method: 'post',
      url,
      data,
      headers: upstreamHeaders,
      responseType: 'stream',
      // 上游可能慢;SCF 自身超时由函数配置控制(60s)。
      timeout: 0,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: () => true, // 错误状态也读流,自行处理
    });
  } catch (e) {
    return sendSseError(res, '上游连接失败: ' + (e && e.message ? e.message : String(e)));
  }

  // 上游非 2xx:把错误体收敛成一条 SSE error 后结束。
  if (upstreamRes.status < 200 || upstreamRes.status >= 300) {
    let errText = '';
    try {
      for await (const chunk of upstreamRes.data) errText += chunk.toString('utf8');
    } catch (_) {}
    return sendSseError(res, '上游返回 ' + upstreamRes.status + ': ' + errText.slice(0, 500));
  }

  // 5. pipe 流式回写,并在结束/错误时主动释放。
  upstreamRes.data.on('error', (err) => {
    sendSseError(res, '流中断: ' + (err && err.message ? err.message : String(err)));
  });

  upstreamRes.data.on('end', () => {
    // ⚠️ 主动结束:释放云函数实例,防止「已无数据但仍计费」的空转。
    try {
      res.end();
    } catch (_) {}
  });

  upstreamRes.data.pipe(res);
});

module.exports = router;
