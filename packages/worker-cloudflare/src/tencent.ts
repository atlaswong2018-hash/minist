/**
 * worker-cloudflare/src/tencent.ts — 腾讯云跨账号 API(AssumeRole + SCF)。
 *
 * 用途:运营方批量管理【多个外部腾讯云账号】的云函数。正确姿势(安全合规):
 *   ① 每个外部账号 B 在其 CAM 建一个跨账号角色(策略如 QcloudSCFFullAccess),
 *      允许本平台账号扮演;B 只需把 uin + 角色名给平台(绝不给 SecretKey)。
 *   ② 平台用【自己主账号】的长期密钥调 STS AssumeRole,扮演 B 的角色,换临时凭证(1h)。
 *   ③ 用临时凭证实例化 SCF 操作(ListFunctions / UpdateFunctionConfiguration …)。
 *   ④ B 可随时在 CAM 撤销角色或缩为只读 —— 权限可控、可吊销。
 *
 * 全部 TC3-HMAC-SHA256 签名(Web Crypto,见 ./tc3),可在 Worker 跑。
 * TENCENT_API_BASE 可把请求指向本地 mock(联调用)。
 *
 * 参考:https://cloud.tencent.com/document/product/598/37355 (AssumeRole)
 */
import { signTc3 } from './tc3';
import type { Env } from './env';

/** 解析腾讯云 API 端点(支持 TENCENT_API_BASE 覆写指向本地 mock)。 */
export function tencentEndpoint(
  apiBase: string | null | undefined,
  service: string,
): { url: string; host: string } {
  if (apiBase) {
    const base = apiBase.replace(/\/+$/, '');
    return { url: base, host: base.replace(/^https?:\/\//, '') };
  }
  const host = `${service}.tencentcloudapi.com`;
  return { url: `https://${host}`, host };
}

/** 临时凭证结构(腾讯云 STS 返回)。 */
export interface TcCredentials {
  TmpSecretId: string;
  TmpSecretKey: string;
  Token: string;
  ExpiredTime?: number;
}

/**
 * STS AssumeRole:用平台主账号密钥扮演目标账号的跨账号角色,换临时凭证。
 */
export async function assumeRole(
  env: Env,
  targetUin: string,
  roleName: string,
  opts: { sessionName?: string; duration?: number; region?: string } = {},
): Promise<TcCredentials> {
  if (!env.TENCENT_SECRET_ID || !env.TENCENT_SECRET_KEY) {
    throw new Error('TENCENT_SECRET_ID/KEY 未配置(运营方主账号长期密钥)');
  }
  const region = opts.region || env.TENCENT_REGION || 'ap-guangzhou';
  const roleArn = `qcs::cam::uin/${targetUin}:roleName/${roleName}`;
  const payload = JSON.stringify({
    RoleArn: roleArn,
    RoleSessionName: opts.sessionName || `minist-batch-${targetUin}`,
    DurationSeconds: opts.duration ?? 3600,
  });

  const ep = tencentEndpoint(env.TENCENT_API_BASE, 'sts');
  const sig = await signTc3({
    secretId: env.TENCENT_SECRET_ID,
    secretKey: env.TENCENT_SECRET_KEY,
    service: 'sts',
    region,
    action: 'AssumeRole',
    version: '2018-08-13',
    payload,
    timestamp: Math.floor(Date.now() / 1000),
    host: ep.host,
  });

  const res = await fetch(ep.url, { method: 'POST', headers: sig.headers, body: payload });
  const json = (await res.json()) as {
    Response?: { Credentials?: TcCredentials; Error?: { Code?: string; Message?: string } };
  };
  const resp = json.Response;
  if (!res.ok || !resp?.Credentials || resp.Error) {
    throw new Error(
      `STS AssumeRole failed: ${resp?.Error?.Code ?? res.status} ${resp?.Error?.Message ?? ''}`,
    );
  }
  return resp.Credentials;
}

/** 通用:用临时凭证调腾讯云 API(TC3 签名 + X-TC-Token)。 */
async function callTencentApi(
  creds: TcCredentials,
  apiBase: string | null | undefined,
  service: string,
  region: string,
  action: string,
  version: string,
  payloadObj: unknown,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const payload = JSON.stringify(payloadObj);
  const ep = tencentEndpoint(apiBase, service);
  const sig = await signTc3({
    secretId: creds.TmpSecretId,
    secretKey: creds.TmpSecretKey,
    service,
    region,
    action,
    version,
    payload,
    timestamp: Math.floor(Date.now() / 1000),
    host: ep.host,
    extraHeaders: { 'x-tc-token': creds.Token },
  });

  const res = await fetch(ep.url, { method: 'POST', headers: sig.headers, body: payload });
  const json = (await res.json()) as { Response?: { Error?: { Code?: string; Message?: string } } & Record<string, unknown> };
  if (!res.ok || json.Response?.Error) {
    return {
      ok: false,
      error: `${action} failed: ${json.Response?.Error?.Code ?? res.status} ${json.Response?.Error?.Message ?? ''}`,
    };
  }
  return { ok: true, data: json.Response };
}

/** ListFunctions:列出目标账号某地域的云函数(批量管理用)。 */
export async function scfListFunctions(
  creds: TcCredentials,
  apiBase: string | null | undefined,
  region: string,
  limit = 20,
  offset = 0,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return callTencentApi(creds, apiBase, 'scf', region, 'ListFunctions', '2018-04-16', { Limit: limit, Offset: offset });
}

/** UpdateFunctionConfiguration:批量自锁防爆产配置(超时/内存)。 */
export async function scfUpdateConfig(
  creds: TcCredentials,
  apiBase: string | null | undefined,
  region: string,
  functionName: string,
  opts: { timeout?: number; memorySize?: number; namespace?: string },
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const payload: Record<string, unknown> = {
    FunctionName: functionName,
    Namespace: opts.namespace || 'default',
  };
  if (opts.timeout !== undefined) payload.Timeout = opts.timeout;
  if (opts.memorySize !== undefined) payload.MemorySize = opts.memorySize;
  return callTencentApi(creds, apiBase, 'scf', region, 'UpdateFunctionConfiguration', '2018-04-16', payload);
}
