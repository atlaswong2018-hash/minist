# 贡献指南(Contributing)

感谢你有兴趣为 **minist(MiniTavern)** 贡献代码!本项目是 SillyTavern 的裁剪移植,
采用 **AGPL-3.0** 协议(衍生作品须保持同协议)。提交即表示你同意以 AGPL-3.0 授权你的贡献。

## 开发环境

- Node.js ≥ 18.18(推荐 20.x)
- npm ≥ 10(使用内置 workspaces,无需 pnpm)

```bash
git clone <repo-url> minist
cd minist
npm install            # 安装并链接所有 workspace 包
```

## 仓库结构

```
apps/        前端应用:tavern(酒馆)、platform(部署平台)
packages/    共享与后端:core、shared、worker-cloudflare、scf-tencent、deploy-agent
docs/        部署与架构文档
examples/    示例人物卡 / 世界书
```

`@minist/shared` 是全栈契约(路由 / 加密 / 类型)的单一事实来源;修改它 = 修改全栈契约。
腾讯云 `scf-tencent` 因独立打包部署,复制了等价常量,**改 shared 时须同步**。

## 常用脚本

```bash
npm run dev:tavern        # 启动酒馆前端
npm run dev:platform      # 启动部署平台
npm run dev:worker        # 本地 wrangler dev(CF Worker)
npm run dev:scf           # 本地起 SCF express(端口 9000)
npm run build             # 构建所有 workspace
npm run typecheck         # 全量类型检查
```

## 提交规范(Conventional Commits)

- `feat(scope):` 新功能,`fix(scope):` 修复,`docs:`, `refactor:`, `chore:`, `test:`
- scope 例:`tavern` / `platform` / `worker-cf` / `scf` / `core` / `shared` / `docs`
- 示例:`feat(core): 支持 character card V3 (ccv3) 优先解析`

## 分支策略

- `main`:稳定,可发布
- `dev`:集成
- 功能分支:`feat/<topic>`、`fix/<topic>`

## 裁剪移植原则(请勿偏离)

- **无 Node 后端**:酒馆必须可在纯静态托管 + Serverless 后端下运行
- **本地优先**:IndexedDB 是主存储,云端只做备份/同步
- **手机/微信友好**:触控上传、独立发送按钮、流式断线重连、IndexedDB 可清空/导出
- **免备案**:默认域名在微信内被拦截,方案须走 CF/Vercel/GitHub Pages + CloudBase/Tailscale 通道

## 行为准则

保持尊重、聚焦技术。NSFW/角色扮演是上游酒馆的合法使用场景,但**本仓库不收录任何具体 NSFW 内容**,
仅作为通用工具。Issue/PR 中的示例请使用 SFW 内容。
