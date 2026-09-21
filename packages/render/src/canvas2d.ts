/**
 * Canvas 2D 绘制 —— 全部美术由代码绘制（目标位图预算 0）。
 *
 * ⚠️ 本文件属 render 层：禁止出现 window / document / wx，
 *    只允许通过传入的 ctx 与 Layout 工作（.eslintrc.cjs 强制）。
 */

import { COLS, ROWS, EXIT_ROW, type Piece } from '@rush-hour/core';
import type { CanvasRenderingContext2DLike, ImageLike } from '@rush-hour/platform';
import { CAR_PALETTE, COLORS, FONTS, METRICS, derive, type ColorInfo } from './theme';
import { cellToPx, dialogGeometry, dialogScale, hudButtons, type Layout } from './layout';

export interface CarWithOffset {
  piece: Piece;
  color: ColorInfo;
  /** 拖拽/动画额外偏移（像素） */
  dx: number;
  dy: number;
  /** 拖拽中的车略微提亮 + 阴影加重 */
  dragging?: boolean;
  /** 不可移动（顶住感）时变暗 */
  dimmed?: boolean;
  /**
   * 该车的卡通贴图。缺省或未加载完成时，drawCar 会回落为矢量绘制。
   * 这是"素材可选增强"契约的落点：贴图永远不能让车画不出来。
   */
  sprite?: ImageLike;
}

/**
 * 同一关内不同车辆颜色必须互不相同（同色会让玩家误以为可互换）。
 * 做法：按 index 直接取色板（色板长度 >= 任何关卡的车辆数上限 14），
 * 天然无重复；再用 id 哈希做微扰让同长度车也有区分度。
 */
export function pickColors(pieces: readonly Piece[]): Map<string, ColorInfo> {
  const map = new Map<string, ColorInfo>();
  const used = new Set<string>();
  for (const p of pieces) {
    if (p.id === 'R') {
      map.set(p.id, derive(COLORS.redCar));
      used.add(COLORS.redCar);
      continue;
    }
    let idx = hash(p.id) % CAR_PALETTE.length;
    let guard = 0;
    while (used.has(CAR_PALETTE[idx]) && guard < CAR_PALETTE.length) {
      idx = (idx + 1) % CAR_PALETTE.length;
      guard++;
    }
    const fill = CAR_PALETTE[idx];
    used.add(fill);
    map.set(p.id, derive(fill));
  }
  return map;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// ---------------------------------------------------------------- 圆角矩形

function roundRect(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  // 降级路径：小游戏旧版本可能没有 roundRect
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// ---------------------------------------------------------------- 各图层

export function drawBackground(ctx: CanvasRenderingContext2DLike, layout: Layout): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, layout.width, layout.height);
}

export function drawBoard(ctx: CanvasRenderingContext2DLike, layout: Layout): void {
  const { boardX, boardY, boardSize, cell } = layout;
  ctx.save();
  ctx.shadowColor = 'rgba(33,37,41,0.10)';
  ctx.shadowBlur = Math.max(8, cell * 0.28);
  ctx.shadowOffsetY = Math.max(2, cell * 0.06);
  ctx.fillStyle = COLORS.boardBg;
  roundRect(ctx, boardX, boardY, boardSize, boardSize, Math.max(10, cell * 0.28));
  ctx.fill();
  ctx.restore();

  // 格子底色 + 格线
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const { x, y } = cellToPx(layout, r, c);
      ctx.fillStyle = COLORS.cellBg;
      roundRect(
        ctx,
        x + METRICS.carInset,
        y + METRICS.carInset,
        cell - METRICS.carInset * 2,
        cell - METRICS.carInset * 2,
        METRICS.cellRadius,
      );
      ctx.fill();
    }
  }
  ctx.strokeStyle = COLORS.gridLine;
  ctx.lineWidth = 1;
  for (let i = 1; i < COLS; i++) {
    const x = boardX + i * cell;
    ctx.beginPath();
    ctx.moveTo(x, boardY);
    ctx.lineTo(x, boardY + boardSize);
    ctx.stroke();
  }
  for (let i = 1; i < ROWS; i++) {
    const y = boardY + i * cell;
    ctx.beginPath();
    ctx.moveTo(boardX, y);
    ctx.lineTo(boardX + boardSize, y);
    ctx.stroke();
  }
}

/** 出口：右侧第 2 行的缺口 + 绿色箭头（暗示"从这里开出去"） */
export function drawExit(ctx: CanvasRenderingContext2DLike, layout: Layout, pulse = 0): void {
  const { cell } = layout;
  const y = layout.boardY + EXIT_ROW * cell;
  const x = layout.boardX + layout.boardSize;
  const h = cell;
  ctx.save();
  // 出口缺口：用背景色盖掉棋盘右边框
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(x - 1, y + 2, Math.max(3, cell * 0.1), h - 4);

  const cx = x + Math.max(10, cell * 0.42);
  const cy = y + h / 2;
  const s = Math.max(7, cell * 0.24) + pulse;
  ctx.fillStyle = COLORS.exit;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.moveTo(cx - s, cy - s);
  ctx.lineTo(cx + s * 0.6, cy);
  ctx.lineTo(cx - s, cy + s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawCar(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  car: CarWithOffset,
): void {
  if (car.sprite) {
    drawCarSprite(ctx, layout, car, car.sprite);
    return;
  }
  drawCarVector(ctx, layout, car);
}

/**
 * 贴图版车辆 —— 尺寸策略。
 *
 * 横向车：**双向铺满**占用矩形（允许非等比拉伸）。
 * 纵向车：**长轴等比铺满**（保持素材比例）。
 *
 * 为什么两类车用不同策略：
 *
 *   侧视素材的宽高比在 1.29~1.68 之间，而 2 格车位是 112:48 ≈ 2.33:1
 *   的扁矩形 —— 两者比例天然对不上。若坚持等比，就只能在「宽度空一截」
 *   与「高度空一截」之间二选一，无论选哪个车都显小。
 *   实测等比最优解只画到 78×46，占不满 112×48 的车位。
 *
 *   卡通美术对横向拉伸的容忍度很高（圆润造型 + 粗描边，拉宽 20% 后
 *   看起来只是"这辆车更胖一点"，不会露馅），因此横向车直接拉伸铺满。
 *
 *   纵向车不能同样处理：纵向车位是 48:112 的竖长条，而正面视角素材
 *   本身已接近该比例（0.42~0.69），等比即可铺满长轴，没有必要拉伸 ——
 *   且纵向拉伸会让车头明显变长，一眼看出变形。
 *
 * 朝右问题：素材的侧视图全部朝右，而横向车可能向左/向右。红车必须朝右
 *   （它就是"开出右边出口"的那辆），其余横向车统一保持朝右 —— 卡通游戏里
 *   车辆朝向不一致反而更像玩具，且翻转会连带把驾驶员的脸也镜像，不自然。
 */
function drawCarSprite(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  car: CarWithOffset,
  sprite: ImageLike,
): void {
  const { piece } = car;
  const cell = layout.cell;
  const inset = METRICS.carInset + 1;
  const base = cellToPx(layout, piece.r, piece.c);
  const boxW = (piece.dir === 'H' ? piece.len * cell : cell) - inset * 2;
  const boxH = (piece.dir === 'V' ? piece.len * cell : cell) - inset * 2;
  const bx = base.x + inset + car.dx;
  const by = base.y + inset + car.dy;

  let dw: number;
  let dh: number;

  if (piece.dir === 'H') {
    // 横向：长轴（宽）与短轴（高）各自铺满，允许非等比拉伸 —— 但有上限。
    //
    // 上限的意义：车位是 2.17:1，素材却在 1.29~1.68 之间，硬铺满会让
    // 最扁的拖拉机被拉宽 67%，车轮变成明显的椭圆。限制到 STRETCH_MAX 后，
    // 超出上限的车改为等比缩放（宽度略空一点），观感从"变形"回到"小车"。
    dh = boxH * SPRITE_SHORT_FILL;
    dw = boxW * SPRITE_LONG_FILL;

    const ratio = sprite.width / sprite.height;
    const naturalW = dh * ratio; // 按当前高度等比缩放时该有的宽度
    if (dw > naturalW * STRETCH_MAX) dw = naturalW * STRETCH_MAX;
  } else {
    // 纵向：长轴（高）铺满，短轴按素材比例 —— 保持不变形。
    dh = boxH * SPRITE_LONG_FILL;
    dw = dh * (sprite.width / sprite.height);
    const maxW = boxW * SPRITE_SHORT_FILL;
    if (dw > maxW) {
      dw = maxW;
      dh = dw * (sprite.height / sprite.width);
    }
  }

  const dx = bx + (boxW - dw) / 2;
  const dy = by + (boxH - dh) / 2;

  ctx.save();
  if (car.dimmed) ctx.globalAlpha = 0.55;

  // 拖拽中：先垫一层白色描边光晕，把"正在操作"的车从底板上托起来。
  // 矢量版靠 fillStyle + shadow 实现，贴图版用 shadowColor 模拟同等观感。
  if (car.dragging) {
    ctx.shadowColor = 'rgba(255,255,255,0.9)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(sprite, dx, dy, dw, dh);
    ctx.shadowBlur = 0;
  }

  // 落地投影：贴图自带描边与体积感，这里只补一层柔和的地面阴影。
  // 拖拽时投影加重，与矢量版保持同一套"提起"反馈。
  ctx.shadowColor = car.dragging ? 'rgba(33,37,41,0.34)' : 'rgba(33,37,41,0.16)';
  ctx.shadowBlur = car.dragging ? Math.max(8, cell * 0.3) : Math.max(3, cell * 0.12);
  ctx.shadowOffsetY = car.dragging ? Math.max(3, cell * 0.1) : Math.max(1, cell * 0.04);
  ctx.drawImage(sprite, dx, dy, dw, dh);

  ctx.restore();
}

/**
 * 贴图沿**长轴**方向的铺满比例（长轴 = 横向车的宽 / 纵向车的高）。
 *
 * 取 1.0 而非留白，是因为素材已被 build-car-assets.mjs 裁到内容包围盒，
 * 卡通描边本身就画在素材边界内侧 —— 铺满即"车轮贴格线"，正是想要的观感。
 * 之前留 6% 白，直接导致车看起来比它占的格子小。
 */
const SPRITE_LONG_FILL = 1;
/**
 * 贴图沿**短轴**方向（横向车的高 / 纵向车的宽）的铺满比例。
 *
 * 略小于 1：相邻两行/两列的格子之间本就有 inset 间隙，短轴铺满会让
 * 上下两排车的描边几乎相接。留 4% 让车与车之间有一道可见的缝。
 */
const SPRITE_SHORT_FILL = 0.96;
/**
 * 横向车允许的最大横向拉伸倍率。
 *
 * 卡通美术能容忍一定程度的横向拉伸（圆润造型 + 粗描边，胖一点不露馅），
 * 但超过这个倍率就开始"露馅"：车轮从正圆变成明显椭圆、车身细节被横向扯开。
 * 实测拖拉机素材比例 1.29，若硬铺满 2.17 的车位要拉伸 1.67 倍，
 * 轮子已明显变形。1.35 是"看起来更饱满"与"看不出被拉过"的平衡点。
 */
const STRETCH_MAX = 1.35;

/** 矢量绘制的车辆（素材缺失时的回落路径，也是 P0–P2 的原始外观） */
function drawCarVector(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  car: CarWithOffset,
): void {
  const { piece, color } = car;
  const cell = layout.cell;
  const inset = METRICS.carInset + 1;
  const base = cellToPx(layout, piece.r, piece.c);
  const w = (piece.dir === 'H' ? piece.len * cell : cell) - inset * 2;
  const h = (piece.dir === 'V' ? piece.len * cell : cell) - inset * 2;
  const x = base.x + inset + car.dx;
  const y = base.y + inset + car.dy;
  const r = METRICS.carRadius;

  ctx.save();
  if (car.dimmed) ctx.globalAlpha = 0.55;

  // 底部投影
  ctx.shadowColor = car.dragging ? 'rgba(33,37,41,0.34)' : 'rgba(33,37,41,0.16)';
  ctx.shadowBlur = car.dragging ? Math.max(10, cell * 0.34) : Math.max(4, cell * 0.14);
  ctx.shadowOffsetY = car.dragging ? Math.max(3, cell * 0.1) : Math.max(1, cell * 0.04);

  ctx.fillStyle = color.fill;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();

  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 顶部高光
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, color.light);
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  // 描边
  ctx.strokeStyle = color.stroke;
  ctx.lineWidth = Math.max(1, cell * 0.035);
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();

  // 车窗 / 车灯
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  if (piece.len === 3) {
    // 长车中部加深色车窗
    ctx.fillStyle = 'rgba(33,37,41,0.30)';
    if (piece.dir === 'H') {
      const cw = w * 0.3;
      roundRect(ctx, x + (w - cw) / 2, y + h * 0.16, cw, h * 0.68, r * 0.5);
    } else {
      const ch = h * 0.3;
      roundRect(ctx, x + w * 0.16, y + (h - ch) / 2, w * 0.68, ch, r * 0.5);
    }
    ctx.fill();
  }
  ctx.restore();

  // 两个车灯小圆（沿行进方向前端）
  const lampR = Math.max(1.6, cell * 0.05);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  if (piece.dir === 'H') {
    const lx = x + w - cell * 0.16;
    for (const t of [0.26, 0.74]) {
      ctx.beginPath();
      ctx.arc(lx, y + h * t, lampR, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const ly = y + h - cell * 0.16;
    for (const t of [0.26, 0.74]) {
      ctx.beginPath();
      ctx.arc(x + w * t, ly, lampR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 拖拽时显示可滑动范围的半透明虚影 */
export function drawGhost(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  piece: Piece,
  dir: 'up' | 'down' | 'left' | 'right',
  cells: number,
): void {
  if (cells <= 0) return;
  const cell = layout.cell;
  const inset = METRICS.carInset + 1;
  let r = piece.r;
  let c = piece.c;
  if (dir === 'left') c -= cells;
  else if (dir === 'right') c += cells;
  else if (dir === 'up') r -= cells;
  else r += cells;
  const base = cellToPx(layout, r, c);
  const w = (piece.dir === 'H' ? piece.len * cell : cell) - inset * 2;
  const h = (piece.dir === 'V' ? piece.len * cell : cell) - inset * 2;
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.strokeStyle = COLORS.text;
  ctx.lineWidth = Math.max(1, cell * 0.04);
  roundRect(ctx, base.x + inset, base.y + inset, w, h, METRICS.carRadius);
  ctx.stroke();
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = COLORS.text;
  ctx.fill();
  ctx.restore();
}

/** 长按提示：显示该车可移动方向的箭头 */
export function drawHintArrows(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  piece: Piece,
  dirs: Array<'up' | 'down' | 'left' | 'right'>,
): void {
  const cell = layout.cell;
  const base = cellToPx(layout, piece.r, piece.c);
  const w = piece.dir === 'H' ? piece.len * cell : cell;
  const h = piece.dir === 'V' ? piece.len * cell : cell;
  const cx = base.x + w / 2;
  const cy = base.y + h / 2;
  const off = Math.max(cell * 0.7, w / 2 + cell * 0.42);
  ctx.save();
  ctx.fillStyle = COLORS.text;
  ctx.globalAlpha = 0.55;
  const tri = (x: number, y: number, rot: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    const s = Math.max(5, cell * 0.16);
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.7, -s);
    ctx.lineTo(-s * 0.7, s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  for (const d of dirs) {
    if (d === 'left') tri(cx - off, cy, Math.PI);
    else if (d === 'right') tri(cx + off, cy, 0);
    else if (d === 'up') tri(cx, cy - off, -Math.PI / 2);
    else tri(cx, cy + off, Math.PI / 2);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- HUD

export interface HudState {
  levelName: string;
  steps: number;
  parMoves: number;
  hintLeft: number;
}

export function drawHud(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  hud: HudState,
  canUndo: boolean,
): void {
  const pad = layout.boardX;
  ctx.save();
  ctx.fillStyle = COLORS.text;
  ctx.font = FONTS.title;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(hud.levelName, pad, layout.hudHeight * 0.34);

  ctx.font = FONTS.hud;
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`步数 ${hud.steps}`, pad, layout.hudHeight * 0.72);

  ctx.font = FONTS.small;
  ctx.fillStyle = COLORS.textDim;
  ctx.textAlign = 'right';
  ctx.fillText(`目标 ${hud.parMoves} 步`, layout.width - pad, layout.hudHeight * 0.72);
  ctx.restore();

  // 按钮
  for (const b of hudButtons(layout)) {
    const disabled = b.id === 'undo' ? !canUndo : false;
    drawButton(ctx, b.x, b.y, b.w, b.h, b.label, disabled, layout);
  }
}

function drawButton(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  disabled: boolean,
  layout: Layout,
): void {
  ctx.save();
  ctx.globalAlpha = disabled ? 0.4 : 1;
  ctx.fillStyle = COLORS.panel;
  ctx.strokeStyle = COLORS.panelStroke;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, Math.max(8, layout.cell * 0.24));
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = COLORS.primary;
  ctx.font = FONTS.button;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
  ctx.restore();
}

// ---------------------------------------------------------------- 结算弹窗

export interface ResultState {
  stars: number;
  steps: number;
  parMoves: number;
  cellSteps: number;
  isNewBest: boolean;
  hasNext: boolean;
  /** 0~1 入场进度 */
  progress: number;
  /** 是否显示"分享"按钮（宿主未提供分享能力时隐藏，避免点了没反应） */
  shareEnabled?: boolean;
}

export function drawResultDialog(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  res: ResultState,
): void {
  ctx.save();
  ctx.fillStyle = COLORS.overlay;
  ctx.fillRect(0, 0, layout.width, layout.height);

  const p = Math.min(1, Math.max(0, res.progress));
  // 几何与命中测试共用 dialogGeometry，避免两处公式漂移（见 layout.ts）
  const geo = dialogGeometry(layout);
  const panelW = geo.panelW;
  const panelH = geo.panelH;
  const scale = dialogScale(p);
  const cx = geo.cx;
  const cy = geo.cy;

  ctx.globalAlpha = p;
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  ctx.fillStyle = COLORS.panel;
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = 24;
  roundRect(ctx, cx - panelW / 2, cy - panelH / 2, panelW, panelH, 18);
  ctx.fill();
  ctx.shadowColor = 'rgba(0,0,0,0)';
  ctx.shadowBlur = 0;

  const top = cy - panelH / 2;
  const atPar = res.steps <= res.parMoves;

  // 达 par 时换成特殊文案（docs/01 §6.1「达 par 时特殊文案与特效」）
  ctx.fillStyle = atPar ? COLORS.exit : COLORS.text;
  ctx.font = FONTS.title;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(atPar ? '完美通关！' : '过关！', cx, top + panelH * 0.13);

  // 三颗星
  const starR = Math.max(14, layout.cell * 0.34);
  const gap = starR * 2.6;
  for (let i = 0; i < 3; i++) {
    const sx = cx + (i - 1) * gap;
    const sy = top + panelH * 0.32;
    drawStar(ctx, sx, sy, starR, i < res.stars);
  }

  ctx.font = FONTS.hud;
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`本局 ${res.steps} 步 / 目标 ${res.parMoves} 步`, cx, top + panelH * 0.49);

  // par 对比（docs/01 §6.1 要求"比最少步数多 3 步"这类表述）
  ctx.font = FONTS.small;
  ctx.fillStyle = COLORS.textDim;
  const diff = res.steps - res.parMoves;
  const cmp = diff <= 0 ? '已达最少步数' : `比最少步数多 ${diff} 步`;
  ctx.fillText(cmp, cx, top + panelH * 0.575);

  // 副行：滑动格数 + 新纪录标记（两者并排，避免行数过多挤压按钮）
  const subY = top + panelH * 0.645;
  ctx.fillText(`滑动格数 ${res.cellSteps}`, cx, subY);
  if (res.isNewBest) {
    ctx.fillStyle = COLORS.exit;
    ctx.fillText('新纪录！', cx, subY + panelH * 0.062);
  }

  // 按钮：直接使用 geo.buttons（已含屏幕坐标，处于当前缩放变换内）
  for (const b of geo.buttons) {
    if (b.id === 'next' && !res.hasNext) continue;
    if (b.id === 'share' && !res.shareEnabled) continue;
    const primary = b.id === 'next';
    ctx.fillStyle = primary ? COLORS.primary : COLORS.panel;
    ctx.strokeStyle = primary ? COLORS.primary : COLORS.panelStroke;
    ctx.lineWidth = 1.5;
    roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = primary ? COLORS.primaryText : COLORS.text;
    ctx.font = FONTS.small;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
  }

  ctx.restore();
}

function drawStar(
  ctx: CanvasRenderingContext2DLike,
  cx: number,
  cy: number,
  r: number,
  filled: boolean,
): void {
  ctx.save();
  ctx.fillStyle = filled ? COLORS.star : COLORS.starEmpty;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.44;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** 通关白光闪屏 */
export function drawFlash(ctx: CanvasRenderingContext2DLike, layout: Layout, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.restore();
}

/** 长按提示气泡文字 */
export function drawToast(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  text: string,
): void {
  ctx.save();
  ctx.font = FONTS.small;
  const w = ctx.measureText(text).width + 28;
  const h = 32;
  const x = (layout.width - w) / 2;
  const y = layout.hudHeight * 0.5 + 6;
  ctx.fillStyle = 'rgba(33,37,41,0.86)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, layout.width / 2, y + h / 2);
  ctx.restore();
}
