# Cloudflare 部署完整指南

> 把 minist 酒馆部署到 Cloudflare:前端 SPA 到 Vercel/GitHub Pages(免备案),后端用 Cloudflare Worker + KV/D1/R2。**个人自用全免费**,微信内分享需配合 `X-Crypto-Data` 混淆。
>
> 本文所有额度数字均为 Cloudflare 官方免费版(Workers Free Plan)的**已核实数据**,不要被过时博客误导。

---

## 目录

- [一、资源准备清单](#一资源准备清单)
- [二、已核实免费额度(必读)](#二已核实免费额度必读)
- [三、部署步骤(手动)](#三部署步骤手动)
- [四、一键部署(方案一 /api/cf-setup)](#四一键部署方案一-apicf-setup)
- [五、免备案与防审查](#五免备案与防审查)
- [六、避坑清单](#六避坑清单)
- [七、验证清单](#七验证清单)

---

## 一、资源准备清单

部署前需在 Cloudflare 控制台准备以下资源。每项都附**用途**、**免费额度**、**控制台入口 URL**。

| 资源 | 用途 | 免费额度(已核实) | 控制台入口 |
|------|------|-------------------|-----------|
| **Cloudflare 账号** | 总入口 | 个人免费 | https://dash.cloudflare.com/sign-up |
| **Workers** | 计算/路由/流式中转 | 100k 请求/天,CPU 10ms/请求 | https://dash.cloudflare.com/?to=/:account/workers |
| **KV Namespace** | 角色卡/世界书/预设索引(**读多写少**) | 读 10 万/天,**写仅 1000/天** ⚠️ | https://dash.cloudflare.com/?to=/:account/workers/kv |
| **D1 Database** | 聊天历史(**频繁追加**) | 读 500 万行/天,**写 10 万行/天** | https://dash.cloudflare.com/?to=/:account/workers/d1 |
| **R2 Bucket** | 人物卡 PNG 图片(**无出流量费**) | 10GB 存储 / 100万 A 类写 / 1000万 B 类读 每月 | https://dash.cloudflare.com/?to=/:account/r2 |
| **API Token**(一键部署用) | 调 CF REST API 自动建资源 | — | https://dash.cloudflare.com/profile/api-tokens |
| **Account ID** | API 调用必填 | — | https://dash.cloudflare.com → 右侧栏 |

> **资源绑定名必须与 `wrangler.toml` 一致**:`SillyKV`(KV)/ `SillyDB`(D1)/ `SillyR2`(R2),见 `packages/worker-cloudflare/src/env.ts` 的 `Env` 接口。

---

## 二、已核实免费额度(必读)

这些数字是部署设计的**地基**,任何分层数据存储决策都基于它们:

| 资源 | 维度 | 免费额度 | 频率 | 瓶颈风险 |
|------|------|----------|------|----------|
| **Workers** | 请求量 | 100,000 | 每天 | 🟢 个人用很难触顶 |
| **Workers** | CPU 时间 | **10ms** | 每请求 | 🟢 流式是等网络 I/O,不计 CPU(见 [六避坑](#六避坑清单)) |
| **KV** | 读 | 100,000 | 每天 | 🟢 读多写少数据无压力 |
| **KV** | 写 | **1,000** | 每天 | 🔴 **最紧瓶颈!聊天放 KV 必爆** |
| **KV** | 删除 | 1,000 | 每天 | 🟡 同写 |
| **KV** | 存储 | 1 GB | 总量 | 🟢 角色卡索引够用 |
| **D1** | 读 | 5,000,000 行 | 每天 | 🟢 极宽裕 |
| **D1** | 写 | 100,000 行 | 每天 | 🟢 聊天逐条追加无压力 |
| **D1** | 存储 | 5 GB | 总量 | 🟢 聊天历史够用 |
| **R2** | 存储 | 10 GB | 每月 | 🟢 大量人物卡够用 |
| **R2** | A 类操作(写/列表) | 1,000,000 | 每月 | 🟢 上传低频 |
| **R2** | B 类操作(读) | 10,000,000 | 每月 | 🟢 浏览低频 |
| **R2** | **出流量(egress)** | **无限,且 $0/GB** | — | 🟢 **核心优势**,手机加载图片免费 |

### 数据分层设计(基于额度)

| 数据 | 放哪 | 理由 |
|------|------|------|
| 角色卡索引、世界书、预设元数据 | **KV** | 读多写少,放 KV 读快、写次数低 |
| 聊天历史(逐条追加) | **D1** | 写 10 万/天,远超 KV 的 1000/天 |
| 人物卡 PNG 图片 | **R2** | 无出流量费,手机加载免费 |

> 这正是 `wrangler.toml` 注释里反复强调的"KV 只放读多写少 / 聊天走 D1 / 图片走 R2"的根因。

---

## 三、部署步骤(手动)

### 步骤 1:创建 KV / D1 / R2 资源

**方式 A:命令行(推荐)**

```bash
cd packages/worker-cloudflare
npx wrangler login   # 首次登录,浏览器授权

# 创建 KV 命名空间
npx wrangler kv namespace create SillyKV
# 输出形如: { "id": "abc123..." }  → 复制 id

# 创建 D1 数据库
npx wrangler d1 create sillydb
# 输出形如: database_id = "def456..."  → 复制 database_id

# 创建 R2 桶(R2 无需 id,用 bucket 名)
npx wrangler r2 bucket create silly-r2
```

**方式 B:控制台手动创建**

到上面表格里的入口 URL,逐个新建,记录返回的 id。

### 步骤 2:填 `wrangler.toml` 绑定

打开 `packages/worker-cloudflare/wrangler.toml`,**取消注释**并填入真实 id:

```toml
name = "minist-worker"
main = "src/index.ts"
compatibility_date = "2024-09-01"

[observability]
enabled = true

[[kv_namespaces]]
binding = "SillyKV"                        # ← 必须叫这个名字
id = "<步骤1 KV 返回的 id>"

[[d1_databases]]
binding = "SillyDB"                        # ← 必须叫这个名字
database_name = "sillydb"
database_id = "<步骤1 D1 返回的 database_id>"

[[r2_buckets]]
binding = "SillyR2"                        # ← 必须叫这个名字
bucket_name = "silly-r2"
```

> **绑定名是硬契约**:`packages/worker-cloudflare/src/env.ts` 的 `Env` 接口里字段名就是 `SillyKV` / `SillyDB` / `SillyR2`,改了名字会运行时报 `undefined`。

### 步骤 3:配置 Secrets(至少 DEFAULT_LLM_URL)

```bash
# 必填:LLM 上游地址(completions 中转用)
npx wrangler secret put DEFAULT_LLM_URL
# 交互输入:https://api.deepseek.com  (或 OpenAI 兼容的任意服务)

# 可选(腾讯云方案一 CAM 中转才需要)
npx wrangler secret put TENCENT_SECRET_ID
npx wrangler secret put TENCENT_SECRET_KEY
npx wrangler secret put TENCENT_ROOT_UIN
npx wrangler secret put TENCENT_REGION

# 可选(CF 方案一自动建资源)
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ACCOUNT_ID
```

> **安全红线**:Secret 用 `wrangler secret put` 写入,**不进仓库**。`.dev.vars.example` 是模板,`.dev.vars` 已在 `.gitignore`。

### 步骤 4:部署 Worker

```bash
cd packages/worker-cloudflare
npx wrangler deploy
```

部署成功输出形如:

```
Published minist-worker (1.23 sec)
  https://minist-worker.<你的子域>.workers.dev
```

**记下这个 Worker URL**,下一步回填到前端。

### 步骤 5:回填 Worker URL 到酒馆前端

在酒馆前端 `apps/tavern` 的设置面板(或 `TavernConfig.apiBaseUrl`):

```
apiBaseUrl = https://minist-worker.<你的子域>.workers.dev
backend    = cloudflare
apiKey     = <你的 DeepSeek/OpenAI Key>
model      = deepseek-chat
crypto     = true   # 国内免备案建议开(见第五节)
```

### 步骤 6:前端 SPA 部署到 Vercel / GitHub Pages

> ⚠️ **关键**:不要让前端跑在 `*.workers.dev` 或 `*.pages.dev`,这两个域名国内部分地区/微信被墙(见 [六避坑](#六避坑清单)之 `cf-default-domain-blocked`)。

**Vercel(推荐,国内可达性最好)**

```bash
cd apps/tavern
# 构建(具体脚本见 apps/tavern/package.json,通常 npm run build → dist/)
npm run build

# 方式 A:Vercel CLI
npm i -g vercel
vercel --prod

# 方式 B:GitHub 仓库连接 Vercel 自动部署
# 把 minist 仓库推到 GitHub → Vercel 控制台 Import Project → 选 apps/tavern → Deploy
```

部署后获得 `https://<你的项目>.vercel.app`,在手机/微信打开。CORS 已在 `@minist/shared` 配好(`Access-Control-Allow-Origin: *`),前端调 Worker 跨域无障碍。

**GitHub Pages(备选)**

```bash
cd apps/tavern
npm run build
# 把 dist/ 推到 gh-pages 分支(可用 gh-pages 工具)
npx gh-pages -d dist
# 访问:https://<你的用户名>.github.io/<仓库名>/
```

---

## 四、一键部署(方案一 `/api/cf-setup`)

不想手动建 KV/D1/R2?minist 提供 CF 方案一自动向导,用你的 `CF_API_TOKEN` 调 Cloudflare REST API 一键创建。

### 前置:准备 API Token

1. 打开 https://dash.cloudflare.com/profile/api-tokens → **Create Token**。
2. 选 **Edit Cloudflare Workers** 模板,并额外勾选权限:
   - Account · **Workers KV Storage** · Edit
   - Account · **D1** · Edit
   - Account · **Workers R2 Storage** · Edit
3. Account Resources 选 **All accounts** 或指定账号。
4. 创建后**立即复制 Token**(只显示一次)。
5. Account ID 在 https://dash.cloudflare.com 首页右侧栏。

### 调用 `/api/cf-setup`

先把 `CF_API_TOKEN` + `CF_ACCOUNT_ID` 配为 Worker 的 Secret(见步骤 3),再本地或部署后调用:

```bash
curl -X POST https://minist-worker.<你的子域>.workers.dev/api/cf-setup \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "SillyKV",
    "d1Name": "sillydb",
    "r2Bucket": "silly-r2"
  }'
```

**响应**(实现见 `packages/worker-cloudflare/src/routes/cf-setup.ts`):

```json
{
  "success": true,
  "data": {
    "kv": { "id": "<KV namespace id>", "title": "SillyKV" },
    "d1": { "uuid": "<D1 database_id>", "name": "sillydb" },
    "r2": { "name": "silly-r2" },
    "steps": [
      "KV 已创建: SillyKV → id=...",
      "D1 已创建: sillydb → database_id=...",
      "R2 已创建: silly-r2"
    ],
    "warnings": []
  }
}
```

把返回的 `kv.id` / `d1.uuid` / `r2.name` 填回 `wrangler.toml`,再 `npx wrangler deploy` 一次即可。

### 幂等性

`cf-setup` 先 LIST 查重再 POST,同名 KV 会复用而非报错(实现见源码 KV 分支)。D1/R2 同名创建会冲突,报错进 `warnings`。

> ⚠️ **安全提示**:长期 CF API Token 放 Worker Secret 是"尽力而为"方案。生产推荐改用 OAuth + 最小权限,定期轮换 Token。

---

## 五、免备案与防审查

### 为什么前端不放 `*.workers.dev` / `*.pages.dev`

见避坑清单 `cf-default-domain-blocked`(`packages/deploy-agent/src/knowledge.ts`):

- Cloudflare 默认提供的 `*.workers.dev` 与 `*.pages.dev` 子域,在中国大陆**部分地区/运营商被 DNS 污染或 SNI 阻断**。
- **微信内置浏览器 100% 无法打开**这两个域名(未在微信白名单)。
- 用户反馈"部署成功但手机打不开"基本是这个原因。

**对策**:前端 SPA 部署到 **Vercel** 或 **GitHub Pages**(这两者国内可达性优于 workers.dev);Worker 走自定义域名或直接 fetch Worker URL(配合混淆)。

若要 Worker 也国内可达:

1. **绑定自有域名**:CF 控制台 → Workers → 你的 Worker → Triggers → Custom Domains,绑定一个你已备案或未备案但 CF DNS 接管的域名。
2. **或用 Cloudflare 中国网络**(企业版付费)。
3. **兜底**:启用下面的 `X-Crypto-Data` 混淆,绕过明文审查。

### Base64 混淆(X-Crypto-Data)原理与开启方法

**原理**(见 `packages/shared/src/crypto.ts`):

```
请求侧: 前端 JSON ──encodeBase64──► "乱码" body
         Content-Type: text/plain;charset=UTF-8   (伪装非 JSON)
         X-Crypto-Data: true                       (告诉后端要解混淆)
响应侧: 后端先 decodeBase64 还原再处理
         /api/storage 特殊:原样存密文,Worker 零明文零密钥
流式响应: 不二次混淆(避免破坏 SSE chunk 边界导致断连)
```

**开启方法**:在酒馆设置面板把 `TavernConfig.crypto = true`。前端适配层 `CloudflareAdapter.wrapBody()` 会自动:

- 把请求 JSON `encodeBase64()`
- 设 `Content-Type: text/plain;charset=UTF-8`
- 加 `X-Crypto-Data: true` 头

后端侧无需任何配置,`@minist/shared` 的 `CORS_HEADERS` 已声明允许该头,Worker 路由(如 `completions.ts`、`chat.ts`)见到头自动 `decodeBase64()` 还原。

> ⚠️ **边界再次强调**:这是**混淆非加密**,防的是自动化关键词审查,不防主动攻击者。真正机密内容仍需端到端加密(可用 `xorEncode` 叠加一层,见 `crypto.ts`)。API Key 始终走 HTTPS `Authorization` 头,绝不进 body、不进 Worker 日志。

---

## 六、避坑清单

以下是已核实并写入 `packages/deploy-agent/src/knowledge.ts` 的 CF 平台核心避坑点,部署前逐一对照:

### 🔴 Critical

#### `cf-kv-write-limit`:KV 每日写入仅 1,000 次,是最紧瓶颈

- **症状**:聊天记录/世界书频繁写入 KV,瞬间打爆配额,后续写入返回 429 或静默丢弃。
- **对策**:
  1. **聊天记录放 D1**(10 万写/天),不放 KV。
  2. KV 只存索引、配置、角色卡元数据等读多写少数据。
  3. 前端做写入节流:合并连续消息、本地 IndexedDB 先攒批再上报。
  4. 监控:Workers Analytics 看 KV writes/day,接近 1000 立即降频。

### 🟠 High

#### `cf-default-domain-blocked`:默认域名被墙

见上文 [五、免备案与防审查](#五免备案与防审查)。

#### `common-cors`:CORS 跨域

- **症状**:前端(Vercel)调 Worker,浏览器报 "CORS policy blocked" 或预检 OPTIONS 失败。
- **对策**:
  1. 后端所有响应(含 OPTIONS 预检)必须带 `@minist/shared` 的 `CORS_HEADERS`。Worker 入口 `index.ts` 第一行已处理 OPTIONS → 204 + CORS。
  2. 自定义头(`X-Crypto-Data` / `X-Admin-Token` / `X-User-Id`)已在 `Access-Control-Allow-Headers` 声明。
  3. 调试:DevTools → Network → 失败请求 → Response Headers,确认有没有 `Access-Control-Allow-Origin`。

### 🟡 Medium

#### `cf-crypto-obfuscation`:明文审查拦截

敏感词角色扮演内容经 CF 边缘节点转发可能被重置。开启 `crypto = true` 走 Base64 混淆,见第五节。

#### `cf-r2-no-egress`:图片应放 R2

人物卡 PNG / 头像若放普通对象存储,每次加载产生出流量费。R2 出流量 $0/GB,走 Worker 代理 R2(`/api/r2/:key`)不算 egress。

### 🟢 Low

#### `cf-cpu-10ms`:Workers CPU 10ms/请求

- **误区**:以为流式 AI 输出(LLM 响应慢)会超 CPU 限制。
- **真相**:Workers 限的是 **CPU 时间**(实际执行 JS 的累计时间),不是 wall-clock。等待 LLM 响应的网络 I/O **不计 CPU**。流式转发 `fetch()` 的 `ReadableStream` pipe 给 `Response` 完全可行。
- 真正占 CPU 的:`JSON.parse` 大对象、加密计算、大循环。保持 Worker 逻辑薄。
- 升级 Paid($5/月)→ CPU 上限 30s,基本无瓶颈。

#### `common-sse-reconnect`:SSE 断连重连

手机锁屏、微信切后台、网络抖动会导致流式中断。

- 前端用 `fetch` + `ReadableStream`(非原生 `EventSource`,后者不支持 POST 与自定义头)。
- 每收到 token 立即写 IndexedDB,断连已输出内容不丢。
- 断连后用"已输出内容"作为 prompt 续传。

---

## 七、验证清单

部署后按顺序验证:

```bash
# 1. Worker 健康检查
curl https://minist-worker.<你的子域>.workers.dev/api/health
# 期望: {"success":true,"data":{"ok":true}}

# 2. KV 读写(/api/storage/:key)
curl -X POST https://minist-worker.<你的子域>.workers.dev/api/storage/test-key \
  -H "Content-Type: application/json" \
  -d '{"hello":"world"}'
curl https://minist-worker.<你的子域>.workers.dev/api/storage/test-key

# 3. D1 聊天追加(/api/chat/:userId)
curl -X POST https://minist-worker.<你的子域>.workers.dev/api/chat/test-user \
  -H "Content-Type: application/json" \
  -d '{"role":"user","content":"你好","ts":1700000000000}'
curl https://minist-worker.<你的子域>.workers.dev/api/chat/test-user

# 4. R2 上传与读取(/api/r2/:key)
curl -X PUT https://minist-worker.<你的子域>.workers.dev/api/r2/test.png \
  -H "Content-Type: image/png" \
  --data-binary @some.png
curl https://minist-worker.<你的子域>.workers.dev/api/r2/test.png -o out.png

# 5. 流式中转(/v1/chat/completions)
curl -N https://minist-worker.<你的子域>.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <你的 DeepSeek Key>" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}],"stream":true}'
# 期望: 逐 token 输出 data: {"choices":[{"delta":{"content":"..."}}]}
```

全部通过后,在手机/微信打开前端 Vercel URL,填好 `apiBaseUrl` = Worker URL,即可开始角色扮演。

---

下一篇:[腾讯云部署指南](./deploy-tencent.md) · [计费测算与选型](./cost.md) · [架构说明](./architecture.md)

License: AGPL-3.0-only · minist contributors
