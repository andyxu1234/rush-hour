/**
 * 屏幕管理器 —— 唯一帧循环 + 屏幕注册表 + 导航栈。
 *
 * 职责边界：
 *   - 只做"切换与驱动"，不实现任何界面逻辑；
 *   - 所有平台交互（rAF / 指针 / resize）在这里**统一订阅一次**，
 *     再分发给当前屏幕 —— 避免每个屏幕各订阅一份导致重复处理。
 *   - 平台 API 一律通过注入的 Platform 接口访问（架构红线）。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx。
 */

import type { Platform, PointerEventLike } from '@rush-hour/platform';
import type { Screen, ScreenId, GameParams } from './screen';

export interface ScreenManagerDeps {
  platform: Platform;
  /** 事件回调（用于埋点与调试） */
  onNavigate?(to: ScreenId, from: ScreenId | null, params?: unknown): void;
}

export interface ScreenManagerOptions {
  /** 最大保留的返回栈深度，防止无限入栈 */
  maxStack?: number;
  /** 帧间隔上限（ms）。切后台回来时 dt 可能极大，必须夹紧避免动画瞬移 */
  maxDt?: number;
}

export class ScreenManager {
  private screens = new Map<ScreenId, Screen>();
  private current: Screen | null = null;
  /** 返回栈（不包含 current） */
  private stack: Array<{ id: ScreenId; params?: unknown }> = [];
  private rafHandle: number | null = null;
  private lastTime = 0;
  private unsubs: Array<() => void> = [];
  private readonly maxStack: number;
  private readonly maxDt: number;

  constructor(
    private readonly deps: ScreenManagerDeps,
    opts: ScreenManagerOptions = {},
  ) {
    this.maxStack = Math.max(1, opts.maxStack ?? 8);
    this.maxDt = opts.maxDt ?? 64;
  }

  register(screen: Screen): void {
    this.screens.set(screen.id, screen);
  }

  get currentId(): ScreenId | null {
    return this.current?.id ?? null;
  }

  get currentScreen(): Screen | null {
    return this.current;
  }

  /** 返回栈深度（e2e 断言深链行为用） */
  get stackDepth(): number {
    return this.stack.length;
  }

  /** 订阅平台能力 —— 必须在首次 navigate 之前调用一次 */
  attach(): void {
    if (this.unsubs.length > 0) return;
    this.unsubs.push(this.deps.platform.onPointer((e) => this.current?.onPointer(e)));
    this.unsubs.push(this.deps.platform.onResize(() => this.current?.onResize()));
    // 切回前台时重置时间基准：否则 dt 会是"后台停留时长"，
    // 一次巨大的 dt 会让动画直接跳到终点（游戏页早期已踩过这个坑）。
    this.unsubs.push(this.deps.platform.onShow(() => this.resetClock()));
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  /** 切换到目标屏幕（不压栈）；同屏幕重复导航会被忽略 */
  navigate(id: ScreenId, params?: unknown): void {
    const next = this.screens.get(id);
    if (!next) {
      // 未注册的屏幕属编程错误：静默忽略而不是崩溃，避免线上白屏
      return;
    }
    if (this.current?.id === id) {
      // 同一屏幕：只更新参数，不重走 enter/exit（避免重入导致状态错乱）
      this.current.enter(params);
      return;
    }
    const from = this.current?.id ?? null;
    this.current?.exit();
    this.current = next;
    next.enter(params);
    this.deps.onNavigate?.(id, from, params);
    this.resetClock();
  }

  /** 压栈并导航（用于"进入子页面后再返回"） */
  push(id: ScreenId, params?: unknown): void {
    if (this.current) {
      this.stack.push({ id: this.current.id, params: undefined });
      while (this.stack.length > this.maxStack) this.stack.shift();
    }
    this.navigate(id, params);
  }

  /** 返回上一层；栈空时返回 false（由调用方决定兜底去哪） */
  back(): boolean {
    const prev = this.stack.pop();
    if (!prev) return false;
    this.navigate(prev.id, prev.params);
    return true;
  }

  /** 清空返回栈并导航（如"回主菜单"） */
  reset(id: ScreenId, params?: unknown): void {
    this.stack = [];
    this.navigate(id, params);
  }

  start(): void {
    if (this.rafHandle !== null) return;
    const loop = (t: number) => {
      const dt = this.lastTime === 0 ? 16 : Math.max(0, Math.min(this.maxDt, t - this.lastTime));
      this.lastTime = t;
      this.current?.update(dt, t);
      this.current?.render();
      this.rafHandle = this.deps.platform.requestAnimationFrame(loop);
    };
    this.rafHandle = this.deps.platform.requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafHandle !== null) this.deps.platform.cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
  }

  dispose(): void {
    this.stop();
    this.current?.exit();
    this.current = null;
    this.detach();
  }

  /** 外部（如 e2e）主动派发指针事件；与平台回调同一入口 */
  dispatchPointer(e: PointerEventLike): void {
    this.current?.onPointer(e);
  }

  private resetClock(): void {
    this.lastTime = 0;
  }
}

/** 导航到游戏页时的参数类型再导出，方便宿主与 e2e 共用 */
export type { GameParams };
