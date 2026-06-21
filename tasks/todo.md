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
- 推送到 GitHub:在 GitHub 新建空仓库 `minist-tavern/minist`,然后:
  `git remote add origin git@github.com:minist-tavern/minist.git && git push -u origin main --tags`
- git 作者目前为占位(`minist <minist@users.noreply.github.com>`),可在推送前 `git config user.name/user.email` 重新设置并 `git commit --amend --reset-author`(尚未推送,可安全改写)。
- 案例部署平台(`apps/platform`)构建产物可托管到 CF Pages / Vercel / GitHub Pages;酒馆前端同理。

### 后续路线
精确 tokenizer / 人物卡可视化编辑器 / 完整组队聊天 / 向量检索 AI 助手 / EdgeOne 方案 / 真实云凭证联调与 e2e 测试。
