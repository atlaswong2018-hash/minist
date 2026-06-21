/**
 * worker-cloudflare/src/env.ts — Worker 环境绑定与 Secrets 类型
 *
 * 这些绑定名必须与 wrangler.toml 中的 binding 字段一一对应。
 * KV/D1/R2 在 wrangler.toml 注释中给出创建步骤;Secrets 用
 * `npx wrangler secret put <NAME>` 写入,均为 string(未设置时为 undefined)。
 */

/**
 * Worker 运行时环境。
 * 通过 `export default { fetch(req, env: Env, ctx) }` 第二参数注入。
 */
export interface Env {
  // ─── 绑定资源 ───────────────────────────────────────────────────
  /** KV:角色卡/世界书/预设索引等读多写少数据(写入仅 1000/天)。 */
  SillyKV: KVNamespace;
  /** D1:聊天历史等频繁追加数据(10 万写/天)。 */
  SillyDB: D1Database;
  /** R2:人物卡 PNG 图片(无出流量费)。 */
  SillyR2: R2Bucket;

  // ─── Secrets(均为可选,未配置时对应功能返回清晰错误) ───────────
  /** 默认 LLM 上游地址(completions 中转)。 */
  DEFAULT_LLM_URL?: string;
  /** 腾讯云 CAM SecretId(方案一)。 */
  TENCENT_SECRET_ID?: string;
  /** 腾讯云 CAM SecretKey(方案一)。 */
  TENCENT_SECRET_KEY?: string;
  /** 腾讯云主账号 UIN。 */
  TENCENT_ROOT_UIN?: string;
  /** 腾讯云默认地域。 */
  TENCENT_REGION?: string;
  /**
   * 腾讯云 API 基地址覆写(仅用于联调/自测,把 Worker 对腾讯 API 的请求
   * 指向本地 mock,如 `http://localhost:9999`)。生产留空。
   */
  TENCENT_API_BASE?: string;
  /** COS API 基地址覆写(联调用,指向本地 mock)。生产留空,走真实 cos.<region>.myqcloud.com。 */
  COS_API_BASE?: string;
  /** Cloudflare API Token(方案一:自动创建 KV/D1/R2)。 */
  CF_API_TOKEN?: string;
  /** Cloudflare Account ID。 */
  CF_ACCOUNT_ID?: string;
  /** 运营方批量管理鉴权 token(跨账号 batch-scf 路由)。 */
  OPERATOR_TOKEN?: string;
}
