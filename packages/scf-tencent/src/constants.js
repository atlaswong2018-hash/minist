/**
 * @minist/scf-tencent — 路由常量与请求头协议(独立复制版)
 *
 * ⚠️ 本文件须与 @minist/shared 保持同步。
 * 腾讯云 SCF 包独立部署(打包成 zip 上传到用户自己的腾讯云账号),运行在云函数里,
 * 不能依赖 monorepo 里的 @minist/shared(CommonJS/ESM 边界 + 自包含约束)。
 * 因此此处复制一份等价常量。任何契约变更必须同时修改两边。
 *
 * 对应源文件:packages/shared/src/routes.ts
 */

'use strict';

/** HTTP 路由(与 shared/routes.ts ROUTES 逐项一致)。 */
const ROUTES = Object.freeze({
  /** 健康检查。 */
  health: '/api/health',
  /** R2/COS 对象(人物卡 PNG)直传预签名。 */
  r2: '/api/r2',
  /** 全量同步:POST /api/sync 上传,GET /api/sync/:userId 拉取。 */
  sync: '/api/sync',
  /** 方案二:Token 自改超时配置。 */
  adminTimeout: '/api/admin/set-timeout',
  /** OpenAI 兼容流式补全中转(打字机效果)。 */
  completions: '/v1/chat/completions',
});

/** 自定义请求头协议(与 shared/HEADERS 一致)。 */
const HEADERS = Object.freeze({
  /** 值为 "true" 时,请求/响应体为 Base64 混淆后的密文。 */
  cryptoData: 'X-Crypto-Data',
  /** 方案二管理员 Token。 */
  adminToken: 'X-Admin-Token',
  /** 同步分区用户标识。 */
  userId: 'X-User-Id',
});

/** CORS:允许任意源(手机/微信浏览器跨域)。 */
const CORS_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Content-Type',
    'Authorization',
    HEADERS.cryptoData,
    HEADERS.adminToken,
    HEADERS.userId,
  ].join(', '),
  'Access-Control-Max-Age': '86400',
});

/** SSE 流式响应头。 */
const SSE_HEADERS = Object.freeze({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // 关闭腾讯云 API 网关缓冲,让 token 真正流式下发。
  'X-Accel-Buffering': 'no',
});

/** 同步负载结构版本号(与 shared SYNC_VERSION 同步)。 */
const SYNC_VERSION = 1;

/** 同步对象在 COS 中的 Key 前缀。 */
const SYNC_KEY_PREFIX = 'minist_users/';

/** 空负载(找不到对象时返回,与前端默认结构对齐)。 */
const EMPTY_SYNC_PAYLOAD = Object.freeze({
  version: SYNC_VERSION,
  exportedAt: 0,
  userId: '',
  characters: [],
  chats: [],
  worldinfo: [],
  presets: [],
});

module.exports = {
  ROUTES,
  HEADERS,
  CORS_HEADERS,
  SSE_HEADERS,
  SYNC_VERSION,
  SYNC_KEY_PREFIX,
  EMPTY_SYNC_PAYLOAD,
};
