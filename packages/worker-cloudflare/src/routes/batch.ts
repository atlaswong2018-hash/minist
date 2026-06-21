/**
 * worker-cloudflare/src/routes/batch.ts — 运营方批量管理外部腾讯云账号的云函数。
 *
 * 路由:POST /api/admin/batch-scf(OPERATOR_TOKEN 鉴权)
 *   body: {
 *     operatorToken?: string,                // 或用 X-Operator-Token 头
 *     accounts: [{ uin, roleName, owner? }], // 客户账号:uin + 在其 CAM 建好的角色名
 *     operation: 'list' | 'set-config',
 *     region?: 'ap-guangzhou',
 *     // operation='set-config':
 *     functionName?: string,                 // 不填则对该账号下全部函数逐个自锁
 *     timeout?: number, memorySize?: number, // 默认 60 / 128(防爆产)
 *     limit?: number                         // list 的 Limit,默认 20
 *   }
 *
 * 流程:对每个账号 → assumeRole(uin, roleName) 换临时凭证 → 按 operation 调 SCF API。
 *   不索要对方 SecretKey —— 仅靠其 CAM 跨账号角色 + STS 临时凭证(可吊销)。
 *
 * 安全:OPERATOR_TOKEN 未配置则禁用(503);token 不符则 403。
 * 子请求预算:Worker 免费版单请求 50 子请求 —— accounts × 调用数须在此内,否则报错提示分批。
 */
import { ok, err, HEADERS } from '@minist/shared';
import type { Env } from '../env';
import { jsonCors } from '../cors';
import { assumeRole, scfListFunctions, scfUpdateConfig } from '../tencent';

interface BatchAccount {
  uin: string;
  roleName: string;
  owner?: string;
}
interface BatchRequest {
  operatorToken?: string;
  accounts: BatchAccount[];
  operation: 'list' | 'set-config';
  region?: string;
  functionName?: string;
  timeout?: number;
  memorySize?: number;
  limit?: number;
}

export async function handleBatchScf(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonCors(err(`method not allowed: ${request.method}`, 'METHOD_NOT_ALLOWED'), 405);
  }

  // ─── 鉴权 ───────────────────────────────────────────
  if (!env.OPERATOR_TOKEN) {
    return jsonCors(err('未配置 OPERATOR_TOKEN,批量管理接口禁用(默认安全)', 'DISABLED'), 503);
  }
  let body: BatchRequest;
  try {
    body = (await request.json()) as BatchRequest;
  } catch {
    return jsonCors(err('invalid JSON body', 'BAD_REQUEST'), 400);
  }
  const provided = body.operatorToken ?? request.headers.get(HEADERS.operatorToken);
  if (!provided || provided !== env.OPERATOR_TOKEN) {
    return jsonCors(err('运营方 token 无效', 'UNAUTHORIZED'), 403);
  }
  if (!Array.isArray(body.accounts) || body.accounts.length === 0) {
    return jsonCors(err('accounts 不能为空', 'BAD_REQUEST'), 400);
  }

  // ─── 子请求预算(Worker 免费版 50/请求)─────────────
  const SUBREQ_BUDGET = 50;
  const perAccount = body.operation === 'list' ? 2 : body.functionName ? 2 : 3; // AssumeRole + (List | Update | List+N×Update)
  const est = body.accounts.length * perAccount;
  if (est > SUBREQ_BUDGET) {
    const maxAccounts = Math.floor(SUBREQ_BUDGET / perAccount);
    return jsonCors(
      err(`预计子请求 ${est} 超过 Worker 单请求上限 ${SUBREQ_BUDGET};请分批(每批 accounts ≤ ${maxAccounts})`, 'TOO_MANY'),
      400,
    );
  }

  const region = body.region || env.TENCENT_REGION || 'ap-guangzhou';
  const apiBase = env.TENCENT_API_BASE;
  const results: Array<Record<string, unknown>> = [];

  for (const acc of body.accounts) {
    const row: Record<string, unknown> = { uin: acc.uin, owner: acc.owner ?? null };
    try {
      const creds = await assumeRole(env, acc.uin, acc.roleName, { region });
      row.assumeRole = true;

      if (body.operation === 'list') {
        const r = await scfListFunctions(creds, apiBase, region, body.limit ?? 20);
        row.ok = r.ok;
        row.data = r.data;
        if (!r.ok) row.error = r.error;
      } else {
        // set-config
        if (body.functionName) {
          const r = await scfUpdateConfig(creds, apiBase, region, body.functionName, {
            timeout: body.timeout ?? 60,
            memorySize: body.memorySize ?? 128,
          });
          row.ok = r.ok;
          row.data = r.data;
          if (!r.ok) row.error = r.error;
        } else {
          // 未指定函数:先 List 再对每个函数自锁(批量防爆产)
          const list = await scfListFunctions(creds, apiBase, region, body.limit ?? 20);
          if (!list.ok) {
            row.ok = false;
            row.error = 'ListFunctions 失败:' + list.error;
          } else {
            const fns =
              (list.data as { Functions?: Array<{ FunctionName: string }> })?.Functions ?? [];
            const perFn: Array<Record<string, unknown>> = [];
            for (const f of fns) {
              const r = await scfUpdateConfig(creds, apiBase, region, f.FunctionName, {
                timeout: body.timeout ?? 60,
                memorySize: body.memorySize ?? 128,
              });
              perFn.push({ function: f.FunctionName, ok: r.ok, error: r.error });
            }
            row.ok = perFn.every((x) => x.ok);
            row.functions = perFn;
          }
        }
      }
    } catch (e) {
      row.ok = false;
      row.error = (e as Error).message;
    }
    results.push(row);
  }

  return jsonCors(ok({ results, operation: body.operation, region, count: results.length }), 200);
}
