# minist 集成联调 harness(`integration/`)

在没有真实云账号凭证的前提下,用**高保真本地 mock + 真实 Worker/SCF**把三条部署方案
端到端跑通,暴露并修复真实 bug。最终上线只剩"换真实凭证"这一步。

## 拓扑

| 方案 | 测试脚本 | 真实组件 | mock 对端 | 验证方式 |
|---|---|---|---|---|
| **CF 核心路径** | `run-cf-core.mjs` | CF Worker(wrangler dev 本地 miniflare,KV/D1/R2) | mock LLM(SSE) | KV 往返 / sync 往返 / 流式 / 混淆 |
| **方案二 · Token 自改** | `run-tencent-token.mjs` | 腾讯云 SCF(admin.js) | mock 腾讯云 SCF API(自签 HTTPS,lenient) | 鉴权门 / 参数透传 / 字段名对齐 |
| **方案一 · CAM** | `run-tencent-cam.mjs` | CF Worker(grant-config + signTc3) | mock 腾讯云 API(STS+SCF,http,**strict 验签**) | **TC3 签名被独立 Node crypto 验证** |
| **批量管理 · 跨账号** | `run-batch.mjs` | CF Worker(batch-scf + AssumeRole) | mock 腾讯云 API(STS AssumeRole + SCF,http,**strict 验签**) | OPERATOR_TOKEN 门 / AssumeRole 主密钥+临时密钥验签 / 全量自锁 |

## 运行

```bash
cd integration
node tc3-verify.mjs          # ① 验签器自检
node run-all.mjs             # ② 跑全部四个场景
# 或单独:
node run-cf-core.mjs
node run-tencent-token.mjs
node run-tencent-cam.mjs
node run-batch.mjs
```

> 需要本机有 `openssl`(mock 自签 HTTPS 用)与 `npx wrangler`(worker 包 devDep 已装)。

## 关键设计点

- **`tc3-verify.mjs`**:用 Node `crypto` 独立复现腾讯云 TC3-HMAC-SHA256,**按客户端声明的 `SignedHeaders` 重算验签**(与真实服务器一致)。方案一中 Worker 的 `signTc3`(Web Crypto 实现)就是被它反向验证的——两条独立实现吻合 = 签名算法正确。
- **方案二用 lenient**:方案二的 TC3 签名由官方 `tencentcloud-sdk-nodejs-scf` 生成(非 minist 代码)。该 SDK 签名 host 用 `urlObj.hostname`(不含端口),在本地 mock 上会与发送的 Host 头不符(真实 API 默认 443 无此问题)。故方案二 mock 用 lenient,聚焦验证 `admin.js`(鉴权/参数/字段名);SDK 签名正确性由腾讯官方保证。
- **方案一用 strict**:Worker 的 `signTc3` 签名 host 含端口、与发送的 Host 头一致,strict 验签可通过,从而**严格证明 minist 的签名实现正确**(主密钥签 STS + 临时密钥签 SCF + 临时凭证链路)。

## 联调中发现并修复的真实 bug

1. **平台↔SCF 字段名不匹配**:平台发 `memory`/`concurrency`,SCF 读 `memorySize`/`instanceConcurrency` → 内存/并发配置静默失效。已对齐。
2. **SCF SDK endpoint 协议**:腾讯 SDK 的 `endpoint` 只接受主机名,协议由 `httpProfile.protocol` 控制。`SCF_API_ENDPOINT` 现拆分 `scheme://host` 正确设置。
3. **Worker 腾讯 API base 不可覆写**:`grant.ts` 新增 `TENCENT_API_BASE` env,支持指向 mock(也利于 staging)。
4. **tavern↔Worker storage 路由不匹配**:tavern 保存 POST `/api/storage`,Worker 要求 `/api/storage/:key`(会 404)。已对齐为 `/api/storage/card:<name>`,并注明云端角色卡批量管理走 `sync`。

## 仍需真实凭证验证的边界

- CAM 方案一的真实 OAuth `code` 流程(本实现用 `GetFederationToken` 作尽力版本)。
- 腾讯云 COS `CreateBucket`(应改用 COS XML API + cos v5 签名,非 TC3)。
- CF `/api/cf-setup`、真实 CF/Tencent 账号下的端到端。
