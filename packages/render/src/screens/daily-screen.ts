/**
 * 每日挑战 —— docs/01 §6.1 / §5。
 *
 * ⚠️ 本轮（P4）**只做占位页**，按用户决策等 P5 后端契约再实现。
 *
 * 为什么占位而不删掉入口：
 *   - 规格书要求"每日挑战"用日期种子**确定性生成**，且 `RemoteApi` 契约里
 *     已定义 `getDailyChallenge(date)`。真实实现必须与服务端**同一种子算法**，
 *     否则会出现"今天我和好友的每日关不一样"这种无法解释的 bug。
 *   - 主菜单的布局是按入口数量均分的，删掉入口会导致 P5 时重排。
 *
 * 占位页的纪律：**明确告知未开放**，不伪造一个"今日关卡"让玩家白玩一局。
 * 显示今天日期，让玩家知道页面是活的（不是加载失败）。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx。
 */

import type { CanvasRenderingContext2DLike, Platform, PointerEventLike } from '@rush-hour/platform';
import { COLORS, FONTS } from '../theme';
import { computeLayout, hitRect, type Layout } from '../layout';
import {
  drawEmptyState,
  drawFootNote,
  drawHeader,
  drawPageBackground,
  drawText,
  drawUiButton,
  roundRectPath,
  type UiButton,
} from '../ui';
import type { Screen, ScreenId } from './screen';

export interface DailyScreenDeps {
  platform: Platform;
  goBack(): void;
}

export class DailyScreen implements Screen {
  readonly id: ScreenId = 'daily';
  private layout: Layout;
  private readonly ctx: CanvasRenderingContext2DLike;
  private backBtn: UiButton | null = null;
  private hintBtn: UiButton | null = null;
  private dateText = '';

  constructor(private readonly deps: DailyScreenDeps) {
    const s = deps.platform.screen();
    this.layout = computeLayout(s.width, s.height);
    this.ctx = deps.platform.createCanvas(1, 1).getContext('2d') as CanvasRenderingContext2DLike;
  }

  enter(): void {
    this.dateText = formatToday(new Date());
    this.rebuild();
  }

  exit(): void {
    /* 无订阅 */
  }

  onResize(): void {
    const s = this.deps.platform.screen();
    this.layout = computeLayout(s.width, s.height);
    this.rebuild();
  }

  update(): void {
    /* 静态占位页 */
  }

  onPointer(e: PointerEventLike): void {
    if (e.phase !== 'end') return;
    if (this.backBtn && hitRect([this.backBtn], e.x, e.y)) {
      this.deps.platform.audio.play('click');
      this.deps.goBack();
    }
  }

  /** 是否已开放（e2e 断言占位状态） */
  get isAvailable(): boolean {
    return false;
  }

  get todayLabel(): string {
    return this.dateText;
  }

  get hintRect(): UiButton | null {
    return this.hintBtn;
  }

  private rebuild(): void {
    // 一个不可点击的"敬请期待"提示按钮 —— 用 disabled 明确它点不动
    const w = Math.round(this.layout.width * 0.56);
    const h = Math.max(42, Math.round(this.layout.height * 0.062));
    this.hintBtn = {
      id: 'coming-soon',
      label: '敬请期待',
      x: Math.round((this.layout.width - w) / 2),
      y: Math.round(this.layout.height * 0.62),
      w,
      h,
      disabled: true,
    };
    this.backBtn = backGeometry(this.layout);
  }

  render(): void {
    const ctx = this.ctx;
    const layout = this.layout;
    drawPageBackground(ctx, layout);

    const header = drawHeader(ctx, layout, '每日挑战');
    this.backBtn = header.back;

    // 日期卡片（证明页面是"活的"，不是加载失败）
    const cardW = Math.round(layout.width * 0.62);
    const cardH = Math.round(layout.height * 0.11);
    const cx = Math.round((layout.width - cardW) / 2);
    const cy = Math.round(layout.height * 0.3);
    ctx.save();
    ctx.fillStyle = COLORS.panel;
    ctx.strokeStyle = COLORS.panelStroke;
    ctx.lineWidth = 1;
    roundRectPath(ctx, cx, cy, cardW, cardH, 14);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    drawText(ctx, '今天', layout.width / 2, cy + cardH * 0.32, {
      font: FONTS.small,
      color: COLORS.textDim,
      align: 'center',
    });
    drawText(ctx, this.dateText, layout.width / 2, cy + cardH * 0.68, {
      font: FONTS.hudLarge,
      align: 'center',
    });

    drawEmptyState(ctx, layout, '每日挑战尚未开放', '需要服务端下发当日关卡，正在开发中');
    if (this.hintBtn) drawUiButton(ctx, this.hintBtn);

    drawFootNote(ctx, layout, '每日挑战・即将上线');
  }
}

/** YYYY-MM-DD（本地时区）。刻意不用 toISOString：那是 UTC，会让玩家看到"昨天的日期" */
function formatToday(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function backGeometry(layout: Layout): UiButton {
  const pad = Math.round(layout.width * 0.05);
  const size = Math.round(Math.min(40, Math.max(32, layout.width * 0.095)));
  return {
    id: 'back',
    label: '返回',
    x: pad,
    y: pad,
    w: Math.max(64, size * 1.7),
    h: size,
    secondary: true,
  };
}
