# @minist/scf-tencent

minist 腾讯云 SCF **Web 函数**后端——极薄 Serverless,独立打包上传到用户自己的腾讯云账号,免备案部署。

- 运行时:Node.js 18+(CommonJS,express)
- 职责:OpenAI 兼容流式中转、COS 同步备份、人物卡直传预签名、方案二自改配置
- 目标:个人/熟人低频使用,**月成本 < 2 元**

> 这是 SillyTavern 酒馆裁剪移植的极薄后端。前端 SPA 是主存储(IndexedDB),SCF 仅做中转与备份。

---

## 目录

- [一、架构与约束](#一架构与约束)
- [二、资源准备清单](#二资源准备清单)
- [三、部署(两种方式)](#三部署两种方式)
- [四、免备案访问通道(二选一)](#四免备案访问通道二选一)
- [五、防爆产清单](#五防爆产清单)
- [六、响应流量计费警告(必读)](#六响应流量计费警告必读)
- [七、路由清单](#七路由清单)
- [八、本地开发](#八本地开发)
- [九、CAM 方案一 vs 方案二边界](#九cam-方案一-vs-方案二边界)
- [十、TODO 与已知边界](#十todo-与已知边界)

---

## 一、架构与约束

```
手机/微信浏览器  ──HTTPS──►  SCF Web 函数 (本包)
                              ├── /v1/chat/completions ──流式中转──► DeepSeek / OpenAI 兼容上游
                              ├── /api/sync             ──► COS 桶(用户自己的)
                              ├── /api/r2/presign       ──► COS 预签名(前端直传)
                              └── /api/admin/set-timeout ──► SCF 自己改自己(方案二)
```

**自包含约束**:本包会被打包成 zip 上传到用户的腾讯云账号,运行在云函数里。因此:

- **必须 CommonJS**(`require`/`module.exports`),不能依赖 monorepo 的 `@minist/shared`(ESM 边界 + 独立部署)。
- `src/constants.js` 是从 `@minist/shared` 复制的等价常量,**契约变更必须两边同步**(文件头已标注)。
- 依赖在打包前 `npm install --production` 装进 zip,与源码一起上传。

**安全红线**:SCF 运行时自动注入临时凭证(`TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN`),有效期随函数生命周期。**绝不硬编码持久 SecretKey**。COS、SCF SDK 全部走临时凭证。

---

## 二、资源准备清单

部署前在腾讯云控制台准备:

| 资源 | 说明 | 备注 |
|---|---|---|
| **SCF 函数** | Web 类型,Nodejs18.15,128MB,超时 60s | 区域与 COS 一致 |
| **COS 桶** | 同地域,命名 `<自定义>-<APPID>` | 用户自己的桶,成本转嫁 |
| **环境变量** | `ADMIN_TOKEN` / `COS_BUCKET` / `COS_REGION` / `LLM_PROXY_URL` | 见 `.env.example` |

**环境变量取值**:

```
ADMIN_TOKEN=<openssl rand -hex 32 生成的随机串>
COS_BUCKET=minist-backup-1250000000     # 你的桶名
COS_REGION=ap-guangzhou                  # 与桶地域一致
LLM_PROXY_URL=https://api.deepseek.com   # 上游,可换 OpenAI 兼容的任意服务
```

> SCF 还会自动注入 `TENCENTCLOUD_SECRETID/SECRETKEY/SESSIONTOKEN/FUNCTIONNAME/NAMESPACE/REGION`,**这些不需要配置**。

---

## 三、部署(两种方式)

### 方式 A:Serverless Framework 一键部署(推荐新手)

```bash
# 1. 安装 CLI
npm install -g serverless

# 2. 配置腾讯云 CAM 凭证(主账号或子账号,需 SCF/COS/API网关 权限)
serverless credentials set --provider tencent \
  --secretId <你的SecretId> --secretKey <你的SecretKey>

# 3. 在本目录填好环境变量(从本机 env 读,不会进仓库)
export ADMIN_TOKEN=$(openssl rand -hex 32)
export COS_BUCKET=minist-backup-1250000000
export COS_REGION=ap-guangzhou

# 4. 部署
cd packages/scf-tencent
sls deploy
```

部署成功后,CLI 会输出 API 网关触发器 URL(形如 `https://service-xxx.region.apigw...`)。

### 方式 B:打包 zip 手动上传(推荐熟手)

```bash
cd packages/scf-tencent

# 1. 装生产依赖(不装 devDependencies,减小体积)
npm install --production

# 2. 给启动文件加可执行位(SCF 不自动加)
chmod +x scf_bootstrap

# 3. 打 zip(排除 .env / 本地凭证)
zip -r minist-scf.zip . \
  -x ".env*" "*.git*" "node_modules/.cache/*" "*.zip"

# 4. 控制台上传
#    SCF 控制台 → 函数服务 → 新建函数 → 模板「Web 函数」→ 代码上传 zip
#    运行环境选 Nodejs18.15,内存 128MB,超时 60s
#    高级配置 → 环境变量 填 ADMIN_TOKEN/COS_BUCKET/COS_REGION/LLM_PROXY_URL
```

> 无论哪种方式,部署后都需要 **配置 Web 触发器** 才能获得可访问的 URL(见下一节)。

---

## 四、免备案访问通道(二选一)

> ⚠️ **关键现实**:SCF API 网关的三级域名(`service-xxx.region.apigw...`)在**微信内置浏览器 100% 被拦截**(未备案域名不在微信白名单)。必须走以下任一通道。

### 通道 ① CloudBase Web 触发器(推荐,自带白名单域名)

云开发 CloudBase 的「Web 静态托管」域名 `*.service.tcloudbase.com` 已被微信加入白名单,可直接在微信内打开。

**步骤**:

1. 开通腾讯云 CloudBase(云开发),创建环境。
2. 在 CloudBase 控制台「云函数」中导入已部署的 SCF 函数(或直接在 CloudBase 创建 Web 触发器指向同一函数)。
3. CloudBase 会给函数分配 `https://<envId>.service.tcloudbase.com/<path>` 形式的 HTTP 访问地址。
4. 前端 `apiBaseUrl` 填该地址。微信内访问不再被拦。

### 通道 ② Tailscale 内网(熟人间共享,无公网暴露)

手机与云函数所在 VPC 加入同一 Tailscale 网络,走加密内网隧道,微信无法拦截(流量是加密的 WireGuard,不可见明文域名)。

**步骤**:

1. SCF 函数所在的 VPC 配置 Tailscale(可通过 NAT 网关出网 + 在同 VPC 一台 CVM 上跑 Tailscale subnet router)。
2. 手机安装 Tailscale 客户端,登录同一 tailnet。
3. 前端 `apiBaseUrl` 填 SCF 内网 IP 或 Tailscale 分配的域名。
4. 适合个人/熟人小范围,不适合公开发放。

---

## 五、防爆产清单

个人低频使用,目标月成本 < 2 元。部署后逐一确认:

| 项 | 建议值 | 在哪设 |
|---|---|---|
| 内存 | **128 MB** | 函数配置 |
| 超时 | **60 s** | 函数配置(或方案二 `/api/admin/set-timeout`) |
| 最大并发实例 | **1** | 函数配置 → 实例并发 |
| 失败重试 | **关闭** | 函数配置 → 异步重试(关闭) |
| 异步执行 | **关闭** | 流式必须同步返回 |
| 余额预警 | **设 5 元** | 账户中心 → 费用告警 |
| SCF 免费额度 | 仅新用户前 3 个月 | 3 个月后按量计费 |

**方案二自改**:部署并配置好 `ADMIN_TOKEN` 后,调用一次:

```bash
curl -X POST https://<你的函数URL>/api/admin/set-timeout \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: <你的ADMIN_TOKEN>" \
  -d '{"timeout":60,"memorySize":128}'
```

这会让 SCF「自己改自己」,把防爆产配置固化,无需进控制台手点。返回 `success:true` 即生效。

---

## 六、响应流量计费警告(必读)

> ⚠️ **Web 函数的「响应流量」单独计费,不包含在免费额度/资源包内。**

流式聊天的 AI 输出正是响应流量——这是隐藏成本:

- 每次对话响应的字节数 × 单价,叠加在「资源量(内存×时间)」和「调用次数」之上。
- 长对话(几千 token 输出)单次响应可能几十 KB,频繁对话累积可观。

**本包的防扣费设计**(已写入 `src/routes/completions.js`):

```js
upstreamRes.data.on('end', () => {
  res.end();   // 主动结束,释放云函数实例,防空转累积运行时间
});
upstreamRes.data.pipe(res);
```

流结束即主动 `res.end()`,杜绝「数据已传完但实例仍存活被计时」的空转扣费。

**你的实操建议**:

- 不用时就闲置(零成本)。
- 流式优先于非流式(单次响应更短,总流量更可控)。
- 监控「响应流量」计费项,设阈值告警。

---

## 七、路由清单

所有路由返回统一信封 `{success, data?, error?, code?}`,错误一律 `success:false`。

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| GET | `/api/health` | 健康检查 | 无 |
| POST | `/api/sync` | 上传同步负载(body 可 Base64 混淆) | 无(userId 分区) |
| GET | `/api/sync/:userId` | 拉取同步负载(空负载=未同步) | 无 |
| POST | `/api/r2/presign` | 生成 COS 预签名 PUT URL(前端直传) | 无 |
| POST | `/v1/chat/completions` | OpenAI 兼容流式中转(SSE) | Authorization 透传 |
| POST | `/api/admin/set-timeout` | 方案二:Token 自改超时/内存 | `X-Admin-Token` |

**请求头协议**(与 `@minist/shared` 一致):

- `X-Crypto-Data: true` — body 为 Base64 混淆后的密文(免备案防明文审查)。
- `X-Admin-Token: <token>` — 方案二鉴权。
- `X-User-Id: <id>` — 同步分区键(也可在 body.userId 提供)。
- `Authorization: Bearer <key>` — 透传给上游 LLM。

---

## 八、本地开发

```bash
cd packages/scf-tencent

# 安装依赖(在 monorepo 根 npm install 会自动 hoist;独立调试可在此目录装)
npm install

# 填本地环境变量
cp .env.example .env
# 编辑 .env,至少填 COS_BUCKET(可填测试桶)

# 启动(默认 9000,与 SCF 一致;可用 PORT 覆盖)
PORT=9000 npm run dev
```

快速验证:

```bash
# 健康检查
curl http://localhost:9000/api/health
# 期望: {"success":true,"data":{"ok":true}}

# 同步往返(未配 COS 会返回明确错误,验证错误信封)
curl -X POST http://localhost:9000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","characters":[]}'

curl http://localhost:9000/api/sync/test

# 预签名
curl -X POST http://localhost:9000/api/r2/presign \
  -H "Content-Type: application/json" \
  -d '{"key":"test.png"}'

# 流式中转(需真实 LLM Key)
curl -N http://localhost:9000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <你的DeepSeek Key>" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"你好"}],"stream":true}'
```

---

## 九、CAM 方案一 vs 方案二边界

minist 腾讯云部署有两种授权模型,**本包仅实现方案二**。

| 维度 | 方案一 CAM 跨账号授权 | 方案二 Token 自改(本包) |
|---|---|---|
| 目标用户 | 通过 minist 平台代用户配置 | 个人/熟人自部署 |
| 凭证流转 | 用户在平台授权码 → 平台用 STS 代配置 | 用户自己的子账号 CAM 凭证 |
| 路由 | `/api/grant-config`(本包**未实现**) | `/api/admin/set-timeout` ✅ |
| 复杂度 | 高(需 CAM 角色、信任策略、STS) | 低(运行时临时凭证「自己改自己」) |
| 免备案 | 与平台域名绑定 | 与 CloudBase/Tailscale 通道绑定 |
| 适用 | 公开发放、陌生人 | 个人/熟人、低频 |

**方案二的精髓**:SCF 运行时注入的临时凭证天然具备「修改本函数配置」的权限(继承函数所属账号的 CAM),所以函数能调用 `UpdateFunctionConfiguration` 改自己——无需额外 CAM 配置。这是个人自部署最省事的路径。

> 方案一(grant-config)由 minist 部署平台 `apps/platform` 实现,不在本 SCF 包职责内。

---

## 十、TODO 与已知边界

- **方案一 `/api/grant-config`**:未在本包实现,由部署平台包负责。
- **并发实例上限**:SCF 的 `InstanceConcurrency` 通过 SDK `UpdateFunctionConfiguration` 设置在部分区域/SDK 版本可能不被识别;并发实例上限强烈建议在**控制台手动确认设为 1**(SDK 字段为 `InstanceConcurrentConfig.MaxConcurrency`,已在 admin.js 尽力透传)。
- **SCF Node 路径**:`scf_bootstrap` 硬编码 `/var/lang/node18/bin/node`,若腾讯云升级 Node 大版本镜像需同步修改。
- **API 网关缓冲**:已在 SSE 响应头设 `X-Accel-Buffering: no`,但部分 API 网关版本仍可能缓冲;若发现流式「一次性吐出」,改走 CloudBase Web 触发器或直连 SCF 内网。
- **跨域预检**:`Access-Control-Allow-Origin: *` 与 `Authorization` 头的组合在严格浏览器下可能需要 `Access-Control-Allow-Credentials`,当前未启用 credentials(用 `*` 即可,API Key 走 Authorization 头而非 Cookie)。
- **错误日志**:生产建议在 SCF 控制台开启日志投递到 CLS,排查流式中断。
- **与 `@minist/shared` 同步**:`src/constants.js` 是契约复制件,任何路由/头/版本号变更必须两边同时改,文件头已标注。

---

License: AGPL-3.0-only · minist contributors
