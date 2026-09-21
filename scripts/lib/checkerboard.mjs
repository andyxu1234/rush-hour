/**
 * 素材后处理共用工具 —— 抠除"被拍平的透明棋盘格"背景 + 裁到内容包围盒。
 *
 * 背景（为什么所有素材都需要这一步）：
 *   设计稿导出的 PNG 虽然带 alpha 通道，但 **alpha 全是 255** ——
 *   原本的透明区被导出成了 Photoshop 那种灰白相间的棋盘格像素
 *   （254 / 212 两级灰），也就是说"透明"是画上去的，不是真的透明。
 *   不抠除的话，棋盘格会跟着车/木牌一起画到页面上。
 *
 * 被 build-car-assets.mjs 与 build-site-assets.mjs 共用，故抽到此处。
 */

import sharp from 'sharp';

/** 亮度下限：背景棋盘格是 212 / 254，JPEG 式压缩噪声会让边缘落到 190~210 */
const LUM_MIN = 150;
const LUM_MAX = 256;
/** 三通道极差上限：只清"无彩色的灰"，保住浅黄/米白等高光 */
const SAT_MAX = 22;

/**
 * 抠掉棋盘格背景并裁到内容包围盒。
 *
 * @param {Buffer|string} input 图片路径或缓冲区
 * @returns {Promise<{buffer: Buffer, width: number, height: number, contentWidth: number, contentHeight: number}>}
 */
export async function trimBakedCheckerboard(input) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.from(data);

  // ---- 第 1 步：把"低饱和 + 中高亮度"的像素置为全透明 ----
  //
  // 阈值取 150 而非 190：车身下方的柔和阴影与棋盘格**混合**后会产生
  // 170~215 的中灰，阈值太高会残留一圈"棋盘格尾巴"。
  // 再叠一道"三通道极差 ≤ 22"的约束，避免误伤浅色的高光与玻璃反光。
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const r = out[o];
    const g = out[o + 1];
    const b = out[o + 2];
    const lum = (r + g + b) / 3;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum >= LUM_MIN && lum <= LUM_MAX && spread <= SAT_MAX) out[o + 3] = 0;
  }

  // ---- 第 2 步：求内容包围盒 ----
  //
  // 不用 sharp 的 trim()：即使显式传全透明 background，实测仍原样返回原尺寸
  // （透明边距裁不掉）。这里已经逐像素遍历过，自己算包围盒更可控。
  //
  // 用"逐行/逐列计数 + 最小密度"而不是单像素判定：
  // 单个压缩噪点就能让包围盒贴满整张图，必须按行/列的占比过滤。
  const colCount = new Int32Array(width);
  const rowCount = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (out[(y * width + x) * channels + 3] === 0) continue;
      colCount[x]++;
      rowCount[y]++;
    }
  }
  const minColPx = Math.max(2, Math.round(height * 0.02));
  const minRowPx = Math.max(2, Math.round(width * 0.02));

  let minX = 0;
  while (minX < width && colCount[minX] < minColPx) minX++;
  let maxX = width - 1;
  while (maxX > minX && colCount[maxX] < minColPx) maxX--;
  let minY = 0;
  while (minY < height && rowCount[minY] < minRowPx) minY++;
  let maxY = height - 1;
  while (maxY > minY && rowCount[maxY] < minRowPx) maxY--;

  const raw = sharp(out, { raw: { width, height, channels } });

  // 整张图都是背景（没有任何内容）时原样返回
  if (maxX < minX || maxY < minY) {
    return {
      buffer: await raw.png().toBuffer(),
      width,
      height,
      contentWidth: width,
      contentHeight: height,
    };
  }

  // 四周留 1px 余量，避免描边正好贴边被切掉
  const left = Math.max(0, minX - 1);
  const top = Math.max(0, minY - 1);
  const cw = Math.min(width - left, maxX - minX + 3);
  const chh = Math.min(height - top, maxY - minY + 3);

  const buffer = await raw.extract({ left, top, width: cw, height: chh }).png().toBuffer();
  return { buffer, width, height, contentWidth: cw, contentHeight: chh };
}
