/**
 * e2e 运行器：先释放 preview 端口，再后台启动 Playwright，结果写入日志文件。
 *
 * 为什么不直接在命令行里串联：本机 shell 对 `&&` 与嵌套引号的处理不稳定，
 * 长命令还会触发工具超时。用脚本执行更可控，也方便日志排查。
 *
 * 用法：node scripts/run-e2e.mjs [name] [playwright 额外参数...]
 */
import { spawn } from 'node:child_process';
import { openSync, appendFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2] ?? 'e2e';
const extra = process.argv.slice(3);

const logPath = join(root, `${name}.log`);
rmSync(logPath, { force: true });

// 1) 释放端口（残留的 preview 会让本次跑在旧产物上，造成整批假失败）
await new Promise((resolve) => {
  const p = spawn(process.execPath, [join(root, 'scripts', 'free-port.mjs'), '4173'], {
    cwd: root,
    stdio: 'inherit',
  });
  p.on('exit', resolve);
});

// 2) 启动 Playwright
const out = openSync(logPath, 'w');
const args = ['node_modules/@playwright/test/cli.js', 'test', '--reporter=list', ...extra];
const proc = spawn(process.execPath, args, {
  cwd: root,
  stdio: ['ignore', out, out],
  detached: true,
  windowsHide: true,
});
proc.on('exit', (code) => appendFileSync(logPath, `\n=== exit ${code} ===\n`));
proc.unref();

console.log(`[run-e2e] started → ${logPath}`);
console.log(`[run-e2e] args: ${extra.join(' ') || '(全部用例)'}`);
