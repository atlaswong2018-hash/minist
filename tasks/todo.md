# minist 实施进度(todo)

> 计划全文见 `../home/claude/.claude/plans/declarative-churning-pelican.md`
> 首期交付口径:全模块纵向贯通 MVP(端到端架构跑通,非功能满血)。

## Phase 0 — 脚手架 + shared 契约包
- [x] 重建 minist 目录属主(claude)
- [x] 根 package.json(npm workspaces,@minist scope)
- [x] .gitignore / .editorconfig / .npmrc / tsconfig.base.json
- [x] LICENSE(AGPL-3.0 全文)/ CONTRIBUTING.md
- [x] packages/shared:types / routes / crypto / api / index
- [ ] npm install 联调 + shared typecheck 通过

## Phase 1 — 地基与后端(子代理并行)
- [ ] packages/core:人物卡 PNG 解析(V2/V3)+ 世界书 + Prompt 构建
- [ ] packages/worker-cloudflare:CORS/KV/D1/R2/流式中转/CAM 中转 + wrangler.toml
- [ ] packages/scf-tencent:express/COS/流式 pipe/Token 自改 + serverless 配置

## Phase 2 — 前端(子代理)
- [ ] apps/tavern:Vue3 聊天/流式/人物卡/世界书/设置/适配层/移动微信专项/PWA
- [ ] apps/platform:首页/CF 向导/腾讯 CAM 向导/Token 向导/配置面板/同步中心/AI 助手
- [ ] packages/deploy-agent:prompt + 避坑知识库

## Phase 3 — 文档 / 示例 / 验证 / git
- [ ] README.md(中英要点 + 架构图 + 快速开始 + 部署入口)
- [ ] docs/architecture.md(裁剪对照表 + 数据流 + 本地优先存储)
- [ ] docs/deploy-cloudflare.md(资源清单 + 入口 + 一键脚本 + 避坑)
- [ ] docs/deploy-tencent.md(资源清单 + CAM 流程 + 入口 + 免备案通道 + 避坑)
- [ ] docs/cost.md(两平台真实计费测算)
- [ ] examples:示例人物卡 + 世界书
- [ ] CHANGELOG.md / .github 模板
- [ ] 验证:build 全绿 / core 解析自测 / worker+scf 本地 curl / 前端 dev 跑通
- [ ] git:init + 约定式提交 + v0.1.0 tag

## Review(完成后填写)
(待验证阶段填写:实际验证结果、已知边界、后续路线)
