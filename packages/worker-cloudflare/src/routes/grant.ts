/**
 * worker-cloudflare/src/routes/grant.ts — 腾讯云 CAM 方案一中转
 *
 * 路由:POST /api/grant-config
 *   body: { code: string, functionName: string, region?: string, rootUin?: string }
 *   或用 X-Grant-Code 头传 code。
 *
 * CAM 方案一流程(用户用主账号 AK/SK 一次性自动配置 SCF):
 *   ① Worker 用主账号密钥 + 用户 code 调腾讯云 STS 换"临时凭证"。
 *      (注:真实 OAuth/OIDC code 流程需用户先在腾讯云授权页拿到 code,
 *       此处 code 的具体语义取决于采用的授权模式 — 见下方 TODO。)
 *   ② 用临时凭证调 SCF UpdateFunctionConfiguration(Timeout=60, MemorySize=128)。
 *   ③ (可选)用临时凭证调 COS CreateBucket 为用户建存储桶。
 *
 * 联调支持:env.TENCENT_API_BASE 可把 Worker 对腾讯云 API 的请求整体指向
 *   本地 mock(如 http://localhost:9999),用于端到端验证 TC3 签名与流程,
 *   生产留空。
 *
 * ⚠️ 需真实凭证验证的步骤(本文件尽力实现,标注 TODO):
 *   - STS 换临时凭证:GetFederationToken(简单)或 AssumeRoleWithWebIdentity(OIDC)。
 *   - UpdateFunctionConfiguration:需临时凭证具备 scf:UpdateFunctionConfiguration 权限。
 *   - CreateBucket:需临时凭证具备 cos:PutBucket 权限 + 合规地域。
 *
 * 安全建议(生产):
 *   1. 主账号 SecretKey 不应长期放 Worker;应预先签发临时凭证缓存到 KV。
 *   2. code 应一次性、带时效,Worker 侧去重防重放。
 */
import { ok, err } from '@minist/shared';
import type { Env } from '../env';
import { jsonCors } from '../cors';
import { signTc3 } from '../tc3';
import { tencentEndpoint } from '../tencent';
import { cosPutBucket } from '../cos-sign';
import { HEADERS } from '@minist/shared';

/** grant 请求体。 */
interface GrantRequest {
  code?: string;
  functionName: string;
  region?: string;
  rootUin?: string;
  /** 是否同时创建 COS 存储桶(默认 false)。 */
  createBucket?: boolean;
  /** 要创建的 COS 存储桶名(全小写、全局唯一)。 */
  bucketName?: string;
}

/** 主处理:CAM 方案一。 */
export async function handleGrantConfig(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonCors(err(`method not allowed: ${request.method}`, 'METHOD_NOT_ALLOWED'), 405);
  }

  // ─── 0. 校验环境凭证 ────────────────────────────────────────────
  if (!env.TENCENT_SECRET_ID || !env.TENCENT_SECRET_KEY) {
    return jsonCors(
      err(
        'TENCENT_SECRET_ID/TENCENT_SECRET_KEY 未配置(方案一需主账号或子账号长期密钥)',
        'MISSING_CAM_CREDENTIALS',
      ),
      500,
    );
  }

  // ─── 1. 解析请求 ────────────────────────────────────────────────
  let body: GrantRequest;
  try {
    body = (await request.json()) as GrantRequest;
  } catch {
    return jsonCors(err('invalid JSON body', 'BAD_REQUEST'), 400);
  }
  // code 优先取 body,其次头。
  const code = body.code ?? request.headers.get(HEADERS.grantCode) ?? null;
  if (!code) {
    return jsonCors(err('missing grant code (body.code 或 X-Grant-Code)', 'BAD_REQUEST'), 400);
  }
  if (!body.functionName) {
    return jsonCors(err('missing functionName', 'BAD_REQUEST'), 400);
  }
  const region = body.region || env.TENCENT_REGION || 'ap-guangzhou';
  const apiBase = env.TENCENT_API_BASE;

  const results: Record<string, unknown> = { code: code.slice(0, 4) + '***', functionName: body.functionName, region };

  // ─── 2. ① STS 换临时凭证(尽力版本) ────────────────────────────────
  // TODO(真实 OAuth):真实场景 code 是腾讯云 OAuth/OIDC 回调码,应调
  //   AssumeRoleWithWebIdentity(STS:2018-08-13)用 code 换 credentials。
  //   此处实现 GetFederationToken 作为"个人部署"的尽力版本:
  //   用主账号密钥签发一个最小权限临时凭证(有效期 1 小时),供后续 SCF/COS 调用复用。
  const stsCreds = await getFederationToken(env, region, code, apiBase).catch((e) => {
    results.stsError = (e as Error).message;
    return null;
  });
  if (!stsCreds) {
    return jsonCors(
      err(
        'STS 换临时凭证失败,详见 results.stsError(需真实腾讯云凭证验证)',
        'STS_FAILED',
      ),
      502,
    );
  }
  results.stsIssued = true;

  // ─── 3. ② 调 SCF UpdateFunctionConfiguration(Timeout/Memory) ────
  // TODO(需真实凭证验证):临时凭证需具备 scf:UpdateFunctionConfiguration 权限。
  const scfRes = await updateScfFunctionConfig(
    stsCreds,
    region,
    body.functionName,
    { timeout: 60, memorySize: 128 },
    apiBase,
  ).catch((e) => ({ ok: false, error: (e as Error).message }));
  results.scfUpdate = scfRes;

  // ─── 4. ③ (可选)COS CreateBucket ────────────────────────────────
  if (body.createBucket && body.bucketName) {
    // TODO(需真实凭证验证):临时凭证需具备 cos:PutBucket 权限;
    //   存储桶名需全小写、全局唯一;地域需合规;
    //   bucket 标准格式为 <name>-<appid>,appid 来自 root 账号(body.rootUin 或 env)。
    const appid = body.rootUin ?? env.TENCENT_ROOT_UIN ?? null;
    if (!appid) {
      results.cosBucket = {
        ok: false,
        error: 'createBucket 需 body.rootUin 或 env.TENCENT_ROOT_UIN(appid)',
      };
    } else {
      const cosRes = await createCosBucket(
        stsCreds,
        region,
        body.bucketName,
        appid,
        env.COS_API_BASE ?? null,
      ).catch((e) => ({ ok: false, error: (e as Error).message }));
      results.cosBucket = cosRes;
    }
  }

  return jsonCors(ok(results), 200);
}

/** 临时凭证结构(腾讯云 STS 返回)。 */
interface TcCredentials {
  TmpSecretId: string;
  TmpSecretKey: string;
  Token: string;
  expiredTime: number;
}

/**
 * ① GetFederationToken(尽力版本)。
 * 用主账号密钥签发一个最小权限临时凭证(个人/演示部署适用)。
 *
 * ⚠️ 生产应用改用 AssumeRoleWithWebIdentity + 用户授权 code,而非本函数。
 *    本函数 name/policy 等参数需对照真实腾讯云 STS API 字段校验(见 TODO)。
 */
async function getFederationToken(
  env: Env,
  region: string,
  _code: string,
  apiBase: string | null | undefined,
): Promise<TcCredentials> {
  const payload = JSON.stringify({
    Name: 'minist-grant',
    DurationSeconds: 3600,
    // 最小权限策略:仅允许改 SCF 配置 + 建 COS 桶(演示)。
    Policy: JSON.stringify({
      version: '2.0',
      statement: [
        {
          effect: 'allow',
          action: ['scf:UpdateFunctionConfiguration', 'scf:GetFunction'],
          resource: ['*'],
        },
        {
          effect: 'allow',
          action: ['cos:PutBucket', 'cos:GetBucket'],
          resource: ['*'],
        },
      ],
    }),
  });

  const ep = tencentEndpoint(apiBase, 'sts');
  const sig = await signTc3({
    secretId: env.TENCENT_SECRET_ID!,
    secretKey: env.TENCENT_SECRET_KEY!,
    service: 'sts',
    region,
    action: 'GetFederationToken',
    version: '2018-08-13',
    payload,
    timestamp: Math.floor(Date.now() / 1000),
    host: ep.host,
  });

  const res = await fetch(ep.url, {
    method: 'POST',
    headers: sig.headers,
    body: payload,
  });
  const json = (await res.json()) as {
    Response?: { Credentials?: TcCredentials; Error?: { Code?: string; Message?: string } };
  };
  const resp = json.Response;
  if (!res.ok || !resp?.Credentials || resp.Error) {
    throw new Error(
      `STS GetFederationToken failed: ${resp?.Error?.Code ?? res.status} ${resp?.Error?.Message ?? ''}`,
    );
  }
  return resp.Credentials;
}

/**
 * ② 用临时凭证调 SCF UpdateFunctionConfiguration。
 * TODO(需真实凭证验证):临时凭证 Token 需作为 X-TC-Token 头传入。
 */
async function updateScfFunctionConfig(
  creds: TcCredentials,
  region: string,
  functionName: string,
  opts: { timeout: number; memorySize: number },
  apiBase: string | null | undefined,
): Promise<{ ok: boolean; requestId?: string; error?: string }> {
  const payload = JSON.stringify({
    FunctionName: functionName,
    Namespace: 'default',
    Timeout: opts.timeout,
    MemorySize: opts.memorySize,
  });

  const ep = tencentEndpoint(apiBase, 'scf');
  const sig = await signTc3({
    secretId: creds.TmpSecretId,
    secretKey: creds.TmpSecretKey,
    service: 'scf',
    region,
    action: 'UpdateFunctionConfiguration',
    version: '2018-04-16',
    payload,
    timestamp: Math.floor(Date.now() / 1000),
    host: ep.host,
    extraHeaders: { 'x-tc-token': creds.Token },
  });

  const res = await fetch(ep.url, {
    method: 'POST',
    headers: sig.headers,
    body: payload,
  });
  const json = (await res.json()) as {
    Response?: { RequestId?: string; Error?: { Code?: string; Message?: string } };
  };
  if (!res.ok || json.Response?.Error) {
    return {
      ok: false,
      error: `SCF update failed: ${json.Response?.Error?.Code ?? res.status} ${json.Response?.Error?.Message ?? ''}`,
    };
  }
  return { ok: true, requestId: json.Response?.RequestId };
}

/**
 * ③ 用临时凭证调 COS PutBucket(创建存储桶)。
 * ✅ 正确姿势:COS 用 XML API + cos v5 签名(HMAC-SHA1),非 TC3(见 ../cos-sign)。
 *    bucket 标准格式 <name>-<appid>;cosApiBase 仅联调用(指向本地 mock),生产留空。
 */
async function createCosBucket(
  creds: TcCredentials,
  region: string,
  bucketName: string,
  appid: string,
  cosApiBase: string | null | undefined,
): Promise<{ ok: boolean; requestId?: string; error?: string }> {
  const r = await cosPutBucket(creds, {
    region,
    bucketFullName: `${bucketName}-${appid}`,
    apiBase: cosApiBase ?? undefined,
  });
  return { ok: r.ok, requestId: r.requestId, error: r.error };
}
