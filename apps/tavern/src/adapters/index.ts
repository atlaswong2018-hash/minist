/**
 * 适配器工厂 — 按 config.backend 返回对应 BackendAdapter 实例。
 *
 * 上层组件/composable 通过 getAdapter(config) 拿到适配器,
 * 不关心是 local / cloudflare / tencent / direct。
 */
import type { TavernConfig } from '@minist/shared';
import type { BackendAdapter } from './types';
import { LocalAdapter } from './local';
import { CloudflareAdapter } from './cloudflare';
import { TencentAdapter } from './tencent';

export { LocalAdapter, CloudflareAdapter, TencentAdapter };
export type { BackendAdapter, ChatStreamHandle, ChatOptions } from './types';

/** 按 backend 模式构造适配器。local / direct 都走 LocalAdapter(直连 LLM)。 */
export function getAdapter(config: TavernConfig): BackendAdapter {
  switch (config.backend) {
    case 'cloudflare':
      return new CloudflareAdapter({ config });
    case 'tencent':
      return new TencentAdapter({ config });
    case 'direct':
    case 'local':
    default:
      return new LocalAdapter({ config });
  }
}
