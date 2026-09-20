/**
 * 通用 UI 组件 —— 主菜单 / 选关 / 设置 / 排行榜等界面共用。
 *
 * 为什么单独抽一层：P0–P2 只有"游戏页"一个屏幕，按钮绘制散落在 canvas2d.ts 里；
 * P4 新增 8 个界面后如果每个页面各写一套圆角/按钮/标题，几何公式必然漂移，
 * 又会重演"看得到却点不着"的问题（见 layout.ts 的 dialogGeometry 注释）。
 * 这里把「绘制」与「几何」绑在一起：调用方拿到的 ButtonRect 就是绘制时用的那个，
 * 命中测试直接用 hitButton()，不存在第二套坐标公式。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx（.eslintrc.cjs 强制）。
 */

import type { CanvasRenderingContext2DLike } from '@rush-hour/platform';
import { COLORS, FONTS } from './theme';
import type { Layout } from './layout';

/** 通用按钮矩形。与 layout.ts 的 ButtonRect 结构兼容，但 id 是开放字符串 */
export interface UiButton {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** 次要样式（描边、浅底） */
  secondary?: boolean;
  /** 禁用（灰显且不可点） */
  disabled?: boolean;
}

// ---------------------------------------------------------------- 基础图元

/**
 * 圆角矩形路径。小游戏旧版本可能没有 ctx.roundRect，降级为四段二次曲线。
 * 与 canvas2d.ts 内部实现同源（那边是私有函数，这里导出给 UI 层用）。
 */
export function roundRectPath(
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

/** 全屏半透明遮罩（弹窗 / 引导遮罩共用） */
export function drawOverlay(ctx: CanvasRenderingContext2DLike, layout: Layout, alpha = 0.45): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = COLORS.text;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.restore();
}

/** 页面背景（与游戏页一致，保证切屏不闪色） */
export function drawPageBackground(ctx: CanvasRenderingContext2DLike, layout: Layout): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, layout.width, layout.height);
}

/** 白色面板 */
export function drawPanel(
  ctx: CanvasRenderingContext2DLike,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 16,
): void {
  ctx.save();
  ctx.fillStyle = COLORS.panel;
  ctx.shadowColor = 'rgba(33,37,41,0.12)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 2;
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = COLORS.panelStroke;
  ctx.lineWidth = 1;
  roundRectPath(ctx, x, y, w, h, radius);
  ctx.stroke();
  ctx.restore();
}

export type TextAlign = 'left' | 'center' | 'right';

/** 单行文本（统一处理对齐/基线，避免每处手写 6 行 setter） */
export function drawText(
  ctx: CanvasRenderingContext2DLike,
  text: string,
  x: number,
  y: number,
  opts: { font?: string; color?: string; align?: TextAlign } = {},
): void {
  ctx.save();
  ctx.font = opts.font ?? FONTS.hud;
  ctx.fillStyle = opts.color ?? COLORS.text;
  ctx.textAlign = opts.align ?? 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ---------------------------------------------------------------- 按钮

/** 按矩形绘制一个按钮（样式由 secondary / disabled 决定） */
export function drawUiButton(ctx: CanvasRenderingContext2DLike, b: UiButton, radius = 12): void {
  ctx.save();
  if (b.disabled) ctx.globalAlpha = 0.38;

  const filled = !b.secondary;
  ctx.fillStyle = filled ? COLORS.primary : COLORS.panel;
  ctx.strokeStyle = filled ? COLORS.primary : COLORS.panelStroke;
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, b.x, b.y, b.w, b.h, radius);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = filled ? COLORS.primaryText : COLORS.text;
  ctx.font = FONTS.button;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
  ctx.restore();
}

export function drawUiButtons(
  ctx: CanvasRenderingContext2DLike,
  buttons: readonly UiButton[],
  radius = 12,
): void {
  for (const b of buttons) drawUiButton(ctx, b, radius);
}

// ---------------------------------------------------------------- 星级

/** 五角星（实心）。filled=false 时用空星色填充 */
export function drawStar(
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

/** 一排三颗星（关卡星级展示的标准形态） */
export function drawStarRow(
  ctx: CanvasRenderingContext2DLike,
  cx: number,
  cy: number,
  r: number,
  stars: number,
  opts: { gap?: number } = {},
): void {
  const gap = opts.gap ?? r * 2.6;
  for (let i = 0; i < 3; i++) {
    drawStar(ctx, cx + (i - 1) * gap, cy, r, i < stars);
  }
}

// ---------------------------------------------------------------- 页面骨架

/** 带返回按钮的页面标题栏；返回按钮矩形由调用方用于命中测试 */
export interface HeaderGeometry {
  back: UiButton;
  titleX: number;
  titleY: number;
}

export function headerGeometry(layout: Layout): HeaderGeometry {
  const pad = Math.round(layout.width * 0.05);
  const size = Math.round(Math.min(40, Math.max(32, layout.width * 0.095)));
  return {
    back: {
      id: 'back',
      label: '返回',
      x: pad,
      y: pad,
      w: Math.max(64, size * 1.7),
      h: size,
      secondary: true,
    },
    titleX: layout.width / 2,
    // 标题基线：返回按钮下方留出按钮高度的 0.55 作为间距
    titleY: pad + size + Math.round(size * 0.55) + size / 2,
  };
}

export function drawHeader(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  title: string,
  subtitle?: string,
): HeaderGeometry {
  const g = headerGeometry(layout);
  drawUiButton(ctx, g.back);
  // 标题放在返回按钮下方一行，避免与按钮争宽度（窄屏 320px 下会撞）
  const y = g.back.y + g.back.h + Math.round(g.back.h * 0.55);
  drawText(ctx, title, layout.width / 2, y, {
    font: FONTS.hudLarge,
    align: 'center',
  });
  if (subtitle) {
    drawText(ctx, subtitle, layout.width / 2, y + Math.round(g.back.h * 0.78), {
      font: FONTS.small,
      color: COLORS.textDim,
      align: 'center',
    });
  }
  return { ...g, titleY: y };
}

/** 底部提示条（如"未登录时展示本地成绩"这类说明文案） */
export function drawFootNote(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  text: string,
): void {
  drawText(ctx, text, layout.width / 2, layout.height - Math.round(layout.height * 0.045), {
    font: FONTS.small,
    color: COLORS.textDim,
    align: 'center',
  });
}

/** 空状态提示（居中大字 + 副文案） */
export function drawEmptyState(
  ctx: CanvasRenderingContext2DLike,
  layout: Layout,
  title: string,
  hint?: string,
): void {
  const cy = layout.height / 2;
  drawText(ctx, title, layout.width / 2, cy, { font: FONTS.hudLarge, align: 'center' });
  if (hint) {
    drawText(ctx, hint, layout.width / 2, cy + Math.round(layout.height * 0.045), {
      font: FONTS.small,
      color: COLORS.textDim,
      align: 'center',
    });
  }
}
