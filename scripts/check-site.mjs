/**
 * 落地页冒烟检查 —— 启动静态服务器 → 打开页面 → 校验资源与试玩入口 → 退出。
 *
 * 为什么需要它：落地页上的图片是"运行期按 URL 加载"的，路径写错时
 * 构建完全不会报错，只有浏览器打开才会发现是 404 空白块。
 * 这里用真实浏览器把所有 <img> 与试玩页都过一遍，把这类错误挡在部署前。
 *
 * 前置：先跑 npm run site:build
 * 用法：node scripts/check-site.mjs
 */

import { createServer } from 'node:http';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const PORT = 4180;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(root, url));
  if (!file.startsWith(root)) return res.writeHead(403).end('Forbidden');
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return res.writeHead(404).end('404');
  res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });

// 1) 所有图片必须真正加载成功（naturalWidth > 0 才算解码成功）
// 跳过尚无 src 的占位图（灯箱预览图在点击前本就是空的）
const brokenImgs = await page.evaluate(() =>
  [...document.images]
    .filter((i) => i.getAttribute('src'))
    .filter((i) => !i.complete || i.naturalWidth === 0)
    .map((i) => i.getAttribute('src')),
);

// 2) 主要区块与关键文案存在
const checks = await page.evaluate(() => ({
  sections: ['overview', 'features', 'shots', 'cars', 'tech'].filter((id) => !document.getElementById(id)),
  shots: document.querySelectorAll('.shot').length,
  cars: document.querySelectorAll('.car-card').length,
  playHref: document.querySelector('a[href="play/"]')?.getAttribute('href') ?? null,
}));

// 3) 试玩页能正常启动（等 __RUSH_HOUR__ 就绪）
await page.goto(`http://localhost:${PORT}/play/`, { waitUntil: 'load' });
let playOk = false;
try {
  await page.waitForFunction(() => Boolean(window.__RUSH_HOUR__), null, { timeout: 15000 });
  playOk = true;
} catch {
  /* playOk 保持 false，下面统一报错 */
}

await browser.close();
server.close();

const fail = (m) => {
  problems.push(m);
};

if (brokenImgs.length) fail(`图片未加载成功：${brokenImgs.join(', ')}`);
if (checks.sections.length) fail(`缺少区块：${checks.sections.join(', ')}`);
if (checks.shots !== 7) fail(`截图数量异常：${checks.shots}（期望 7）`);
if (checks.cars !== 10) fail(`车辆卡片数量异常：${checks.cars}（期望 10）`);
if (!checks.playHref) fail('未找到「在线试玩」入口');
if (!playOk) fail('试玩页 /play/ 未能启动（__RUSH_HOUR__ 未就绪）');

if (problems.length) {
  console.error('[site:check] 发现问题：');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log('[site:check] 通过：图片全部加载、区块齐全、试玩页可启动');
