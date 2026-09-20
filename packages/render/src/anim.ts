/**
 * 动画与插值 —— 手感参数严格对齐 docs/01 §8。
 *
 * 设计：渲染层不持有"动画状态机"，只持有若干**带生命周期的 tween**；
 * 每帧推进并产出当前绘制用的偏移量。这样即使掉帧也不会累积误差。
 */

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

/** 带轻微过冲的回弹（非法方向 x 轴抖动 + 顶住感） */
export function easeOutBack(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  const s = 1.70158;
  const u = c - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}

export abstract class Tween {
  elapsed = 0;
  done = false;
  constructor(readonly duration: number) {}
  advance(dt: number): void {
    this.elapsed += dt;
    if (this.elapsed >= this.duration) this.done = true;
  }
  get t(): number {
    return Math.min(1, this.duration <= 0 ? 1 : this.elapsed / this.duration);
  }
}

/** 一辆车从一格滑到另一格的插值 */
export class SlideTween extends Tween {
  constructor(
    readonly pieceId: string,
    duration: number,
    /** 起点偏移（格），终点恒为 0 */
    readonly fromDx: number,
    readonly fromDy: number,
  ) {
    super(duration);
  }

  get offset(): { dx: number; dy: number } {
    const e = easeOutCubic(this.t);
    return { dx: this.fromDx * (1 - e), dy: this.fromDy * (1 - e) };
  }
}

/** 非法移动的抖动 */
export class ShakeTween extends Tween {
  constructor(
    readonly pieceId: string,
    readonly axis: 'x' | 'y',
    duration: number,
    readonly amplitude: number,
  ) {
    super(duration);
  }

  get offset(): { dx: number; dy: number } {
    // 阻尼正弦：振幅随进度衰减，观感更像"顶住后弹回"
    const damp = 1 - this.t;
    const v = Math.sin(this.t * Math.PI * 4) * this.amplitude * damp;
    return this.axis === 'x' ? { dx: v, dy: 0 } : { dx: 0, dy: v };
  }
}

/** 过关驶出：红车沿 x 轴加速驶出屏幕 */
export class ExitTween extends Tween {
  constructor(duration: number, readonly distancePx: number) {
    super(duration);
  }
  get offset(): { dx: number; dy: number } {
    // 加速（easeIn）：起步慢、冲出屏幕快
    const c = this.t;
    return { dx: this.distancePx * c * c, dy: 0 };
  }
}

/** 白光闪屏 */
export class FlashTween extends Tween {
  constructor(duration: number) {
    super(duration);
  }
  get alpha(): number {
    return 1 - this.t;
  }
}

/** 通用进度（用于弹窗缩放入场） */
export class ProgressTween extends Tween {
  constructor(duration: number) {
    super(duration);
  }
}

/** 一个简单的 tween 集合，按 pieceId 索引 */
export class Animator {
  private slides = new Map<string, SlideTween>();
  private shakes = new Map<string, ShakeTween>();
  private transient: Tween[] = [];
  exit: ExitTween | null = null;
  flash: FlashTween | null = null;
  dialog: ProgressTween | null = null;

  slide(pieceId: string, fromDx: number, fromDy: number, duration: number): void {
    this.slides.set(pieceId, new SlideTween(pieceId, duration, fromDx, fromDy));
  }

  shake(pieceId: string, axis: 'x' | 'y', duration: number, amplitude: number): void {
    this.shakes.set(pieceId, new ShakeTween(pieceId, axis, duration, amplitude));
  }

  startExit(duration: number, distancePx: number): void {
    this.exit = new ExitTween(duration, distancePx);
  }

  startFlash(duration: number): void {
    this.flash = new FlashTween(duration);
  }

  startDialog(duration: number): void {
    this.dialog = new ProgressTween(duration);
  }

  add(t: Tween): void {
    this.transient.push(t);
  }

  clear(): void {
    this.slides.clear();
    this.shakes.clear();
    this.transient = [];
    this.exit = null;
    this.flash = null;
    this.dialog = null;
  }

  /** 该车当前的绘制偏移（像素） */
  offsetFor(pieceId: string, cell: number): { dx: number; dy: number } {
    let dx = 0;
    let dy = 0;
    const s = this.slides.get(pieceId);
    if (s) {
      const o = s.offset;
      dx += o.dx * cell;
      dy += o.dy * cell;
    }
    const k = this.shakes.get(pieceId);
    if (k) {
      const o = k.offset;
      dx += o.dx;
      dy += o.dy;
    }
    if (pieceId === 'R' && this.exit) dx += this.exit.offset.dx;
    return { dx, dy };
  }

  get animating(): boolean {
    return (
      this.slides.size > 0 ||
      this.shakes.size > 0 ||
      this.transient.some((t) => !t.done) ||
      (this.exit !== null && !this.exit.done)
    );
  }

  advance(dt: number): void {
    for (const [k, t] of this.slides) {
      t.advance(dt);
      if (t.done) this.slides.delete(k);
    }
    for (const [k, t] of this.shakes) {
      t.advance(dt);
      if (t.done) this.shakes.delete(k);
    }
    for (const t of this.transient) t.advance(dt);
    this.transient = this.transient.filter((t) => !t.done);
    if (this.exit) {
      this.exit.advance(dt);
      if (this.exit.done) this.exit = null;
    }
    if (this.flash) {
      this.flash.advance(dt);
      if (this.flash.done) this.flash = null;
    }
    if (this.dialog) {
      this.dialog.advance(dt);
      if (this.dialog.done) this.dialog = null;
    }
  }
}
