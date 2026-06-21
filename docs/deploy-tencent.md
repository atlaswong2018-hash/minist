# 腾讯云 SCF 部署完整指南

> 把 minist 酒馆部署到腾讯云 SCF:Web 函数流式中转 + COS 备份。**核心痛点是免备案访问**(默认域名微信 100% 拦截)与**响应流量隐藏成本**,本文用最大篇幅讲透这两件事。
>
> 本文所有计费数字均为腾讯云官方的**已核实数据**,部署前请逐项理解,避免账单炸弹。

---

## 目录

- [一、资源准备清单](#一资源准备清单)
- [二、已核实计费(必读)](#二已核实计费必读)
- [三、防爆产清单](#三防爆产清单)
- [四、部署步骤(两种方式)](#四部署步骤两种方式)
- [五、免备案访问通道(核心)](#五免备案访问通道核心)
- [六、一键配置两方案](#六一键配置两方案)
- [七、避坑清单](#七避坑清单)
- [八、验证清单](#八验证清单)

---

## 一、资源准备清单

部署前在腾讯云控制台准备以下资源。每项附**用途**与**入口**。

| 资源 | 用途 | 说明 | 控制台入口 |
|------|------|------|-----------|
| **腾讯云账号** | 总入口 | 实名认证(个人即可) | https://cloud.tencent.com/register |
| **SCF 云函数** | Web 类型,流式中转 + 同步备份 | Nodejs18.15,128MB,超时 60s | https://console.cloud.tencent.com/scf |
| **COS 存储桶** | 同步备份(整包 JSON) + 人物卡 PNG 直传 | 命名 `<自定义>-<APPID>`,与函数同地域 | https://console.cloud.tencent.com/cos |
| **API 网关**(自动生成) | SCF Web 函数触发器,提供 HTTP 入口 | 三级域名微信拦截,见第五节 | 部署时自动创建 |
| **(可选)云开发 CloudBase** | **免备案关键通道 ①** | 自带 `*.service.tcloudbase.com` 微信白名单域名 | https://console.cloud.tencent.com/tcb |
| **(可选)EdgeOne / 备案域名** | 正规 CDN 加速 + 微信信任 | 需 ICP 备案,流程长 | https://console.cloud.tencent.com/edgeone |
| **(可选)Tailscale** | **免备案关键通道 ②**(私人自用) | 加密内网隧道,微信无法拦截 | https://tailscale.com/ |

> SCF 运行时会自动注入临时凭证(`TENCENTCLOUD_SECRETID` / `SECRETKEY` / `SESSIONTOKEN` / `FUNCTIONNAME` / `NAMESPACE` / `REGION`),**这些不需要配置**,函数内部用临时凭证"自己改自己"(方案二的核心)。

---

## 二、已核实计费(必读)

> ⚠️ 这是用户最关心的部分。腾讯云 SCF 的计费模型比 Cloudflare 复杂得多,有几个**隐藏成本**必须提前理解。

### 计费模型三要素

腾讯云 SCF 按以下三项叠加计费:

```
总费用 = 资源量费用 + 调用次数费用 + 外网流量费用
       (内存×执行时长)  (每次调用)   (函数主动外访)
```

### 各项免费额度与单价(已核实)

| 计费项 | 免费额度 | 单价(超出后) | 备注 |
|--------|----------|--------------|------|
| **资源量**(GB·s) | **新用户前 3 个月** 40 万 GB·s/月;之后无 | ¥0.0000335 / GB·s | = 内存(GB) × 执行时长(秒) |
| **调用次数** | 新用户前 3 个月 100 万次/月;之后无 | ¥0.0013 / 万次(后付费) | 每次函数触发算一次 |
| **外网出流量**(函数主动外访) | 与 CVM 共享流量包 | ¥0.8 / GB(各地域略有差异) | 函数主动 fetch 上游 LLM 产生的出流量 |

### 🔴 隐藏成本:Web 函数"响应流量"单独计费

> 见避坑清单 `tencent-response-traffic-billing`(`packages/deploy-agent/src/knowledge.ts`)。

**这是最大的坑**:腾讯云 SCF 的外网流量分两种:

| 流量类型 | 是否含免费额度 / 资源包 | minist 命中场景 |
|----------|----------------------|----------------|
| **函数主动外访**(出流量) | ✅ 享免费额度与资源包抵扣 | SCF fetch 上游 LLM |
| **Web 函数返回给客户端**(响应流量) | ❌ **不享免费额度与资源包** | **流式 AI 输出正是响应流量!** |

**含义**:你每收到一句 AI 流式回复,这些 token 从 SCF 流向手机浏览器的字节,**全部按 ¥0.8/GB 单独计费,免费 3 个月也不抵扣**。

### 真实测算(个人低频使用场景)

假设:每天 30 句对话,每句流式输出 20 秒,内存 128MB,每月 30 天。

**资源量费用**:

```
内存 = 128 MB = 0.125 GB
每次时长 = 20 s
每天 = 30 次 × 20 s × 0.125 GB = 75 GB·s
每月 = 75 × 30 = 2250 GB·s
费用 = 2250 × ¥0.0000335 ≈ ¥0.075/月
```

(新用户前 3 个月免费额度 40 万 GB·s/月,完全够用;3 个月后 ≈ ¥0.075/月)

**调用次数费用**:

```
每月 = 30 × 30 = 900 次
费用 = 900 × ¥0.0013 / 10000 ≈ ¥0.0001/月
```

(几乎可忽略)

**响应流量费用**(隐藏成本!):

```
假设每句 AI 输出 ≈ 500 字 ≈ 1.5 KB(UTF-8 中文 3 字节/字)
每天 = 30 × 1.5 KB = 45 KB
每月 = 45 × 30 = 1.35 MB
费用 = 1.35 MB × ¥0.8/GB ≈ ¥0.001/月
```

(低频短对话几乎可忽略;但**长文本角色扮演**(每句几千 token)+ **高频使用**(每天数百句)会快速放大,详见 [cost.md](./cost.md))

**COS 存储费用**:

```
50 MB 同步备份存储
费用 = 50 MB × ¥0.099/GB/月 ≈ ¥0.005/月
```

(< ¥0.01/月,可忽略)

**API 网关费用**:

```
个人低频使用,在免费额度内,¥0/月
```

### 总成本结论

| 场景 | 月成本估算 |
|------|----------|
| 个人低频(每天 30 句短对话) | **< ¥0.25/月**(主要是资源量,前 3 个月 ¥0) |
| 中频(每天 100 句长对话,每句 2000 字) | ≈ ¥1~3/月(响应流量占大头) |
| 高频(每天 500+ 句长对话) | 转用 Cloudflare(见 [cost.md](./cost.md) 选型决策树) |

---

## 三、防爆产清单

部署后**立即**在 SCF 控制台逐一确认(见 `packages/scf-tencent/README.md`):

| 项 | 建议值 | 在哪设 |
|---|---|---|
| **内存** | **128 MB** | 函数配置 → 基础配置 |
| **超时** | **60 s** | 函数配置(或方案二 `/api/admin/set-timeout`) |
| **最大并发实例** | **1** | 函数配置 → 实例并发 |
| **失败重试** | **关闭** | 函数配置 → 异步重试(关闭) |
| **异步执行** | **关闭** | 流式必须同步返回 |
| **余额预警** | **设 ¥5** | 账户中心 → 费用告警 |
| **日预算上限** | **¥1** | 费用 → 预算管理,触发告警 |

**为什么这些值**:

- **内存 128MB**:SCF 薄中转层(express + axios)够用;内存翻倍 = 价格翻倍。
- **超时 60s**:够 LLM 流式首 token + 短会话;设过高会导致"卡在等待 LLM"的空转扣费。
- **并发实例 1**:个人低频使用,杜绝多实例同时计费 + 控制冷启动成本。
- **关闭失败重试**:SCF 异步重试会放大失败成本(一次失败变三次计费)。
- **关闭异步执行**:流式必须同步返回(SSE 是同步流),异步会导致客户端收不到响应。

---

## 四、部署步骤(两种方式)

### 方式 A:Serverless Framework 一键部署(推荐新手)

```bash
# 1. 安装 CLI
npm install -g serverless

# 2. 配置腾讯云 CAM 凭证(主账号或子账号,需 SCF/COS/API网关 权限)
serverless credentials set --provider tencent \
  --secretId <你的SecretId> --secretKey <你的SecretKey>

# 3. 在本目录填好环境变量(从本机 env 读,不会进仓库)
export ADMIN_TOKEN=$(openssl rand -hex 32)
export COS_BUCKET=minist-backup-1250000000    # 改成你的桶名(<自定义>-<APPID>)
export COS_REGION=ap-guangzhou                 # 与桶地域一致

# 4. 部署
cd packages/scf-tencent
sls deploy
```

部署成功后,CLI 输出 API 网关触发器 URL(形如 `https://service-xxx.region.apigw...`)。

> 配置文件 `serverless.yml` 已内置防爆产默认值(`memorySize: 128`、`timeout: 60`、`instanceConcurrency: 1`、`asyncRunEnable: false`)。

### 方式 B:打包 zip 手动上传(推荐熟手)

```bash
cd packages/scf-tencent

# 1. 装生产依赖(不装 devDependencies,减小体积)
npm install --production

# 2. 给启动文件加可执行位(SCF 不自动加,见避坑 scf-bootstrap 可执行位)
chmod +x scf_bootstrap

# 3. 打 zip(排除 .env / 本地凭证 / 缓存)
zip -r minist-scf.zip . \
  -x ".env*" "*.git*" "node_modules/.cache/*" "*.zip"

# 4. 控制台上传
#    SCF 控制台 → 函数服务 → 新建函数 → 模板「Web 函数」→ 代码上传 zip
#    运行环境选 Nodejs18.15,内存 128MB,超时 60s
#    高级配置 → 环境变量 填:
#      ADMIN_TOKEN  = <openssl rand -hex 32>
#      COS_BUCKET   = minist-backup-<你的APPID>
#      COS_REGION   = ap-guangzhou
#      LLM_PROXY_URL= https://api.deepseek.com
```

无论哪种方式,部署后都需要**配置 Web 触发器**才能获得可访问的 URL(见下一节)。

### 环境变量取值参考

| 变量 | 取值示例 | 必填 | 说明 |
|------|---------|------|------|
| `ADMIN_TOKEN` | `openssl rand -hex 32` 生成 | 方案二必填 | 方案二鉴权,见第六节 |
| `COS_BUCKET` | `minist-backup-1250000000` | ✅ | 命名 `<自定义>-<APPID>` |
| `COS_REGION` | `ap-guangzhou` | ✅ | 与桶地域一致 |
| `LLM_PROXY_URL` | `https://api.deepseek.com` | ✅ | OpenAI 兼容上游 |

> SCF 还会自动注入 `TENCENTCLOUD_SECRETID` / `SECRETKEY` / `SESSIONTOKEN` / `FUNCTIONNAME` / `NAMESPACE` / `REGION`,**这些不需要配置**。

---

## 五、免备案访问通道(核心)

> ⚠️ **关键现实**:SCF API 网关的三级域名(`service-xxx.region.apigw...`)在**微信内置浏览器 100% 被拦截**(未备案域名不在微信白名单)。没有备案域名的情况下,必须走以下任一通道。

见避坑清单 `tencent-wechat-default-domain-blocked`。

### 通道 ① 云开发 CloudBase Web 触发器(推荐,自带白名单)

腾讯云 CloudBase(云开发)的「Web 静态托管」域名 `*.service.tcloudbase.com` 已被微信加入白名单,可直接在微信内打开。

**步骤**:

1. 开通腾讯云 CloudBase(云开发),创建环境(有免费额度)。
2. 在 CloudBase 控制台「云函数」中**导入已部署的 SCF 函数**(或直接在 CloudBase 创建 Web 触发器指向同一函数)。
3. CloudBase 会给函数分配形如 `https://<envId>.service.tcloudbase.com/<path>` 的 HTTP 访问地址。
4. 前端 `apiBaseUrl` 填该地址。微信内访问不再被拦。

**优点**:

- ✅ 微信白名单域名,**免备案**
- ✅ 自带 HTTPS,无需额外配置
- ✅ 同地域内调用 SCF,延迟低

**注意**:

- CloudBase 本身也有计费(看「Web 静态托管流量」),但比备案域名流程简单得多。
- 见避坑 `tencent-cloudbase-whitelist`。

### 通道 ② Tailscale 内网(熟人间共享,无公网暴露)

手机与云函数所在 VPC 加入同一 Tailscale 网络,走加密内网隧道,微信无法拦截(流量是加密的 WireGuard,不可见明文域名)。

**步骤**:

1. SCF 函数所在的 VPC 配置 Tailscale(可通过 NAT 网关出网 + 在同 VPC 一台 CVM 上跑 Tailscale subnet router)。
2. 手机安装 Tailscale 客户端(iOS / Android 官方),登录同一 tailnet。
3. 前端 `apiBaseUrl` 填 SCF 内网 IP 或 Tailscale 分配的域名(`100.x.x.x`)。
4. 适合个人 / 熟人小范围(1-10 人),不适合公开发放。

**优点**:

- ✅ 零成本(Tailscale 个人版免费)
- ✅ 流量全程 WireGuard 加密,微信只能看到去 Tailscale 中继的连接,无法识别内容
- ✅ 无公网暴露,无扫描/限流风险

**注意**:

- 适合 1-10 人自用,不适合公开服务。
- 见避坑 `tencent-tailscale-intranet`。

### 通道 ③(需备案)自有备案域名 + EdgeOne / CLB

最正规但流程长:

1. 自有域名完成 ICP 备案(腾讯云备案,约 7-20 工作日)。
2. 绑定到腾讯云 EdgeOne(CDN)或 CLB,回源到 SCF API 网关。
3. 备案域名在微信白名单内,可直接打开。

**何时选**:公开服务、有正规备案、追求稳定与加速。

---

## 六、一键配置两方案

minist 腾讯云部署有两种授权模型,**按你的使用场景选择**。

### 对比表

| 维度 | 方案一 CAM 跨账号授权 | 方案二 Token 自改(推荐自用) |
|------|---------------------|--------------------------|
| **目标用户** | 通过 minist 平台代用户配置(公开发放) | 个人 / 熟人自部署 |
| **凭证流转** | 用户授权码 → 平台用 STS 代配置 | 用户自己的 ADMIN_TOKEN |
| **主账号密钥** | 全程不离开腾讯云 ✅ | 无需提供(运行时临时凭证"自己改自己")|
| **入口路由** | `/api/grant-config`(在 Worker 实现中转) | `/api/admin/set-timeout`(在 SCF 包实现)|
| **复杂度** | 高(需 CAM 角色、信任策略、STS) | 低(一个 curl 命令) |
| **何时选** | 公开发放、陌生人 | 个人 / 熟人、低频 |

### 方案一:CAM 跨账号角色授权(对外公开场景)

**目标**:让 minist 平台帮用户自动配置其腾讯云资源(SCF 超时、COS 桶),**用户主账号 SecretKey 全程不暴露给平台**。

见避坑 `tencent-cam-cross-account`,完整流程:

1. **平台(服务商)**有一个腾讯云主账号,记录其 UIN(在 Worker 的 `TENCENT_ROOT_UIN` 配置)。
2. **用户**跳转到腾讯云 CAM 角色授权页,创建一个"允许平台 UIN 扮演"的角色,挂最小权限策略(`QcloudSCFFullAccess` 子集 + COS `CreateBucket` + STS `AssumeRole`)。
3. 授权完成回调到 minist 平台,带回授权 `code`(走 `X-Grant-Code` 头)。
4. **平台后端(我们的 CF Worker 中转)**拿 `code` 调 `STS:AssumeRole` 换临时凭证(有效期 1 小时,自动续期)。
5. 平台用 STS 调:
   - `UpdateFunctionConfiguration`(改超时 / 内存)
   - `CreateBucket`(建 COS 桶)
   - 生成 COS **Presigned URL** 给前端直传(成本转嫁用户)
6. 用户主账号 SecretKey 全程不离开腾讯云,平台只持有临时凭证,过期失效。

**入口路由**:`POST /api/grant-config`(在 `packages/worker-cloudflare/src/routes/grant.ts` 实现 Worker 侧中转;SCF 包**不实现**此路由,因为中转逻辑在平台侧)。

> ⚠️ **安全提示**(已写入 CF Worker README):长期 SecretKey 放 Worker 是"尽力而为"方案,适合个人/演示。生产推荐改用 `AssumeRoleWithWebIdentity` + 最小权限策略,并预先签发临时凭证缓存到 KV,避免长期密钥驻留 Worker。

### 方案二:Token 自改(个人自部署,推荐)

**目标**:用户部署完 SCF 后,用一个 `curl` 命令让函数**自己改自己**的配置(超时 / 内存 / 并发),无需 CAM 跨账号授权。

**原理**(精髓):SCF 运行时注入的临时凭证(`TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN`)天然具备"修改本函数配置"的权限(继承函数所属账号的 CAM),所以函数能调用 `UpdateFunctionConfiguration` 改自己——无需额外 CAM 配置。

**实现**:见 `packages/scf-tencent/src/routes/admin.js`:

```bash
curl -X POST https://<你的函数URL>/api/admin/set-timeout \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: <你的 ADMIN_TOKEN>" \
  -d '{"timeout":60,"memorySize":128}'
```

返回:

```json
{
  "success": true,
  "data": {
    "requestId": "...",
    "FunctionName": "minist-scf",
    "Namespace": "default",
    "Timeout": 60,
    "MemorySize": 128,
    "reminder": "并发实例上限设为 1、关闭异步重试需在 SCF 控制台手动确认"
  }
}
```

**鉴权**:`X-Admin-Token` 头(或 `body.adminToken`),必须匹配环境变量 `ADMIN_TOKEN`。未配置 `ADMIN_TOKEN` 时接口拒绝(默认安全)。

**何时选方案二**:个人 / 熟人 / 自部署 / 低频。这是个人自部署最省事的路径,SCF 包 README 主推此方案。

### 两方案边界(已写入 SCF 包 README)

| 维度 | 方案一 CAM | 方案二 Token 自改 |
|------|----------|----------------|
| 实现位置 | Worker 中转(`grant.ts`)+ 用户 CAM 角色 | SCF 包(`admin.js`)|
| 路由 | `/api/grant-config` | `/api/admin/set-timeout` |
| 本 SCF 包是否实现 | ❌(由部署平台 `apps/platform` 负责) | ✅(本包核心) |

---

## 七、避坑清单

以下是已核实并写入 `packages/deploy-agent/src/knowledge.ts` 的腾讯云平台核心避坑点:

### 🔴 Critical

#### `tencent-response-traffic-billing`:Web 函数"响应流量"单独计费

见第二节 [已核实计费](#二已核实计费必读)。**流式 AI 输出正是响应流量**,不享免费额度与资源包。

- **降本**:① 限制 `max_tokens`;② 高频用户转 CF(响应流量在 CF 是 Worker 请求量,不单独计费);③ 设余额预警。
- 本包已内置防扣费:`upstreamRes.data.on('end', () => res.end())` 主动释放实例,杜绝空转。

### 🟠 High

#### `tencent-scf-timeout-idle-billing`:超时设置过高导致空转扣费

SCF 按"资源量 = 内存 × 执行时长"计费。超时设 900s 时,即使卡在等待 LLM 响应,进程没退出就持续计费。

- **对策**:超时设 60s、内存 128MB、并发 1、关闭失败重试。见第三节防爆产清单。

#### `tencent-wechat-default-domain-blocked`:默认域名微信 100% 被拦

见第五节 [免备案访问通道](#五免备案访问通道核心)。三级域名 `*.service.tencentcloudapi.com` 未在微信白名单。

### 🟡 Medium

#### `tencent-cloudbase-whitelist`:CloudBase 域名在微信白名单

见通道 ①。`*.service.tcloudbase.com` 可直接在微信打开。

#### `tencent-tailscale-intranet`:Tailscale 内网微信无法拦截

见通道 ②。WireGuard 加密,微信只看到去中继的连接。

#### `tencent-cam-cross-account`:CAM 跨账号授权不暴露主账号密钥

见方案一流程。

#### `tencent-free-tier-3-months`:免费额度仅新用户前 3 个月

- **对策**:部署时明确告知"免费 3 个月,到期后按量计费"。
- 设日预算上限 ¥1 触发告警。
- 3 个月到期前评估:用量小继续 SCF,用量大迁移到 CF。

#### `tencent-cos-presigned-upload`:Presigned URL 直传,成本转嫁用户

人物卡 PNG 直传用户自有 COS,流量与存储成本由用户承担。见 `packages/scf-tencent/src/routes/r2.js`。

### 🔧 部署期避坑(SCF 包 README 补充)

#### `scf_bootstrap` 可执行位

SCF Web 函数要求启动文件 `scf_bootstrap` 有可执行位。**SCF 控制台上传 zip 不会自动加**,必须本地 `chmod +x scf_bootstrap` 后再打 zip。

#### Node 大版本

`scf_bootstrap` 硬编码 `/var/lang/node18/bin/node`。腾讯云若升级 Node 大版本镜像需同步修改。当前运行时选 **Nodejs18.15**。

#### API 网关缓冲破坏流式

部分 API 网关版本会缓冲 SSE 响应,导致"一次性吐出"而非逐 token。已在响应头设 `X-Accel-Buffering: no` + `Content-Encoding: identity`,但若仍发现流式异常,改走 **CloudBase Web 触发器**(通道 ①)或直连 SCF 内网。

#### InstanceConcurrency 字段兼容性

`UpdateFunctionConfiguration` 的 `InstanceConcurrentConfig.MaxConcurrency` 在部分区域/SDK 版本可能不被识别。**并发实例上限强烈建议在控制台手动确认设为 1**,不要只依赖 SDK 设置。

---

## 八、验证清单

部署并配置好通道后,按顺序验证:

```bash
# 1. 健康检查
curl https://<你的通道URL>/api/health
# 期望: {"success":true,"data":{"ok":true}}

# 2. 同步往返(POST 上传 / GET 拉取)
curl -X POST https://<你的通道URL>/api/sync \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test" \
  -d '{"userId":"test","characters":[{"name":"测试"}],"chats":[],"worldinfo":[],"presets":[],"version":1,"exportedAt":1700000000000}'

curl https://<你的通道URL>/api/sync/test

# 3. COS 预签名(/api/r2/presign)
curl -X POST https://<你的通道URL>/api/r2/presign \
  -H "Content-Type: application/json" \
  -d '{"key":"test.png","contentType":"image/png"}'
# 期望: {"success":true,"data":{"url":"https://...cos.../?sign=...","key":"test.png",...}}

# 4. 流式中转(/v1/chat/completions)
curl -N https://<你的通道URL>/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <你的 DeepSeek Key>" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}],"stream":true}'
# 期望: 逐 token 输出 data: {"choices":[{"delta":{"content":"..."}}]}

# 5. 方案二自改(/api/admin/set-timeout)
curl -X POST https://<你的通道URL>/api/admin/set-timeout \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: <你的 ADMIN_TOKEN>" \
  -d '{"timeout":60,"memorySize":128}'
# 期望: {"success":true,"data":{"Timeout":60,"MemorySize":128,...}}
```

全部通过后,在手机/微信打开前端,填好 `apiBaseUrl` = 通道 URL,`backend = tencent`,即可开始角色扮演。

---

## 路由清单(完整对照)

| 方法 | 路径 | 说明 | 鉴权 | 实现文件 |
|------|------|------|------|---------|
| GET | `/api/health` | 健康检查 | 无 | `routes/health.js` |
| POST | `/api/sync` | 上传同步负载(可 Base64 混淆) | 无(userId 分区) | `routes/sync.js` |
| GET | `/api/sync/:userId` | 拉取同步负载(空负载=未同步) | 无 | `routes/sync.js` |
| POST | `/api/r2/presign` | 生成 COS 预签名 PUT URL(前端直传) | 无 | `routes/r2.js` |
| POST | `/v1/chat/completions` | OpenAI 兼容流式中转(SSE) | Authorization 透传 | `routes/completions.js` |
| POST | `/api/admin/set-timeout` | 方案二:Token 自改超时/内存 | `X-Admin-Token` | `routes/admin.js` |

---

下一篇:[计费测算与选型](./cost.md) · [架构说明](./architecture.md) · [Cloudflare 部署](./deploy-cloudflare.md)

License: AGPL-3.0-only · minist contributors
