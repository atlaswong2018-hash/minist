/**
 * Cloudflare Worker 适配器。
 *
 * 路由约定(与 @minist/shared ROUTES 一致):
 *  - 流式补全:POST {base}/v1/chat/completions(Authorization 透传,SSE)
 *  - 卡存储:  POST {base}/api/storage  (body { key, value })
 *  - 同步:    POST {base}/api/sync     (上传) / GET {base}/api/sync/:userId(拉取)
 *
 * crypto 协议:config.crypto=true 时请求体 encodeBase64 + X-Crypto-Data: true,
 * Content-Type 改 text/plain(伪装非 JSON),免备案防明文审查。
 */
import {
  ROUTES,
  HEADERS,
  encodeBase64,
  type ApiEnvelope,
  type ChatMessage,
  type SyncPayload,
  type TavernConfig,
} from '@minist/shared';
import type { CharacterCard } from '@minist/core';
import type { BackendAdapter, AdapterArgs, ChatOptions, ChatStreamHandle, AssetUploadOpts } from './types';
import type { AssetRef } from '@minist/shared';
import { fetchStream } from './stream';
import { buildChatPayload } from './payload';

function joinUrl(base: string, path: string): string {
  return base.replace(/\/$/, '') + path;
}

/** 解信封:success=true 取 data,否则抛错。 */
function unwrapOrThrow<T>(env: ApiEnvelope<T>): T {
  if (env.success) return (env.data ?? null) as T;
  throw new Error(env.error || '后端返回未知错误');
}

export class CloudflareAdapter implements BackendAdapter {
  readonly name: string = 'Cloudflare Worker';
  readonly backend: TavernConfig['backend'] = 'cloudflare';
  readonly hasObjectStorage = true;
  protected cfg: TavernConfig;

  constructor(args: AdapterArgs) {
    this.cfg = args.config;
  }

  protected get base(): string {
    return this.cfg.apiBaseUrl.replace(/\/$/, '');
  }

  /** 通用请求头(含 Authorization + userId)。 */
  protected headers(crypto: boolean): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      [HEADERS.userId]: this.cfg.userId,
      // crypto 模式伪装为纯文本(避免网关识别 JSON)
      'Content-Type': crypto ? 'text/plain;charset=UTF-8' : 'application/json',
    };
    return h;
  }

  /** 按 crypto 协议包装请求体。 */
  protected wrapBody(rawObj: unknown): { body: string; extra: Record<string, string> } {
    const json = JSON.stringify(rawObj);
    if (this.cfg.crypto) {
      return {
        body: encodeBase64(json),
        extra: { [HEADERS.cryptoData]: 'true' },
      };
    }
    return { body: json, extra: {} };
  }

  async health(): Promise<boolean> {
    try {
      const resp = await fetch(joinUrl(this.base, ROUTES.health), { method: 'GET' });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatStreamHandle> {
    const url = joinUrl(this.base, ROUTES.completions);
    const stream = opts.stream !== false;
    const { body, extra } = this.wrapBody(buildChatPayload(this.cfg, messages, opts));
    return fetchStream({
      url,
      headers: { ...this.headers(this.cfg.crypto), ...extra },
      body,
      stream,
    });
  }

  async saveCard(card: CharacterCard): Promise<void> {
    // Worker 契约:POST /api/storage/:key,body 为原始 value(可选 Base64 混淆)。
    const cardObj = card as { data?: { name?: string }; name?: string };
    const name = cardObj.data?.name ?? cardObj.name ?? 'card';
    const url = joinUrl(this.base, ROUTES.storage) + '/card:' + encodeURIComponent(name);
    const { body, extra } = this.wrapBody(card);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(this.cfg.crypto), ...extra },
      body,
    });
    if (!resp.ok) throw new Error(`保存人物卡失败 ${resp.status}`);
  }

  /**
   * 上传二进制资源到 R2(内容寻址 key=cards/<sha256>.<ext>)。
   * 直接 PUT Worker /api/r2/:key(Worker 侧写 R2,无 egress 费)。
   */
  async uploadAsset(bytes: Uint8Array, opts: AssetUploadOpts): Promise<AssetRef> {
    const key = `cards/${opts.sha256}.${opts.ext}`;
    const uri = joinUrl(this.base, ROUTES.r2) + '/' + key;
    const resp = await fetch(uri, {
      method: 'PUT',
      headers: {
        ...this.headers(false),
        'Content-Type': opts.contentType ?? 'application/octet-stream',
      },
      body: bytes,
    });
    if (!resp.ok) throw new Error(`资源上传失败 ${resp.status}`);
    return { uri, sha256: opts.sha256, size: bytes.byteLength, ext: opts.ext };
  }

  /** 下载二进制资源(GET Worker /api/r2/:key → Blob)。 */
  async downloadAsset(ref: AssetRef): Promise<Blob> {
    const resp = await fetch(ref.uri, { headers: this.headers(false) });
    if (!resp.ok) throw new Error(`资源下载失败 ${resp.status}`);
    return resp.blob();
  }

  // ── Phase S3:角色卡 per-card 粒度同步(TencentAdapter 继承本实现,SCF 同路径)──

  private cardListUrl(): string {
    return (
      joinUrl(this.base, ROUTES.sync) +
      '/cards/' +
      encodeURIComponent(this.cfg.userId)
    );
  }
  private cardUrl(id: string): string {
    return (
      joinUrl(this.base, ROUTES.sync) +
      '/card/' +
      encodeURIComponent(this.cfg.userId) +
      '/' +
      encodeURIComponent(id)
    );
  }

  async listCards(): Promise<string[]> {
    const resp = await fetch(this.cardListUrl(), { headers: this.headers(false) });
    if (!resp.ok) throw new Error(`列卡失败 ${resp.status}`);
    const env = (await resp.json().catch(() => ({ success: false, error: 'parse' }))) as ApiEnvelope<{
      ids: string[];
    }>;
    return unwrapOrThrow(env).ids ?? [];
  }

  async getCard(id: string): Promise<string | null> {
    const resp = await fetch(this.cardUrl(id), { headers: this.headers(false) });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`取卡失败 ${resp.status}`);
    const env = (await resp.json().catch(() => ({ success: false, error: 'parse' }))) as ApiEnvelope<{
      data: string;
    }>;
    return unwrapOrThrow(env).data ?? null;
  }

  async putCard(id: string, json: string): Promise<void> {
    const resp = await fetch(this.cardUrl(id), {
      method: 'PUT',
      headers: { ...this.headers(false), 'Content-Type': 'application/json' },
      body: json,
    });
    if (!resp.ok) throw new Error(`写卡失败 ${resp.status}`);
  }

  async deleteCard(id: string): Promise<void> {
    const resp = await fetch(this.cardUrl(id), {
      method: 'DELETE',
      headers: this.headers(false),
    });
    // 404 视为已删除,成功
    if (!resp.ok && resp.status !== 404) throw new Error(`删卡失败 ${resp.status}`);
  }

  async sync(payload: SyncPayload): Promise<void> {
    const url = joinUrl(this.base, ROUTES.sync);
    const { body, extra } = this.wrapBody(payload);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(this.cfg.crypto), ...extra },
      body,
    });
    if (!resp.ok) throw new Error(`同步上传失败 ${resp.status}`);
  }

  async pull(): Promise<SyncPayload | null> {
    const url = joinUrl(this.base, ROUTES.sync) + '/' + encodeURIComponent(this.cfg.userId);
    const resp = await fetch(url, { headers: this.headers(false) });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`同步拉取失败 ${resp.status}`);
    const env = (await resp.json().catch(() => ({ success: false, error: 'parse' }))) as ApiEnvelope<
      SyncPayload
    >;
    return unwrapOrThrow(env) as SyncPayload | null;
  }
}
