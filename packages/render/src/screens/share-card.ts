/**
 * 分享卡片 —— docs/01 §6.1「结算弹窗」的"分享"按钮落地。
 *
 * 合规红线（docs/01 §6.4，原文）：
 *   「禁止"分享给好友才能解锁下一关"这类强制分享（提审高频驳回项）」
 *
 * 因此本文件**只负责画一张分享卡**，且：
 *   - 分享是**可选**行为，任何解锁/奖励逻辑都不得依赖它；
 *   - 卡片内容全部由 `ShareCardInfo` 决定，不读取任何用户隐私字段
 *     （不含昵称、头像、openid —— 这三样都是提审与合规的高危项）；
 *   - 卡片是**代码绘制**的：Canvas 矢量输出，无位图资源、无网络图片。
 *
 * 为什么不去"截图 canvas"：
 *   小游戏与 H5 的截图 API 不一致（wx.canvasToTempFilePath vs toDataURL），
 *   且截图会把 HUD、棋盘、弹窗一起拍进去，观感差且信息噪声大。
 *   用参数化绘制能保证双端像素一致、可测。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx。
 */

import type { CanvasRenderingContext2DLike } from '@rush-hour/platform';
import { COLORS, FONTS } from '../theme';
import { computeLayout, type Layout } from '../layout';
import { drawStarRow, drawText, roundRectPath } from '../ui';

export interface ShareCardInfo {
  levelName: string;
  steps: number;
  stars: number;
  parMoves: number;
  /** 是否达 par（决定文案从"过关"变"完美通关"） */
  isPar?: boolean;
}

/** 分享卡片的逻辑尺寸（与设计分辨率同宽，便于在小游戏分享图里居中） */
export const SHARE_CARD_SIZE = { width: 375, height: 480 } as const;

/**
 * 绘制分享卡片。
 *
 * 刻意接受 `ctx` + `size` 而非 `Layout`：分享卡是**独立于屏幕尺寸**的一张图，
 * 若按当前视口排版，同一局在不同机型上导出的卡片会长得不一样。
 * 需要预览时由调用方把它画到屏幕中央。
 */
export function drawShareCard(
  ctx: CanvasRenderingContext2DLike,
  info: ShareCardInfo,
  opts: { x?: number; y?: number; scale?: number; size?: { width: number; height: number } } = {},
): void {
  const size = opts.size ?? SHARE_CARD_SIZE;
  const scale = opts.scale ?? 1;
  const ox = opts.x ?? 0;
  const oy = opts.y ?? 0;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);

  // 卡片底
  ctx.fillStyle = COLORS.panel;
  ctx.shadowColor = 'rgba(33,37,41,0.18)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 3;
  roundRectPath(ctx, 0, 0, size.width, size.height, 20);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.strokeStyle = COLORS.panelStroke;
  ctx.lineWidth = 1;
  roundRectPath(ctx, 0, 0, size.width, size.height, 20);
  ctx.stroke();

  const cx = size.width / 2;

  // 顶部品牌条
  ctx.fillStyle = COLORS.primary;
  roundRectPath(ctx, 0, 0, size.width, 56, 20);
  ctx.fill();
  // 抹平顶部条下缘的圆角（否则会露出两个"耳朵"）
  ctx.fillRect(0, 36, size.width, 20);
  drawText(ctx, '汽车华容道', cx, 28, {
    font: FONTS.hud,
    color: COLORS.primaryText,
    align: 'center',
  });

  // 标题：达 par 用特殊文案（与结算弹窗一致）
  const atPar = info.isPar ?? info.steps <= info.parMoves;
  drawText(ctx, atPar ? '完美通关！' : '我通关啦！', cx, 108, {
    font: FONTS.hudLarge,
    color: atPar ? COLORS.exit : COLORS.text,
    align: 'center',
  });

  // 星级
  drawStarRow(ctx, cx, 168, 24, info.stars);

  // 关卡名（限制宽度并截断）
  const name = clip(ctx, info.levelName, size.width - 64);
  drawText(ctx, name, cx, 224, { font: FONTS.hud, align: 'center' });

  // 步数对比块
  const boxW = size.width - 64;
  const boxH = 74;
  const bx = 32;
  const by = 258;
  ctx.fillStyle = COLORS.cellBg;
  roundRectPath(ctx, bx, by, boxW, boxH, 14);
  ctx.fill();

  drawText(ctx, '本局步数', bx + boxW * 0.27, by + boxH * 0.31, {
    font: FONTS.small,
    color: COLORS.textDim,
    align: 'center',
  });
  drawText(ctx, String(info.steps), bx + boxW * 0.27, by + boxH * 0.68, {
    font: FONTS.hudLarge,
    align: 'center',
  });

  drawText(ctx, '最少步数', bx + boxW * 0.73, by + boxH * 0.31, {
    font: FONTS.small,
    color: COLORS.textDim,
    align: 'center',
  });
  drawText(ctx, String(info.parMoves), bx + boxW * 0.73, by + boxH * 0.68, {
    font: FONTS.hudLarge,
    color: COLORS.primary,
    align: 'center',
  });

  // 分隔竖线
  ctx.strokeStyle = COLORS.panelStroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(bx + boxW / 2, by + 14);
  ctx.lineTo(bx + boxW / 2, by + boxH - 14);
  ctx.stroke();

  // 底部引导文案（不含任何"分享才能解锁"的表述 —— 合规红线）
  drawText(ctx, '来挑战一下，看谁步数更少', cx, size.height - 52, {
    font: FONTS.small,
    color: COLORS.textDim,
    align: 'center',
  });

  ctx.restore();
}

/**
 * 把分享卡预览画到屏幕中央。
 * 返回卡片在屏幕上的实际矩形（供命中测试/点击"关闭"用）。
 */
export function drawShareCardPreview(
  ctx: CanvasRenderingContext2DLike,
  viewport: { width: number; height: number },
  info: ShareCardInfo,
): { x: number; y: number; w: number; h: number } {
  // 全屏压暗
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = COLORS.text;
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  ctx.restore();

  const maxW = viewport.width * 0.76;
  const maxH = viewport.height * 0.72;
  const scale = Math.min(maxW / SHARE_CARD_SIZE.width, maxH / SHARE_CARD_SIZE.height);
  const w = SHARE_CARD_SIZE.width * scale;
  const h = SHARE_CARD_SIZE.height * scale;
  const x = (viewport.width - w) / 2;
  const y = (viewport.height - h) / 2;

  drawShareCard(ctx, info, { x, y, scale });
  return { x, y, w, h };
}

/** 按像素宽度截断（与排行榜同一套处理） */
function clip(ctx: CanvasRenderingContext2DLike, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

/** 便捷入口：按平台屏幕尺寸推算布局（宿主调用时用） */
export function shareCardLayoutFor(width: number, height: number): Layout {
  return computeLayout(width, height);
}
