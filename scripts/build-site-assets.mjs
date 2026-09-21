/**
 * 落地页素材处理 —— design/ 与 packages/render/assets 的素材 → site/assets/
 *
 * 为什么要单独一步（而不是直接引 design/ 下的原图）：
 *   1. design/design.jpg 是 375×667 游戏截图的放大稿，原始 2.9MB。
 *      直接放到页面上会让首屏加载变得不可接受（移动端尤其明显）。
 *   2. design/assets/*.png 的木牌标签同样带"被拍平的透明棋盘格"背景
 *      （与车辆素材同源问题，见 scripts/lib/checkerboard.mjs），需抠除。
 *   3. 车辆贴图必须与游戏内实际使用的那份**完全一致**，
 *      因此直接从 packages/render/assets 复制，而不是重新处理一遍
 *      （重新处理会引入视觉漂移：页面上和游戏里的车长得不一样）。
 *
 * 用法：node scripts/build-site-assets.mjs
 */

import { readdirSync, mkdirSync, statSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { trimBakedCheckerboard } from './lib/checkerboard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const OUT = join(root, 'site', 'assets');
const CARS_SRC = join(root, 'packages', 'render', 'assets', 'assets', 'cars');

mkdirSync(join(OUT, 'labels'), { recursive: true });
mkdirSync(join(OUT, 'cars'), { recursive: true });

const report = [];

// ---------------------------------------------------------------- 主视觉

/**
 * design.jpg 是"目标 UI 稿"，作为落地页 hero 与预览图。
 * 压到 1400px 宽 + JPEG q82 —— 在这个尺寸下肉眼已看不出差别，
 * 体积从 2.9MB 降到约 200KB 量级。
 */
const heroSrc = join(root, 'design', 'design.jpg');
if (existsSync(heroSrc)) {
  const buf = await sharp(heroSrc)
    .resize({ width: 1400, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  writeFileSync(join(OUT, 'hero.jpg'), buf);
  report.push(`  hero.jpg          ${(buf.length / 1024).toFixed(0)} KB`);
} else {
  console.warn('  [skip] design/design.jpg 不存在');
}

// ---------------------------------------------------------------- 木牌标签

const LABELS = ['关卡', '步数', '得分'];
for (const name of LABELS) {
  const src = join(root, 'design', 'assets', `${name}.png`);
  if (!existsSync(src)) continue;
  const cut = await trimBakedCheckerboard(src);
  const buf = await sharp(cut.buffer)
    .resize({ width: 480, fit: 'inside' })
    .png({ compressionLevel: 9, palette: true, quality: 92 })
    .toBuffer();
  writeFileSync(join(OUT, 'labels', `${name}.png`), buf);
  report.push(
    `  labels/${name}.png`.padEnd(20) +
      `${String(cut.contentWidth).padStart(4)}×${String(cut.contentHeight).padEnd(4)} → ` +
      `${(buf.length / 1024).toFixed(0)} KB`,
  );
}

// ---------------------------------------------------------------- 车辆贴图

let carBytes = 0;
if (existsSync(CARS_SRC)) {
  for (const f of readdirSync(CARS_SRC)) {
    if (!f.endsWith('.png')) continue;
    const dst = join(OUT, 'cars', f);
    copyFileSync(join(CARS_SRC, f), dst);
    carBytes += statSync(dst).size;
  }
  report.push(
    `  cars/*.png        共 ${readdirSync(join(OUT, 'cars')).length} 个，${(carBytes / 1024).toFixed(0)} KB`,
  );
} else {
  console.warn('  [skip] 车辆贴图未生成，先跑 npm run assets');
}

console.log('[site] 落地页素材处理完成：');
console.log(report.join('\n'));

// 全站素材预算：页面要能在移动网络下快速打开
const total = report.length
  ? readdirSync(join(OUT, 'labels')).reduce(
      (n, f) => n + statSync(join(OUT, 'labels', f)).size,
      statSync(join(OUT, 'hero.jpg')).size + carBytes,
    )
  : 0;
console.log(`[site] 素材合计 ${(total / 1024).toFixed(0)} KB → ${OUT}`);
