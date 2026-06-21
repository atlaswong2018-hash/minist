# 安全策略(Security Policy)

minist 是一个本地优先的 AI 聊天前端 + 极薄 Serverless 后端中转。本文件说明已知安全
边界与漏洞上报流程。

## 上报漏洞

**请不要在公开 Issue 中提交安全漏洞。** 请私下联系仓库维护者(优先开一个标题带
`[security]` 的私有 Security Advisory:GitHub 仓库 → Security → Report a vulnerability)。

上报时请尽可能包含:复现步骤、影响范围、最小化 PoC、你期望的披露时间。我们会在合理
时间内回复并协调修复与披露。

## 安全边界(使用前必读)

- **API Key 仅存本地**:LLM 的 API Key 存在你浏览器的 IndexedDB,通过 `Authorization`
  头经 HTTPS 透传给后端中转;后端**不记录、不落盘** Key。
- **`X-Crypto-Data` 是混淆,不是加密**:它用 Base64(可选 XOR)把手机↔后端之间的聊天
  明文变为"乱码",目的是降低免备案网络下的明文审查/关键词拦截概率,**不能防御主动
  攻击者**。真正的机密性依赖 HTTPS。
- **腾讯云 `tencentcloud-sdk-nodejs` / CF Worker 临时凭证**:方案一 CAM 走跨账号临时
  凭证(STS),不暴露主账号 SecretKey;方案二用 SCF 运行时注入的临时凭证。**任何
  SecretKey/Token 都不要写进代码或提交进仓库**(已在 `.gitignore` 排除 `.env*`、
  `.dev.vars`)。
- **人物卡来源**:从外部导入的 PNG/JSON 人物卡可能包含任意 prompt,请只导入可信来源。
- **后端 CORS**:默认 `Access-Control-Allow-Origin: *`,适合个人/演示。若对外公开部署,
  请在 Worker/SCF 中收紧为你的域名。

## 已知不提供的安全保证

- minist 不对 LLM 生成的内容负责,不内置审核;对外公开服务须自行完成合规与内容审核。
- 免备案的 Base64 混淆不构成传输加密。

## 范围外的上报

- 第三方依赖的已知 CVE(请走依赖更新,我们启用 Dependabot)。
- 上游 SillyTavern 的问题(请报至其仓库)。
