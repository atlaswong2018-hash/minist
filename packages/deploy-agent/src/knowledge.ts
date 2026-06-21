/**
 * @minist/deploy-agent — 结构化避坑知识库
 *
 * 每条 entry = 一个已核实的部署坑点/最佳实践。
 * retrieve() 通过 keywords 命中数检索,纯 TS 无向量依赖。
 * 所有计费数字、阈值、行为均来自已核实的官方文档与社区实测(见 README 引用)。
 */

/** 知识条目平台归属。与 @minist/shared 的 DeployTarget 对齐 + common 通用类。 */
export type KnowledgePlatform = 'cloudflare' | 'tencent' | 'common';

/** 严重度。决定 UI 高亮与回答优先级。 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

/** 单条避坑知识。 */
export interface KnowledgeEntry {
  /** 稳定 id,前缀为平台缩写 + 短描述。用于回答中引用 [KB:id]。 */
  id: string;
  /** 一句话标题。 */
  title: string;
  /** 归属平台。 */
  platform: KnowledgePlatform;
  /** 检索关键词(小写),用于命中数排序。 */
  keywords: string[];
  /** 问题描述:坑点/症状。 */
  problem: string;
  /** 解决方案:可执行步骤。 */
  solution: string;
  /** 严重度。 */
  severity: Severity;
}

/**
 * 知识库主数据。新增条目请追加到末尾,保持 id 唯一。
 * 当前覆盖:15 条核心(CF 5 / 腾讯 7 / common 3)。
 */
export const KNOWLEDGE: KnowledgeEntry[] = [
  // ===== Cloudflare =====
  {
    id: 'cf-kv-write-limit',
    title: 'Cloudflare KV 每日写入仅 1,000 次,是最紧瓶颈',
    platform: 'cloudflare',
    keywords: ['kv', 'write', '写入', '限额', '限制', '1000', '瓶颈', '免费', '计费', 'rate limit', '频率'],
    problem:
      'Workers 免费版 KV 写入每天只有 1,000 次,读 100,000 次/天。聊天记录、世界书频繁写入会瞬间打爆配额,导致后续写入全部失败(返回 429/静默丢弃)。',
    solution:
      '1. 聊天记录放 D1(免费 10 万写/天,5GB 存储),不放 KV。\n2. KV 只存索引、配置、角色卡元数据等读多写少数据。\n3. 前端做写入节流:合并连续消息、本地 IndexedDB 先攒批再上报。\n4. 监控:Workers Analytics 看 KV writes/day,接近 1000 立即降频。\n5. 升级 Workers Paid($5/月)可放宽,但根因仍是设计分层。',
    severity: 'critical',
  },
  {
    id: 'cf-r2-no-egress',
    title: 'Cloudflare R2 无出流量费,图片应放 R2',
    platform: 'cloudflare',
    keywords: ['r2', '对象存储', '图片', 'png', '流量', '出流量', 'egress', '免费', '人物卡', '头像'],
    problem:
      '人物卡 PNG、头像等大文件若放普通对象存储(S3/阿里 OSS),每次加载都产生出流量费。高并发角色卡浏览时费用不可控。',
    solution:
      '1. 所有图片/二进制存 R2(R2 → 公网零出流量费,仅按存储量 + 操作次数计费)。\n2. 免费额度:10GB 存储 + 100 万次 Class A 操作/月 + 1000 万次 Class B 操作/月。\n3. 通过 Worker 代理 R2 对象(/api/r2/:key),Worker 读 R2 不算 egress。\n4. 角色卡 PNG 解析:Worker 用 Response.arrayBuffer() 读 R2,提取 tEXt/iTXt 块的 chara 字段。',
    severity: 'medium',
  },
  {
    id: 'cf-default-domain-blocked',
    title: 'CF 默认域名 *.workers.dev / *.pages.dev 国内部分地区与微信被墙',
    platform: 'cloudflare',
    keywords: ['workers.dev', 'pages.dev', '被墙', '无法访问', '微信', '国内', '域名', '备案', '封锁', 'gfw'],
    problem:
      'Cloudflare 默认提供的 *.workers.dev 与 *.pages.dev 子域,在中国大陆部分地区/运营商被 DNS 污染或 SNI 阻断,微信内置浏览器 100% 无法打开。用户反馈"部署成功但手机打不开"。',
    solution:
      '前端(SPA)部署到 Vercel 或 GitHub Pages(这两者国内可达性优于 workers.dev)。API 走 CF Worker,前端通过自定义域名或直接 fetch Worker URL。\n若要 Worker 也国内可达:绑定自有域名(CF DNS 接管)+ 开启 Cloudflare 的中国网络(企业版)或使用未被墙的 CF IP。\n终极兜底:启用 X-Crypto-Data Base64 混淆规避明文审查(见 cf-crypto-obfuscation)。',
    severity: 'high',
  },
  {
    id: 'cf-crypto-obfuscation',
    title: 'Worker 对 payload 做 Base64 混淆(X-Crypto-Data)规避明文审查',
    platform: 'cloudflare',
    keywords: ['xcrypto', 'crypto-data', '加密', '混淆', 'base64', '审查', '明文', '免备案', 'x-crypto-data'],
    problem:
      '明文 JSON 聊天内容经 CF 边缘节点转发时,可能被中间设备基于关键词阻断(尤其是含敏感词的角色扮演内容),表现为请求被重置或内容丢失。',
    solution:
      '1. 前端设置 TavernConfig.crypto = true,启用 X-Crypto-Data 协议。\n2. 请求/响应体先 Base64(可选再叠加一层对称加密),通过 X-Crypto-Data: true 头标识。\n3. Worker 端在 CORS_HEADERS 中已声明允许该头(@minist/shared)。\n4. 注意:这只是混淆不是真加密,防的是关键词审查而非攻击者;真正机密仍需端到端加密。',
    severity: 'medium',
  },
  {
    id: 'cf-cpu-10ms',
    title: 'Workers 免费 CPU 10ms/请求,但网络等待不计入',
    platform: 'cloudflare',
    keywords: ['cpu', '10ms', '超时', 'cpu时间', '免费', '流式', 'stream', '限制', 'wall time'],
    problem:
      '误解:以为流式 AI 输出(LLM 响应慢)会超 Workers CPU 限制。实际上 Workers 限的是 CPU 时间(实际执行 JS 的累计时间),不是 wall-clock 时间。等待 LLM 响应的网络 I/O 不占 CPU 时间。',
    solution:
      '1. 流式转发 LLM 响应完全可行:fetch() 流式 ReadableStream pipe 给 Response,等待 LLM 的时间不算 CPU。\n2. 真正占 CPU 的:JSON.parse 大对象、加密计算、大循环。保持 Worker 逻辑薄。\n3. 若 CPU 超 10ms(免费)/ 30s(Paid),返回错误。监控 Workers Analytics 的 CPU time p99。\n4. 升级 Paid($5/月)→ CPU 上限 30s,基本无瓶颈。',
    severity: 'low',
  },

  // ===== 腾讯云 SCF =====
  {
    id: 'tencent-response-traffic-billing',
    title: '腾讯云 Web 函数"响应流量"单独计费,不含免费额度/资源包',
    platform: 'tencent',
    keywords: ['响应流量', '流量', '计费', 'web函数', 'scf', '成本', '隐藏', '出流量', '流式', '隐藏成本', '资源包'],
    problem:
      '腾讯云 SCF 的外网出流量分两种:函数主动外访(出流量,有免费额度/资源包)与 Web 函数/API 网关返回给客户端的"响应流量"。后者单独计费,**不享受免费额度与资源包抵扣**。流式 AI 输出正是响应流量,长文本角色扮演会产生持续隐藏成本。',
    solution:
      '1. 爆产前必看:SCF 控制台 → 函数 → 监控 → "响应流量"曲线。\n2. 估算成本:响应流量约 ¥0.8/GB(各地域略有差异),一次长会话几 MB,高频使用月费可能几十到上百。\n3. 降本:① 前端做 SSE 压缩(Worker 前置 gzip);② 限制 maxTokens;③ 高频用户转 CF。\n4. 设余额预警:腾讯云 → 费用 → 余额预警,低于阈值短信通知,防爆产。',
    severity: 'critical',
  },
  {
    id: 'tencent-scf-timeout-idle-billing',
    title: '腾讯云 SCF 超时设置过高会导致空转扣费',
    platform: 'tencent',
    keywords: ['超时', 'timeout', '空转', '扣费', '计费', 'scf', '资源量', '内存', '时间', '防爆产'],
    problem:
      'SCF 按"资源量 = 内存 × 执行时长 + 调用次数 + 外网流量"计费。若超时设为 900s(默认上限),函数即使卡在等待 LLM 响应,只要进程没退出就持续计费时长,一次失败请求可能烧掉几 GB·s 资源量。',
    solution:
      '1. 超时设 60s(够 LLM 流式首 token + 短会话,不够就前端分段重试)。\n2. 内存 128MB(SCF 薄中转层够用,内存翻倍 = 价格翻倍)。\n3. 并发设 1(避免冷启动风暴 + 控制成本)。\n4. 关闭"失败重试"(SCF 异步重试会放大失败成本)。\n5. 用方案二 ADMIN_TOKEN 自改:POST /api/admin/set-timeout(见 platform 一键配置)。',
    severity: 'high',
  },
  {
    id: 'tencent-wechat-default-domain-blocked',
    title: '腾讯云默认 API 瘫痪三级域名微信内 100% 被拦截',
    platform: 'tencent',
    keywords: ['微信', '拦截', '三级域名', 'api网关', '默认域名', 'service-tencentcloudapi', 'cloudbase', '白名单', '免备案'],
    problem:
      'SCF + API 网关默认提供 *.service.tencentcloudapi.com 三级域名,该域名未在微信白名单内,微信内置浏览器打开 100% 被拦截(提示"已停止访问")。用户在微信里点链接直接打不开。',
    solution:
      '方案一(推荐,免备案):走云开发 CloudBase 的 Web 触发器,自带 *.service.tcloudbase.com 域名,该域名在微信白名单内,可直接打开。\n方案二(自用,需组网):Tailscale 内网。手机与云函数同加一个 Tailscale 网络(同 VPC),走加密隧道,微信无法识别与拦截。适合个人/小圈子自用。\n方案三(需备案):绑定自有备案域名 + ICP,走腾讯云 CDN/CLB。最正规但流程长。',
    severity: 'high',
  },
  {
    id: 'tencent-cloudbase-whitelist',
    title: '云开发 CloudBase Web 触发器域名在微信白名单内,可直接打开',
    platform: 'tencent',
    keywords: ['cloudbase', '云开发', 'web触发器', '白名单', '微信', '域名', 'service.tcloudbase.com', '免备案'],
    problem:
      '需要一个微信内可直接打开、又不用备案的访问入口。SCF 默认域名不行(见 tencent-wechat-default-domain-blocked)。',
    solution:
      '1. 开通腾讯云开发 CloudBase(有免费额度)。\n2. 创建 Web 应用 → 添加"Web 函数"触发器,绑定你的 SCF 函数。\n3. CloudBase 自动分配 *.service.tcloudbase.com 域名,该域名在微信白名单。\n4. 前端部署到 CloudBase 静态托管(同域名无 CORS 问题)。\n5. 注意 CloudBase 本身也有计费,看"Web 静态托管流量"。',
    severity: 'medium',
  },
  {
    id: 'tencent-tailscale-intranet',
    title: 'Tailscale 内网:手机与云函数同 VPC,加密隧道微信无法拦截',
    platform: 'tencent',
    keywords: ['tailscale', '内网', 'vpn', '组网', '加密', '隧道', '微信', 'vpc', '自用', '私人'],
    problem:
      '个人/小圈子自用,不想走 CloudBase 公开域名(有被扫描/限流风险),也不想备案。需要一个只有自己人能进的入口。',
    solution:
      '1. 手机装 Tailscale(iOS/Android 官方),登录同一账号。\n2. 在腾讯云 SCF 所在的轻量服务器/CVM 装 Tailscale,加入同一 tailnet。\n3. 手机通过 Tailscale IP 直连 SCF 内网地址,流量全程 WireGuard 加密,微信只能看到去 Tailscale 中继的连接,无法识别内容与拦截。\n4. 适合 1-10 人自用,不适合公开服务。零成本(Tailscale 个人版免费)。',
    severity: 'medium',
  },
  {
    id: 'tencent-cam-cross-account',
    title: 'CAM 跨账号角色授权:用户授权 → 平台换 STS → 自动配置,不暴露主账号密钥',
    platform: 'tencent',
    keywords: ['cam', '角色授权', 'sts', '临时凭证', '跨账号', '授权', '一键', '安全', '不暴露密钥', 'grant'],
    problem:
      '一键配置需要平台帮用户操作其腾讯云资源(SCF/COS)。若让用户填主账号 SecretKey 到前端,等于把账号控制权交给网页,极不安全。',
    solution:
      'CAM 跨账号角色授权流程:\n1. 平台(服务商)有一个腾讯云主账号,记录其 UIN。\n2. 用户跳转到腾讯云 CAM 角色授权页,创建一个"允许平台 UIN 扮演"的角色,挂最小权限策略(QcloudSCFFullAccess 子集 + COS CreateBucket + STS:AssumeRole)。\n3. 授权完成回调到平台,带回授权 code。\n4. 平台后端(我们的 CF Worker 中转)拿 code 调 STS:AssumeRole 换临时凭证(有效期 1 小时,自动续期)。\n5. 平台用 STS 调 UpdateFunctionConfiguration(改超时/内存)、CreateBucket(建 COS)、PutBucketLifecycle 等。\n6. 用户主账号 SecretKey 全程不离开腾讯云,平台只持有临时凭证,过期失效。',
    severity: 'high',
  },
  {
    id: 'tencent-cos-presigned-upload',
    title: 'Presigned URL 直传:图片直传用户自有 COS 桶,成本转嫁用户',
    platform: 'tencent',
    keywords: ['cos', 'presigned', '预签名', '直传', '图片', '存储', '成本转嫁', '用户自有', '桶'],
    problem:
      '图片/角色卡 PNG 若存平台统一 COS,流量与存储成本由平台承担,用户量大会拖垮平台。需要把存储成本转嫁给用户自己的账号。',
    solution:
      '1. CAM 授权时,平台帮用户在其账号下创建一个 COS 桶(用户付费)。\n2. 平台用 STS 生成 Presigned URL(预签名上传 URL),返回给前端。\n3. 前端直接 PUT 文件到用户的 COS,不经过平台服务器(省平台带宽)。\n4. 存储路径 key、bucket 名记在平台 KV/D1 作为索引。\n5. 读取时同理生成下载 Presigned URL(可设过期时间防盗链)。\n6. 成本 100% 由用户承担,平台零存储/零流量。',
    severity: 'medium',
  },
  {
    id: 'tencent-free-tier-3-months',
    title: '腾讯云 SCF 免费额度仅新用户前 3 个月,之后按量计费',
    platform: 'tencent',
    keywords: ['免费额度', '新用户', '3个月', '计费', 'scf', '试用', '到期', '续费'],
    problem:
      '腾讯云 SCF 对新用户提供免费额度(每月一定量调用次数 + 资源量),但仅限前 3 个月。到期后自动转按量计费,用户不知情会产生账单。',
    solution:
      '1. 部署时明确告知用户"免费 3 个月,到期后按量计费"。\n2. 设日预算上限:腾讯云 → 费用 → 预算管理,日预算 ¥1 触发告警。\n3. 3 个月到期前评估:若用量小,继续 SCF;若用量大,迁移到 CF(免费额度长期,见 cf-kv-write-limit)。\n4. 注意:免费额度不覆盖响应流量(见 tencent-response-traffic-billing),即使用免费期也有响应流量费。',
    severity: 'medium',
  },

  // ===== Common 通用 =====
  {
    id: 'common-cors',
    title: 'CORS:跨域时后端必须返回 Access-Control-Allow-Origin',
    platform: 'common',
    keywords: ['cors', '跨域', 'access-control', '预检', 'options', '前端', '报错', 'blocked'],
    problem:
      '前端(部署在 Vercel/Pages)调后端(Worker/SCF),浏览器报 "CORS policy blocked" 或预检 OPTIONS 失败,请求发不出去。',
    solution:
      '1. 后端所有响应(含 OPTIONS 预检)必须带 @minist/shared 的 CORS_HEADERS(Access-Control-Allow-Origin: * 等)。\n2. Worker 在 fetch handler 第一行处理 OPTIONS:返回 204 + CORS_HEADERS。\n3. SCF 在 API 网关"公共响应头"配置 CORS,或在函数代码里手动加。\n4. 调试:浏览器 DevTools → Network → 失败请求 → Response Headers,确认有没有 Access-Control-Allow-Origin。\n5. 预检失败常见原因:自定义头(X-Crypto-Data 等)没在 Allow-Headers 里声明(shared 已声明)。',
    severity: 'medium',
  },
  {
    id: 'common-sse-reconnect',
    title: 'SSE 流式输出断连重连:保存最后 token,续传',
    platform: 'common',
    keywords: ['sse', 'stream', '流式', '断连', '重连', '断点续传', 'event-stream', '长连接'],
    problem:
      '流式 AI 输出(SSE/EventSource)在网络抖动、手机锁屏、微信切后台时断连,已输出内容丢失,用户体验断裂。',
    solution:
      '1. 前端用 fetch + ReadableStream(而非原生 EventSource,后者不支持 POST 与自定义头)。\n2. 用 @minist/shared 的 parseSseStream 逐 token 回调。\n3. 每收到 token 立即写入 IndexedDB(本地持久化),即使断连已输出内容不丢。\n4. 断连后用"已输出内容"作为 prompt 重新请求 LLM(带 "continue from:" 提示),实现续传。\n5. 长连接保活:每 15s 发一个心跳注释行(: heartbeat),防中间代理超时断开。\n6. 指数退避重试:1s → 2s → 4s,最多 3 次。',
    severity: 'medium',
  },
  {
    id: 'common-indexeddb-quota',
    title: 'IndexedDB 满配额兜底:100% 本地化 PWA,云端仅备份',
    platform: 'common',
    keywords: ['indexeddb', '配额', '本地化', 'pwa', '离线', '兜底', '存储满', 'quotaexceeded'],
    problem:
      '浏览器 IndexedDB 配额有限(Chrome 通常约磁盘 60%,但部分环境更低)。大量角色卡 + 长期聊天记录会触发 QuotaExceededError,写入失败。同时,纯本地数据换设备即丢。',
    solution:
      '1. 终极兜底架构:核心数据 100% 存 IndexedDB,云端(CF/腾讯)仅作备份与跨设备同步。\n2. 配额监控:navigator.storage.estimate() 定期检查 usage/quota,接近 80% 提示用户清理旧聊天。\n3. 分库策略:角色卡/世界书(只读为主)单独 store;聊天记录按角色分 store,可单独删除。\n4. 大文件(图片)优先存云端 R2/COS,IndexedDB 只存 URL + 元数据。\n5. PWA:加 Service Worker + manifest,可装到手机主屏离线使用。\n6. 定期备份:导出 SyncPayload JSON,用户手动存或定时同步到云。',
    severity: 'low',
  },
  {
    id: 'common-character-png-parse',
    title: '人物卡 PNG 解析失败:正确提取 tEXt/iTXt 块的 chara 字段',
    platform: 'common',
    keywords: ['png', '人物卡', '角色卡', 'chara', '解析', 'tEXt', 'iTXt', 'base64', 'v2', '失败'],
    problem:
      '角色卡 PNG(图 + 元数据)解析失败,提示"找不到角色信息"或解析出乱码。常见原因:读错 PNG chunk、chara 字段在 iTXt 而非 tEXt、Base64 未 trim。',
    solution:
      '1. PNG 结构:8 字节签名 + 一系列 chunk(每个 = 4B length + 4B type + data + 4B CRC)。\n2. 角色卡 v2 关键 chunk:tEXt(关键词 "chara" = Base64 的 JSON v2)、iTXt(关键词 "chara" 带压缩标志)、tEXt "ccv3"。\n3. 正确解析:遍历所有 chunk,匹配 type === "tEXt" 或 "iTXt",data 以 "chara\\0" 开头的部分,trim 后 Base64 decode。\n4. 注意 iTXt 的压缩标志位(第 5 字节),为 1 时需 zlib 解压。\n5. v2 卡解析后字段在 .data,需二次 JSON.parse;v1 卡直接是顶层字段。\n6. 用 @minist/core 的 character-card 解析模块,已处理上述边界。',
    severity: 'medium',
  },
];

/** 按 id 查单条。 */
export function getEntry(id: string): KnowledgeEntry | undefined {
  return KNOWLEDGE.find((e) => e.id === id);
}
