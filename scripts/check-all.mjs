/**
 * 一键质量门：类型检查 → 单测 → H5 构建 → 小游戏构建 → 产物红线检查。
 *
 * 之所以写成脚本而不是一长串 npm run：Windows 上链式 && 在 cmd/PowerShell
 * 之间语义不一致，且失败时很难看出是哪一步炸的。这里逐步输出并记录退出码。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const run = (label, cmd, args, cwd = root) => {
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    const out = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(out);
    return { ok: true, code: 0 };
  } catch (e) {
    process.stdout.write(String(e.stdout ?? ''));
    process.stdout.write(String(e.stderr ?? ''));
    process.stdout.write(`\n[${label}] 失败，退出码 ${e.status}\n`);
    return { ok: false, code: e.status ?? 1 };
  }
};

const node = process.execPath;
const results = [
  ['typecheck:h5', run('typecheck:h5', node, ['node_modules/typescript/bin/tsc', '-p', 'apps/h5/tsconfig.json', '--noEmit'])],
  ['typecheck:minigame', run('typecheck:minigame', node, ['scripts/tsc-minigame.mjs'])],
  ['test', run('test', node, ['node_modules/vitest/vitest.mjs', 'run', '--reporter=basic'])],
  ['build:h5', run('build:h5', node, [join(root, 'node_modules/vite/bin/vite.js'), 'build', join(root, 'apps/h5')])],
  ['build:wx', run('build:wx', node, ['apps/minigame/build.mjs'])],
];

// ---- 产物红线检查 ----
process.stdout.write('\n=== 产物检查 ===\n');
const h5Bundle = join(root, 'apps', 'h5', 'dist', 'game.js');
const wxBundle = join(root, 'apps', 'minigame', 'dist', 'minigame', 'game.js');

const checks = [];
/**
 * 递归求目录体积。车辆贴图不进 game.js，而是作为独立文件随包发布，
 * 因此"包体"必须是 代码 + 资源 之和 —— 只量 game.js 会漏掉全部素材。
 */
const dirSize = (dir) => {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
};

if (existsSync(h5Bundle)) {
  const src = readFileSync(h5Bundle, 'utf8');
  const size = statSync(h5Bundle).size;
  checks.push([`H5 包体 ${(size / 1024).toFixed(1)} KB ≤ 350KB（游戏代码预算）`, size <= 350 * 1024]);
  // 素材单独设预算：H5 是网络加载，宽松些但不允许无上限
  const h5Assets = dirSize(join(root, 'apps', 'h5', 'dist', 'assets'));
  checks.push([
    `H5 素材 ${(h5Assets / 1024).toFixed(1)} KB ≤ 300KB（贴图预算）`,
    h5Assets <= 300 * 1024,
  ]);
  // levels.verify.json 含每关解答，绝不能进包
  checks.push(['H5 产物不含 solution 字段（levels.verify.json 未进包）', !/"solution"\s*:/.test(src)]);
  checks.push(['H5 产物不含 eval(', !src.includes('eval(')]);
  checks.push(['H5 产物不含 new Function', !src.includes('new Function')]);
} else {
  checks.push(['H5 产物存在', false]);
}

if (existsSync(wxBundle)) {
  const wxDir = join(root, 'apps', 'minigame', 'dist', 'minigame');
  const size = dirSize(wxDir);
  checks.push([
    `小游戏主包 ${(size / 1024).toFixed(1)} KB ≤ 4MB（代码+素材）`,
    size <= 4 * 1024 * 1024,
  ]);
} else {
  checks.push(['小游戏产物存在', false]);
}

let allOk = results.every(([, r]) => r.ok);
for (const [name, pass] of checks) {
  process.stdout.write(`${pass ? '  ✓' : '  ✗'} ${name}\n`);
  if (!pass) allOk = false;
}

process.stdout.write('\n=== 汇总 ===\n');
for (const [name, r] of results) process.stdout.write(`${r.ok ? '  ✓' : '  ✗'} ${name}\n`);
process.stdout.write(allOk ? '\n全部通过\n' : '\n存在失败项\n');
process.exit(allOk ? 0 : 1);
