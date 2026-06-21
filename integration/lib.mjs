/** lib.mjs — 联调 harness 公共工具。 */
import { spawn } from 'node:child_process';

export const log = (tag, ...a) => console.log(`[${tag}]`, ...a);
export const fail = (tag, m) => {
  console.error(`\n[${tag}] ❌ FAIL: ${m}\n`);
  process.exit(1);
};
export const pass = (tag, m) => console.log(`[${tag}] ✅ ${m}`);

/** fetch 并解析 JSON,返回 { status, text, json, ok }。 */
export async function fetchJson(url, opts = {}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON */
  }
  return { status: r.status, text, json, ok: r.ok, headers: r.headers };
}

/** 轮询 URL 直到返回 <500(或 ok),超时抛错。 */
export async function waitFor(tag, url, timeoutMs = 20000) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
      last = `status ${r.status}`;
    } catch (e) {
      last = e.message;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  fail(tag, `等待 ${url} 超时(最后:${last})`);
}

/** 派生长驻进程,stdout/stderr 转发到本进程 stderr。 */
export function spawnLong(cmd, args, opts = {}) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' && cmd === 'npx', ...opts });
  p.stdout?.on('data', (d) => process.stderr.write(d));
  p.stderr?.on('data', (d) => process.stderr.write(d));
  p.on('exit', (code) => {
    if (code && code !== 0 && code !== null) process.stderr.write(`[${cmd}] exited ${code}\n`);
  });
  return p;
}

/** 汇总:打印并返回退出码。 */
export function summarize(tag, results) {
  const all = results.every((r) => r);
  console.log(`\n[${tag}] ${all ? '🎉 全部通过' : '❌ 存在失败'} (${results.filter(Boolean).length}/${results.length})\n`);
  return all ? 0 : 1;
}
