/**
 * 车辆素材处理 —— design/assets/*.png → packages/render/assets/cars/*.png
 *
 * 为什么需要这一步（而不是直接引用 design/assets）：
 *   1. 原始素材合计 ~4.4MB，而 H5 产物红线是 350KB。直接用必然构建失败。
 *   2. 棋盘单格在 375×667 下约 50px，车最大不超过 3 格 ≈ 150px。
 *      原始素材 500×300 远超实际绘制尺寸，属于纯浪费。
 *   3. 小游戏主包红线 4MB，同样经不起未压缩素材。
 *
 * 输出策略：
 *   - 每个素材先自动裁掉四周边距（trim），再按「目标显示尺寸 @3x」等比缩放。
 *   - 保留 PNG 透明通道；用 palette 量化在不损失肉眼质量的前提下压体积。
 *   - 尺寸按"网格格数"归一：横向 2 格车输出 width=180（约 2x 逻辑宽），
 *     纵向 2 格车同理。渲染层只按格子拉伸，不关心原始像素。
 *
 * 用法：node scripts/build-car-assets.mjs
 */

import { readdirSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { trimBakedCheckerboard } from './lib/checkerboard.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SRC = join(root, 'design', 'assets');
/**
 * 输出到 `assets/assets/cars` 看着别扭，但这是刻意的：
 *   Vite 的 `publicDir` 会把**目录内容**原样铺到 dist 根下，因此
 *   publicDir=packages/render/assets 时，文件必须位于 assets/cars/ 才能
 *   在产物里落到 dist/assets/cars/ —— 与 car-art.ts 的 spritePath() 一致。
 * 小游戏侧 cpSync 整个 assets 目录，结果同样是 assets/cars/，两端同构。
 */
const OUT = join(root, 'packages', 'render', 'assets', 'assets', 'cars');

/**
 * 素材映射表。
 *
 * 注：design/assets 里的中文文件名与实际内容**对不上**（例如"红色公鸡跑车.png"
 * 其实是淡紫猫咪正面图），因此这里统一按 sprite_* 编号引用，避免被错名误导。
 */
const MAP = [
  // ---- 横向车（dir=H）----
  // 输出宽 180 ≈ 逻辑 90px × 2x。棋盘单格仅 ~50px，2 格车约 100px，
  // 180px 在 3x 屏上仍有 1.8x 余量，肉眼已看不出差别。
  { out: 'h-red-rooster', src: '载具 sprite_020.png', w: 180 },
  { out: 'h-yellow-sheep', src: '载具 sprite_021.png', w: 180 },
  { out: 'h-blue-tractor', src: '载具 sprite_025.png', w: 180 },
  { out: 'h-pink-pig', src: '载具 sprite_038.png', w: 180 },
  { out: 'h-lavender-cat', src: '载具 sprite_040.png', w: 180 },

  // 巴士的原图是直接从素材合辑里截的，顶部带着 "Compact" / "Purple Limo Bus"
  // 两行标注文字，最左侧还有邻车的一角。因此必须先用 crop 把纯车区域框出来，
  // 否则文字会被一起缩放并画到棋盘上（已实测到车身上印着 "Purple Limo Bus"）。
  {
    out: 'h-purple-bus',
    src: '载具 sprite_028.png',
    w: 270,
    crop: { left: 112, top: 44, width: 550, height: 233 },
  },

  /**
   * 纵向 3 格长车（1×3）—— 用**旋转 90° 后的巴士**。
   *
   * 为什么不能复用正面视角的轿车素材：
   *   正面视角（车头朝观察者）只在"1 格宽 × 2 格高"时成立，那时车看起来
   *   就是一辆迎面开来的车。但 1×3 的格位是细长条，把方正的车头图硬拉成
   *   3 格高，会得到一辆被纵向拉变形的车（实测观感就是"车被扯长了"）。
   *   长车的正确画法是**俯视/侧视的长条形象**，因此这里把侧视巴士转 90°，
   *   得到一辆纵向停放的长车 —— 与横向巴士是同一辆车，只是朝向不同。
   */
  {
    out: 'v-purple-bus',
    src: '载具 sprite_028.png',
    w: 90,
    crop: { left: 112, top: 44, width: 550, height: 233 },
    // 逆时针 90°：让车头朝上、车轮朝向与纵向车一致的视觉预期
    rotate: -90,
  },

  // ---- 纵向车（dir=V）----
  // 同理：正面拖拉机原图右侧混入了旁边那辆拖拉机的边缘，裁掉。
  {
    out: 'v-blue-tractor',
    src: '载具 sprite_022.png',
    w: 90,
    crop: { left: 22, top: 0, width: 138, height: 317 },
  },
  { out: 'v-pink-pig', src: '载具 sprite_023.png', w: 90 },
  { out: 'v-lavender-cat', src: '红色公鸡跑车.png', w: 90 },
];

/** 素材里出现过的纯色块/透视稿等不可用项，显式跳过并提示 */
const SKIP = new Set([
  '原始素材合辑.png',
  '蓝色拖拉机.png',
  '粉色小猪面包车.png',
  '载具 sprite_018.png',
  '载具 sprite_019.png',
  '载具 sprite_024.png',
  '载具 sprite_026.png',
  '载具 sprite_027.png',
  '载具 sprite_037.png',
  '载具 sprite_039.png',
]);

mkdirSync(OUT, { recursive: true });

const available = new Set(readdirSync(SRC));
const report = [];
let totalOut = 0;
const missing = [];

for (const m of MAP) {
  if (!available.has(m.src)) {
    missing.push(`${m.out} ← ${m.src}`);
    continue;
  }
  const input = join(SRC, m.src);

  // 第 0 步：若素材混入了标注文字/邻车，先按显式矩形框出纯车区域
  let staged = m.crop ? await sharp(input).extract(m.crop).png().toBuffer() : input;

  // 第 0.5 步：可选旋转（纵向长车复用侧视巴士时用）
  if (m.rotate) staged = await sharp(staged).rotate(m.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

  // 抠掉被拍平的棋盘格背景 + 裁到内容包围盒
  const cut = await trimBakedCheckerboard(staged);

  // 等比缩放到目标宽度（高度按比例自适应）
  const buf = await sharp(cut.buffer)
    .resize({ width: m.w, fit: 'inside', withoutEnlargement: false })
    .png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 })
    .toBuffer();

  const outPath = join(OUT, `${m.out}.png`);
  writeFileSync(outPath, buf);

  const info = await sharp(buf).metadata();
  const kb = (statSync(outPath).size / 1024).toFixed(1);
  totalOut += statSync(outPath).size;
  report.push(
    `  ${m.out.padEnd(20)} ${String(cut.contentWidth).padStart(4)}×${String(cut.contentHeight).padEnd(4)}` +
      ` → ${String(info.width).padStart(4)}×${String(info.height).padEnd(4)}  ${kb.padStart(6)} KB` +
      `  (原 ${cut.width}×${cut.height})`,
  );
}

console.log('[cars] 素材处理完成：');
console.log(report.join('\n'));
console.log(`[cars] 合计 ${(totalOut / 1024).toFixed(1)} KB → ${OUT}`);

if (missing.length) {
  console.warn(`[cars] 缺失素材（将回落为代码绘制）：\n  ${missing.join('\n  ')}`);
}

const skipped = [...available].filter(
  (f) => !MAP.some((m) => m.src === f) && !SKIP.has(f),
);
if (skipped.length) {
  console.warn(`[cars] 未映射的素材（已忽略）：${skipped.join(', ')}`);
}

if (totalOut > 150 * 1024) {
  console.error('[cars] 超出素材预算 150KB，请下调输出宽度或提高压缩强度');
  process.exit(1);
}
