<script setup lang="ts">
/**
 * DeployTencent — 腾讯云部署,两个 Tab:
 *  - 方案一 CAM:构造授权链接 → 用户授权 → 回调 code → 提交 grant-config → 展示进度
 *  - 方案二 Token:输入函数 URL + ADMIN_TOKEN → set-timeout 自改(可即时测试)
 *
 * CAM 方案一的前端跳转链接构造遵循腾讯云角色授权 URL 形态,
 * 标注需替换开发者 UIN / 回调地址。
 */
import { computed, reactive, ref } from 'vue';
import {
  adminSetTimeout,
  submitGrantCode,
  usePlatformApi,
  platformConfig,
  persistConfig,
} from '../composables/usePlatformApi';

type TabId = 'cam' | 'token';
const tab = ref<TabId>('cam');

// ===== 方案一 CAM =====

/** CAM 授权配置(开发者需替换为真实值)。 */
const camConfig = reactive({
  /** 服务商(平台)的腾讯云 UIN — 用户授权后,该 UIN 扮演角色。 */
  platformUin: '100000000000', // TODO: 替换为平台真实 UIN
  /** 授权回调 URL — 用户授权后腾讯云带回 code 跳回这里。 */
  callbackUrl: typeof window !== 'undefined' ? `${window.location.origin}/#/tencent/grant-callback` : '',
  /** 需要的角色策略描述(展示给用户看)。 */
  policies: [
    'QcloudSCFFullAccess(云函数全部读写)',
    'QcloudCOSFullAccess(对象存储,用于建桶 + Presigned)',
    'sts:AssumeRole(扮演角色换临时凭证)',
  ],
  /** 用户授权后从 URL 回传的 code(可手动粘贴)。 */
  grantCode: '',
});

/**
 * 构造腾讯云 CAM 角色授权 URL。
 * 形态参考腾讯云访问管理控制台的角色授权页。
 * 注:实际生产用腾讯云 "角色授权" SaaS 页面 URL,这里给等价可用的 console 深链。
 */
const authUrl = computed(() => {
  const params = new URLSearchParams({
    // 角色类型:允许指定 UIN 扮演
    roleType: '2',
    // 服务商 UIN(平台账号,扮演方)
    parentId: camConfig.platformUin,
    // 回调地址
    callbackUrl: camConfig.callbackUrl,
    // 来源标记
    from: 'minist-platform',
  });
  return `https://console.cloud.tencent.com/cam/role/authorize?${params.toString()}`;
});

const camProgress = reactive({
  visible: false,
  step: 0, // 0=未开始 1=换 STS 2=建 COS 3=配置 SCF 4=完成
  steps: ['换 STS 临时凭证', '创建 COS 桶', '配置/部署 SCF', '完成'],
  scfUrl: '',
  error: '',
});

const { loading: camLoading, error: camError, run: runCam } = usePlatformApi();

async function submitCam() {
  if (!camConfig.grantCode) {
    alert('请先完成腾讯云授权,把回调 URL 里的 code 粘贴到上方"授权 code"');
    return;
  }
  if (!platformConfig.relayWorkerUrl) {
    alert('请先在"配置"页填写"平台中转 CF Worker URL"');
    return;
  }
  camProgress.visible = true;
  camProgress.step = 0;
  camProgress.error = '';

  const result = await runCam(() =>
    submitGrantCode(platformConfig.relayWorkerUrl, camConfig.grantCode, 'tencent'),
  );

  if (result) {
    // 真实场景下中转 Worker 会流式回传进度,这里简化为推进步骤
    camProgress.step = 4;
    const r = result as { scfUrl?: string };
    camProgress.scfUrl = r.scfUrl ?? '';
  } else if (camError.value) {
    camProgress.error = camError.value;
  }
}

function openAuth() {
  window.open(authUrl.value, '_blank', 'noopener');
}

// ===== 方案二 Token =====

const tokenForm = reactive({
  scfUrl: platformConfig.tencentScfUrl,
  adminToken: platformConfig.adminToken,
  timeout: 60,
  memory: 128,
  concurrency: 1,
});

const tokenResult = ref<unknown>(null);
const { loading: tokenLoading, error: tokenError, run: runToken } = usePlatformApi();

async function doSelfConfig() {
  if (!tokenForm.scfUrl || !tokenForm.adminToken) {
    alert('请填写函数 URL 和 ADMIN_TOKEN');
    return;
  }
  const result = await runToken(() =>
    adminSetTimeout(tokenForm.scfUrl, tokenForm.adminToken, {
      timeout: tokenForm.timeout,
      memory: tokenForm.memory,
      concurrency: tokenForm.concurrency,
    }),
  );
  tokenResult.value = result;
  // 同步到全局配置
  platformConfig.tencentScfUrl = tokenForm.scfUrl;
  platformConfig.adminToken = tokenForm.adminToken;
  persistConfig();
}

/** 模拟说明(方案二在无真实 SCF 时可 mock 验证前端流程)。 */
function mockTest() {
  tokenResult.value = {
    success: true,
    data: {
      message: '[MOCK] 真实环境需部署 SCF 并设 ADMIN_TOKEN 环境变量',
      applied: {
        timeout: tokenForm.timeout,
        memory: tokenForm.memory,
        concurrency: tokenForm.concurrency,
        retry: false,
      },
    },
  };
}
</script>

<template>
  <div>
    <section class="card">
      <h1 class="card-title">
        <span class="badge badge-tencent">腾讯云</span> 部署
      </h1>
      <p class="card-subtitle">
        两种方案。方案一适合对外公开服务(CAM 跨账号,不暴露主账号密钥);
        方案二适合自用即时测试(SCF 自己改自己)。
      </p>
      <div class="alert alert-danger">
        <strong>计费警告:</strong>腾讯云 Web 函数"响应流量"单独计费,<strong>不含免费额度/资源包</strong>。
        流式 AI 输出正是此项,高频使用会产生持续隐藏成本。务必设余额预警(见下方步骤)。
      </div>
    </section>

    <!-- Tabs -->
    <div class="tabs">
      <button class="tab" :class="{ active: tab === 'cam' }" @click="tab = 'cam'">
        方案一:CAM 跨账号授权(对外公开)
      </button>
      <button class="tab" :class="{ active: tab === 'token' }" @click="tab = 'token'">
        方案二:Token 自改(自用,可即时测)
      </button>
    </div>

    <!-- ===== 方案一 CAM ===== -->
    <div v-show="tab === 'cam'">
      <section class="card">
        <h2 class="card-title">方案一:CAM 跨账号角色授权</h2>
        <p class="card-subtitle">
          用户跳腾讯云官方授权页 → 回调 code → 平台 CF Worker 中转换 STS →
          自动配置 SCF + 建 COS 桶 + 签 Presigned URL。<strong>主账号密钥不暴露。</strong>
        </p>

        <div class="alert alert-info">
          <strong>原理(参考 tencent-cam-cross-account):</strong>
          平台(服务商)持有一个腾讯云主账号(UIN),用户在腾讯云 CAM 创建一个
          "允许平台 UIN 扮演"的角色(挂最小权限策略),授权后平台用 STS:AssumeRole
          换得 1 小时有效的临时凭证,过期自动续期。用户 SecretKey 全程不离开腾讯云。
        </div>

        <h3 class="mt-4">步骤 1:点按钮跳转腾讯云授权</h3>
        <p class="text-sm text-dim mb-2">所需权限(最小集):</p>
        <ul class="text-sm" style="margin-left: 18px; color: var(--text-dim)">
          <li v-for="p in camConfig.policies" :key="p">{{ p }}</li>
        </ul>
        <div class="field mt-3">
          <label>平台 UIN(服务商账号,需替换为真实值)</label>
          <input v-model="camConfig.platformUin" class="input" placeholder="100000000000" />
        </div>
        <div class="field">
          <label>授权回调 URL(腾讯云授权后带回 code 跳回这里)</label>
          <input v-model="camConfig.callbackUrl" class="input" />
        </div>
        <button class="btn btn-primary" @click="openAuth">
          打开腾讯云授权页 ↗
        </button>
        <pre class="mt-3"><code>{{ authUrl }}</code></pre>

        <h3 class="mt-4">步骤 2:粘贴回调带回的授权 code</h3>
        <p class="text-sm text-dim mb-2">
          授权完成后,腾讯云会带 <code>code</code> 跳回你的回调 URL,把 code 粘贴到下面。
        </p>
        <div class="field">
          <label>授权 code</label>
          <input v-model="camConfig.grantCode" class="input" placeholder="授权回调 URL 里的 code 参数" />
        </div>
        <button class="btn btn-primary" :disabled="camLoading" @click="submitCam">
          {{ camLoading ? '正在配置...' : '提交 code,开始自动配置' }}
        </button>
        <div v-if="camError" class="alert alert-danger mt-3">{{ camError }}</div>

        <!-- 配置进度 -->
        <div v-if="camProgress.visible" class="mt-4">
          <h4>配置进度</h4>
          <div class="stepper-head">
            <div
              v-for="(s, i) in camProgress.steps"
              :key="s"
              class="step-dot"
              :class="{ active: i === camProgress.step, done: i < camProgress.step }"
            >
              <span class="dot">{{ i < camProgress.step ? '✓' : i + 1 }}</span>
              <span>{{ s }}</span>
            </div>
          </div>
          <div v-if="camProgress.error" class="alert alert-danger">{{ camProgress.error }}</div>
          <div v-if="camProgress.scfUrl" class="alert alert-success">
            SCF 部署完成!访问地址:
            <code>{{ camProgress.scfUrl }}</code>
          </div>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">步骤 3:免备案访问入口(三选一)</h2>
        <ol style="margin-left: 18px; line-height: 2">
          <li>
            <strong>CloudBase Web 触发器(推荐,免备案):</strong>
            开通云开发 → 创建 Web 应用 → 绑定 SCF,得到
            <code>*.service.tcloudbase.com</code> 域名(在微信白名单内,可直接打开)。
            <a href="https://console.cloud.tencent.com/tcb" target="_blank" rel="noopener">开通 ↗</a>
          </li>
          <li>
            <strong>Tailscale 内网(自用):</strong>
            手机与 SCF 所在服务器同装 Tailscale,走加密隧道,微信无法识别与拦截。
            适合 1-10 人自用。
          </li>
          <li>
            <strong>自有备案域名(正规但慢):</strong>
            绑定 ICP 备案域名 + 腾讯云 CDN/CLB,走正规流程。
          </li>
        </ol>
        <div class="alert alert-warning">
          <strong>注意:</strong>SCF 默认三级域名
          <code>*.service.tencentcloudapi.com</code> 在微信内 100% 被拦截,不能作为正式入口。
        </div>
      </section>
    </div>

    <!-- ===== 方案二 Token ===== -->
    <div v-show="tab === 'token'">
      <section class="card">
        <h2 class="card-title">方案二:Token 自改(SCF 自己改自己)</h2>
        <p class="card-subtitle">
          在 SCF 环境变量里设 <code>ADMIN_TOKEN</code>,前端 POST
          <code>{scfUrl}/api/admin/set-timeout</code>(带 <code>X-Admin-Token</code> 头),
          云函数改自己的超时/内存/并发。<strong>免 CAM,自用即时可测。</strong>
        </p>

        <div class="grid-2">
          <div class="field">
            <label>SCF 函数 URL</label>
            <input v-model="tokenForm.scfUrl" class="input" placeholder="https://xxx.service.tencentcloudapi.com" />
          </div>
          <div class="field">
            <label>ADMIN_TOKEN(SCF 环境变量里设的)</label>
            <input v-model="tokenForm.adminToken" class="input" type="password" />
          </div>
          <div class="field">
            <label>超时(秒,推荐 60)</label>
            <input v-model.number="tokenForm.timeout" class="input" type="number" min="1" max="900" />
          </div>
          <div class="field">
            <label>内存(MB,推荐 128)</label>
            <input v-model.number="tokenForm.memory" class="input" type="number" min="64" />
          </div>
          <div class="field">
            <label>并发(推荐 1,防爆产)</label>
            <input v-model.number="tokenForm.concurrency" class="input" type="number" min="1" />
          </div>
        </div>

        <div class="alert alert-warning">
          <strong>防爆产配置:</strong>超时 60s / 内存 128MB / 并发 1 / 关失败重试。
          超时设过高会导致空转扣费(资源量 = 内存 × 时长)。
        </div>

        <div class="flex gap-3 flex-wrap">
          <button class="btn btn-primary" :disabled="tokenLoading" @click="doSelfConfig">
            {{ tokenLoading ? '正在自改...' : '提交自改配置' }}
          </button>
          <button class="btn" @click="mockTest">
            [Mock 测试](无真实 SCF 时验证前端)
          </button>
        </div>

        <div v-if="tokenError" class="alert alert-danger mt-3">{{ tokenError }}</div>
        <div v-if="tokenResult" class="alert alert-success mt-3">
          自改结果:
          <pre>{{ JSON.stringify(tokenResult, null, 2) }}</pre>
        </div>

        <h3 class="mt-4">如何设置 ADMIN_TOKEN</h3>
        <ol style="margin-left: 18px; line-height: 1.8" class="text-sm text-dim">
          <li>腾讯云控制台 → 云函数 → 你的函数 → 函数管理 → 函数配置。</li>
          <li>环境变量 → 新增:<code>ADMIN_TOKEN</code> = 你的自定义 token。</li>
          <li>保存后,用同一 token 调上方接口。建议用强随机串。</li>
        </ol>
      </section>

      <section class="card">
        <h2 class="card-title">余额预警(防爆产必设)</h2>
        <ol style="margin-left: 18px; line-height: 1.8">
          <li>
            腾讯云 → 费用 →
            <a href="https://console.cloud.tencent.com/expense/budget" target="_blank" rel="noopener">
              预算管理
            </a>。
          </li>
          <li>新建预算:日预算 ¥1(或你能接受的阈值)。</li>
          <li>告警通知:超 80% 短信 + 邮件。</li>
          <li>同时开"余额预警":低于 ¥10 触发(防止欠费停服)。</li>
        </ol>
      </section>
    </div>
  </div>
</template>
