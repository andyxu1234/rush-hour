/**
 * 农场风格图元绘制 —— 游戏页的"美术层"。
 *
 * 目标：对齐 design/ 下的高保真稿（卡通 Q 版农场），但**全部用 Canvas 矢量绘制**。
 * 为什么不用 design/assets 里的散图：
 *   1. 那批素材的命名与内容不一致（见 scripts/build-car-assets.mjs 的注释），
 *      且高保真稿里的栅栏/干草/雏菊/石砖在 assets 里**没有对应文件**；
 *   2. 矢量在任意 DPR 下都锐利，且不占包体预算（docs/01 §7 的美术原则）。
 *   因此只有车辆走位图（packages/render/assets/cars），UI 与场景全部代码绘制。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx（.eslintrc.cjs 强制）。
 *    只允许使用 CanvasRenderingContext2DLike 声明过的成员。
 */

import type { CanvasRenderingContext2DLike } from '@rush-hour/platform';
import { FARM, cartoonFont, clamp, noise01 } from './farm-theme';
import { roundRectPath } from './ui';
import { hudButtons, pauseGeometry, topBarGeometry, type Layout } from './layout';

const TAU = Math.PI * 2;

// ================================================================ 文本

export interface CartoonTextOptions {
  size: number;
  fill?: string;
  stroke?: string;
  /** 描边宽度；显式传 0 可关闭描边 */
  outline?: number;
  align?: 'left' | 'center' | 'right';
  maxWidth?: number;
  weight?: '600' | '700' | '800';
}

/**
 * 卡通粗体字：奶白填充 + 深棕描边。
 *
 * 描边走 `ctx.strokeText`（跨端均支持），但接口把它声明为**可选**
 * （小游戏低版本 canvas 可能缺），缺失时自动退化为纯填充 —— 绝不因描边而丢字。
 */
export function drawCartoonText(
  ctx: CanvasRenderingContext2DLike,
  text: string,
  x: number,
  y: number,
  o: CartoonTextOptions,
): void {
  ctx.save();
  ctx.font = cartoonFont(o.size, o.weight ?? '800');
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = 'middle';

  const outline = o.outline ?? Math.max(2, o.size * 0.28);
  if (outline > 0 && typeof ctx.strokeText === 'function') {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = outline;
    ctx.strokeStyle = o.stroke ?? FARM.outline;
    if (o.maxWidth !== undefined) ctx.strokeText(text, x, y, o.maxWidth);
    else ctx.strokeText(text, x, y);
  }

  ctx.fillStyle = o.fill ?? FARM.cream;
  if (o.maxWidth !== undefined) ctx.fillText(text, x, y, o.maxWidth);
  else ctx.fillText(text, x, y);
  ctx.restore();
}

// ================================================================ 木质件

/** 一根木头（横杆 / 立柱 / 木板）：圆角 + 木色 + 深色描边 */
export function woodBar(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  light = false,
): void {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  const r = Math.min(h / 2, w / 2, 6);
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = light ? FARM.woodLight : FARM.wood;
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, h * 0.2);
  ctx.strokeStyle = FARM.woodEdge;
  ctx.stroke();
  ctx.restore();
}

/**
 * 木牌（顶部信息栏 / 弹窗面板）。
 *
 * 结构：外描边 → 木色渐变 → 顶部高光带 → 木纹 → 两端铆钉。
 * 这些细节让"一块木板"在放大到 300px 宽时仍然有材质感，而不是一个纯色块。
 */
export function drawWoodPlate(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { radius?: number; grain?: boolean; nails?: boolean } = {},
): void {
  if (w <= 0 || h <= 0) return;
  const r = clamp(opts.radius ?? h * 0.32, 4, Math.min(w, h) / 2);

  ctx.save();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, FARM.woodLight);
  g.addColorStop(0.42, FARM.wood);
  g.addColorStop(1, FARM.woodMid);
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(2, h * 0.11);
  ctx.strokeStyle = FARM.woodEdge;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();

  // 顶部高光
  ctx.fillStyle = 'rgba(255,246,224,0.34)';
  roundRectPath(ctx, x + r * 0.5, y + h * 0.14, Math.max(0, w - r), Math.max(1, h * 0.16), h * 0.08);
  ctx.fill();

  if (opts.grain !== false) {
    ctx.strokeStyle = FARM.woodGrain;
    ctx.lineWidth = Math.max(1, h * 0.045);
    for (let i = 1; i <= 2; i++) {
      const gy = y + (h * i) / 3;
      ctx.beginPath();
      ctx.moveTo(x + r * 0.4, gy);
      ctx.quadraticCurveTo(x + w / 2, gy + h * 0.06, x + w - r * 0.4, gy);
      ctx.stroke();
    }
  }
  ctx.restore();

  if (opts.nails !== false && r >= 6) {
    const nr = clamp(h * 0.055, 1.2, 3);
    ctx.save();
    ctx.fillStyle = FARM.woodNail;
    for (const nx of [x + r * 0.75, x + w - r * 0.75]) {
      for (const ny of [y + h * 0.28, y + h * 0.72]) {
        ctx.beginPath();
        ctx.arc(nx, ny, nr, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

/** 圆角木质大按钮（底部操作区）——按 `pressed` 缩小到 0.94 并压暗 */
export function drawWoodButton(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  pressed: boolean,
  disabled: boolean,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const s = pressed ? 0.94 : 1;
  ctx.save();
  ctx.translate(cx, cy + (pressed ? h * 0.02 : 0));
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);

  if (disabled) ctx.globalAlpha = 0.45;

  // 底面阴影
  ctx.save();
  ctx.shadowColor = 'rgba(60,38,10,0.35)';
  ctx.shadowBlur = Math.max(4, h * 0.12);
  ctx.shadowOffsetY = Math.max(2, h * 0.06);
  roundRectPath(ctx, x, y, w, h, w * 0.26);
  ctx.fillStyle = FARM.woodMid;
  ctx.fill();
  ctx.restore();

  drawWoodPlate(ctx, x, y, w, h, { radius: w * 0.26, nails: false });

  // 内圈压印线，让按钮像一块有厚度的木牌
  ctx.save();
  ctx.strokeStyle = 'rgba(107,69,30,0.22)';
  ctx.lineWidth = Math.max(1, w * 0.02);
  roundRectPath(ctx, x + w * 0.09, y + h * 0.09, w * 0.82, h * 0.82, w * 0.2);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

/** 悬挂木牌（关卡 / 步数）——顶部两根小绳，呼应高保真稿里的吊牌 */
export function drawHangingPlate(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { radius?: number } = {},
): void {
  const rope = Math.max(2, h * 0.16);
  const top = y - rope * 2.4;
  ctx.save();
  ctx.strokeStyle = '#7A5A32';
  ctx.lineWidth = Math.max(1.5, rope * 0.5);
  ctx.lineCap = 'round';
  for (const t of [0.22, 0.78]) {
    const rx = x + w * t;
    ctx.beginPath();
    ctx.moveTo(rx, top);
    ctx.lineTo(rx, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rx, top, rope * 0.55, 0, TAU);
    ctx.fillStyle = '#8B6534';
    ctx.fill();
  }
  ctx.restore();
  drawWoodPlate(ctx, x, y, w, h, { radius: opts.radius ?? h * 0.3 });
}

// ================================================================ 图标

export type FarmIcon = 'pause' | 'sound' | 'soundOff' | 'hint' | 'reset' | 'undo';

/**
 * 圆形箭头（重置 ⟳ / 撤销 ↺）。
 *
 * 箭头三角由"弧上相邻两点"的切线方向推出，因此改半径/改缺口都不会让箭头指歪。
 */
export function drawCircularArrow(
  ctx: CanvasRenderingContext2DLike,
  cx: number,
  cy: number,
  r: number,
  color: string,
  clockwise: boolean,
): void {
  const aHead = clockwise ? -Math.PI * 0.35 : -Math.PI * 0.65;
  const span = Math.PI * 1.45;
  const aStart = clockwise ? aHead - span : aHead + span;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, r * 0.34);
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, aStart, aHead, !clockwise);
  ctx.stroke();

  const hx = cx + r * Math.cos(aHead);
  const hy = cy + r * Math.sin(aHead);
  // 沿弧前进方向的切线
  const tx = clockwise ? -Math.sin(aHead) : Math.sin(aHead);
  const ty = clockwise ? Math.cos(aHead) : -Math.cos(aHead);
  const px = -ty;
  const py = tx;
  const s = r * 0.66;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(hx + tx * s * 0.95, hy + ty * s * 0.95);
  ctx.lineTo(hx + px * s * 0.8 - tx * s * 0.15, hy + py * s * 0.8 - ty * s * 0.15);
  ctx.lineTo(hx - px * s * 0.8 - tx * s * 0.15, hy - py * s * 0.8 - ty * s * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 小灯泡（提示） */
export function drawBulb(
  ctx: CanvasRenderingContext2DLike,
  cx: number,
  cy: number,
  r: number,
  lit: boolean,
): void {
  ctx.save();
  // 光晕
  if (lit) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#FFE48A';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.5, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // 玻壳
  ctx.fillStyle = lit ? '#FFE066' : '#E7D9A8';
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.12, r * 0.78, Math.PI * 0.98, Math.PI * 2.02);
  ctx.quadraticCurveTo(cx + r * 0.5, cy + r * 0.72, cx - r * 0.5, cy + r * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, r * 0.16);
  ctx.strokeStyle = FARM.outline;
  ctx.stroke();
  // 灯头
  ctx.fillStyle = '#B6B2AC';
  roundRectPath(ctx, cx - r * 0.36, cy + r * 0.6, r * 0.72, r * 0.44, r * 0.14);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** 喇叭（音效开关） */
export function drawSpeaker(
  ctx: CanvasRenderingContext2DLike,
  cx: number,
  cy: number,
  r: number,
  on: boolean,
): void {
  ctx.save();
  ctx.fillStyle = FARM.cream;
  // 箱体
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.9, cy - r * 0.3);
  ctx.lineTo(cx - r * 0.35, cy - r * 0.3);
  ctx.lineTo(cx + r * 0.1, cy - r * 0.85);
  ctx.lineTo(cx + r * 0.1, cy + r * 0.85);
  ctx.lineTo(cx - r * 0.35, cy + r * 0.3);
  ctx.lineTo(cx - r * 0.9, cy + r * 0.3);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = Math.max(1.2, r * 0.14);
  ctx.strokeStyle = FARM.outline;
  ctx.stroke();

  ctx.strokeStyle = FARM.cream;
  ctx.lineWidth = Math.max(1.4, r * 0.16);
  ctx.lineCap = 'round';
  if (on) {
    ctx.beginPath();
    ctx.arc(cx + r * 0.2, cy, r * 0.62, -Math.PI * 0.32, Math.PI * 0.32);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + r * 0.2, cy, r * 1.02, -Math.PI * 0.3, Math.PI * 0.3);
    ctx.stroke();
  } else {
    const d = r * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx + d * 0.4, cy - d * 0.6);
    ctx.lineTo(cx + d * 1.5, cy + d * 0.6);
    ctx.moveTo(cx + d * 1.5, cy - d * 0.6);
    ctx.lineTo(cx + d * 0.4, cy + d * 0.6);
    ctx.stroke();
  }
  ctx.restore();
}

/** 暂停（两根竖条） */
export function drawPauseBars(
  ctx: CanvasRenderingContext2DLike,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.save();
  ctx.fillStyle = FARM.cream;
  roundRectPath(ctx, cx - r * 0.62, cy - r * 0.8, r * 0.46, r * 1.6, r * 0.16);
  ctx.fill();
  roundRectPath(ctx, cx + r * 0.16, cy - r * 0.8, r * 0.46, r * 1.6, r * 0.16);
  ctx.fill();
  ctx.restore();
}

/** 金币 */
export function drawCoin(ctx: CanvasRenderingContext2DLike, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fillStyle = FARM.coin;
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, r * 0.2);
  ctx.strokeStyle = FARM.coinEdge;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.6, 0, TAU);
  ctx.strokeStyle = FARM.coinDark;
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.stroke();
  // 高光
  ctx.beginPath();
  ctx.arc(cx - r * 0.28, cy - r * 0.3, r * 0.22, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.restore();
}

// ================================================================ 场景装饰

/** 一簇草 */
export function drawGrassTuft(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  r: number,
  dark = false,
): void {
  ctx.save();
  ctx.strokeStyle = dark ? FARM.grassDark : FARM.grassTuft;
  ctx.lineWidth = Math.max(1.3, r * 0.3);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const k of [-1, 0, 1]) {
    const dx = k * r * 0.5;
    ctx.moveTo(x + dx, y);
    ctx.quadraticCurveTo(x + dx + k * r * 0.4, y - r * 0.8, x + dx + k * r * 0.95, y - r * 1.45);
  }
  ctx.stroke();
  ctx.restore();
}

/** 小雏菊 */
export function drawDaisy(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.fillStyle = FARM.daisy;
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + (k * TAU) / 5;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.72, y + Math.sin(a) * r * 0.72, r * 0.46, 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, r * 0.4, 0, TAU);
  ctx.fillStyle = FARM.daisyCenter;
  ctx.fill();
  ctx.restore();
}

/** 小石子 */
export function drawPebble(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.fillStyle = '#B9B2A4';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.arc(x - r * 0.25, y - r * 0.3, r * 0.36, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** 干草垛 */
export function drawHayBale(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, '#F7DC90');
  g.addColorStop(1, FARM.hayDark);
  roundRectPath(ctx, x, y, w, h, Math.min(h * 0.28, 7));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, h * 0.09);
  ctx.strokeStyle = FARM.hayBand;
  ctx.stroke();

  ctx.save();
  roundRectPath(ctx, x, y, w, h, Math.min(h * 0.28, 7));
  ctx.clip();
  ctx.strokeStyle = 'rgba(176,133,53,0.55)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const ly = y + (h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(x, ly);
    ctx.lineTo(x + w, ly);
    ctx.stroke();
  }
  // 横向捆绳
  ctx.strokeStyle = FARM.hayBand;
  ctx.lineWidth = Math.max(1.6, h * 0.1);
  for (const t of [0.3, 0.7]) {
    const lx = x + w * t;
    ctx.beginPath();
    ctx.moveTo(lx, y);
    ctx.lineTo(lx, y + h);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

/** 木栅栏（一段）：先立柱后横杆，保证交叉处的遮挡关系正确 */
export function drawFenceRail(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (w <= 6 || h <= 6) return;
  const postW = clamp(h * 0.24, 4, 12);
  const posts = Math.max(2, Math.round(w / (postW * 4.5)));
  for (let i = 0; i <= posts; i++) {
    const px = x + (i / posts) * (w - postW);
    woodBar(ctx, px, y - h * 0.04, postW, h * 1.02);
  }
  const railH = clamp(h * 0.2, 3, 9);
  for (const t of [0.2, 0.6]) woodBar(ctx, x, y + h * t, w, railH);
}

/** 谷仓（点缀，放在棋盘外的草地上） */
export function drawBarn(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  const bodyH = h * 0.66;
  const bodyY = y + h - bodyH;
  // 屋顶
  ctx.beginPath();
  ctx.moveTo(x - w * 0.06, bodyY + h * 0.06);
  ctx.lineTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 1.06, bodyY + h * 0.06);
  ctx.closePath();
  ctx.fillStyle = FARM.barnRoof;
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, h * 0.06);
  ctx.strokeStyle = FARM.outline;
  ctx.stroke();
  // 墙体
  roundRectPath(ctx, x, bodyY, w, bodyH, Math.max(2, w * 0.06));
  ctx.fillStyle = FARM.barnWall;
  ctx.fill();
  ctx.stroke();
  // 门（白色 X 纹，谷仓的经典标记）
  const dw = w * 0.44;
  const dh = bodyH * 0.62;
  const dx = x + (w - dw) / 2;
  const dy = bodyY + bodyH - dh;
  ctx.fillStyle = '#F3E4C8';
  roundRectPath(ctx, dx, dy, dw, dh, Math.max(1, dw * 0.1));
  ctx.fill();
  ctx.strokeStyle = FARM.outline;
  ctx.lineWidth = Math.max(1, h * 0.04);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(dx, dy);
  ctx.lineTo(dx + dw, dy + dh);
  ctx.moveTo(dx + dw, dy);
  ctx.lineTo(dx, dy + dh);
  ctx.lineWidth = Math.max(1, dw * 0.1);
  ctx.strokeStyle = FARM.barnRoof;
  ctx.stroke();
  ctx.restore();
}

// ================================================================ 棋盘

/**
 * 草地背景 + 草地上的点缀。
 *
 * 点缀位置全部由 `noise01` 确定性生成（同一 seed 永远同一坐标）：
 * 若用 Math.random()，草地会在每一帧重排，观感是整片草地都在抖。
 */
export function drawFarmBackground(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  frame: number,
): void {
  const { width, height } = layout;
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, FARM.grassTop);
  g.addColorStop(0.5, FARM.grassMid);
  g.addColorStop(1, FARM.grassBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // 割草机条纹：交替的极浅色竖带，让大片草地有层次而不需要纹理
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#FFFFFF';
  const stripes = 6;
  for (let i = 0; i < stripes; i++) {
    if (i % 2) continue;
    ctx.fillRect((width / stripes) * i, 0, width / stripes, height);
  }
  ctx.restore();

  // 棋盘（含外框）的禁放区：点缀不得压到棋盘上
  const pad = frame + 14;
  const bx0 = layout.boardX - pad;
  const bxy0 = layout.boardY - pad;
  const bx1 = layout.boardX + layout.boardSize + pad;
  const bxy1 = layout.boardY + layout.boardSize + pad;
  const blocked = (x: number, y: number) => x > bx0 && x < bx1 && y > bxy0 && y < bxy1;

  const minSide = Math.min(width, height);
  const count = Math.round(clamp((width * height) / 7200, 20, 64));
  for (let i = 0; i < count; i++) {
    const s = i * 17;
    const x = noise01(s + 1) * width;
    const y = noise01(s + 2) * height;
    if (blocked(x, y)) continue;
    const roll = noise01(s + 3);
    const r = minSide * (0.012 + noise01(s + 4) * 0.014);
    if (roll < 0.16) drawDaisy(ctx, x, y, r * 1.15);
    else if (roll < 0.24) drawPebble(ctx, x, y, r * 0.6);
    else drawGrassTuft(ctx, x, y, r, roll > 0.7);
  }

  drawSceneryProps(ctx, layout, frame);
}

/**
 * 农场景物：棋盘上方的木栅栏、左下角的谷仓、右下角的干草垛。
 *
 * 为什么全部按 layout **现算**而不是写死坐标：棋盘尺寸随屏幕变化
 * （375×667 与 768×1024 的格子差 2 倍），写死坐标会在某些机型上
 * 直接叠到棋盘或底部操作区上。这里只用"相对棋盘/屏幕的位置"。
 */
export function drawSceneryProps(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  frame: number,
): void {
  const { boardX, boardY, boardSize, height, bottomBarH, width } = layout;

  // —— 棋盘上方的一整道木栅栏：让棋盘像被围在农场院子里 ——
  const marginTop = boardY - layout.hudHeight;
  const fenceH = clamp(marginTop * 0.34, 16, 34);
  const fenceY = boardY - frame - fenceH - 3;
  if (fenceY > layout.hudHeight + 4) {
    drawFenceRail(ctx, boardX - 2, fenceY, boardSize + 4, fenceH);
  }

  // —— 棋盘与底部操作区之间的草地带 ——
  const stripY = boardY + boardSize + frame;
  const stripH = height - bottomBarH - stripY;
  if (stripH < 44) return;

  const barnH = clamp(stripH * 0.6, 28, 56);
  const barnW = barnH * 1.18;
  drawBarn(ctx, boardX - frame * 0.4, stripY + (stripH - barnH) * 0.62, barnW, barnH);

  const hayH = clamp(stripH * 0.4, 20, 36);
  const hayW = hayH * 1.35;
  const hayY = stripY + (stripH - hayH) * 0.45;
  drawHayBale(ctx, width - boardX - hayW, hayY, hayW, hayH);
  drawHayBale(ctx, width - boardX - hayW * 2 - 8, hayY + hayH * 0.28, hayW * 0.85, hayH * 0.82);
}

/** 棋盘外框：地面投影 + 木框 + 铆钉 + 四角草丛 */
export function drawBoardFrame(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  frame: number,
): void {
  const { boardX, boardY, boardSize } = layout;
  const outerX = boardX - frame;
  const outerY = boardY - frame;
  const outerS = boardSize + frame * 2;
  const outerR = frame + 10;

  // 地面投影
  ctx.save();
  ctx.shadowColor = 'rgba(38,54,18,0.30)';
  ctx.shadowBlur = Math.max(8, frame * 1.4);
  ctx.shadowOffsetY = Math.max(3, frame * 0.6);
  roundRectPath(ctx, outerX, outerY, outerS, outerS, outerR);
  ctx.fillStyle = FARM.woodMid;
  ctx.fill();
  ctx.restore();

  // 木框本体
  ctx.save();
  const g = ctx.createLinearGradient(outerX, outerY, outerX, outerY + outerS);
  g.addColorStop(0, FARM.woodLight);
  g.addColorStop(0.5, FARM.wood);
  g.addColorStop(1, FARM.woodDark);
  roundRectPath(ctx, outerX, outerY, outerS, outerS, outerR);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = Math.max(2, frame * 0.24);
  ctx.strokeStyle = FARM.woodEdge;
  ctx.stroke();
  ctx.restore();

  // 木纹（三条内缩的圆角环）
  ctx.save();
  ctx.strokeStyle = FARM.woodGrain;
  ctx.lineWidth = Math.max(1, frame * 0.1);
  for (let i = 1; i <= 3; i++) {
    const inset = (frame * i) / 4.2;
    roundRectPath(
      ctx,
      outerX + inset,
      outerY + inset,
      outerS - inset * 2,
      outerS - inset * 2,
      Math.max(2, outerR - inset),
    );
    ctx.stroke();
  }
  ctx.restore();

  // 内凹槽：棋盘底色（石砖之间的缝隙就是这个颜色）
  ctx.save();
  roundRectPath(ctx, boardX, boardY, boardSize, boardSize, Math.max(4, frame * 0.5));
  ctx.fillStyle = FARM.soilDeep;
  ctx.fill();
  ctx.restore();

  // 铆钉
  ctx.save();
  ctx.fillStyle = FARM.woodNail;
  const nr = clamp(frame * 0.3, 1.5, 5);
  const off = frame * 0.5;
  for (const [nx, ny] of [
    [outerX + off, outerY + off],
    [outerX + outerS - off, outerY + off],
    [outerX + off, outerY + outerS - off],
    [outerX + outerS - off, outerY + outerS - off],
  ]) {
    ctx.beginPath();
    ctx.arc(nx, ny, nr, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  // 四角草丛：让木框像是"长在草地里"，而不是贴在草地上
  const cr = frame * 0.85;
  drawGrassTuft(ctx, outerX + cr * 0.6, outerY + cr * 0.5, cr, true);
  drawGrassTuft(ctx, outerX + outerS - cr * 0.6, outerY + cr * 0.5, cr * 0.9, true);
  drawGrassTuft(ctx, outerX + cr * 0.5, outerY + outerS - cr * 0.35, cr * 0.85, true);
  drawGrassTuft(ctx, outerX + outerS - cr * 0.5, outerY + outerS - cr * 0.35, cr, true);
}

/**
 * 6×6 石板砖。
 *
 * 每块砖都是"浅灰米色 + 顶部高光 + 底部压边 + 描边"，约一半的砖额外带 1~2 道裂纹
 * （裂纹位置由 noise01 决定，因此不会逐帧变化）。
 */
export function drawStoneTiles(ctx: CanvasRenderingContext2DLike, layout: Layout): void {
  const { boardX, boardY, cell } = layout;
  const pad = Math.max(1.5, cell * 0.05);
  const radius = Math.max(2, cell * 0.13);
  const stoneColors = [FARM.stone, FARM.stoneAlt, FARM.stoneWarm];

  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const x = boardX + c * cell + pad;
      const y = boardY + r * cell + pad;
      const w = cell - pad * 2;
      const h = cell - pad * 2;
      const seed = r * 31 + c * 7;

      ctx.save();
      ctx.fillStyle = stoneColors[Math.floor(noise01(seed + 1) * 3) % 3];
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.fill();

      // 顶部高光
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      roundRectPath(ctx, x + w * 0.08, y + h * 0.07, w * 0.84, Math.max(1.5, h * 0.08), h * 0.04);
      ctx.fill();

      // 底部压边
      ctx.fillStyle = 'rgba(150,132,100,0.28)';
      roundRectPath(ctx, x + w * 0.08, y + h * 0.85, w * 0.84, Math.max(1.5, h * 0.07), h * 0.035);
      ctx.fill();

      // 描边
      ctx.lineWidth = Math.max(1, cell * 0.022);
      ctx.strokeStyle = FARM.stoneEdge;
      roundRectPath(ctx, x, y, w, h, radius);
      ctx.stroke();

      // 裂纹
      const roll = noise01(seed + 2);
      if (roll > 0.36) {
        ctx.strokeStyle = FARM.crack;
        ctx.lineWidth = Math.max(1, cell * 0.02);
        ctx.beginPath();
        const sx = x + w * (0.2 + noise01(seed + 3) * 0.3);
        const sy = y + h * (0.18 + noise01(seed + 4) * 0.3);
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + w * 0.16, sy + h * 0.18);
        ctx.lineTo(sx + w * 0.06, sy + h * 0.38);
        if (roll > 0.78) {
          ctx.moveTo(sx + w * 0.16, sy + h * 0.18);
          ctx.lineTo(sx + w * 0.4, sy + h * 0.26);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 砖缝：横竖各 5 条，压在石砖之间的凹槽上
  ctx.save();
  ctx.strokeStyle = 'rgba(70,50,22,0.22)';
  ctx.lineWidth = Math.max(1, cell * 0.028);
  for (let i = 1; i < 6; i++) {
    const x = boardX + i * cell;
    ctx.beginPath();
    ctx.moveTo(x, boardY + pad * 0.5);
    ctx.lineTo(x, boardY + cell * 6 - pad * 0.5);
    ctx.stroke();
    const y = boardY + i * cell;
    ctx.beginPath();
    ctx.moveTo(boardX + pad * 0.5, y);
    ctx.lineTo(boardX + cell * 6 - pad * 0.5, y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 出口：木栅栏缺口 + 敞开门扇 + 发光绿色引导箭头 + 「出口」木牌。
 *
 * `pulse` 由调用方按时间给出（像素），让箭头有轻微呼吸感，引导玩家注意目标。
 *
 * 关于窄屏：出口通道只占短边的 ~9%（约 34px），横向排不下"出口"两个字。
 * 因此当牌子宽度不足时**主动改为竖排两字**，而不是让 fillText 的 maxWidth
 * 把字挤扁 —— 挤扁后的字在真机上完全看不懂。
 */
export function drawExitGate(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  frame: number,
  exitRow: number,
  pulse: number,
): void {
  const { boardX, boardY, boardSize, cell, width } = layout;
  const exitX = boardX + boardSize;
  const y = boardY + exitRow * cell;
  const barH = clamp(frame * 0.55, 3, 11);

  // 1) 在木框上开一道缺口（露出"通道"）
  ctx.save();
  ctx.fillStyle = FARM.soilDeep;
  roundRectPath(ctx, exitX - 1, y + cell * 0.05, frame + 4, cell * 0.9, 3);
  ctx.fill();
  ctx.restore();

  // 2) 缺口上下两根横杆 + 外侧两根立柱 —— 读作"栅栏上的一个门洞"
  for (const by of [y - barH * 0.1, y + cell - barH * 0.9]) {
    woodBar(ctx, exitX - 1, by, frame + 6, barH, true);
  }
  const postW = Math.max(3, barH * 0.9);
  for (const py of [y - barH * 0.5, y + cell - barH * 0.5]) {
    woodBar(ctx, exitX + frame + 5 - postW, py, postW, barH * 2.4);
  }

  // 3) 发光绿色箭头（出场方向 = 向右）
  const cy = y + cell / 2;
  const size = clamp(cell * 0.34, 8, 22) + pulse;
  const ax = exitX + frame * 0.35 + size * 0.6;
  ctx.save();
  ctx.shadowColor = 'rgba(120,255,110,0.95)';
  ctx.shadowBlur = Math.max(6, cell * 0.24);
  ctx.fillStyle = FARM.exitGlow;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(ax - size, cy - size * 1.25);
  ctx.lineTo(ax + size * 1.35, cy);
  ctx.lineTo(ax - size, cy + size * 1.25);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = FARM.arrow;
  ctx.beginPath();
  ctx.moveTo(ax - size * 0.72, cy - size * 0.95);
  ctx.lineTo(ax + size * 1.1, cy);
  ctx.lineTo(ax - size * 0.72, cy + size * 0.95);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = FARM.arrowDark;
  ctx.lineWidth = Math.max(1, size * 0.14);
  ctx.stroke();
  ctx.restore();

  // 4) 「出口」木牌：挂在缺口**上方**的木框上，绝不遮挡车辆驶出通道
  const signW = clamp(width - exitX - 3, 26, 64);
  const signH = clamp(cell * 0.9, 24, 48);
  const signX = width - signW - 2;
  const signY = y - signH - Math.max(1, frame * 0.14);
  if (signY < layout.hudHeight - signH * 0.3) return;

  // 立柱（把牌子"钉"在栅栏上）
  woodBar(ctx, signX + signW * 0.5 - postW * 0.5, signY + signH * 0.9, postW, frame * 0.7);
  drawWoodPlate(ctx, signX, signY, signW, signH, { radius: Math.min(signH * 0.3, 12), nails: false });

  const vertical = signW < signH * 0.86;
  if (vertical) {
    const size = clamp(Math.min(signW * 0.6, signH * 0.42), 10, 19);
    drawCartoonText(ctx, '出', signX + signW / 2, signY + signH * 0.29, {
      size,
      maxWidth: signW - 6,
      outline: 2,
    });
    drawCartoonText(ctx, '口', signX + signW / 2, signY + signH * 0.72, {
      size,
      maxWidth: signW - 6,
      outline: 2,
    });
  } else {
    drawCartoonText(ctx, '出口', signX + signW / 2, signY + signH / 2, {
      size: clamp(Math.min(signH * 0.5, signW * 0.42), 10, 20),
      maxWidth: signW - 8,
      outline: 2,
    });
  }
}

// ================================================================ 顶部信息栏

export interface FarmHud {
  levelName: string;
  steps: number;
  /** 历史最佳步数（无记录时 undefined → 该行不显示） */
  bestMoves?: number;
  hintLeft: number;
  /** 金币 / 体力计数（商业化占位栏位） */
  coins?: number;
  soundOn: boolean;
  canUndo: boolean;
  /** 正在播放按下反馈的按钮 id（缩小 0.94） */
  pressedId?: string | null;
}

/**
 * 关卡名 → 木牌上的短标签。
 *
 * 关卡数据里的 name 形如「第3关 · 拐个弯」，是一条完整描述；
 * 木牌只有 ~70px 宽，塞不下。这里只取"第 N 关"，
 * 全角/半角空格与「关」字后的内容一律丢弃；不属于该格式时原样返回。
 */
export function levelBadge(name: string): string {
  const m = /第\s*([0-9]+)\s*关/.exec(name);
  return m ? `第 ${m[1]} 关` : name;
}

function pressedOf(hud: FarmHud, id: string): boolean {
  return hud.pressedId === id;
}

/** 顶部信息栏：左侧功能按钮 / 中部木牌 / 右侧金币 */
export function drawTopBar(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  hud: FarmHud,
): void {
  const geo = topBarGeometry(layout);

  // —— 左侧：暂停 + 音效（远离右上角胶囊） ——
  drawWoodButton(ctx, geo.pause.x, geo.pause.y, geo.pause.w, geo.pause.h, pressedOf(hud, 'pause'), false);
  drawPauseBars(ctx, geo.pause.x + geo.pause.w / 2, geo.pause.y + geo.pause.h / 2, geo.pause.w * 0.3);

  drawWoodButton(ctx, geo.sound.x, geo.sound.y, geo.sound.w, geo.sound.h, pressedOf(hud, 'sound'), false);
  drawSpeaker(
    ctx,
    geo.sound.x + geo.sound.w / 2,
    geo.sound.y + geo.sound.h / 2,
    geo.sound.w * 0.28,
    hud.soundOn,
  );

  // —— 中部：关卡木牌 ——
  const lv = geo.levelPlate;
  drawHangingPlate(ctx, lv.x, lv.y, lv.w, lv.h);
  drawCartoonText(ctx, levelBadge(hud.levelName), lv.x + lv.w / 2, lv.y + lv.h / 2, {
    size: clamp(lv.h * 0.44, 11, 17),
    maxWidth: lv.w - 12,
    outline: 2,
  });

  // —— 中部：步数 / 最佳 ——
  const mv = geo.movesPlate;
  drawWoodPlate(ctx, mv.x, mv.y, mv.w, mv.h, { radius: mv.h * 0.3, nails: false });
  const line1 = `步数 ${hud.steps}`;
  const line2 = Number.isFinite(hud.bestMoves) ? `最佳 ${hud.bestMoves}` : '';
  const s1 = clamp(mv.h * 0.38, 10, 15);
  const s2 = clamp(mv.h * 0.32, 9, 13);
  if (line2) {
    drawCartoonText(ctx, line1, mv.x + mv.w / 2, mv.y + mv.h * 0.32, {
      size: s1,
      maxWidth: mv.w - 10,
      outline: 2,
    });
    drawCartoonText(ctx, line2, mv.x + mv.w / 2, mv.y + mv.h * 0.71, {
      size: s2,
      fill: FARM.coin,
      maxWidth: mv.w - 10,
      outline: 2,
    });
  } else {
    drawCartoonText(ctx, line1, mv.x + mv.w / 2, mv.y + mv.h / 2, {
      size: s1,
      maxWidth: mv.w - 10,
      outline: 2,
    });
  }

  // —— 右侧：金币 ——
  const cp = geo.coinPill;
  drawWoodPlate(ctx, cp.x, cp.y, cp.w, cp.h, { radius: cp.h * 0.5, grain: false, nails: false });
  const cr = clamp(cp.h * 0.34, 5, 11);
  const ccx = cp.x + cr + 6;
  const ccy = cp.y + cp.h / 2;
  drawCoin(ctx, ccx, ccy, cr);
  drawCartoonText(ctx, String(hud.coins ?? 0), cp.x + cr * 2 + 10, ccy, {
    size: clamp(cp.h * 0.46, 10, 15),
    align: 'left',
    maxWidth: cp.w - cr * 2 - 14,
    outline: 2,
  });
}

// ================================================================ 底部操作区

/**
 * 底部三个大木按钮：撤销 / 重置 / 提示。
 *
 * 说明：`hudButtons()` 的 id 顺序是 undo → reset → hint，
 * 与按钮的**视觉顺序**一致，命中测试直接用同一份矩形。
 */
export function drawBottomControls(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  hud: FarmHud,
): void {
  for (const b of hudButtons(layout)) {
    const disabled = b.id === 'undo' ? !hud.canUndo : false;
    drawWoodButton(ctx, b.x, b.y, b.w, b.h, pressedOf(hud, b.id), disabled);

    const iconR = b.w * 0.17;
    const cx = b.x + b.w / 2;
    const iconCy = b.y + b.h * 0.38;

    if (b.id === 'undo') {
      drawCircularArrow(ctx, cx, iconCy, iconR, FARM.cream, false);
    } else if (b.id === 'reset') {
      drawCircularArrow(ctx, cx, iconCy, iconR, FARM.cream, true);
    } else {
      drawBulb(ctx, cx, iconCy, iconR, true);
    }

    if (b.id === 'hint') {
      // 剩余可用次数徽标（提示每关免费 1 次，之后靠激励视频）
      const br = b.w * 0.15;
      const bcx = b.x + b.w * 0.79;
      const bcy = b.y + b.h * 0.21;
      ctx.save();
      ctx.beginPath();
      ctx.arc(bcx, bcy, br, 0, TAU);
      ctx.fillStyle = FARM.done;
      ctx.fill();
      ctx.lineWidth = Math.max(1, br * 0.24);
      ctx.strokeStyle = FARM.cream;
      ctx.stroke();
      ctx.restore();
      drawCartoonText(ctx, String(Math.max(0, hud.hintLeft)), bcx, bcy + br * 0.06, {
        size: clamp(br * 1.25, 8, 14),
        outline: 0,
      });
    }

    drawCartoonText(ctx, b.label, cx, b.y + b.h * 0.76, {
      size: clamp(b.w * 0.22, 10, 17),
      maxWidth: b.w - 8,
      outline: 2,
    });
  }
}

// ================================================================ 暂停面板

/** 暂停面板：遮罩 + 木牌 + 继续 / 重新开始 / 返回菜单 */
export function drawPauseDialog(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  progress: number,
): void {
  const p = clamp(progress, 0, 1);
  const geo = pauseGeometry(layout);
  const s = 0.88 + 0.12 * p;

  ctx.save();
  ctx.globalAlpha = p * 0.62;
  ctx.fillStyle = '#1B2A10';
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = p;
  ctx.translate(geo.cx, geo.cy);
  ctx.scale(s, s);
  ctx.translate(-geo.cx, -geo.cy);

  drawWoodPlate(ctx, geo.cx - geo.panelW / 2, geo.cy - geo.panelH / 2, geo.panelW, geo.panelH, {
    radius: 20,
  });
  drawCartoonText(ctx, '暂停中', geo.cx, geo.cy - geo.panelH / 2 + geo.panelH * 0.16, {
    size: clamp(geo.panelH * 0.11, 16, 26),
    fill: FARM.cream,
    maxWidth: geo.panelW - 40,
  });

  for (const b of geo.buttons) {
    drawWoodButton(ctx, b.x, b.y, b.w, b.h, false, false);
    drawCartoonText(ctx, b.label, b.x + b.w / 2, b.y + b.h / 2, {
      size: clamp(b.h * 0.4, 12, 20),
      maxWidth: b.w - 16,
    });
  }
  ctx.restore();
}

/**
 * 棋盘外框的厚度。
 *
 * 必须同时受四处限制约束：木框画在棋盘**外侧**，一旦超过可用留白就会压到
 * HUD、底部操作区或屏幕边缘。绘制（drawBoardFrame）、出口缺口（drawExitGate）
 * 都调用它，保证三者用的是同一个厚度。
 */
export function boardFrameWidth(layout: Layout): number {
  const marginTop = layout.boardY - layout.hudHeight;
  const marginBottom = layout.height - layout.bottomBarH - (layout.boardY + layout.boardSize);
  return Math.max(
    6,
    Math.floor(Math.min(layout.cell * 0.2, layout.boardX - 2, marginTop - 2, marginBottom - 2)),
  );
}
