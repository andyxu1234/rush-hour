/**
 * 新手引导遮罩 —— docs/01 §9。
 *
 * 规格要求（原文）：前 3 关即教学关，用**情境化遮罩 + 文案**而非独立教程页：
 *   1. t01（1 步）：只高亮红车，"向右拖动红车开出出口"。
 *   2. t02（2 步）：第一辆挡路竖车，文案"竖车只能上下移动，先把它挪开"。
 *   3. t03（4 步）：多辆挡路车，文案"一次只能动一辆车，想好顺序"。
 *
 * 实现要点：
 *   - 遮罩期间**吞掉所有指针事件**（handle 返回 true），防止玩家在引导层下误操作棋盘；
 *   - 高亮区用"挖洞"（evenodd 填充）而非在车上画高亮边框：这样即使车被动画
 *     移动/缩放，洞仍然露出真实棋盘，不会出现高亮框与车错位；
 *   - 引导是**可跳过**的（右上角"跳过"），但跳过入口的持久化由设置页负责展示。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx。
 */

import type { CanvasRenderingContext2DLike, PointerEventLike } from '@rush-hour/platform';
import { COLORS, FONTS, METRICS } from '../theme';
import { cellToPx, hitRect, type Layout } from '../layout';
import { roundRectPath } from '../ui';

/** 3 步引导的文案（严格取自 docs/01 §9，不要改写措辞） */
export const TUTORIAL_TEXT: Record<1 | 2 | 3, string> = {
  1: '向右拖动红车开出出口',
  2: '竖车只能上下移动，先把它挪开',
  3: '一次只能动一辆车，想好顺序',
};

export interface TutorialOverlayDeps {
  step: 1 | 2 | 3;
  layout: Layout;
  /** 需要高亮的车 id（null 表示不挖洞，纯全屏文案） */
  highlightPieceId: string | null;
  /** 高亮车的网格位置（用于计算挖洞矩形）；缺省则退化为全屏文案 */
  highlightPos?: { r: number; c: number; len: number; dir: string };
}

export interface TutorialOverlayHooks {
  onFinish(): void;
}

interface OverlayButton {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/** 引导遮罩。非 Screen（不参与导航），由 GameScreen 持有并转发指针/渲染 */
export class TutorialOverlay {
  private readonly skip: OverlayButton;
  /** 上一帧时间（ms），用于呼吸动效 */
  private phase = 0;

  constructor(
    private readonly deps: TutorialOverlayDeps,
    private readonly hooks: TutorialOverlayHooks,
  ) {
    const layout = deps.layout;
    const w = Math.max(64, Math.round(layout.width * 0.2));
    const h = Math.max(30, Math.round(layout.height * 0.045));
    this.skip = {
      x: layout.width - w - Math.round(layout.width * 0.05),
      y: Math.round(layout.height * 0.045),
      w,
      h,
      label: '跳过',
    };
  }

  get text(): string {
    return TUTORIAL_TEXT[this.deps.step];
  }

  get step(): 1 | 2 | 3 {
    return this.deps.step;
  }

  get highlightPieceId(): string | null {
    return this.deps.highlightPieceId;
  }

  get skipRect(): OverlayButton {
    return this.skip;
  }

  /** 高亮洞的屏幕矩形（绘制、命中、e2e 断言同源） */
  holeRectPublic(): { x: number; y: number; w: number; h: number } | null {
    return this.holeRect();
  }

  /** "我知道了"按钮矩形（绘制、命中、e2e 断言同源） */
  get okRect(): { x: number; y: number; w: number; h: number; label: string } {
    return this.okButton();
  }

  /** 文案气泡矩形 */
  get bubbleRectPublic(): { x: number; y: number; w: number; h: number } {
    return this.bubbleRect();
  }

  update(now: number): void {
    this.phase = now;
  }

  /**
   * 处理指针。返回 true 表示事件已被引导层消费（上层不得再转发给棋盘）。
   * 这样 GameScreen.onPointer 只需一行 `if (overlay.handle(e)) return;`。
   */
  handle(e: PointerEventLike): boolean {
    if (e.phase !== 'end') return true;

    const hit = hitRect([this.skip], e.x, e.y);
    if (hit) {
      this.hooks.onFinish();
      return true;
    }
    // 「我知道了」按钮：引导文案气泡内的主按钮
    const ok = this.okButton();
    if (hitRect([ok], e.x, e.y)) {
      this.hooks.onFinish();
      return true;
    }
    // 其余区域一律吞掉：引导期间不允许操作棋盘
    return true;
  }

  /** 文案气泡内的"我知道了"按钮 */
  private okButton(): OverlayButton {
    const layout = this.deps.layout;
    const w = Math.round(layout.width * 0.34);
    const h = Math.max(36, Math.round(layout.height * 0.052));
    return {
      x: Math.round((layout.width - w) / 2),
      y: this.bubbleRect().y + this.bubbleRect().h - h - Math.round(layout.height * 0.028),
      w,
      h,
      label: '我知道了',
    };
  }

  /** 文案气泡（宽度占屏 86%，位于棋盘下方，避免遮挡要看的车） */
  private bubbleRect(): { x: number; y: number; w: number; h: number } {
    const layout = this.deps.layout;
    const w = Math.round(layout.width * 0.86);
    const h = Math.round(layout.height * 0.15);
    const boardBottom = layout.boardY + layout.boardSize;
    // 棋盘下方剩余空间不足时，气泡移到棋盘上方（避免压住棋盘）
    const below = boardBottom + Math.round(layout.height * 0.02);
    const y =
      below + h <= layout.height - Math.round(layout.height * 0.03)
        ? below
        : Math.max(layout.hudHeight + layout.height * 0.01, layout.boardY - h - layout.height * 0.02);
    return { x: Math.round((layout.width - w) / 2), y: Math.round(y), w, h };
  }

  render(ctx: CanvasRenderingContext2DLike): void {
    const layout = this.deps.layout;
    const bubble = this.bubbleRect();

    // 高亮挖洞矩形（车所在格）
    const hole = this.holeRect();
    this.drawMask(ctx, layout, hole);

    // 若挖了洞，在洞周围加一圈描边，让玩家明确"看这里"
    if (hole) {
      ctx.save();
      ctx.strokeStyle = COLORS.exit;
      ctx.lineWidth = Math.max(2, layout.cell * 0.06);
      const pulse = 1 + Math.sin(this.phase / 260) * 0.04;
      const cx = hole.x + hole.w / 2;
      const cy = hole.y + hole.h / 2;
      const w = hole.w * pulse;
      const h = hole.h * pulse;
      roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, Math.max(8, layout.cell * 0.28));
      ctx.stroke();
      ctx.restore();
    }

    // 文案气泡
    ctx.save();
    ctx.fillStyle = COLORS.panel;
    ctx.shadowColor = 'rgba(33,37,41,0.28)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 3;
    roundRectPath(ctx, bubble.x, bubble.y, bubble.w, bubble.h, 16);
    ctx.fill();
    ctx.restore();

    // 步骤指示（1/3 2/3 3/3）
    ctx.save();
    ctx.font = FONTS.small;
    ctx.fillStyle = COLORS.textDim;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `${this.deps.step} / 3`,
      layout.width / 2,
      bubble.y + Math.round(bubble.h * 0.2),
    );

    // 文案
    ctx.font = FONTS.hud;
    ctx.fillStyle = COLORS.text;
    ctx.fillText(this.text, layout.width / 2, bubble.y + Math.round(bubble.h * 0.47));
    ctx.restore();

    // 按钮
    const ok = this.okButton();
    ctx.save();
    ctx.fillStyle = COLORS.primary;
    roundRectPath(ctx, ok.x, ok.y, ok.w, ok.h, 12);
    ctx.fill();
    ctx.fillStyle = COLORS.primaryText;
    ctx.font = FONTS.button;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ok.label, ok.x + ok.w / 2, ok.y + ok.h / 2);
    ctx.restore();

    // 跳过按钮
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    roundRectPath(ctx, this.skip.x, this.skip.y, this.skip.w, this.skip.h, this.skip.h / 2);
    ctx.fill();
    ctx.fillStyle = COLORS.textDim;
    ctx.font = FONTS.small;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.skip.label, this.skip.x + this.skip.w / 2, this.skip.y + this.skip.h / 2);
    ctx.restore();
  }

  /**
   * 高亮洞的屏幕矩形。取不到车位置时返回 null（退化为纯全屏遮罩 + 文案）。
   * 尺寸比格子略大：留出 METRICS.carInset 的缝隙，视觉上更"透气"。
   */
  private holeRect(): { x: number; y: number; w: number; h: number } | null {
    const pos = this.deps.highlightPos;
    if (!this.deps.highlightPieceId || !pos) return null;
    const layout = this.deps.layout;
    const pad = Math.round(layout.cell * 0.12);
    const base = cellToPx(layout, pos.r, pos.c);
    const w = (pos.dir === 'H' ? pos.len : 1) * layout.cell;
    const h = (pos.dir === 'V' ? pos.len : 1) * layout.cell;
    return {
      x: base.x - pad,
      y: base.y - pad,
      w: w + pad * 2,
      h: h + pad * 2,
    };
  }

  /**
   * 绘制遮罩（挖洞高亮）。
   *
   * 为什么不用 evenodd 路径：CanvasRenderingContext2DLike 是我们自己声明的最小
   * 接口（见 platform/types.ts），不包含 fill(fillRule)。为了不破坏"双端只使用
   * 共有 API"的约定，这里改用**四块矩形围出中间的洞**：
   *
   *     ┌──────────────┐
   *     │   上         │
   *     ├────┬────┬────┤
   *     │ 左 │ 洞 │ 右 │
   *     ├────┴────┴────┤
   *     │   下         │
   *     └──────────────┘
   *
   * 四块矩形必定无重叠、无缝隙，效果与 evenodd 完全一致，且只依赖 fillRect。
   */
  private drawMask(
    ctx: CanvasRenderingContext2DLike,
    layout: Layout,
    hole: { x: number; y: number; w: number; h: number } | null,
  ): void {
    ctx.save();
    ctx.fillStyle = COLORS.overlay;
    ctx.globalAlpha = METRICS.tutorialMaskAlpha;
    if (!hole) {
      ctx.fillRect(0, 0, layout.width, layout.height);
      ctx.restore();
      return;
    }

    // 洞的边界夹紧到屏幕内，防止越界矩形造成"遮罩没铺满"
    const hx = Math.max(0, Math.min(layout.width, hole.x));
    const hy = Math.max(0, Math.min(layout.height, hole.y));
    const hw = Math.max(0, Math.min(layout.width - hx, hole.w));
    const hh = Math.max(0, Math.min(layout.height - hy, hole.h));

    // 上
    if (hy > 0) ctx.fillRect(0, 0, layout.width, hy);
    // 下
    if (hy + hh < layout.height) {
      ctx.fillRect(0, hy + hh, layout.width, layout.height - (hy + hh));
    }
    // 左
    if (hx > 0) ctx.fillRect(0, hy, hx, hh);
    // 右
    if (hx + hw < layout.width) {
      ctx.fillRect(hx + hw, hy, layout.width - (hx + hw), hh);
    }
    ctx.restore();
  }
}
