/**
 * mock-llm.mjs — OpenAI 兼容的流式(SSE)mock LLM。
 *
 * 用于端到端联调:Worker / SCF 的 /v1/chat/completions 中转 → 本 mock,
 * 验证流式透传(pipe + 逐 token)与打字机效果,无需真实 API Key。
 */
import http from 'node:http';

const DEFAULT_TOKENS = ['你好', '！', '我是', 'mock', ' LLM', '，', '流式', '透传', '测试', '成功', '。'];

export function startMockLlm(port = 9911, tokens = DEFAULT_TOKENS) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      return res.end('method not allowed');
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      let i = 0;
      const tick = () => {
        if (i < tokens.length) {
          const chunk = {
            id: 'mock-' + i,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: tokens[i++] }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          setTimeout(tick, 15);
        } else {
          const done = {
            id: 'mock-done',
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          };
          res.write(`data: ${JSON.stringify(done)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      };
      tick();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, port }));
  });
}

// 直接运行:node mock-llm.mjs [port]
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.argv[2]) || 9911;
  startMockLlm(port).then(({ port: p }) => {
    console.log(`[mock-llm] listening on http://127.0.0.1:${p}`);
  });
}
