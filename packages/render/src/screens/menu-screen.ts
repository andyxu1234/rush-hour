/**
 * 主菜单 —— docs/01 §6.1。
 *
 * 规格要求的六个入口（原文）：
 *   「继续上局、开始闯关、每日挑战、排行榜、设置、隐私政策入口」
 *   边界：「首次进入走强制新手引导」
 *
 * 实现取舍：
 *   - 「继续上局」只在存档里存在未完成对局时出现（按钮数量动态变化），
 *     因此按钮用**索引 id**（menu-0..n）而非语义 id，命中后按当前菜单项数组解析，
 *     避免"按钮列表变了但 id 对不上"这种错位。
 *   - 「每日挑战」按用户决策**本轮只做占位页**（等 P5 后端契约），
 *     但入口保留 —— 否则后续接入时要重排主菜单布局。
 *   - 强制引导：`!save.tutorialDone` 时点"开始闯关"直接进游戏，
 *     引导遮罩由 GameScreen 依据关卡序号自行触发（docs/01 §9 是"情境化遮罩"，
 *     不是独立教程页，所以不能在这里拦一个"教程页"出来）。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx。
 */

import type { CanvasRenderingContext2DLike, Platform, PointerEventLike } from '@rush-hour/platform';
import type { LevelRepository, SaveV1 } from '@rush-hour/core';
import { totalStars } from '@rush-hour/core';
import { COLORS, FONTS } from '../theme';
import { computeLayout, hitRect, menuLayout, type Layout } from '../layout';
import { drawPageBackground, drawText, drawUiButton, type UiButton } from '../ui';
import type { Screen, ScreenId } from './screen';

/** 菜单项语义（与视觉按钮一一对应） */
export type MenuAction =
  | 'continue'
  | 'start'
  | 'daily'
  | 'leaderboard'
  | 'settings'
  | 'privacy';

export interface MenuItem {
  action: MenuAction;
  label: string;
  secondary?: boolean;
}

export interface MenuScreenDeps {
  platform: Platform;
  repo: LevelRepository;
  save: SaveV1;
  /** 导航到其他屏幕 */
  navigate(id: ScreenId, params?: unknown): void;
  /** 进入游戏（由宿主转成 game params） */
  startGame(params: { levelId?: string; from?: 'menu' | 'select' | 'daily' }): void;
}

export class MenuScreen implements Screen {
  readonly id: ScreenId = 'menu';
  private layout: Layout;
  private readonly ctx: CanvasRenderingContext2DLike;
  private items: MenuItem[] = [];
  private buttons: UiButton[] = [];
  private footer: UiButton | null = null;

  constructor(private readonly deps: MenuScreenDeps) {
    const s = deps.platform.screen();
    this.layout = computeLayout(s.width, s.height);
    this.ctx = deps.platform.createCanvas(1, 1).getContext('2d') as CanvasRenderingContext2DLike;
  }

  enter(): void {
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
    /* 主菜单为静态页：无动画、无需逐帧状态推进 */
  }

  onPointer(e: PointerEventLike): void {
    if (e.phase !== 'end') return;
    const hit = hitRect(this.buttons, e.x, e.y) ?? (this.footer ? hitRect([this.footer], e.x, e.y) : null);
    if (!hit) return;
    this.deps.platform.audio.play('click');
    this.dispatch(hit.id as MenuAction);
  }

  /** 当前菜单项（e2e 断言用） */
  get menuItems(): readonly MenuItem[] {
    return this.items;
  }

  get buttonRects(): readonly UiButton[] {
    return this.buttons;
  }

  /** 直接触发某个菜单动作（e2e / 调试台用，避免依赖像素坐标） */
  trigger(action: MenuAction): void {
    this.dispatch(action);
  }

  private dispatch(action: MenuAction): void {
    switch (action) {
      case 'continue':
        this.deps.startGame({ from: 'menu' });
        break;
      case 'start':
        this.deps.navigate('select');
        break;
      case 'daily':
        this.deps.navigate('daily');
        break;
      case 'leaderboard':
        this.deps.navigate('leaderboard');
        break;
      case 'settings':
        this.deps.navigate('settings');
        break;
      case 'privacy':
        this.deps.navigate('privacy');
        break;
    }
  }

  /** 依据存档重建菜单项与几何（有/无"继续上局"会改变按钮数量） */
  private rebuild(): void {
    const items: MenuItem[] = [];
    const cur = this.deps.save.current;
    const hasUnfinished =
      !!cur && cur.moves.length > 0 && this.deps.repo.get(cur.levelId) !== undefined;
    if (hasUnfinished) items.push({ action: 'continue', label: '继续上局' });
    items.push({ action: 'start', label: '开始闯关' });
    if (!hasUnfinished) {
      // 无未完成对局时把"继续"的位置让给"开始"作为主按钮，视觉重心不变
      items[0].secondary = false;
    }
    items.push({ action: 'daily', label: '每日挑战', secondary: true });
    items.push({ action: 'leaderboard', label: '排行榜', secondary: true });
    items.push({ action: 'settings', label: '设置', secondary: true });
    this.items = items;

    const geo = menuLayout(this.layout, items.length);
    this.buttons = items.map((it, i): UiButton => ({
      ...geo.buttons[i],
      id: it.action,
      label: it.label,
      secondary: it.secondary,
    }));
    this.footer = { ...geo.footer, id: 'privacy', label: '隐私政策', secondary: true };
  }

  render(): void {
    const ctx = this.ctx;
    const layout = this.layout;
    drawPageBackground(ctx, layout);

    // 标题
    const titleY = Math.max(layout.height * 0.1, layout.hudHeight * 0.9);
    drawText(ctx, '汽车华容道', layout.width / 2, titleY, {
      font: FONTS.hudLarge,
      align: 'center',
    });

    // 进度摘要（总星数 / 关卡数）—— 给玩家一个"我在哪"的锚点
    const cleared = Object.keys(this.deps.save.levels).length;
    const total = this.deps.repo.levels.length;
    const stars = totalStars(this.deps.save);
    drawText(
      ctx,
      `已通关 ${cleared} / ${total}　★ ${stars}`,
      layout.width / 2,
      titleY + Math.round(layout.height * 0.038),
      { font: FONTS.small, color: COLORS.textDim, align: 'center' },
    );

    for (const b of this.buttons) drawUiButton(ctx, b);
    if (this.footer) drawUiButton(ctx, this.footer);

    // 版本号（提审与线上排障都需要能一眼看出跑的是哪版）
    drawText(ctx, 'v0.1.0', layout.width / 2, layout.height - Math.round(layout.height * 0.018), {
      font: FONTS.small,
      color: COLORS.textDim,
      align: 'center',
    });
  }
}
