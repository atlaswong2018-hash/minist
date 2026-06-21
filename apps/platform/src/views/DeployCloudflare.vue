<script setup lang="ts">
/**
 * DeployCloudflare — Cloudflare 部署向导。
 * 5 步:① 开通账号 → ② 建 KV/D1/R2 → ③ 部署 Worker → ④ 回填 Worker URL → ⑤ 前端部署到 Vercel/GH Pages。
 * 生成"复制到酒馆设置"的配置摘要。
 */
import { computed, reactive, ref } from 'vue';
import Stepper from '../components/Stepper.vue';
import {
  cfOneClickSetup,
  usePlatformApi,
  platformConfig,
  persistConfig,
} from '../composables/usePlatformApi';

const steps = [
  { title: '开通账号', desc: '注册 Cloudflare 账号(免费,无需信用卡)。' },
  { title: '建 KV/D1/R2', desc: '手动 wrangler 命令或一键 API 创建资源。' },
  { title: '部署 Worker', desc: 'Deploy to Cloudflare 或 wrangler deploy。' },
  { title: '回填 Worker URL', desc: '把部署后的 Worker 地址填回平台与酒馆。' },
  { title: '前端部署', desc: '前端(SPA)部署到 Vercel/GitHub Pages(国内可达)。' },
];

const current = ref(0);

// 表单状态
const form = reactive({
  cfApiToken: '',
  kvNamespace: 'minist-kv',
  d1Database: 'minist-db',
  r2Bucket: 'minist-assets',
  workerName: 'minist-api',
  workerUrl: '',
  accountId: '',
});

// 一键配置
const { loading, error, run } = usePlatformApi();
const oneClickResult = ref<unknown>(null);

async function doOneClickSetup() {
  if (!form.cfApiToken) {
    alert('请先填写 CF API Token(下方步骤说明获取方式)');
    return;
  }
  if (!platformConfig.relayWorkerUrl) {
    alert('请先在"配置"页填写"平台中转 CF Worker URL"(用于调 CF REST API)');
    return;
  }
  const result = await run(() =>
    cfOneClickSetup(platformConfig.relayWorkerUrl, form.cfApiToken),
  );
  if (result) {
    oneClickResult.value = result;
  }
}

// 配置摘要(复制到酒馆)
const configSummary = computed(() => {
  const url = form.workerUrl || 'https://<your-worker>.workers.dev';
  return `# minist 酒馆设置(复制到酒馆 Settings → Backend)
backend = cloudflare
apiBaseUrl = ${url}
crypto = true   # 启用 X-Crypto-Data Base64 混淆,免备案防明文审查
userId = ${platformConfig.userId || '<在酒馆里生成>'}

# 资源绑定(Worker 已绑定,无需在酒馆填):
# KV:    ${form.kvNamespace}   (索引/配置)
# D1:    ${form.d1Database}    (聊天/世界书)
# R2:    ${form.r2Bucket}      (图片/角色卡 PNG)`;
});

function copySummary() {
  navigator.clipboard.writeText(configSummary.value).then(
    () => alert('已复制配置摘要到剪贴板'),
    () => alert('复制失败,请手动选中复制'),
  );
}

function saveWorkerUrl() {
  platformConfig.cfWorkerUrl = form.workerUrl;
  persistConfig();
  alert('Worker URL 已保存到平台配置');
}
</script>

<template>
  <div>
    <section class="card">
      <h1 class="card-title">
        <span class="badge badge-cf">Cloudflare</span> 部署向导
      </h1>
      <p class="card-subtitle">
        把 minist API 部署到你的 Cloudflare Workers,绑定 KV/D1/R2。
        前端 SPA 另行部署到 Vercel / GitHub Pages。
      </p>
      <div class="alert alert-warning">
        <strong>免备案提醒:</strong>默认 <code>*.workers.dev</code> 域名国内部分地区/微信被墙。
        API 走 Worker(可绑自有域名),前端务必部署到 Vercel/GitHub Pages。
      </div>
    </section>

    <section class="card">
      <Stepper :steps="steps" :current="current" @update:current="(v) => (current = v)">
        <!-- 步骤 1:开通账号 -->
        <div v-show="current === 0">
          <h3>1. 开通 Cloudflare 账号</h3>
          <ol style="margin-left: 18px; line-height: 2">
            <li>
              访问
              <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">
                dash.cloudflare.com/sign-up
              </a>
              注册(免费,无需信用卡,邮箱验证即可)。
            </li>
            <li>登录后进入 Dashboard,记下右上角的 <strong>Account ID</strong>(步骤二一键配置需要)。</li>
            <li>(可选)添加自有域名到 CF DNS,获得国内更可达的入口。</li>
          </ol>
          <div class="field mt-3">
            <label>Account ID(可选,一键配置用)</label>
            <input v-model="form.accountId" class="input" placeholder="从 Dashboard 右侧复制" />
          </div>
        </div>

        <!-- 步骤 2:建 KV/D1/R2 -->
        <div v-show="current === 1">
          <h3>2. 创建 KV / D1 / R2 资源</h3>
          <p class="text-dim mb-3">两种方式,任选其一。</p>

          <h4 class="mt-3">方式 A:手动(推荐,理解每一步)</h4>
          <p class="text-sm text-dim mb-2">安装 wrangler 后,在 minist 仓库根目录执行:</p>
          <pre><code># 安装 wrangler
npm install -g wrangler
wrangler login

# 创建资源
wrangler kv namespace create <span class="hl">{{ form.kvNamespace }}</span>
wrangler d1 create <span class="hl">{{ form.d1Database }}</span>
wrangler r2 bucket create <span class="hl">{{ form.r2Bucket }}</span>

# 命令会输出 id,填入 wrangler.toml 的 binding</code></pre>

          <h4 class="mt-4">方式 B:一键 API 创建(需 CF API Token)</h4>
          <div class="alert alert-info">
            获取 Token:
            <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">
              dash.cloudflare.com/profile/api-tokens
            </a>
            → Create Token → 选 "Edit Cloudflare Workers" 模板(含 KV/D1/R2 编辑权限)。
            <strong>Token 只在前端临时使用,平台不存储。</strong>
          </div>
          <div class="field">
            <label>CF API Token(Edit Workers 模板)</label>
            <input v-model="form.cfApiToken" class="input" type="password" placeholder="cf_xxx..." />
          </div>
          <div class="grid-2">
            <div class="field">
              <label>KV namespace</label>
              <input v-model="form.kvNamespace" class="input" />
            </div>
            <div class="field">
              <label>D1 database</label>
              <input v-model="form.d1Database" class="input" />
            </div>
            <div class="field">
              <label>R2 bucket</label>
              <input v-model="form.r2Bucket" class="input" />
            </div>
            <div class="field">
              <label>Worker name</label>
              <input v-model="form.workerName" class="input" />
            </div>
          </div>
          <button class="btn btn-primary" :disabled="loading" @click="doOneClickSetup">
            {{ loading ? '正在创建...' : '一键创建 KV/D1/R2 + 部署 Worker' }}
          </button>
          <div v-if="error" class="alert alert-danger mt-3">{{ error }}</div>
          <div v-if="oneClickResult" class="alert alert-success mt-3">
            一键配置请求已提交。结果:
            <pre>{{ JSON.stringify(oneClickResult, null, 2) }}</pre>
            <strong>注:</strong>此步骤需用你的真实 CF Token 端到端验证,平台中转 Worker 部署后生效。
          </div>
        </div>

        <!-- 步骤 3:部署 Worker -->
        <div v-show="current === 2">
          <h3>3. 部署 Worker</h3>
          <h4>方式 A:Deploy to Cloudflare 按钮</h4>
          <p class="text-sm text-dim mb-2">
            仓库 README 里的 "Deploy to Cloudflare" 按钮一键部署(会引导授权 + 填资源 id)。
          </p>
          <pre><code>https://deploy.workers.cloudflare.com/?url=https://github.com/atlaswong2018-hash/minist</code></pre>

          <h4 class="mt-3">方式 B:wrangler deploy</h4>
          <pre><code># 在 packages/worker-cloudflare 目录
wrangler deploy

# 输出形如:
# Published minist-api (x.xx sec)
#   https://<span class="hl">{{ form.workerName }}</span>.&lt;your-subdomain&gt;.workers.dev</code></pre>

          <div class="alert alert-warning mt-3">
            <strong>计费提醒:</strong>Workers 免费版 10 万请求/天,CPU 10ms/请求(流式 LLM 网络等待不算 CPU)。
            KV 写入 1000/天是瓶颈,聊天记录务必放 D1。
          </div>
        </div>

        <!-- 步骤 4:回填 Worker URL -->
        <div v-show="current === 3">
          <h3>4. 回填 Worker URL</h3>
          <p class="text-dim mb-3">
            部署完成后,把 Worker 的访问地址填到下面。平台与酒馆都需要这个地址。
          </p>
          <div class="field">
            <label>Worker URL</label>
            <input v-model="form.workerUrl" class="input" placeholder="https://minist-api.workers.dev" />
          </div>
          <button class="btn" @click="saveWorkerUrl">保存到平台配置</button>
        </div>

        <!-- 步骤 5:前端部署 -->
        <div v-show="current === 4">
          <h3>5. 前端 SPA 部署到 Vercel / GitHub Pages</h3>
          <p class="text-dim mb-3">
            前端(酒馆 SPA)不要部署到 *.workers.dev(国内被墙),改部署到 Vercel 或 GitHub Pages。
          </p>
          <h4>Vercel</h4>
          <ol style="margin-left: 18px; line-height: 1.8">
            <li>vercel.com → New Project → Import 你的 minist fork。</li>
            <li>Framework: Vite,Root: <code>apps/tavern</code>,Build: <code>npm run build</code>。</li>
            <li>Deploy → 得到 <code>*.vercel.app</code> 域名(国内可达性较好)。</li>
          </ol>
          <h4 class="mt-3">GitHub Pages</h4>
          <ol style="margin-left: 18px; line-height: 1.8">
            <li>仓库 Settings → Pages → Source: GitHub Actions。</li>
            <li>添加 workflow 构建 apps/tavern 并发布到 gh-pages。</li>
            <li>得到 <code>*.github.io</code> 域名。</li>
          </ol>

          <h3 class="mt-4">最终配置摘要(复制到酒馆设置)</h3>
          <pre>{{ configSummary }}</pre>
          <button class="btn btn-primary mt-2" @click="copySummary">复制配置摘要</button>
        </div>
      </Stepper>
    </section>
  </div>
</template>

<style scoped>
.hl {
  color: #79c0ff;
  font-style: italic;
}
</style>
