<script setup lang="ts">
/**
 * AiAssistant — 部署排障聊天框。
 * 用户描述部署报错 → @minist/deploy-agent buildAssistantMessages(自动检索知识库)
 * → 调用用户自填的 LLM(OpenAI 兼容)→ 流式渲染回答。命中知识条目对用户透明展示。
 */
import { nextTick, onMounted, reactive, ref } from 'vue';
import {
  buildAssistantMessages,
  askAssistantStream,
  type KnowledgeEntry,
} from '@minist/deploy-agent';
import type { ChatMessage, ChatCompletionChunk } from '@minist/shared';

// LLM 配置(用户自填,存 localStorage)
const LLM_KEY = 'minist-platform-llm';
interface LlmConfig {
  baseUrl: string; // 如 https://api.deepseek.com
  apiKey: string;
  model: string; // 如 deepseek-chat
  platform: 'cloudflare' | 'tencent' | ''; // 可选平台过滤
}

const DEFAULT_LLM: LlmConfig = { baseUrl: '', apiKey: '', model: '', platform: '' };

function loadLlm(): LlmConfig {
  try {
    const raw = localStorage.getItem(LLM_KEY);
    return raw ? { ...DEFAULT_LLM, ...JSON.parse(raw) } : { ...DEFAULT_LLM };
  } catch {
    return { ...DEFAULT_LLM };
  }
}

const llm = reactive<LlmConfig>(loadLlm());
const llmPanelOpen = ref(!llm.baseUrl);

function saveLlm() {
  localStorage.setItem(LLM_KEY, JSON.stringify(llm));
  llmPanelOpen.value = false;
}

// 聊天状态
interface UiMsg {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
const messages = ref<UiMsg[]>([]);
const input = ref('');
const sending = ref(false);
const lastRetrieved = ref<KnowledgeEntry[]>([]);
const chatBoxRef = ref<HTMLElement | null>(null);

const suggestions = [
  '微信里打开腾讯云函数链接提示"已停止访问"怎么办?',
  'Cloudflare KV 写入经常失败,提示限额',
  '腾讯云 SCF 超时设多少合适?响应流量怎么计费?',
  'CF 部署后手机打不开 workers.dev',
  '人物卡 PNG 导入后显示乱码/找不到角色',
  'SSE 流式输出在手机锁屏后断了',
];

async function scrollBottom() {
  await nextTick();
  if (chatBoxRef.value) chatBoxRef.value.scrollTop = chatBoxRef.value.scrollHeight;
}

async function send(question?: string) {
  const q = (question ?? input.value).trim();
  if (!q || sending.value) return;
  if (!llm.baseUrl || !llm.apiKey || !llm.model) {
    llmPanelOpen.value = true;
    alert('请先配置 LLM(Base URL / Key / Model)');
    return;
  }

  input.value = '';
  messages.value.push({ role: 'user', content: q });
  await scrollBottom();

  // 1. 组装 messages(自动检索知识库)
  const platform = llm.platform || undefined;
  const { messages: builtMessages, retrieved } = buildAssistantMessages(q, {
    platform: platform as 'cloudflare' | 'tencent' | undefined,
    topK: 5,
    language: 'zh',
  });
  lastRetrieved.value = retrieved;

  // 展示命中的知识条目(透明)
  if (retrieved.length > 0) {
    messages.value.push({
      role: 'system',
      content: `已检索到 ${retrieved.length} 条相关知识,LLM 将基于这些回答:[${retrieved.map((e) => `KB:${e.id}`).join(', ')}]`,
    });
    await scrollBottom();
  }

  // 2. 占位 assistant 消息(流式追加)
  const assistantIdx = messages.value.push({ role: 'assistant', content: '' }) - 1;
  sending.value = true;
  await scrollBottom();

  try {
    // 3. 调用用户自填的 LLM(platform 注入 fetch 闭包:填 model、带 Authorization)
    await askAssistantStream(
      (body) =>
        fetch(`${llm.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${llm.apiKey}`,
          },
          body: JSON.stringify({ ...(body as object), model: llm.model }),
        }),
      builtMessages as ChatMessage[],
      (token) => {
        messages.value[assistantIdx].content += token;
        void scrollBottom();
      },
      (chunk: ChatCompletionChunk | null) => {
        if (chunk?.finish_reason) {
          // 完成
        }
      },
    );
  } catch (e) {
    messages.value[assistantIdx].content += `\n\n[错误] ${(e as Error).message}`;
  } finally {
    sending.value = false;
    await scrollBottom();
  }
}

function clearChat() {
  messages.value = [];
  lastRetrieved.value = [];
}

onMounted(() => {
  if (messages.value.length === 0) {
    messages.value.push({
      role: 'system',
      content:
        '把你的部署报错或问题发给我(如"微信打不开""KV 写入失败")。我会从知识库检索相关条目,再调用你配置的 LLM 回答。',
    });
  }
});

function severityBadge(s: string): string {
  return `badge-${s}`;
}
function platformBadge(p: string): string {
  return p === 'cloudflare' ? 'badge-cf' : p === 'tencent' ? 'badge-tencent' : 'badge-common';
}
</script>

<template>
  <div>
    <section class="card">
      <div class="flex justify-between items-center flex-wrap gap-3">
        <h1 class="card-title" style="margin-bottom: 0">AI 部署助手</h1>
        <div class="flex gap-2">
          <button class="btn btn-sm" @click="llmPanelOpen = !llmPanelOpen">
            {{ llm.baseUrl ? '修改 LLM 配置' : '配置 LLM' }}
          </button>
          <button class="btn btn-sm" @click="clearChat">清空</button>
        </div>
      </div>
      <p class="card-subtitle mt-2">
        连接<strong>你自己</strong>的 LLM(OpenAI 兼容)。每次回答前会检索避坑知识库,
        命中条目对你透明展示。本平台不存储任何对话。
      </p>
    </section>

    <!-- LLM 配置面板 -->
    <section v-if="llmPanelOpen" class="card">
      <h2 class="card-title">LLM 配置</h2>
      <div class="grid-2">
        <div class="field">
          <label>Base URL(OpenAI 兼容)</label>
          <input v-model="llm.baseUrl" class="input" placeholder="https://api.deepseek.com" />
        </div>
        <div class="field">
          <label>API Key</label>
          <input v-model="llm.apiKey" class="input" type="password" placeholder="sk-..." />
        </div>
        <div class="field">
          <label>Model</label>
          <input v-model="llm.model" class="input" placeholder="deepseek-chat / gpt-4o-mini" />
        </div>
        <div class="field">
          <label>平台过滤(可选,只检索该平台知识)</label>
          <select v-model="llm.platform" class="input">
            <option value="">全部(通用 + CF + 腾讯)</option>
            <option value="cloudflare">仅 Cloudflare</option>
            <option value="tencent">仅腾讯云</option>
          </select>
        </div>
      </div>
      <button class="btn btn-primary" @click="saveLlm">保存</button>
      <p class="text-sm text-dim mt-2">
        配置只存在浏览器 localStorage。Base URL 不要带 /v1/chat/completions 后缀(代码自动拼)。
      </p>
    </section>

    <!-- 聊天区 -->
    <section class="card">
      <div ref="chatBoxRef" class="chat-box">
        <div
          v-for="(m, i) in messages"
          :key="i"
          class="chat-msg"
          :class="m.role"
        >
          <span v-if="m.role === 'system'" class="text-sm">{{ m.content }}</span>
          <span v-else>{{ m.content || '...' }}</span>
        </div>
      </div>

      <!-- 命中知识(透明展示) -->
      <div v-if="lastRetrieved.length > 0" class="mt-3">
        <details>
          <summary class="text-sm text-dim">
            本次命中的知识条目({{ lastRetrieved.length }} 条,点击展开)
          </summary>
          <div class="mt-2">
            <div
              v-for="e in lastRetrieved"
              :key="e.id"
              class="check-item"
              style="display: block; margin-bottom: 8px"
            >
              <div class="check-item-title">
                <code>KB:{{ e.id }}</code>
                <span class="badge" :class="platformBadge(e.platform)">{{ e.platform }}</span>
                <span class="badge" :class="severityBadge(e.severity)">{{ e.severity }}</span>
                {{ e.title }}
              </div>
              <div class="check-item-meta mt-2">
                <strong>问题:</strong>{{ e.problem }}
              </div>
              <div class="check-item-meta">
                <strong>方案:</strong>
                <pre style="margin-top: 4px">{{ e.solution }}</pre>
              </div>
            </div>
          </div>
        </details>
      </div>

      <!-- 输入 -->
      <div class="flex gap-2 mt-3">
        <textarea
          v-model="input"
          class="input"
          placeholder="描述你的部署报错或问题..."
          rows="2"
          @keydown.ctrl.enter="send()"
          :disabled="sending"
        />
        <button class="btn btn-primary" :disabled="sending || !input.trim()" @click="send()">
          {{ sending ? '回答中...' : '发送' }}
        </button>
      </div>
      <div class="text-sm text-dim mt-2">
        Ctrl+Enter 发送。或试试:
        <button
          v-for="s in suggestions"
          :key="s"
          class="btn btn-sm ml-1"
          @click="send(s)"
          :disabled="sending"
        >
          {{ s }}
        </button>
      </div>
    </section>
  </div>
</template>
