# @minist/deploy-agent

minist AI 部署助手:系统 prompt + 结构化避坑知识库 + 关键词检索 + OpenAI 兼容消息组装。

> AGPL-3.0-only。这是 minist 案例部署平台(apps/platform)的 AI 排障后端逻辑层。

## 职责

把"用户描述部署报错"转成"系统 prompt + 检索到的知识片段 + 用户问题"的 OpenAI 兼容 messages,
让平台前端直接喂给用户自填的 LLM(Base URL / Key / Model)。**本包不直接调网络**——网络由 platform 注入(fetch 适配器钩子),保持纯逻辑可测。

## 结构

```
src/
├── prompts.ts      系统 prompt(中英),角色=资深 Serverless 部署运维
├── knowledge.ts    结构化避坑知识库(KNOWLEDGE: KnowledgeEntry[],15+ 条)
├── retrieve.ts     retrieve(query, topK=5) 关键词命中数检索(纯 TS,无向量)
└── index.ts        barrel + buildAssistantMessages() + askAssistantStream 钩子
```

## 知识库覆盖(15 条)

### Cloudflare(5)
- `cf-kv-write-limit` — KV 每日写入仅 1,000 次,最紧瓶颈(critical)
- `cf-r2-no-egress` — R2 无出流量费,图片放 R2(medium)
- `cf-default-domain-blocked` — *.workers.dev / *.pages.dev 国内部分地区/微信被墙(high)
- `cf-crypto-obfuscation` — X-Crypto-Data Base64 混淆规避明文审查(medium)
- `cf-cpu-10ms` — Workers CPU 10ms,但网络等待不计入(low)

### 腾讯云(7)
- `tencent-response-traffic-billing` — Web 函数响应流量单独计费不含免费额度(critical)
- `tencent-scf-timeout-idle-billing` — 超时过高空转扣费(high)
- `tencent-wechat-default-domain-blocked` — 默认三级域名微信内 100% 被拦截(high)
- `tencent-cloudbase-whitelist` — CloudBase Web 触发器域名在微信白名单(medium)
- `tencent-tailscale-intranet` — Tailscale 内网加密隧道(medium)
- `tencent-cam-cross-account` — CAM 跨账号角色授权 STS 中转(high)
- `tencent-cos-presigned-upload` — Presigned URL 直传成本转嫁(medium)
- `tencent-free-tier-3-months` — 免费额度仅新用户前 3 个月(medium)

### 通用(3)
- `common-cors` — CORS 跨域处理(medium)
- `common-sse-reconnect` — SSE 流式断连重连(medium)
- `common-indexeddb-quota` — IndexedDB 满配额 + 100% 本地化 PWA 兜底(low)
- `common-character-png-parse` — 人物卡 PNG 解析(tEXt/iTXt chara 字段)(medium)

## 用法

```ts
import { buildAssistantMessages, askAssistantStream } from '@minist/deploy-agent';

// 1. 组装 messages(自动检索知识库)
const { messages, retrieved } = buildAssistantMessages(
  '微信里打开我的腾讯云函数链接提示已停止访问怎么办',
  { platform: 'tencent', topK: 5 }
);
console.log('命中的知识条目:', retrieved.map(e => e.id));
// → ['tencent-wechat-default-domain-blocked', 'tencent-cloudbase-whitelist', ...]

// 2. 调用用户自填的 LLM(由 platform 注入 fetch)
await askAssistantStream(
  (body) => fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ ...body, model }),
  }),
  messages,
  (token) => appendToUi(token),
  (chunk) => console.log('done', chunk),
);
```

## 检索原理

纯关键词命中数排序,无向量依赖(部署排障问题关键词集中在"kv/超时/微信/计费",召回足够):

1. `tokenize(query)`:英文按空格/标点分词,中文按单字 + 2/3 字滑窗。
2. 对每条 entry,计算 tokens 命中其 keywords 的数量(精确命中 +1,子串命中 +0.5)。
3. 按分数降序,同分按 severity(critical > high > medium > low)排序,取 top-K。

## 数据来源

所有计费数字、阈值、行为均来自已核实的官方文档与社区实测:
- Cloudflare Workers / KV / D1 / R2 计费文档
- 腾讯云 SCF / API 网关 / CloudBase 计费文档
- 微信内置浏览器域名白名单实测(CloudBase 白名单内,SCF 默认域名不在)

更新计费规则时,优先改 `knowledge.ts` 对应条目,保持单一事实来源。

## License

AGPL-3.0-only
