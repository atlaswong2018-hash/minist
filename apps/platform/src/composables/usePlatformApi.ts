/**
 * usePlatformApi — 封装对 minist 各后端路由的 fetch。
 *
 * 处理:CORS(浏览器原生,后端已开 CORS_HEADERS)、统一错误信封、超时、
 * 各部署目标的基地址路由(CF Worker / 腾讯 SCF / 平台中转 CF Worker)。
 *
 * 平台本身是纯静态站,后端地址由用户在 UI 里填写(存 localStorage)。
 */
import { reactive, ref } from 'vue';
import {
  ROUTES,
  HEADERS,
  type ApiEnvelope,
  type SyncPayload,
  type DeployTarget,
} from '@minist/shared';

/** 平台用户配置(持久化在 localStorage)。 */
export interface PlatformConfig {
  /** CF Worker URL(部署 minist API 的 Worker),如 https://minist-api.workers.dev。 */
  cfWorkerUrl: string;
  /** 腾讯云 SCF 函数 URL(默认三级域名或自定义),如 https://xxx.service.tencentcloudapi.com。 */
  tencentScfUrl: string;
  /** 平台中转 CF Worker URL(用于 CAM 方案一:code→STS→配置)。 */
  relayWorkerUrl: string;
  /** 方案二 ADMIN_TOKEN(用户在 SCF 环境变量里自填)。 */
  adminToken: string;
  /** 运营方 Operator Token(批量管理用,运营方在中转 Worker 配 OPERATOR_TOKEN env)。 */
  operatorToken: string;
  /**
   * 运营方腾讯云主账号 ID(UIN)。
   * 客户创建跨账号角色时,需在「载体」里填此 UIN 才能允许运营方扮演角色。
   * 用于生成给客户看的 CAM 授权指引。
   */
  operatorUin: string;
  /** 同步分区 userId。 */
  userId: string;
}

const STORAGE_KEY = 'minist-platform-config';

/** 默认空配置(首次访问)。 */
const DEFAULT_CONFIG: PlatformConfig = {
  cfWorkerUrl: '',
  tencentScfUrl: '',
  relayWorkerUrl: '',
  adminToken: '',
  operatorToken: '',
  operatorUin: '',
  userId: '',
};

/** 加载持久化配置。 */
export function loadConfig(): PlatformConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<PlatformConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** 保存配置到 localStorage。 */
export function saveConfig(cfg: PlatformConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

/** 统一的错误类型。 */
export class ApiError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** 规范化 URL(去尾斜杠)。 */
function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * 核心 fetch 封装:带超时、CORS、信封解析。
 * @param baseUrl 后端基地址(Worker / SCF URL)
 * @param path 路由(来自 ROUTES 常量)
 * @param init fetch init
 */
export async function platformFetch<T = unknown>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = 30000,
): Promise<T> {
  if (!baseUrl) {
    throw new ApiError('请先在"配置"页填写后端地址', 'NO_BASE_URL');
  }
  const url = normalizeUrl(baseUrl) + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      ...init,
      signal: controller.signal,
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await resp.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // 非 JSON 响应(如纯文本/HTML),包装为错误
      throw new ApiError(
        `后端返回非 JSON(${resp.status}): ${text.slice(0, 200)}`,
        'NON_JSON',
        resp.status,
      );
    }
    const env = body as ApiEnvelope<T>;
    if (env && typeof env === 'object' && 'success' in env) {
      if (env.success) return (env as { data?: T }).data as T;
      throw new ApiError((env as { error: string }).error, (env as { code?: string }).code, resp.status);
    }
    // 部分端点(如 set-timeout 自锁)可能直接返回扁平对象,按成功处理
    return body as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError('请求超时(可能后端未部署或地址错误)', 'TIMEOUT');
    }
    // 网络/CORS 错误
    throw new ApiError(
      `网络错误: ${(e as Error).message}(常见:地址错/CORS/后端未部署)`,
      'NETWORK',
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 平台 API 操作集合(响应式 loading/error)。 */
export function usePlatformApi() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    loading.value = true;
    error.value = null;
    try {
      const result = await fn();
      return result;
    } catch (e) {
      error.value = e instanceof ApiError ? e.message : (e as Error).message;
      return null;
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, run };
}

// ===== 各业务路由的高层封装 =====

/** 健康检查(探测后端是否在线)。 */
export function healthCheck(baseUrl: string): Promise<unknown> {
  return platformFetch(baseUrl, ROUTES.health, { method: 'GET' }, 10000);
}

/** 推送同步负载(角色卡/世界书/聊天 → 云端)。 */
export function pushSync(
  baseUrl: string,
  payload: SyncPayload,
  userId: string,
): Promise<unknown> {
  return platformFetch(baseUrl, ROUTES.sync, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { [HEADERS.userId]: userId },
  });
}

/** 从云端拉取同步负载(按 userId)。 */
export function pullSync(baseUrl: string, userId: string): Promise<SyncPayload> {
  return platformFetch<SyncPayload>(
    baseUrl,
    `${ROUTES.sync}/${encodeURIComponent(userId)}`,
    { method: 'GET', headers: { [HEADERS.userId]: userId } },
  );
}

/**
 * 方案二 Token 自改超时配置(腾讯云)。
 * 调 {scfUrl}/api/admin/set-timeout,X-Admin-Token 头。
 */
export function adminSetTimeout(
  scfUrl: string,
  adminToken: string,
  opts: { timeout?: number; memory?: number; concurrency?: number } = {},
): Promise<unknown> {
  return platformFetch(
    scfUrl,
    ROUTES.adminTimeout,
    {
      method: 'POST',
      body: JSON.stringify({
        // 字段名对齐 SCF admin.js 读取的字段(memorySize / instanceConcurrency),
        // 否则内存与并发配置会静默失效。
        timeout: opts.timeout ?? 60,
        memorySize: opts.memory ?? 128,
        instanceConcurrency: opts.concurrency ?? 1,
      }),
      headers: { [HEADERS.adminToken]: adminToken },
    },
    15000,
  );
}

/**
 * CF 一键配置:用户授权 CF API Token → 平台中转 Worker 调 CF REST API
 * 建 KV/D1/R2 + 部署 Worker。
 */
export function cfOneClickSetup(
  relayUrl: string,
  cfApiToken: string,
): Promise<unknown> {
  return platformFetch(
    relayUrl,
    ROUTES.cfSetup,
    {
      method: 'POST',
      body: JSON.stringify({ cfApiToken }),
    },
    120000,
  );
}

/**
 * 方案一 CAM 中转:把授权 code 提交到平台中转 Worker → 换 STS → 建桶 → 配 SCF。
 */
export function submitGrantCode(
  relayUrl: string,
  code: string,
  target: DeployTarget,
): Promise<unknown> {
  return platformFetch(
    relayUrl,
    ROUTES.grantConfig,
    {
      method: 'POST',
      body: JSON.stringify({ code, target }),
      headers: { [HEADERS.grantCode]: code },
    },
    120000,
  );
}

/** 轻量状态:全局共享的当前配置(单例 reactive)。 */
export const platformConfig = reactive<PlatformConfig>(loadConfig());

/** 持久化当前配置。 */
export function persistConfig(): void {
  saveConfig({ ...platformConfig });
}

/**
 * 运营方跨账号批量管理腾讯云函数。
 * 调 {relayUrl}/api/admin/batch-scf,带 X-Operator-Token 头。
 * 后端在中转 Worker 上配 OPERATOR_TOKEN env,通过 STS:AssumeRole 跨账号扮演角色。
 * 超时给到 120s(批量操作 + 跨账号 AssumeRole 较慢)。
 */
export function batchManageScf(
  relayUrl: string,
  operatorToken: string,
  payload: {
    accounts: { uin: string; roleName: string; owner?: string }[];
    operation: 'list' | 'set-config';
    region?: string;
    functionName?: string;
    timeout?: number;
    memorySize?: number;
    limit?: number;
  },
): Promise<unknown> {
  return platformFetch(
    relayUrl,
    ROUTES.batchScf,
    {
      method: 'POST',
      headers: { [HEADERS.operatorToken]: operatorToken },
      body: JSON.stringify(payload),
    },
    120000,
  );
}
