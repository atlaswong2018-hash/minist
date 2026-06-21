<script setup lang="ts">
/**
 * BatchManage — 运营方跨账号批量管理腾讯云函数面板。
 *
 * 适用场景:运营方(服务商)在自己部署的中转 Worker 上配 OPERATOR_TOKEN,
 * 通过 STS:AssumeRole 跨账号扮演客户预先建好的 SCFManagerRole,批量列出函数 /
 * 自锁超时与内存配置。<strong>客户全程只提供 uin + 角色名,绝不提供 SecretKey</strong>。
 *
 * 安全边界:
 *  - 角色权限由客户在其 CAM 控制,运营方无法越权;
 *  - 客户可随时在 CAM 撤销角色授权;
 *  - 这是高权限操作,执行前强制 confirm。
 */
import { computed, reactive, ref, watch } from 'vue';
import {
  batchManageScf,
  platformConfig,
  usePlatformApi,
} from '../composables/usePlatformApi';

// ===== 客户账号列表(持久化到 localStorage) =====

interface BatchAccount {
  /** 备注:客户名称,展示用。 */
  owner: string;
  /** 客户腾讯云主账号 UIN(12 位数字)。 */
  uin: string;
  /** 客户在 CAM 创建的、允许运营方扮演的角色名。 */
  roleName: string;
}

const ACCOUNTS_KEY = 'minist-batch-accounts';

/** 从 localStorage 加载已保存的账号列表。 */
function loadAccounts(): BatchAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as BatchAccount[];
    // 防御:确保每行字段齐全
    return Array.isArray(arr)
      ? arr.map((a) => ({
        owner: a.owner ?? '',
        uin: a.uin ?? '',
        roleName: a.roleName ?? '',
      }))
      : [];
  } catch {
    return [];
  }
}

/** 保存账号列表到 localStorage。 */
function saveAccounts(list: BatchAccount[]): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
}

const accounts = ref<BatchAccount[]>(loadAccounts());

// 列表任何变更都持久化
watch(
  accounts,
  (val) => saveAccounts(val),
  { deep: true },
);

/** 追加一个空账号行。 */
function addAccount(): void {
  accounts.value.push({ owner: '', uin: '', roleName: '' });
}

/** 删除指定行。 */
function removeAccount(index: number): void {
  accounts.value.splice(index, 1);
}

// ===== 操作参数 =====

type Operation = 'list' | 'set-config';

const operation = ref<Operation>('list');
const region = ref('ap-guangzhou');
// set-config 专属参数
const functionName = ref('');
const timeout = ref(60);
const memorySize = ref(128);
const limit = ref(20);

/** 前置配置缺失提示。 */
const missingConfig = computed(
  () => !platformConfig.relayWorkerUrl || !platformConfig.operatorToken,
);

/** 校验:至少有一行 uin + roleName 都填了。 */
function validAccounts(): BatchAccount[] {
  return accounts.value.filter((a) => a.uin.trim() && a.roleName.trim());
}

const { loading, error, run } = usePlatformApi();

// ===== 结果展示 =====

interface ListFunctionItem {
  FunctionName?: string;
  Runtime?: string;
}

interface PerFunctionResult {
  function?: string;
  ok?: boolean;
  error?: string;
}

interface BatchResultItem {
  uin?: string;
  owner?: string;
  assumeRole?: string;
  ok?: boolean;
  data?: { TotalCount?: number; Functions?: ListFunctionItem[] };
  functions?: PerFunctionResult[];
  error?: string;
}

interface BatchResult {
  results?: BatchResultItem[];
  operation?: string;
  region?: string;
  count?: number;
}

const result = ref<BatchResult | null>(null);

// ===== 执行 =====

/**
 * 构造请求 payload 并调 batchManageScf。
 * 执行前对 set-config 高权限操作做二次确认。
 */
async function execute(): Promise<void> {
  if (missingConfig.value) {
    alert('请先在「配置」页填写『平台中转 Worker URL』与『运营方 Operator Token』');
    return;
  }
  const valid = validAccounts();
  if (valid.length === 0) {
    alert('请至少填写一行完整的客户账号(uin + 角色名)');
    return;
  }

  // set-config 是高权限操作(会改函数配置),二次确认
  if (operation.value === 'set-config') {
    const scopeDesc = functionName.value.trim()
      ? `仅对函数「${functionName.value.trim()}」`
      : `对该账号【全部函数】`;
    const confirmed = window.confirm(
      `确认对 ${valid.length} 个账号 ${scopeDesc} 执行批量自锁配置?\n` +
      `  超时 = ${timeout.value}s,内存 = ${memorySize.value}MB,区域 = ${region.value}\n` +
      `此操作会真实修改腾讯云函数配置,不可一键回滚。`,
    );
    if (!confirmed) return;
  }

  const payload: {
    accounts: { uin: string; roleName: string; owner?: string }[];
    operation: Operation;
    region: string;
    functionName?: string;
    timeout?: number;
    memorySize?: number;
    limit?: number;
  } = {
    accounts: valid.map((a) => ({
      uin: a.uin.trim(),
      roleName: a.roleName.trim(),
      owner: a.owner.trim() || undefined,
    })),
    operation: operation.value,
    region: region.value.trim() || 'ap-guangzhou',
    limit: limit.value,
  };
  if (operation.value === 'set-config') {
    payload.timeout = timeout.value;
    payload.memorySize = memorySize.value;
    if (functionName.value.trim()) {
      payload.functionName = functionName.value.trim();
    }
  }

  result.value = null;
  const res = await run(() =>
    batchManageScf(platformConfig.relayWorkerUrl, platformConfig.operatorToken, payload),
  );
  if (res) {
    result.value = res as BatchResult;
  }
}

/** 友好显示客户备注(空则回退到 uin)。 */
function ownerLabel(item: BatchResultItem): string {
  return item.owner || item.uin || '(未知账号)';
}
</script>

<template>
  <div>
    <!-- 头部说明 -->
    <section class="card">
      <h1 class="card-title">
        <span class="badge badge-tencent">运营方</span> 批量管理腾讯云函数
      </h1>
      <p class="card-subtitle">
        运营方(服务商)跨账号扮演客户预设角色,批量<strong>列出函数</strong>或
        <strong>自锁超时/内存配置</strong>。客户只需提供 uin + 角色名,
        <strong>绝不收集 SecretKey</strong>。
      </p>
      <div class="alert alert-info">
        <strong>安全模型:</strong>客户在腾讯云 CAM 自行创建角色
        <code>SCFManagerRole</code>(挂 <code>QcloudSCFFullAccess</code> 等策略),
        允许运营方 UIN 扮演。运营方通过中转 Worker 上的 <code>OPERATOR_TOKEN</code>
        鉴权,再用 STS:AssumeRole 换临时凭证操作。客户可<strong>随时在 CAM 撤销授权</strong>。
      </div>
      <div v-if="missingConfig" class="alert alert-warning">
        <strong>前置配置缺失:</strong>请先在「配置」页填写
        『平台中转 Worker URL』与『运营方 Operator Token』,否则无法执行批量操作。
      </div>
    </section>

    <!-- 客户账号管理 -->
    <section class="card">
      <h2 class="card-title">客户账号列表</h2>
      <p class="card-subtitle">
        每行 = 一个客户账号。账号列表仅存在<strong>你浏览器的 localStorage</strong>,
        不上传任何服务器。
      </p>

      <table class="table" v-if="accounts.length > 0">
        <thead>
          <tr>
            <th style="width: 30%">备注(owner)</th>
            <th style="width: 30%">主账号 UIN</th>
            <th style="width: 30%">角色名(roleName)</th>
            <th style="width: 10%">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(acc, i) in accounts" :key="i">
            <td><input v-model="acc.owner" class="input" placeholder="客户A" /></td>
            <td><input v-model="acc.uin" class="input" placeholder="100000000001" /></td>
            <td><input v-model="acc.roleName" class="input" placeholder="SCFManagerRole" /></td>
            <td>
              <button class="btn btn-sm btn-danger" @click="removeAccount(i)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="text-dim text-sm">暂无账号,点下方按钮添加。</p>

      <button class="btn btn-sm mt-3" @click="addAccount">+ 添加账号</button>
    </section>

    <!-- 操作参数 -->
    <section class="card">
      <h2 class="card-title">操作与参数</h2>

      <div class="field">
        <label>操作类型</label>
        <div class="flex gap-3 flex-wrap">
          <label class="flex gap-2" style="align-items: center">
            <input type="radio" v-model="operation" value="list" />
            <span>列出函数(list,只读)</span>
          </label>
          <label class="flex gap-2" style="align-items: center">
            <input type="radio" v-model="operation" value="set-config" />
            <span>批量自锁配置(set-config,会改函数)</span>
          </label>
        </div>
      </div>

      <div class="grid-2">
        <div class="field">
          <label>区域(region)</label>
          <input v-model="region" class="input" placeholder="ap-guangzhou" />
        </div>
        <div class="field">
          <label>单账号函数上限(limit,防爆产)</label>
          <input v-model.number="limit" class="input" type="number" min="1" max="100" />
        </div>
      </div>

      <!-- set-config 专属参数 -->
      <div v-if="operation === 'set-config'">
        <div class="grid-2">
          <div class="field">
            <label>超时 timeout(秒,推荐 60)</label>
            <input v-model.number="timeout" class="input" type="number" min="1" max="900" />
          </div>
          <div class="field">
            <label>内存 memorySize(MB,推荐 128)</label>
            <input v-model.number="memorySize" class="input" type="number" min="64" />
          </div>
        </div>
        <div class="field">
          <label>functionName(可选,留空 = 对该账号全部函数自锁)</label>
          <input v-model="functionName" class="input" placeholder="留空 = 全部函数" />
        </div>
        <div class="alert alert-warning">
          <strong>计费警告:</strong>超时设过高会导致空转扣费(资源量 = 内存 × 时长)。
          建议超时 60s / 内存 128MB。未指定 functionName 时会对账号下所有函数逐个自锁,
          请确认 limit 覆盖预期函数数。
        </div>
      </div>

      <div class="flex gap-3 flex-wrap mt-3">
        <button
          class="btn btn-primary"
          :disabled="loading"
          @click="execute"
        >
          {{ loading ? '执行中...' : '执行批量操作' }}
        </button>
        <span v-if="validAccounts().length > 0" class="text-sm text-dim" style="align-self: center">
          将对 {{ validAccounts().length }} 个账号执行 {{ operation === 'list' ? '列出函数' : '自锁配置' }}
        </span>
      </div>

      <div v-if="error" class="alert alert-danger mt-3">
        <strong>执行失败:</strong>{{ error }}
      </div>
    </section>

    <!-- 结果展示 -->
    <section class="card" v-if="result">
      <h2 class="card-title">
        执行结果
        <span class="badge badge-common ml-2">
          {{ result.operation }} · {{ result.region }} · 共 {{ result.count ?? result.results?.length ?? 0 }} 个账号
        </span>
      </h2>

      <div v-if="!result.results || result.results.length === 0" class="text-dim text-sm">
        无结果数据。
      </div>

      <div
        v-for="(item, i) in result.results"
        :key="i"
        class="card mt-3"
        style="background: var(--bg-elevated, rgba(255,255,255,0.02))"
      >
        <div class="flex gap-3 flex-wrap" style="align-items: center">
          <strong>{{ ownerLabel(item) }}</strong>
          <span class="text-sm text-dim">UIN: {{ item.uin || '-' }}</span>
          <span class="text-sm text-dim" v-if="item.assumeRole">角色: {{ item.assumeRole }}</span>
          <span v-if="item.ok" class="badge badge-low">✅ 成功</span>
          <span v-else class="badge badge-high">❌ 失败</span>
        </div>

        <!-- 失败错误信息 -->
        <div v-if="item.error" class="alert alert-danger mt-2 text-sm">
          {{ item.error }}
        </div>

        <!-- list 操作:展示函数列表 -->
        <div v-if="operation === 'list' && item.data" class="mt-2">
          <p class="text-sm text-dim">
            TotalCount: {{ item.data.TotalCount ?? '-' }}
          </p>
          <table class="table" v-if="item.data.Functions && item.data.Functions.length > 0">
            <thead>
              <tr>
                <th>FunctionName</th>
                <th>Runtime</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(fn, fi) in item.data.Functions" :key="fi">
                <td><code>{{ fn.FunctionName || '-' }}</code></td>
                <td>{{ fn.Runtime || '-' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="text-dim text-sm">该账号下未返回任何函数。</p>
        </div>

        <!-- set-config 全量自锁:展示每个函数的结果 -->
        <div v-if="operation === 'set-config' && item.functions" class="mt-2">
          <p class="text-sm text-dim">逐函数自锁结果:</p>
          <ul class="text-sm" style="margin-left: 18px">
            <li v-for="(f, fi) in item.functions" :key="fi">
              <code>{{ f.function || '-' }}</code>
              <span v-if="f.ok" class="badge badge-low">✅</span>
              <span v-else class="badge badge-high">❌</span>
              <span v-if="f.error" class="text-dim"> — {{ f.error }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>
