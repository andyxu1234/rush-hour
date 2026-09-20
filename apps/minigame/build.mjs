/**
 * 小游戏构建 —— 用 esbuild 打成一个 IIFE 单文件（docs/02 §6）。
 *
 * 为什么必须是 IIFE 单文件：
 *   小游戏环境**没有** ESM 加载器，也不允许 eval / new Function / 动态 import()，
 *   所有代码必须在 game.js 里同步就绪。
 *
 * 产物：
 *   dist/minigame/game.js         —— 主包（代码 + 内联关卡数据）
 *   dist/minigame/game.json       —— 小游戏配置
 *   dist/minigame/project.config.json
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const outDir = join(here, 'dist', 'minigame');

/** 主包体上限（docs/02 §6）：4MB */
const MAX_MAIN_BYTES = 4 * 1024 * 1024;

const levels = readFileSync(join(root, 'data', 'levels.json'), 'utf8');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const result = await build({
  entryPoints: [join(here, 'src', 'game.ts')],
  outfile: join(outDir, 'game.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2019',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  // 小游戏无 Node/浏览器全局包，禁止任何外部依赖残留
  external: [],
  define: {
    __LEVELS__: levels,
    'process.env.NODE_ENV': '"production"',
  },
  alias: {
    '@rush-hour/core': join(root, 'packages', 'core', 'src', 'index.ts'),
    '@rush-hour/render': join(root, 'packages', 'render', 'src', 'index.ts'),
    '@rush-hour/platform': join(root, 'packages', 'platform', 'src', 'index.ts'),
    '@rush-hour/app-bootstrap': join(root, 'packages', 'app-bootstrap', 'src', 'index.ts'),
  },
  metafile: true,
});

// 小游戏配置
writeFileSync(
  join(outDir, 'game.json'),
  JSON.stringify(
    {
      deviceOrientation: 'portrait',
      showStatusBar: false,
      networkTimeout: { request: 10000 },
      workers: '',
    },
    null,
    2,
  ),
);

writeFileSync(
  join(outDir, 'project.config.json'),
  JSON.stringify(
    {
      description: '汽车华容道',
      appid: 'touristappid',
      setting: { urlCheck: false, es6: false, minified: true, postcss: false },
      compileType: 'game',
      projectname: 'rush-hour',
      libVersion: '3.0.0',
    },
    null,
    2,
  ),
);

const bytes = statSync(join(outDir, 'game.js')).size;
const kb = (bytes / 1024).toFixed(1);

// 包体报告 + 断言
const parts = [];
for (const [file, info] of Object.entries(result.metafile.outputs)) {
  parts.push(`  ${file}: ${(info.bytes / 1024).toFixed(1)} KB`);
}
console.log(`[build:wx] game.js = ${kb} KB`);
console.log(parts.join('\n'));

if (bytes > MAX_MAIN_BYTES) {
  console.error(
    `[build:wx] 包体超限：${kb} KB > ${(MAX_MAIN_BYTES / 1024).toFixed(0)} KB（docs/02 §6 预算）`,
  );
  process.exit(1);
}

// 验证红线：产物中不得出现 eval / new Function（小游戏环境禁止）
const bundle = readFileSync(join(outDir, 'game.js'), 'utf8');
for (const banned of ['new Function', 'eval(']) {
  if (bundle.includes(banned)) {
    console.error(`[build:wx] 产物包含被禁用的构造：${banned}`);
    process.exit(1);
  }
}

console.log(`[build:wx] OK → ${outDir}`);
