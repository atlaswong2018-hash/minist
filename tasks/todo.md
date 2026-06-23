# minist 实施进度(todo)

> 计划全文见 `/home/claude/.claude/plans/declarative-churning-pelican.md`
> 首期交付口径:全模块纵向贯通 MVP(端到端架构跑通,非功能满血)。

## Phase 0 — 脚手架 + shared 契约包
- [x] 重建 minist 目录属主(claude)
- [x] 根 package.json(npm workspaces,@minist scope)
- [x] .gitignore / .editorconfig / .npmrc / tsconfig.base.json
- [x] LICENSE(AGPL-3.0 全文)/ CONTRIBUTING.md
- [x] packages/shared:types / routes / crypto / api / index
- [x] npm install 联调 + shared typecheck 通过

## Phase 1 — 地基与后端(子代理并行)
- [x] packages/core:人物卡 PNG 解析(V2/V3)+ 世界书 + Prompt 构建
- [x] packages/worker-cloudflare:CORS/KV/D1/R2/流式中转/CAM 中转 + wrangler.toml
- [x] packages/scf-tencent:express/COS/流式 pipe/Token 自改 + serverless 配置

## Phase 2 — 前端(子代理)
- [x] apps/tavern:Vue3 聊天/流式/人物卡/世界书/设置/适配层/移动微信专项/PWA
- [x] apps/platform:首页/CF 向导/腾讯 CAM 向导/Token 向导/配置面板/同步中心/AI 助手
- [x] packages/deploy-agent:prompt + 15 条避坑知识库

## Phase 3 — 文档 / 示例 / 验证 / git
- [x] README.md(中英要点 + 架构图 + 快速开始 + 部署入口)
- [x] docs/architecture.md(裁剪对照表 + 数据流 + 本地优先存储)
- [x] docs/deploy-cloudflare.md(资源清单 + 入口 + 一键脚本 + 避坑)
- [x] docs/deploy-tencent.md(资源清单 + CAM 流程 + 入口 + 免备案通道 + 避坑)
- [x] docs/cost.md(两平台真实计费测算)
- [x] examples:示例人物卡 + 世界书 + README
- [x] CHANGELOG.md / .github(CI + Issue/PR 模板)
- [x] 验证:全量 typecheck + build 通过 / SCF 本地启动+健康检查实测 / tavern 44KB、platform 53KB gzip
- [x] git:init + 约定式提交(9c32ce5)+ v0.1.0 tag

## Review(完成总结)

### 实际验证结果(全部通过)
- **类型检查**:`npm run typecheck` —— 6 个 TS 包(shared/core/worker-cf/tavern/platform/deploy-agent)零错误。修复 2 类问题:tavern tsconfig 的 references+composite+noEmit 冲突(改为单 tsconfig + 根级 @types/node);适配层 chat 方法的双重 Promise 包装 + 子类字面量覆写 + 信封窄化。
- **构建**:`npm run build` 全量退出码 0。tavern 87 模块(44KB gzip)、platform 39 模块(53KB gzip)、core/shared/deploy-agent tsc 通过。
- **运行时**:腾讯云 SCF 实测——`node src/index.js` 监听 9000,`/api/health` 返回 `{"success":true,"data":{"ok":true}}`,CORS 预检 200,404 兜底信封正确,流式 pipe + on('end') 由子代理验证。
- **人物卡**:CRC32 与 zlib 一致 + 标准向量,PNG 写→读往返无损(子代理验证)。
- **git**:仓库初始化、首次约定式提交、v0.1.0 标签,工作树干净,node_modules/dist 已排除。

### 已知边界(需真实云凭证端到端验证)
- CAM 跨账号授权(腾讯方案一):前端跳转构造 + Worker 中转(code→STS→UpdateFunctionConfiguration + 建 COS 桶)代码完整,需真实腾讯云主账号 UIN + 回调地址验证。**方案二(Token 自改)可即时自测**。
- CF `/api/cf-setup`、CAM STS 签名调用需对应平台真实 API Token 验证。
- 前端为精简实现(非 SillyTavern 100% 功能对等);token 计数为启发式。
- PWA 图标(icon-192/512.png)为占位,manifest 已声明路径,需补图。

### 待用户操作(部署到 GitHub)
- 本环境无 `gh` CLI 与 GitHub 凭证,git 仓库仅完成本地初始化与提交。
- 推送到 GitHub:在 GitHub 新建空仓库 `atlaswong2018-hash/minist`,然后:
  `git remote add origin git@github.com:atlaswong2018-hash/minist.git && git push -u origin main --tags`
- git 作者目前为占位(`minist <minist@users.noreply.github.com>`),可在推送前 `git config user.name/user.email` 重新设置并 `git commit --amend --reset-author`(尚未推送,可安全改写)。
- 案例部署平台(`apps/platform`)构建产物可托管到 CF Pages / Vercel / GitHub Pages;酒馆前端同理。

### 后续路线
精确 tokenizer / 人物卡可视化编辑器 / 完整组队聊天 / 向量检索 AI 助手 / EdgeOne 方案 / 真实云凭证联调与 e2e 测试。

---

## 分层存储(大容量角色库 · 全库 20GB+)

> 起因:用户**全库**(角色卡 + 世界书 + 聊天)总量可达 20GB+,远超 IndexedDB 配额(几 GB·可回收)与 CF KV 单值(25MB)。腾讯云 sync 现为「整包单 COS 对象」(`minist_users/<uid>.json`),全库也会变单个巨型对象。
> 范式转变:**云对象存储(R2/COS)= 数据主存;IndexedDB = 有上限 LRU 缓存;KV/COS 元数据 = 轻量 JSON(无内嵌二进制)**。
> 双后端**各自实现**(CF:R2+KV+D1 / Tencent:COS),前端按 backend 路由,**不抽象统一**(用户答:「不同方案、各自存储」)。
>
> **已锁定参数**(用户确认):
> - 图片内嵌阈值 = **1MB**(≤1MB 内嵌离线可用,>1MB 外置到对象存储)
> - 双后端 **R2 + COS 同步实现、并重**(不分主次)
> - IndexedDB 缓存 = **动态预算**(`navigator.storage.estimate()` 可用额 ~30%,或按 `deviceMemory`:移动 ~300M / 桌面 ~1-2G)
> - **S5 大文件流式本轮纳入**(不推后)
> - 外置仅在 `backend = cloudflare/tencent` 可用;`local` 无对象存储,图片只能内嵌(受 IndexedDB 配额约束)。

### Phase S1 — 卡图片外置 + 内容寻址(基础,最大收益)✅
- [x] shared/types:新增 `AssetRef` 类型(imageRef 落在 `LocalCharacter` 而非 card spec,更贴合现有数据模型)
- [x] core:parseCardFile 解析后保留 image 原始 bytes(`ParseCardResult.imageBytes`)
- [x] tavern/store/characters.importFiles:image 字节数 >阈值(**1MB**)→ 上传对象存储(key=`cards/<sha256>.<ext>`)→ 卡存 imageRef、删内嵌 base64;≤1MB 仍内嵌;外置失败回退内嵌
- [x] tavern/composables/useAsset(新):按 imageRef 懒加载(会话 urlCache → IndexedDB 缓存 → 回源 GET)
- [x] tavern/components:新增 CharacterAvatar.vue,CharacterCard/CharacterList 头像统一走它(内嵌优先,回退外置懒加载)
- [x] CF `r2.ts`:**零改动**(已支持任意 key 的 PUT/GET/DELETE + CORS);CloudflareAdapter.uploadAsset/downloadAsset
- [x] Tencent:scf `r2.js` 新增 GET 下载路由(镜像 CF);TencentAdapter.uploadAsset(presign 直传 COS),downloadAsset 继承 CF
- [x] 验证:shared/core typecheck + tavern vue-tsc+vite build 全绿(95 模块);r2.js 语法 OK。**导入大图真机 e2e 待用户环境**(沙箱无浏览器/真实 R2/COS 凭证)

### Phase S2 — IndexedDB 缓存治理(防 20GB 崩浏览器)✅
- [x] idb.ts:assets store 已于 S1 建立;**动态预算** `getAssetBudget()`(storage.estimate ~30% / deviceMemory 分档 / 兜底 500MB,上下界 100MB~2GB)+ `enforceAssetBudget()` LRU 淘汰
- [x] useAsset:命中 touch lastUsed(getAsset 异步 touch);超预算按 lastUsed 升序淘汰最旧,被淘汰资源 revoke blob URL
- [x] 冷卡仅元数据常驻,二进制按需拉取缓存(S1 useAsset 已实现)
- [x] 验证:typecheck + build 全绿;**超量淘汰真机 e2e 待用户环境**

### Phase S3 — 元数据分片(全库膨胀,单对象超限)
- [ ] CF sync.ts:characters/worldinfo 从单值改为 per-card(`sync:uid:char:<id>`)+ 索引(`sync:uid:char-index`)
- [ ] CF sync:增量同步(仅变更卡),省 1000 写/天额度;前端按需拉单卡
- [ ] Tencent sync.js:从单 blob 改为 per-card 对象(`minist_users/<uid>/cards/<id>.json`)+ 索引对象
- [ ] SyncPayload 拆为「索引清单」;前端按需拉单卡元数据
- [ ] 验证:模拟 1000+ 卡,各 KV/COS 单对象 <25MB;增量同步只写变更

### Phase S4 — 同步瘦身 + 跨用户共享
- [ ] SyncPayload 只含元数据 + 引用清单(无二进制)
- [ ] 二进制按 sha256 全局共享(跨卡/跨用户同图只存一份)
- [ ] 同步体稳定在 KB~MB 级

### Phase S5 — 大文件流式(本轮纳入)
- [ ] 单文件 >阈值(100MB)Range 请求 + 进度条

### 约束 / 成本
- R2 免费档 10GB → 20GB+ 需付费($0.015/GB·月,egress 免费)或走 COS(按量,容量近无限)。
- 内容寻址(sha256)天然去重,省存储 + 省元数据写。
- 二进制走 HTTPS;免备案混淆对大文件不现实(图片本身不敏感),接受明文或后续分块加密。
