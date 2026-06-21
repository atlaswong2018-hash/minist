# 发布到 GitHub(Publishing)

本文件记录把 minist 发布为公开 GitHub 仓库的步骤。仓库本身已 push-ready(完整提交历史 +
`v0.1.0` 标签 + 全部社区标准文件)。

> 前置:本机已装 `git`;推荐装 [GitHub CLI (`gh`)](https://cli.github.com/) 并 `gh auth login`。
> 仓库路径下所有 `minist-tavern/minist` 字样为占位,若你用别的路径,推送前可全局替换。

## 0. 确认本地仓库就绪

```bash
cd /path/to/minist            # 你的 minist 目录
git status                    # 应:nothing to commit, working tree clean
git log --oneline             # 应看到 6 条提交
git tag                       # 应看到 v0.1.0
```

## 1. 推荐的仓库元数据

| 项 | 值 |
|---|---|
| 仓库名 | `minist`(组织下可用 `minist-tavern/minist`) |
| 描述 | 免备案 Serverless 酒馆(SillyTavern)裁剪移植 + 一键部署平台 — Cloudflare/腾讯云 SCF,适配手机与微信 |
| Topics | `sillytavern` `character-card` `cloudflare-workers` `tencent-scf` `serverless` `llm-chat` `vue3` `pwa` `roleplay` `agnai` |
| 协议 | AGPL-3.0(已含 LICENSE) |
| 默认分支 | `main` |

## 2A. 方法一:`gh` CLI(推荐,一条命令建仓+推送)

> 把下面的 `OWNER` 换成你的 GitHub 用户名或组织名。

```bash
# 建公开仓库 + 加 remote + 推送 main
gh repo create OWNER/minist --public \
  --description "免备案 Serverless 酒馆(SillyTavern)裁剪移植 + 一键部署平台 — Cloudflare/腾讯云 SCF,适配手机与微信" \
  --source . --remote origin --push

# 推送标签(v0.1.0)
git push origin --tags

# 设置 topics
gh repo edit OWNER/minist --add-topic sillytavern,character-card,cloudflare-workers,tencent-scf,serverless,llm-chat,vue3,pwa,roleplay,agnai

# 创建 v0.1.0 Release
gh release create v0.1.0 --title "v0.1.0 — 首个可用 MVP" \
  --notes "$(sed -n '/## \[0.1.0\]/,/## /p' CHANGELOG.md | sed '$d')"
```

## 2B. 方法二:纯 git(无 gh)

1. 在 https://github.com/new 新建**空**仓库 `OWNER/minist`:
   - **不要**勾选 "Add a README" / "Add .gitignore" / "Choose a license"(本仓库已自带,勾了会冲突)。
2. 推送:

```bash
git remote add origin git@github.com:OWNER/minist.git   # SSH;或 https://github.com/OWNER/minist.git
git push -u origin main
git push origin --tags
```

3. 在网页补元数据:
   - About(右上齿轮)→ 填 description + topics。
   - Releases → Draft a new release → 选已有 tag `v0.1.0` → 标题 `v0.1.0 — 首个可用 MVP` → 从 `CHANGELOG.md` 粘贴 `[0.1.0]` 段作为说明。

## 3. 推送后的仓库配置

- **Actions**:首次 push 会自动跑 CI(`build` + `integration` 两 job),在 Actions 页查看。`integration` job 会端到端验证三条部署方案。
- **分支保护**(Settings → Branches → main):
  - Require status checks to pass:`build`、`integration`(需先跑过一次才能选)。
  - Require pull request reviews before merging(可选)。
- **Issues / Discussions**:Settings → Features 按需开启(Issue 模板已就绪)。
- **Security**:Settings → Code security → 开启 Dependabot(`.github/dependabot.yml` 已配)、Secret scanning(若可用)。

## 4.(可选)把案例部署平台发布到 GitHub Pages

`apps/platform`(案例部署平台)是纯静态站,可托管到 GitHub Pages,作为项目"案例网站":

```bash
# 临时本地构建验证
npm run build --workspace @minist/platform
```

新增 `.github/workflows/pages.yml`(如需要可由维护者添加)构建 `apps/platform` 并部署到 Pages,
即可得到 `https://OWNER.github.io/minist/` 形态的在线案例站。酒馆前端 `apps/tavern` 同理。

## 5. 替换占位仓库路径(可选)

仓库内若干链接引用了占位组织 `minist-tavern/minist`(`package.json`、`README.md`、
`CHANGELOG.md`、`CONTRIBUTING.md`)。若你用了别的路径,推送前替换:

```bash
# 例:替换为 yourname/minist(注意这会改写工作区,需重新提交)
git ls-files | xargs sed -i 's#minist-tavern/minist#yourname/minist#g'
git commit -am "chore: 更新仓库链接为 yourname/minist"
```
