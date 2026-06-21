<script setup lang="ts">
/**
 * Home — 项目介绍 + 两条部署路径卡片 + 资源清单速查表。
 * 不假装任何部署已成功,只给真实信息与下一步引导。
 */
import ResourceChecklist, { type ResourceItem } from '../components/ResourceChecklist.vue';

defineEmits<{
  (e: 'navigate', id: 'home' | 'cf' | 'tencent' | 'config' | 'sync' | 'ai'): void;
}>();

// Cloudflare 资源清单(已核实计费数字)
const cfResources: ResourceItem[] = [
  {
    name: 'Cloudflare 账号',
    purpose: '主账号,管理所有 CF 资源',
    freeTier: '注册免费,无需信用卡(Workers 免费版)',
    entry: 'dash.cloudflare.com/sign-up',
    url: 'https://dash.cloudflare.com/sign-up',
    risk: 'low',
  },
  {
    name: 'Workers',
    purpose: 'minist API 后端(薄中转层:LLM 流式 / 同步 / R2)',
    freeTier: '10 万请求/天,10ms CPU/请求(网络等待不算 CPU)',
    entry: 'Workers & Pages → Create Worker',
    url: 'https://dash.cloudflare.com/',
    risk: 'low',
  },
  {
    name: 'KV',
    purpose: '索引/配置/角色卡元数据(读多写少)',
    freeTier: '读 10 万/天,**写入仅 1000/天(最紧瓶颈)**',
    entry: 'Workers → KV → Create namespace',
    url: 'https://dash.cloudflare.com/',
    risk: 'critical',
  },
  {
    name: 'D1',
    purpose: '聊天记录 / 世界书(文本,写多)',
    freeTier: '10 万写/天,5GB 存储(免费版)',
    entry: 'Workers → D1 → Create database',
    url: 'https://dash.cloudflare.com/',
    risk: 'low',
  },
  {
    name: 'R2',
    purpose: '人物卡 PNG / 头像(图片)',
    freeTier: '10GB 存储,**出流量费为 0**(100 万 Class A 操作/月)',
    entry: 'R2 → Create bucket',
    url: 'https://dash.cloudflare.com/',
    risk: 'low',
  },
];

// 腾讯云资源清单
const tencentResources: ResourceItem[] = [
  {
    name: '腾讯云账号',
    purpose: '主账号(用户自己的账号,非平台账号)',
    freeTier: '注册免费,需实名认证',
    entry: 'cloud.tencent.com/register',
    url: 'https://cloud.tencent.com/register',
    risk: 'low',
  },
  {
    name: 'SCF 云函数(Web 函数)',
    purpose: 'minist API 后端(Node 运行时)',
    freeTier: '**仅新用户前 3 个月**有免费额度,之后按量计费',
    entry: '云函数 → 函数服务 → 新建(Web 函数)',
    url: 'https://console.cloud.tencent.com/scf',
    risk: 'high',
  },
  {
    name: '响应流量(Web 函数)',
    purpose: 'SCF 返回给客户端的流量(流式 AI 输出正是此项)',
    freeTier: '**单独计费,不含免费额度/资源包** ¥0.8/GB 起隐藏成本',
    entry: 'SCF → 监控 → 响应流量曲线',
    risk: 'critical',
  },
  {
    name: 'CloudBase 云开发',
    purpose: 'Web 触发器(自带微信白名单域名,免备案入口)',
    freeTier: '有一定免费额度,Web 静态托管流量计费',
    entry: '云开发 CloudBase → 创建环境 → Web 应用',
    url: 'https://console.cloud.tencent.com/tcb',
    risk: 'medium',
  },
  {
    name: 'COS 对象存储(用户自有)',
    purpose: '图片/角色卡 PNG(成本转嫁用户,Presigned 直传)',
    freeTier: '50GB 存储 + 10GB 下行流量/月(免费版)',
    entry: 'CAM 授权时由平台自动创建,或对象存储 → 创建桶',
    url: 'https://console.cloud.tencent.com/cos',
    risk: 'medium',
  },
  {
    name: 'CAM 访问管理',
    purpose: '方案一跨账号角色授权(STS 临时凭证,不暴露主账号密钥)',
    freeTier: '免费',
    entry: '访问管理 CAM → 角色 → 新建角色(选"腾讯云主账号")',
    url: 'https://console.cloud.tencent.com/cam',
    risk: 'high',
  },
];

// 速查表数据(两平台对比)。**x** 会被 mdBold 渲染成 <strong>(v-html)。
const compareTable = [
  { dim: '后端免费额度', cf: '10 万请求/天(长期)', tencent: '仅新用户前 3 个月' },
  { dim: '数据库写入', cf: 'D1 10 万写/天', tencent: 'COS 10 万请求/月(无原生 DB)' },
  { dim: 'KV 写入瓶颈', cf: 'KV 1000 写/天(最紧)', tencent: 'COS 无此限制(按量计费)' },
  { dim: '图片存储出流量', cf: 'R2 = 0 元', tencent: 'COS ¥0.5/GB 起' },
  { dim: 'AI 流式响应流量', cf: '含在 Workers 请求内', tencent: '**单独计费,不含免费额度**' },
  { dim: '微信内打开', cf: '*.workers.dev 被墙 → 前端走 Vercel/GH Pages', tencent: '默认域名被拦 → 走 CloudBase 白名单/Tailscale' },
  { dim: '隐藏成本风险', cf: '低', tencent: '**高(响应流量 + 到期按量)**' },
  { dim: '推荐场景', cf: '长期免费、个人/小规模', tencent: '已有腾讯云资源、企业用户' },
];

/** 把 **x** 转 <strong>x</strong>(仅这一种标记,转义 < 防注入)。 */
function mdBold(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}
</script>

<template>
  <div>
    <!-- 介绍 -->
    <section class="card">
      <h1 class="card-title">minist 部署平台</h1>
      <p class="card-subtitle">
        引导你一键把 minist 酒馆(SillyTavern 免备案裁剪移植)部署到<strong>你自己的</strong>
        Cloudflare 或腾讯云账号,管理配置,同步角色卡与世界书,并用 AI 助手排障。
      </p>
      <div class="alert alert-info">
        <strong>安全提示:</strong>本平台不持有你的云账号密钥。方案一(CAM/CF Token)授权后,
        平台只获得临时凭证(STS)或受限 Token,主账号密钥全程不离开你的云控制台。
      </div>
    </section>

    <!-- 两条部署路径 -->
    <section class="grid-2">
      <div class="card">
        <h2 class="card-title">
          <span class="badge badge-cf">Cloudflare</span>
          部署到 CF
        </h2>
        <p class="card-subtitle">
          Workers + KV + D1 + R2。长期免费额度(10 万请求/天),最适合个人/小规模。
          前端建议部署到 Vercel / GitHub Pages(国内可达性优于 workers.dev)。
        </p>
        <ul class="text-sm" style="margin-left: 18px; color: var(--text-dim)">
          <li>10 万请求/天免费(CPU 10ms,网络等待不算)</li>
          <li>R2 无出流量费,图片零成本</li>
          <li>需注意 KV 写入 1000/天瓶颈(聊天放 D1)</li>
        </ul>
        <button class="btn btn-primary mt-4" @click="$emit('navigate', 'cf')">
          开始 CF 部署向导 →
        </button>
      </div>

      <div class="card">
        <h2 class="card-title">
          <span class="badge badge-tencent">腾讯云</span>
          部署到腾讯云 SCF
        </h2>
        <p class="card-subtitle">
          云函数 Web 函数 + CloudBase + 用户自有 COS。适合已有腾讯云资源/企业用户。
          注意响应流量单独计费(隐藏成本),免备案走 CloudBase 白名单。
        </p>
        <ul class="text-sm" style="margin-left: 18px; color: var(--text-dim)">
          <li>两方案:CAM 跨账号授权(对外公开)/ Token 自改(自用即时测)</li>
          <li>免备案:CloudBase 白名单域名 或 Tailscale 内网</li>
          <li>响应流量 ¥0.8/GB 起,不含免费额度(必须设预算)</li>
        </ul>
        <button class="btn btn-primary mt-4" @click="$emit('navigate', 'tencent')">
          开始腾讯云部署 →
        </button>
      </div>
    </section>

    <!-- 速查表 -->
    <section class="card">
      <h2 class="card-title">两平台资源与计费速查表</h2>
      <p class="card-subtitle">数字来自官方计费文档(2025)。实际计费以官方为准。</p>
      <div style="overflow-x: auto">
        <table class="table">
          <thead>
            <tr>
              <th>维度</th>
              <th><span class="badge badge-cf">Cloudflare</span></th>
              <th><span class="badge badge-tencent">腾讯云</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in compareTable" :key="row.dim">
              <td><strong>{{ row.dim }}</strong></td>
              <td><span v-html="mdBold(row.cf)"></span></td>
              <td><span v-html="mdBold(row.tencent)"></span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 两平台资源清单(可勾选,持久化) -->
    <section class="grid-2">
      <ResourceChecklist
        :items="cfResources"
        storage-key="cf-resources"
        title="Cloudflare 资源清单"
      />
      <ResourceChecklist
        :items="tencentResources"
        storage-key="tencent-resources"
        title="腾讯云资源清单"
      />
    </section>

    <!-- 下一步 -->
    <section class="card">
      <h2 class="card-title">下一步</h2>
      <div class="flex gap-3 flex-wrap">
        <button class="btn" @click="$emit('navigate', 'cf')">CF 部署向导</button>
        <button class="btn" @click="$emit('navigate', 'tencent')">腾讯云部署</button>
        <button class="btn" @click="$emit('navigate', 'config')">管理配置</button>
        <button class="btn" @click="$emit('navigate', 'sync')">同步角色卡/世界书</button>
        <button class="btn" @click="$emit('navigate', 'ai')">AI 排障助手</button>
      </div>
    </section>
  </div>
</template>
