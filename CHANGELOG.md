# Changelog

本仓库所有重要变更记录于此。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### 已完成 — 端到端联调(三条部署方案全绿)
- 新增 `integration/` 集成联调 harness:mock LLM(SSE)+ mock 腾讯云 API(自签 HTTPS)+ 真实 CF Worker(wrangler dev)/ 腾讯云 SCF,在没有真实云凭证下端到端跑通。
- `tc3-verify.mjs` 用独立 Node `crypto` 反向验证 TC3-HMAC-SHA256;**方案一 strict 验签通过**,证明 Worker `signTc3`(Web Crypto 实现)对主密钥(STS)与临时密钥(SCF)签名均正确,临时凭证链路无误。
- 联调发现并修复的真实 bug:
  - 平台↔SCF 字段名不匹配(发 `memory`/`concurrency`、读 `memorySize`/`instanceConcurrency`)→ 内存/并发配置静默失效,已对齐。
  - 腾讯 SDK `endpoint` 只接受主机名(协议由 `httpProfile.protocol` 控制)→ `SCF_API_ENDPOINT` 现拆分 `scheme://host`。
  - Worker 腾讯 API base 不可覆写 → `grant.ts` 新增 `TENCENT_API_BASE` env(也利于 staging)。
  - tavern↔Worker storage 路由不匹配(POST `/api/storage` vs 要求 `/api/storage/:key` 会 404)→ 已对齐,云端角色卡批量管理走 `sync`。

### 已完成 — 运营方跨账号批量管理(STS AssumeRole,安全合规)
- Worker 新增 `/api/admin/batch-scf` 路由(`OPERATOR_TOKEN` 鉴权)+ `src/tencent.ts`(`assumeRole` / `scfListFunctions` / `scfUpdateConfig`,统一 TC3-HMAC-SHA256 签名)。
- 正确姿势:客户在其 CAM 建跨账号角色给运营方扮演,只提供 uin + 角色名(**绝不收集 SecretKey**);运营方主账号密钥 STS `AssumeRole` 换临时凭证,再批量 list / 自锁配置对方云函数。可吊销。
- 平台新增「批量管理」面板:录入客户账号、选操作(列出函数 / 批量自锁 Timeout=60/MemorySize=128)、逐账号展示结果。
- 集成测试 `run-batch.mjs`:strict 验签 AssumeRole(主密钥/sts)+ ListFunctions(临时密钥/scf)+ 临时凭证链路 + 全量自锁,全绿。
- 文档 `docs/batch-manage.md`:客户侧 CAM 授权步骤 + 运营方 API + 安全/子请求预算。

### 已完成 — COS XML API v5 改造 + 客户授权指引
- Worker 新增 `src/cos-sign.ts`(COS v5 HMAC-SHA1 签名,Web Crypto)+ `cosPutBucket`;`grant.ts` 的 `createCosBucket` 从 **TC3 占位改为正确的 COS XML PutBucket + cos v5 签名**(env 加 `COS_API_BASE` 联调覆写)。
- 集成测试 `cos-sign-verify.mjs`(独立 Node crypto COS v5 实现)+ CAM 场景新增 COS PutBucket **strict 验签**断言(两套独立实现交叉验证,全绿)。
- 平台「批量管理」加「📋 生成给客户的授权指引」(可复制纯文本,插值运营方 UIN + 角色名);配置页加「运营方主账号 ID(UIN)」字段。

### 计划中
- 精确 tokenizer(替换启发式 token 估算)
- 人物卡可视化编辑器
- 完整组队聊天(Group Chat)自动轮询(降级版现为手动触发)
- 向量检索增强的 AI 部署助手
- EdgeOne 方案文档与脚本

## [0.1.0] - 2026-06-21

### 🎉 首个可用版本(MVP,全模块纵向贯通)

#### 新增 — 架构与契约
- `@minist/shared`:全栈共享契约(路由常量 / `X-Crypto-Data` 加密协议 / `TavernConfig` `SyncPayload` 类型 / API 信封 / SSE 解析 / UTF-8 安全 Base64)。
- npm workspaces monorepo 脚手架、根 tsconfig、`.gitignore`、AGPL-3.0 LICENSE、CONTRIBUTING。

#### 新增 — 核心逻辑 `@minist/core`
- 人物卡 **V2/V3** 解析:纯浏览器 PNG `tEXt` chunk 解析器(`chara` / `ccv3`,`ccv3` 优先),自包含 CRC32,写回 PNG 幂等。
- 卡片规范化(`normalizeCard`,V1→V2 提升)、校验。
- 世界书条目结构与基础激活(constant / key / selective / case_sensitive)。
- Prompt 构建(`buildMessages`)+ 启发式 token 估算 + 上下文裁剪。

#### 新增 — 后端
- `@minist/worker-cloudflare`:CF Worker —— KV(`/api/storage`)/ D1(`/api/chat`)/ R2(`/api/r2`)、`/api/sync`、`/v1/chat/completions` 流式透传(请求侧 Base64 解混淆)、`/api/grant-config`(CAM 中转 + TC3-HMAC-SHA256 签名)、`/api/cf-setup`(CF REST 建资源)、`wrangler.toml`。
- `@minist/scf-tencent`:腾讯云 SCF Web 函数(CommonJS)—— COS 同步、COS Presigned URL 直传、流式 `axios`→`pipe`+`on('end')` 主动释放防扣费、`/api/admin/set-timeout`(方案二 Token 自改,`UpdateFunctionConfiguration` 自锁 60s/128MB)、`serverless.yml`、`scf_bootstrap`。

#### 新增 — 前端
- `@minist/tavern`:Vue3 + Pinia 酒馆 SPA —— 聊天/流式打字机/中断/重取、人物卡触控导入、世界书管理、设置(后端切换/crypto/温度)、IndexedDB 本地存储 + 导出/恢复/清空、后端适配层(Local/Cloudflare/Tencent)、PWA、移动/微信专项(独立发送按钮、防缩放、hash 文件名、`visibilitychange` 重连、安全区)。
- `@minist/platform`:案例部署平台 —— 首页资源清单、CF 向导、腾讯 CAM 向导(方案一)+ Token 自改向导(方案二)、配置面板、角色卡/世界书同步中心、AI 部署助手。
- `@minist/deploy-agent`:系统 prompt + 15 条结构化避坑知识库 + 关键词检索。

#### 新增 — 文档与示例
- `README.md`、`docs/architecture.md`、`docs/deploy-cloudflare.md`、`docs/deploy-tencent.md`、`docs/cost.md`。
- `examples/`:示例人物卡(`sample-xiaoman.json`,V2)+ 示例世界书。
- GitHub CI(typecheck + build)、Issue/PR 模板。

### ⚠️ 已知边界
- CAM 跨账号授权(方案一)代码完整,需真实腾讯云凭证端到端验证;方案二(Token 自改)可即时自测。
- CF `/api/cf-setup`、CAM STS 中转需对应平台真实 API Token 验证。
- 前端为精简实现,非 SillyTavern 功能满血;token 计数为启发式。

[Unreleased]: https://github.com/atlaswong2018-hash/minist/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/atlaswong2018-hash/minist/releases/tag/v0.1.0
