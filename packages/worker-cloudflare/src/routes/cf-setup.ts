/**
 * worker-cloudflare/src/routes/cf-setup.ts — CF 方案一:自动创建 KV/D1/R2
 *
 * 路由:POST /api/cf-setup
 *   body: { namespace?: string, d1Name?: string, r2Bucket?: string }
 *
 * 用 env.CF_API_TOKEN 调 Cloudflare REST API 为用户一键创建:
 *   ① KV namespace
 *   ② D1 database
 *   ③ R2 bucket
 * 并返回各自的 id / database_id / bucket_name,供用户填回 wrangler.toml。
 *
 * ⚠️ 需真实凭证:
 *   - CF_API_TOKEN:需具备 Workers / KV / D1 / R2 编辑权限
 *     (控制台 → My Profile → API Tokens → Edit Cloudflare Workers + D1 Edit + R2 Edit)。
 *   - CF_ACCOUNT_ID:用户账号 ID(控制台右侧栏可见)。
 *
 * 注意:本路由是"骨架实现 + 清晰注释",真实 API 端点与字段需对照
 *   https://developers.cloudflare.com/api 最新文档校验。
 *   幂等性:KV/R2 同名创建会冲突,本实现先 LIST 查重再 POST。
 */
import { ok, err } from '@minist/shared';
import type { Env } from '../env';
import { jsonCors } from '../cors';

/** cf-setup 请求体。 */
interface CfSetupRequest {
  namespace?: string;
  d1Name?: string;
  r2Bucket?: string;
}

/** cf-setup 结果。 */
interface CfSetupResult {
  kv?: { id: string; title: string };
  d1?: { uuid: string; name: string };
  r2?: { name: string };
  steps: string[];
  warnings: string[];
}

/** 主处理。 */
export async function handleCfSetup(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonCors(err(`method not allowed: ${request.method}`, 'METHOD_NOT_ALLOWED'), 405);
  }

  // ─── 0. 校验环境凭证 ────────────────────────────────────────────
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    return jsonCors(
      err(
        'CF_API_TOKEN / CF_ACCOUNT_ID 未配置(方案一需 CF API Token + Account ID)',
        'MISSING_CF_CREDENTIALS',
      ),
      500,
    );
  }

  let body: CfSetupRequest;
  try {
    body = (await request.json()) as CfSetupRequest;
  } catch {
    return jsonCors(err('invalid JSON body', 'BAD_REQUEST'), 400);
  }

  const account = env.CF_ACCOUNT_ID;
  const authHeader = { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' };
  const result: CfSetupResult = { steps: [], warnings: [] };

  // ─── ① 创建 KV namespace(先查重) ────────────────────────────────
  // TODO(需真实 Token 验证):端点对照 https://developers.cloudflare.com/api/resources/kv/
  if (body.namespace) {
    try {
      const existing = await cfApi<{ result: { id: string; title: string }[] }>(
        `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces`,
        'GET',
        authHeader,
      );
      const hit = existing.result?.find((n) => n.title === body.namespace);
      if (hit) {
        result.kv = { id: hit.id, title: hit.title };
        result.steps.push(`KV 复用已有 namespace: ${body.namespace} (${hit.id})`);
      } else {
        const created = await cfApi<{ result: { id: string; title: string } }>(
          `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces`,
          'POST',
          authHeader,
          { title: body.namespace },
        );
        result.kv = { id: created.result.id, title: created.result.title };
        result.steps.push(`KV 已创建: ${body.namespace} → id=${created.result.id}`);
      }
    } catch (e) {
      result.warnings.push(`KV 创建失败: ${(e as Error).message}(需真实 CF API Token 验证)`);
    }
  }

  // ─── ② 创建 D1 database ──────────────────────────────────────────
  // TODO(需真实 Token 验证):端点对照 https://developers.cloudflare.com/d1/
  if (body.d1Name) {
    try {
      const created = await cfApi<{ result: { uuid: string; name: string } }>(
        `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database`,
        'POST',
        authHeader,
        { name: body.d1Name },
      );
      result.d1 = { uuid: created.result.uuid, name: created.result.name };
      result.steps.push(`D1 已创建: ${body.d1Name} → database_id=${created.result.uuid}`);
    } catch (e) {
      result.warnings.push(`D1 创建失败: ${(e as Error).message}(需真实 CF API Token 验证)`);
    }
  }

  // ─── ③ 创建 R2 bucket ────────────────────────────────────────────
  // TODO(需真实 Token 验证):端点对照 https://developers.cloudflare.com/r2/
  if (body.r2Bucket) {
    try {
      await cfApi(
        `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`,
        'POST',
        authHeader,
        { name: body.r2Bucket, locationHint: 'apac' },
      );
      result.r2 = { name: body.r2Bucket };
      result.steps.push(`R2 已创建: ${body.r2Bucket}`);
    } catch (e) {
      result.warnings.push(`R2 创建失败: ${(e as Error).message}(需真实 CF API Token 验证)`);
    }
  }

  // ─── 下一步指引 ──────────────────────────────────────────────────
  result.steps.push(
    '把上述 id/database_id/bucket 填回 wrangler.toml 的 [[kv_namespaces]]/[[d1_databases]]/[[r2_buckets]] 块',
  );
  result.steps.push('运行 npx wrangler deploy 重新部署 Worker');

  return jsonCors(ok(result), 200);
}

/** Cloudflare REST API 调用封装:检查 success 字段,失败抛错。 */
async function cfApi<T>(
  url: string,
  method: string,
  authHeader: Record<string, string>,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: authHeader,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as T & { success?: boolean; errors?: { message?: string }[] };
  if (!res.ok || json.success === false) {
    const msg = json.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}
