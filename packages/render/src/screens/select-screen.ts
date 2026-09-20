/**
 * 选关页 —— docs/01 §6.1。
 *
 * 规格要求（原文）：
 *   「关卡格子（星级、锁定态）、分页/章节、当前进度」
 *   边界：「未解锁关卡灰显不可点；已通关可重玩刷星」
 *
 * 实现取舍：
 *   - 解锁规则**不在这里重新实现**：一律调用 core 的 `isUnlocked(save, levels, id)`。
 *     解锁口径（"上一关已通关"）只有一处定义，选关页与游戏页的"下一关"才可能一致。
 *   - 星级取 `save.levels[id].stars`（0 表示未通关 → 显示空星并标锁定态）。
 *   - 分页而非滚动：小游戏触屏上滚动与拖拽棋盘的手势容易冲突，
 *     且关卡数量可控（当前 11 关 / 每页 16 格 = 1 页），分页实现最简单可靠。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx。
 */

import type { CanvasRenderingContext2DLike, Platform, PointerEventLike } from '@rush-hour/platform';
import { isUnlocked, type Level, type LevelRepository, type SaveV1 } from '@rush-hour/core';
import { COLORS, FONTS } from '../theme';
import {
  computeLayout,
  hitRect,
  selectLayout,
  type Layout,
  type RectGeom,
} from '../layout';
import {
  drawHeader,
  drawPageBackground,
  drawStarRow,
  drawText,
  drawUiButton,
  roundRectPath,
  type UiButton,
} from '../ui';
import type { Screen, ScreenId } from './screen';

export interface SelectScreenDeps {
  platform: Platform;
  repo: LevelRepository;
  save: SaveV1;
  navigate(id: ScreenId, params?: unknown): void;
  /** 进入某一关 */
  startGame(params: { levelId: string; from: 'select' }): void;
  /** 返回上一层（由宿主决定回主菜单还是别的） */
  goBack(): void;
}

/** 单元格的解锁/星级状态（抽出来便于单测与 e2e 断言） */
export interface LevelCell {
  level: Level;
  index: number;
  unlocked: boolean;
  stars: number;
  rect: RectGeom;
}

export class SelectScreen implements Screen {
  readonly id: ScreenId = 'select';
  private layout: Layout;
  private readonly ctx: CanvasRenderingContext2DLike;
  private page = 0;
  private cells: LevelCell[] = [];
  private prevBtn: UiButton | null = null;
  private nextBtn: UiButton | null = null;
  private backBtn: UiButton | null = null;
  private pageCount = 1;

  constructor(private readonly deps: SelectScreenDeps) {
    const s = deps.platform.screen();
    this.layout = computeLayout(s.width, s.height);
    this.ctx = deps.platform.createCanvas(1, 1).getContext('2d') as CanvasRenderingContext2DLike;
  }

  enter(): void {
    // 每次进入都回到"当前进度所在页"，避免玩家每次都要手动翻页
    this.page = this.pageOfCurrentProgress();
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
    /* 静态页 */
  }

  onPointer(e: PointerEventLike): void {
    if (e.phase !== 'end') return;

    if (this.backBtn && hitRect([this.backBtn], e.x, e.y)) {
      this.deps.platform.audio.play('click');
      this.deps.goBack();
      return;
    }
    if (this.prevBtn && hitRect([this.prevBtn], e.x, e.y)) {
      if (this.page > 0) {
        this.page--;
        this.rebuild();
        this.deps.platform.audio.play('click');
      }
      return;
    }
    if (this.nextBtn && hitRect([this.nextBtn], e.x, e.y)) {
      if (this.page < this.pageCount - 1) {
        this.page++;
        this.rebuild();
        this.deps.platform.audio.play('click');
      }
      return;
    }

    const hit = hitRect(
      this.cells.map((c) => c.rect),
      e.x,
      e.y,
    );
    if (!hit) return;
    const cell = this.cells.find((c) => c.rect.id === hit.id);
    if (!cell) return;
    // 未解锁：灰显不可点（不播放错误音，避免"点了有反应却进不去"的困惑）
    if (!cell.unlocked) return;
    this.deps.platform.audio.play('click');
    this.deps.startGame({ levelId: cell.level.id, from: 'select' });
  }

  // ---------------------------------------------------------------- 查询（e2e / 调试台）

  get cellStates(): readonly LevelCell[] {
    return this.cells;
  }

  get currentPage(): number {
    return this.page;
  }

  get totalPages(): number {
    return this.pageCount;
  }

  get navRects(): { prev: UiButton | null; next: UiButton | null; back: UiButton | null } {
    return { prev: this.prevBtn, next: this.nextBtn, back: this.backBtn };
  }

  /** 直接进入某关（等价于点击格子），返回是否成功；用于 e2e 避免像素坐标 */
  openLevel(levelId: string): boolean {
    const cell = this.cells.find((c) => c.level.id === levelId);
    if (!cell || !cell.unlocked) {
      // 可能在别的分页：先翻到对应页再试
      const idx = this.deps.repo.levels.findIndex((l) => l.id === levelId);
      if (idx < 0) return false;
      const perPage = this.cells.length > 0 ? this.perPageSize() : 0;
      if (perPage <= 0) return false;
      this.page = Math.floor(idx / perPage);
      this.rebuild();
      const again = this.cells.find((c) => c.level.id === levelId);
      if (!again || !again.unlocked) return false;
    }
    this.deps.startGame({ levelId, from: 'select' });
    return true;
  }

  setPage(page: number): void {
    this.page = Math.max(0, Math.min(this.pageCount - 1, page));
    this.rebuild();
  }

  // ---------------------------------------------------------------- 内部

  private perPageSize(): number {
    // rebuild 会重建 cells，此处按上一次的布局推断每页容量
    return Math.max(1, this.cells.length || 1);
  }

  private pageOfCurrentProgress(): number {
    const levels = this.deps.repo.levels;
    // 找到"第一个未通关的关卡"所在页
    let firstUncleared = levels.findIndex((l) => this.deps.save.levels[l.id] === undefined);
    if (firstUncleared < 0) firstUncleared = Math.max(0, levels.length - 1);
    const probe = selectLayout(this.layout, levels.length, 0);
    const perPage = Math.max(1, probe.cells.length);
    return Math.floor(firstUncleared / perPage);
  }

  private rebuild(): void {
    const levels = this.deps.repo.levels;
    const grid = selectLayout(this.layout, levels.length, this.page);
    this.page = grid.page;
    this.pageCount = grid.pageCount;

    this.cells = grid.cells.map((rect): LevelCell => {
      const index = Number(rect.id.replace('level-', ''));
      const level = levels[index];
      const progress = this.deps.save.levels[level.id];
      return {
        level,
        index,
        unlocked: isUnlocked(this.deps.save, levels, level.id),
        stars: progress ? progress.stars : 0,
        rect,
      };
    });

    this.prevBtn = { ...grid.prev, disabled: this.page <= 0, secondary: true };
    this.nextBtn = {
      ...grid.next,
      disabled: this.page >= this.pageCount - 1,
      secondary: true,
    };

    const header = drawHeaderGeometry(this.layout);
    this.backBtn = header;
  }

  render(): void {
    const ctx = this.ctx;
    const layout = this.layout;
    drawPageBackground(ctx, layout);

    const header = drawHeader(ctx, layout, '选择关卡');
    this.backBtn = header.back;

    // 页内格子
    for (const cell of this.cells) {
      this.drawCell(ctx, cell);
    }

    // 翻页按钮 + 页码
    if (this.prevBtn) drawUiButton(ctx, this.prevBtn);
    if (this.nextBtn) drawUiButton(ctx, this.nextBtn);
    if (this.pageCount > 1) {
      drawText(
        ctx,
        `${this.page + 1} / ${this.pageCount}`,
        layout.width / 2,
        this.prevBtn ? this.prevBtn.y + this.prevBtn.h / 2 : layout.height * 0.9,
        { font: FONTS.small, color: COLORS.textDim, align: 'center' },
      );
    }
  }

  /** 单个关卡格：锁定态灰显；已通关显示星级；当前关加主色描边 */
  private drawCell(ctx: CanvasRenderingContext2DLike, cell: LevelCell): void {
    const r = cell.rect;
    const progress = this.deps.save.levels[cell.level.id];
    const isCurrent = !progress && cell.unlocked;

    ctx.save();
    if (!cell.unlocked) ctx.globalAlpha = 0.42;

    ctx.fillStyle = progress ? COLORS.panel : COLORS.boardBg;
    ctx.strokeStyle = isCurrent ? COLORS.primary : COLORS.panelStroke;
    ctx.lineWidth = isCurrent ? 2 : 1;
    roundRectPath(ctx, r.x, r.y, r.w, r.h, Math.max(8, r.w * 0.16));
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.save();
    if (!cell.unlocked) ctx.globalAlpha = 0.42;
    // 关卡号（用关卡在包内的序号，而非 id —— id 形如 c001 对玩家无意义）
    const label = String(cell.index + 1);
    drawText(ctx, label, r.x + r.w / 2, r.y + r.h * 0.36, {
      font: FONTS.hudLarge,
      align: 'center',
    });

    if (cell.unlocked) {
      drawStarRow(ctx, r.x + r.w / 2, r.y + r.h * 0.72, Math.max(5, r.w * 0.09), cell.stars, {
        gap: r.w * 0.22,
      });
    } else {
      // 锁定态用一把"锁"的简化画法（矩形锁体 + 半圆锁梁），全代码绘制
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h * 0.7;
      const s = r.w * 0.14;
      ctx.strokeStyle = COLORS.textDim;
      ctx.lineWidth = Math.max(1.5, s * 0.28);
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.5, s * 0.7, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = COLORS.textDim;
      roundRectPath(ctx, cx - s, cy - s * 0.2, s * 2, s * 1.5, s * 0.35);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** 独立函数：避免 rebuild 与 render 两处各算一次 header 几何 */
function drawHeaderGeometry(layout: Layout): UiButton {
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
