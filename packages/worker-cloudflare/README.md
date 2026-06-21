# @minist/worker-cloudflare

minist 的 **Cloudflare Worker 后端**:数据中转(KV / D1 / R2)+ 大模型流式代理 + 腾讯云 CAM 中转。

纯前端 SPA + 极薄 Serverless 后端架构的"极薄"那一层。免费版即可跑通个人角色扮演场景,免备案、适配手机/微信内置浏览器。

---

## 设计要点(基于 Cloudflare 真实约束)

| 资源 | 用途 | 关键额度(免费版) | 设计决策 |
|------|------|------------------|----------|
| **Worker** | 计算/路由 | 10 万请求/天,CPU 10ms/请求 | 流式转发是等网络(I/O),不计 CPU,长流式补全可行 |
| **KV** | 角色卡/世界书/预设索引(读多写少) | **写入仅 1,000 次/天**(最紧瓶颈) | 只放读多写少数据;频繁写走 D1 |
| **D1** | 聊天历史(频繁追加) | **10 万行写/天** | 逐条消息追加,远超 KV 额度 |
| **R2** | 人物卡 PNG 图片 | **无出流量费**(egress free) | 手机加载图片免费;10GB 存储足够 |

**免备案策略**:
- 前端 SPA 可部署到 Vercel / GitHub Pages,避开 `*.workers.dev` / `*.pages.dev` 域名被墙。
- Worker 对 payload 做 **Base64 混淆**(`X-Crypto-Data` 协议)规避明文敏感词审查(注意:是"混淆"非"加密",仅防自动化审查,不防主动攻击;真正的 API Key 始终走 HTTPS `Authorization` 头)。

---

## 部署步骤

### 1. 安装依赖(在 monorepo 根目录)

```bash
npm install   # npm workspaces 会自动链接 @minist/shared
```

### 2. 本地开发

```bash
cd packages/worker-cloudflare
npx wrangler login           # 首次登录
cp .dev.vars.example .dev.vars   # 填入本地环境变量
npx wrangler dev             # 启动本地 dev(默认 http://localhost:8787)
```

### 3. 创建 KV / D1 / R2 资源(任选一种)

**方式 A:命令行(推荐)**

```bash
npx wrangler kv namespace create SillyKV
# 输出 id,填入 wrangler.toml 的 [[kv_namespaces]] id

npx wrangler d1 create sillydb
# 输出 database_id,填入 wrangler.toml 的 [[d1_databases]] database_id

npx wrangler r2 bucket create silly-r2
# 取消 wrangler.toml 的 [[r2_buckets]] 注释,bucket_name = "silly-r2"
```

**方式 B:CF 方案一自动创建**

先在 `.dev.vars` 填好 `CF_API_TOKEN` + `CF_ACCOUNT_ID`(Token 需具备 Workers / KV / D1 / R2 编辑权限),再:

```bash
curl -X POST http://localhost:8787/api/cf-setup \
  -H "Content-Type: application/json" \
  -d '{"namespace":"SillyKV","d1Name":"sillydb","r2Bucket":"silly-r2"}'
```

返回的 `id` / `database_id` / `bucket_name` 填回 `wrangler.toml`。

### 4. 配置 Secrets(CAM 方案一所需要,见下)

```bash
npx wrangler secret put DEFAULT_LLM_URL
npx wrangler secret put TENCENT_SECRET_ID
npx wrangler secret put TENCENT_SECRET_KEY
npx wrangler secret put TENCENT_ROOT_UIN
npx wrangler secret put TENCENT_REGION
```

### 5. 部署

```bash
npx wrangler deploy
```

部署成功后会输出 Worker URL,形如 `https://minist-worker.<你的子域>.workers.dev`。**把这个 URL 填回酒馆前端**(`@minist/tavern`)的 `apiBaseUrl` 配置项。

---

## 路由清单

| 方法 | 路径 | 说明 | 存储 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | — |
| GET / POST | `/api/storage/:key` | KV 键值存取(角色卡索引等读多写少) | KV |
| GET / POST | `/api/chat/:userId` | 聊天历史读取/追加 | D1 |
| GET / PUT / DELETE | `/api/r2/:key` | 人物卡 PNG 存取 | R2 |
| POST / GET | `/api/sync` 或 `/api/sync/:userId` | 全量同步(拆分:KV + D1) | KV + D1 |
| POST | `/v1/chat/completions` | LLM 流式中转(OpenAI 兼容) | — |
| POST | `/api/grant-config` | 腾讯云 CAM 方案一(code → STS → 自动配置) | — |
| POST | `/api/cf-setup` | CF 方案一(自动建 KV/D1/R2) | — |

---

## CAM 方案一所需环境变量(腾讯云跨账号授权自动配置)

用于让用户用一个授权码(`code`)自动配置自己的腾讯云 SCF 函数(改超时/内存)+ COS 存储桶,无需手动登录控制台。

| 变量 | 说明 | 必填 |
|------|------|------|
| `TENCENT_SECRET_ID` | 主账号或子账号 SecretId | 方案一必填 |
| `TENCENT_SECRET_KEY` | 主账号或子账号 SecretKey | 方案一必填 |
| `TENCENT_ROOT_UIN` | 主账号 UIN(创建 COS 桶需 appid) | createBucket 时必填 |
| `TENCENT_REGION` | 默认地域(如 `ap-guangzhou`) | 可选,默认 `ap-guangzhou` |
| `DEFAULT_LLM_URL` | LLM 上游地址(completions 中转用) | completions 必填(或请求头传) |
| `CF_API_TOKEN` | CF API Token(cf-setup 自动建资源) | cf-setup 必填 |
| `CF_ACCOUNT_ID` | CF Account ID | cf-setup 必填 |

**⚠️ 安全提示**:长期 SecretKey 放 Worker 是"尽力而为"方案,适合个人/演示部署。生产推荐改用 STS `AssumeRoleWithWebIdentity` + 最小权限策略,并预先签发临时凭证缓存到 KV,避免长期密钥驻留 Worker。

---

## 免备案提示

1. **Worker 域名 `*.workers.dev` 在国内可能被污染**。建议:
   - 把前端 SPA 部署到 Vercel / GitHub Pages(国内可访问);
   - Worker 用自定义域名(CF 控制台 → Workers → Triggers → Custom Domains),或直接用国内可达的 Worker 路由。
2. **Base64 混淆**(`X-Crypto-Data: true`):前端把聊天明文先 Base64 再发给 Worker,降低明文敏感词被运营商拦截概率。Worker 侧 `decodeBase64` 还原后转发给 LLM。流式响应**不二次混淆**(免得破坏 SSE chunk 边界导致断连)。
3. **API Key 走 HTTPS `Authorization` 头**,不要塞进 body 明文,不要进 Worker 日志。

---

## 开发

```bash
npm run dev        # = wrangler dev,本地开发
npm run typecheck  # = tsc --noEmit,类型检查
npm run deploy     # = wrangler deploy,部署
```

License: AGPL-3.0-only
