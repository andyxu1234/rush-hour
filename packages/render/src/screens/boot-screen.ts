/**
 * 启动页 —— docs/01 §6.1「启动加载」。
 *
 * 规格约束（原文）：「进度条、logo；必须在 1.5s 内可交互（首屏不拉网络资源）」。
 *
 * 落地方式：
 *   - 关卡包在**构建期**已内联为常量（Vite define / esbuild define），
 *     因此启动阶段不做任何网络请求，也没有异步等待；
 *   - 进度条是**动画时长驱动**的视觉反馈，不是真实加载进度 —— 绝不能
 *     把它写成"等 XHR 完成"，否则就违反了"首屏不拉网络"这条硬约束；
 *   - 到点自动跳主菜单，同时允许点击任意处跳过。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx。
 */

import type { CanvasRenderingContext2DLike, PointerEventLike } from '@rush-hour/platform';
import { COLORS, FONTS } from '../theme';
import { computeLayout, type Layout } from '../layout';
import { drawText, roundRectPath } from '../ui';
import type { Platform } from '@rush-hour/platform';
import type { Screen, ScreenId } from './screen';

/** 启动页停留时长（ms）。低于 1.5s 的验收口径来自 docs/01 §6.1 */
const BOOT_MS = 900;

export interface BootScreenDeps {
  platform: Platform;
  /** 动画结束后去哪（通常是主菜单） */
  onDone(): void;
}

export class BootScreen implements Screen {
  readonly id: ScreenId = 'boot';
  private layout: Layout;
  private elapsed = 0;
  private done = false;
  /** 复用的主画布上下文。
   *  ⚠️ 绝不能在 render() 里调 platform.createCanvas()：H5 端实现是
   *  "首次创建后复用"，但语义上它可能每次新建，每帧建一个 canvas 会瞬间吃光内存。*/
  private readonly ctx: CanvasRenderingContext2DLike;

  constructor(private readonly deps: BootScreenDeps) {
    const s = deps.platform.screen();
    this.layout = computeLayout(s.width, s.height);
    this.ctx = deps.platform.createCanvas(1, 1).getContext('2d') as CanvasRenderingContext2DLike;
  }

  enter(): void {
    this.elapsed = 0;
    this.done = false;
  }

  exit(): void {
    /* 无订阅、无定时器：无需清理 */
  }

  update(dt: number): void {
    if (this.done) return;
    this.elapsed += dt;
    if (this.elapsed >= BOOT_MS) this.finish();
  }

  onPointer(e: PointerEventLike): void {
    // 点击任意处跳过（进度条是装饰性的，不该让用户干等）
    if (e.phase === 'end') this.finish();
  }

  onResize(): void {
    const s = this.deps.platform.screen();
    this.layout = computeLayout(s.width, s.height);
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.deps.onDone();
  }

  /** 进度 0~1（e2e 断言"可交互时间"用） */
  get progress(): number {
    return Math.min(1, this.elapsed / BOOT_MS);
  }

  render(): void {
    const ctx = this.ctx;
    const layout = this.layout;

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, layout.width, layout.height);

    // logo：用棋盘元素拼一个极简标识（全部代码绘制，不含位图）
    this.drawLogo(ctx, layout);

    const cy = layout.height * 0.66;
    drawText(ctx, '汽车华容道', layout.width / 2, cy, {
      font: FONTS.hudLarge,
      align: 'center',
    });
    drawText(ctx, '把红车开出出口', layout.width / 2, cy + layout.height * 0.045, {
      font: FONTS.small,
      color: COLORS.textDim,
      align: 'center',
    });

    // 进度条
    const barW = Math.round(layout.width * 0.48);
    const barH = Math.max(6, Math.round(layout.height * 0.011));
    const bx = Math.round((layout.width - barW) / 2);
    const by = Math.round(layout.height * 0.82);

    ctx.save();
    ctx.fillStyle = COLORS.panelStroke;
    roundRectPath(ctx, bx, by, barW, barH, barH / 2);
    ctx.fill();

    const p = this.progress;
    if (p > 0) {
      ctx.fillStyle = COLORS.primary;
      roundRectPath(ctx, bx, by, Math.max(barH, barW * p), barH, barH / 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 标识：三辆车的俯视剪影 + 一条出口箭头 */
  private drawLogo(ctx: CanvasRenderingContext2DLike, layout: Layout): void {
    const cx = layout.width / 2;
    const cy = layout.height * 0.38;
    const u = Math.min(layout.cell * 1.6, layout.width * 0.13);
    const gap = u * 0.12;

    const car = (r: number, c: number, dir: 'H' | 'V', len: number, fill: string) => {
      const w = (dir === 'H' ? len * u : u) - gap * 2;
      const h = (dir === 'V' ? len * u : u) - gap * 2;
      const x = cx + (c - 1) * u + gap;
      const y = cy + (r - 1) * u + gap;
      ctx.save();
      ctx.fillStyle = fill;
      ctx.shadowColor = 'rgba(33,37,41,0.18)';
      ctx.shadowBlur = u * 0.3;
      ctx.shadowOffsetY = u * 0.08;
      roundRectPath(ctx, x, y, w, h, Math.max(4, u * 0.22));
      ctx.fill();
      ctx.restore();
    };

    // 红车（正中，暗示"主角"）
    car(1, 0.5, 'H', 2, COLORS.redCar);
    // 两辆挡路车
    car(0, 0, 'V', 2, '#4C6EF5');
    car(0, 2, 'V', 2, '#15AABF');

    // 出口箭头（右侧，绿色）
    const ax = cx + u * 1.6;
    const s = u * 0.3;
    ctx.save();
    ctx.fillStyle = COLORS.exit;
    ctx.beginPath();
    ctx.moveTo(ax - s, cy - s);
    ctx.lineTo(ax + s * 0.7, cy);
    ctx.lineTo(ax - s, cy + s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
