/**
 * @minist/shared — 路由常量与请求头协议
 *
 * CF Worker 与腾讯云 SCF 的路由必须与这些常量完全一致。
 * 腾讯云 SCF 包独立部署(打包上传),会复制一份等价常量,二者须保持同步。
 */

/** HTTP 路由。 */
export const ROUTES = {
  /** 健康检查。 */
  health: '/api/health',
  /** KV/COS 通用键值存储:/api/storage/:key (GET 读 / POST 写)。角色卡索引等读多写少数据。 */
  storage: '/api/storage',
  /** D1/文档库聊天与世界书:/api/chat/:userId。 */
  chat: '/api/chat',
  /** R2/COS 对象(人物卡 PNG):/api/r2/:key。 */
  r2: '/api/r2',
  /** 全量同步:/api/sync (POST 上传) / /api/sync/:userId (GET 拉取)。 */
  sync: '/api/sync',
  /** 腾讯云方案二:Token 自改超时配置。 */
  adminTimeout: '/api/admin/set-timeout',
  /** 运营方批量管理多个外部腾讯云账号的云函数(STS AssumeRole 跨账号)。 */
  batchScf: '/api/admin/batch-scf',
  /** 腾讯云方案一:CAM 跨账号授权中转(code→STS→自动配置)。 */
  grantConfig: '/api/grant-config',
  /** CF 方案一:CF API 自动配置 Worker/KV/D1/R2 绑定。 */
  cfSetup: '/api/cf-setup',
  /** OpenAI 兼容流式补全中转(打字机效果)。 */
  completions: '/v1/chat/completions',
} as const;

/** 自定义请求头协议。 */
export const HEADERS = {
  /** 值为 "true" 时,请求/响应体为 Base64 混淆后的密文。 */
  cryptoData: 'X-Crypto-Data',
  /** 方案二管理员 Token。 */
  adminToken: 'X-Admin-Token',
  /** 同步分区用户标识。 */
  userId: 'X-User-Id',
  /** CAM 回调授权码(方案一)。 */
  grantCode: 'X-Grant-Code',
  /** 运营方批量管理鉴权 token(跨账号批量操作)。 */
  operatorToken: 'X-Operator-Token',
} as const;

/** CORS:允许任意源(手机/微信浏览器跨域)。 */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': [
    'Content-Type',
    'Authorization',
    HEADERS.cryptoData,
    HEADERS.adminToken,
    HEADERS.userId,
    HEADERS.grantCode,
    HEADERS.operatorToken,
  ].join(', '),
  'Access-Control-Max-Age': '86400',
};

/** SSE 流式响应头。 */
export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

/** 负载结构版本号。 */
export const SYNC_VERSION = 1;
