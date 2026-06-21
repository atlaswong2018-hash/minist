/**
 * 腾讯云 SCF 适配器。
 *
 * 路由约定与 Cloudflare 相同(SCF 包复制了等价常量),仅 base 指向 SCF 触发器 URL。
 * 额外能力:人物卡 PNG 上传走 R2/COS 预签名 —
 *   先 POST /api/r2/presign 拿到上传 URL,再 PUT 上传二进制。
 *
 * SCF 单次执行默认超时较短(15s~900s 可调),流式依赖 SCF 的 HTTP 响应流式输出能力
 * (express pipe),由 scf-tencent 包负责;前端侧处理与 Cloudflare 一致。
 */
import { ROUTES, type ApiEnvelope } from '@minist/shared';
import type { CharacterCard } from '@minist/core';
import type { BackendAdapter, AdapterArgs } from './types';
import { CloudflareAdapter } from './cloudflare';

interface PresignResult {
  uploadUrl: string;
  key: string;
}

export class TencentAdapter extends CloudflareAdapter implements BackendAdapter {
  override readonly name = '腾讯云 SCF';
  override readonly backend = 'tencent' as const;

  constructor(args: AdapterArgs) {
    super(args);
  }

  override async health(): Promise<boolean> {
    try {
      const resp = await fetch(this.base + ROUTES.health, { method: 'GET' });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * 人物卡 PNG 上传(腾讯云方案):先预签名再 PUT。
   * 仅当 card 带 image(dataURL)时上传;否则走 KV。
   */
  override async saveCard(card: CharacterCard): Promise<void> {
    const img = (card as unknown as { image?: string }).image;
    if (!img || !img.startsWith('data:image/')) {
      // 无图片:走与 CF 一致的 KV 存储
      return super.saveCard(card);
    }
    // 1) 请求预签名
    const presignUrl = this.base + ROUTES.r2 + '/presign';
    const resp = await fetch(presignUrl, {
      method: 'POST',
      headers: { ...this.headers(this.cfg.crypto) },
      body: JSON.stringify({ contentType: 'image/png', key: `cards/${this.cfg.userId}/${Date.now()}.png` }),
    });
    if (!resp.ok) throw new Error(`获取上传预签名失败 ${resp.status}`);
    const env = (await resp.json().catch(() => ({ success: false, error: 'parse' }))) as ApiEnvelope<PresignResult>;
    if (!env.success) throw new Error(env.error || '预签名响应无效');
    const presigned = (env.data ?? null) as PresignResult | null;
    if (!presigned) throw new Error('预签名响应无效');

    // 2) 把 dataURL 转 Blob 并 PUT 上传
    const blob = await (await fetch(img)).blob();
    const putResp = await fetch(presigned.uploadUrl, { method: 'PUT', body: blob });
    if (!putResp.ok) throw new Error(`上传人物卡 PNG 失败 ${putResp.status}`);

    // 3) 把卡元数据(含图片 URL)写 KV
    const meta = { ...card, imageKey: presigned.key };
    const { body, extra } = this.wrapBody({ key: 'characters', value: meta });
    const storeResp = await fetch(this.base + ROUTES.storage, {
      method: 'POST',
      headers: { ...this.headers(this.cfg.crypto), ...extra },
      body,
    });
    if (!storeResp.ok) throw new Error(`保存人物卡元数据失败 ${storeResp.status}`);
  }
}
