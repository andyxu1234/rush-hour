/**
 * 屏幕接口 —— P4 新增的导航基础。
 *
 * 为什么需要它：P0–P2 只有一个 GameScreen，它自己持有 requestAnimationFrame 循环。
 * 一旦有 8 个界面，若每个界面各自起一个 rAF，就会出现：
 *   - 多个循环同时绘制同一张 canvas（互相覆盖、闪烁）；
 *   - 上一个屏幕停不下来（内存与事件订阅泄漏）；
 *   - 指针事件被多个屏幕重复处理。
 * 因此改为：**唯一循环由 ScreenManager 驱动**，屏幕只负责 update/render/onPointer。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx（.eslintrc.cjs 强制）。
 */

import type { PointerEventLike } from '@rush-hour/platform';

export type ScreenId =
  | 'boot'
  | 'menu'
  | 'select'
  | 'game'
  | 'settings'
  | 'leaderboard'
  | 'daily'
  | 'privacy'
  | 'share';

export interface Screen {
  readonly id: ScreenId;
  /** 进入屏幕。params 由导航方定义，各屏幕自行解释 */
  enter(params?: unknown): void;
  /** 离开屏幕：必须在这里退订平台事件、清空定时器 */
  exit(): void;
  update(dt: number, now: number): void;
  render(): void;
  onPointer(e: PointerEventLike): void;
  /** 尺寸变化（平台方向变化 / 桌面窗口缩放） */
  onResize(): void;
}

/** 导航参数：各屏幕用到的通用载荷 */
export interface GameParams {
  levelId?: string;
  /** 从选关页进入时为 true（返回时回到选关页而非主菜单） */
  from?: 'menu' | 'select' | 'daily';
  /** 是否强制显示新手引导（设置页"重看引导"入口） */
  forceTutorial?: boolean;
}
