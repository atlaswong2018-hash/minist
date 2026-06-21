/**
 * run-all.mjs — 顺序跑通三条部署方案的端到端联调,汇总结果。
 * 顺序执行(共享端口 8787/9001/9999/9911,避免冲突),每条之间清理残留进程。
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

const scenarios = [
  ['CF 核心路径', 'run-cf-core.mjs'],
  ['方案二 · Token 自改', 'run-tencent-token.mjs'],
  ['方案一 · CAM(strict 验签)', 'run-tencent-cam.mjs'],
];

function cleanup() {
  // 正则技巧避免 pkill 自匹配当前 shell
  try {
    execSync('pkill -9 -f "[w]orkerd" || true; pkill -9 -f "[s]cf-tencent/src/index" || true', { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}

const results = [];
for (const [name, file] of scenarios) {
  console.log(`\n========== ${name} ==========`);
  const code = await new Promise((resolve) => {
    const p = spawn('node', [path.join(DIR, file)], { stdio: 'inherit' });
    p.on('exit', resolve);
  });
  results.push({ name, ok: code === 0 });
  cleanup();
  await new Promise((r) => setTimeout(r, 600));
}

console.log('\n========== 联调汇总 ==========');
for (const r of results) console.log(`  ${r.ok ? '✅' : '❌'}  ${r.name}`);
const allOk = results.every((r) => r.ok);
console.log(`\n  ${allOk ? '🎉 三条方案全部端到端通过' : '❌ 存在失败,详见上方日志'}\n`);
process.exit(allOk ? 0 : 1);
