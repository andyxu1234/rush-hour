/**
 * 截图脚本 —— 从真实运行的游戏里抓取各屏幕截图，供落地页 / README 使用。
 *
 * 为什么不用"另画一张图"：落地页上的界面必须是**真实运行结果**，
 * 否则会与实现漂移（改一次 UI 就要重画一次）。这里用 Playwright 驱动
 * http://localhost:4173 上的构建产物，跑一次就能拿到全套截图。
 *
 * 前置：先起预览服务器
 *   npm run build:h5 && npm run preview
 * 用法：
 *   node scripts/capture-screens.mjs [输出目录]
 * 默认输出到 site/assets/shots/
 */

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT = join(root, process.argv[2] ?? 'site/assets/shots');
const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173/';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 375, height: 667 },
  deviceScaleFactor: 3,
});

// 收集控制台错误：截图脚本顺带当 smoke 用，页面报错要能立刻发现
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__RUSH_HOUR__), null, { timeout: 15000 });
// 跳过启动页与新手引导，直接进入主菜单
await page.waitForFunction(() => window.__RUSH_HOUR__.nav.current() === 'menu', null, {
  timeout: 15000,
});
await page.evaluate(() => {
  window.__RUSH_HOUR__.save.tutorialDone = true;
});

/** 等画布画完一帧（rAF 两次确保绘制与贴图都就绪） */
const settle = async (ms = 900) => {
  await page.waitForTimeout(ms);
};

const shot = async (name) => {
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${name}.png`);
};

const goto = async (id) => {
  await page.evaluate((s) => window.__RUSH_HOUR__.nav.reset(s), id);
  await page.waitForFunction((s) => window.__RUSH_HOUR__.nav.current() === s, id, {
    timeout: 5000,
  });
};

console.log('[capture] 开始截图 →', OUT);

// ---- 1. 主菜单 ----
await goto('menu');
await settle(1200);
await shot('menu');

// ---- 2. 选关页 ----
await goto('select');
await settle();
await shot('select');

// ---- 3. 对局页（c015 车型最丰富：含横/纵/3 格车）----
await page.evaluate(() => window.__RUSH_HOUR__.nav.openLevel('c015', 'select'));
await page.waitForFunction(() => window.__RUSH_HOUR__.nav.current() === 'game', null, {
  timeout: 5000,
});
// 等贴图加载完成（首次加载是异步的，早截会拍到矢量回落的色块车）
await settle(2500);
await shot('game');

// ---- 4. 拖拽中（显示可滑动虚影）----
await page.evaluate(() => {
  const api = window.__RUSH_HOUR__;
  const m = api.screen.bestNextMove();
  if (m) api.screen.applyMove(m);
});
await settle(700);
await shot('game-move');

// ---- 5. 结算弹窗（完美通关）----
await page.evaluate(() => window.__RUSH_HOUR__.screen.forceSolveReport());
await settle(2200);
await shot('win');

// ---- 6. 设置页 ----
await goto('settings');
await settle();
await shot('settings');

// ---- 7. 排行榜 ----
await goto('leaderboard');
await settle();
await shot('leaderboard');

await browser.close();

console.log(`[capture] 完成，共 7 张 → ${OUT}`);
if (errors.length) {
  console.error('[capture] 页面存在 console 错误：');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}
