/**
 * 排行榜 —— docs/01 §6.1。
 *
 * 规格要求（原文）：
 *   「好友榜（开放数据域）、全球榜、我的排名」
 *   边界：「未登录时展示本地最好成绩」
 *
 * 本轮（P4）没有后端（P5 才接），因此按**本地降级**实现（用户已确认）：
 *   - Tabs「全球榜 / 好友榜」保留（否则后续接入要重排布局），
 *     但都明确标注数据来源为「本地成绩」—— 绝不伪造一个看起来像真榜的列表。
 *   - 榜单内容从 `save.levels` 归纳：每关的 `bestMoves` 就是"我的成绩"。
 *     按关卡顺序排列，未通关的关卡不出现（没有成绩可排）。
 *   - 「我的排名」在无后端时没有意义，改为展示汇总（总星数 / 通关数 / 最佳步数）。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx。
 */

import type { CanvasRenderingContext2DLike, Platform, PointerEventLike } from '@rush-hour/platform';
import { totalStars, type LevelRepository, type SaveV1 } from '@rush-hour/core';
import { COLORS, FONTS } from '../theme';
import { computeLayout, hitRect, listLayout, tabsLayout, type Layout } from '../layout';
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

export type LeaderboardScope = 'global' | 'friends';

export interface LeaderboardRow {
  levelId: string;
  levelName: string;
  index: number;
  bestMoves: number;
  stars: number;
}

export interface LeaderboardScreenDeps {
  platform: Platform;
  repo: LevelRepository;
  save: SaveV1;
  goBack(): void;
}

/** 一页最多展示多少行（超出的部分本轮不做滚动，只展示前 N 名） */
const MAX_ROWS = 8;

export class LeaderboardScreen implements Screen {
  readonly id: ScreenId = 'leaderboard';
  private layout: Layout;
  private readonly ctx: CanvasRenderingContext2DLike;
  private scope: LeaderboardScope = 'global';
  private tabs: UiButton[] = [];
  private rows: UiButton[] = [];
  private backBtn: UiButton | null = null;

  constructor(private readonly deps: LeaderboardScreenDeps) {
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
    /* 静态页 */
  }

  onPointer(e: PointerEventLike): void {
    if (e.phase !== 'end') return;
    if (this.backBtn && hitRect([this.backBtn], e.x, e.y)) {
      this.deps.platform.audio.play('click');
      this.deps.goBack();
      return;
    }
    const tab = hitRect(this.tabs, e.x, e.y);
    if (tab) {
      const next = (tab.id === 'tab-0' ? 'global' : 'friends') as LeaderboardScope;
      if (next !== this.scope) {
        this.scope = next;
        this.deps.platform.audio.play('click');
        this.rebuild();
      }
    }
  }

  // ---------------------------------------------------------------- 查询（e2e）

  get currentScope(): LeaderboardScope {
    return this.scope;
  }

  get showingRows(): readonly LeaderboardRow[] {
    return this.visibleRows();
  }

  get tabRects(): readonly UiButton[] {
    return this.tabs;
  }

  setScope(scope: LeaderboardScope): void {
    this.scope = scope;
    this.rebuild();
  }

  /**
   * 从存档归纳榜单。
   *
   * 排序口径：**按关卡顺序**而非步数 —— 因为不同关卡的 par 不同，
   * 跨关比步数没有意义（第 1 关 1 步永远排第一）。真正的跨玩家比较
   * 必须限定同一个关卡，那是后端排行榜的职责（`RemoteApi.leaderboard(levelId)`）。
   */
  private visibleRows(): LeaderboardRow[] {
    const levels = this.deps.repo.levels;
    const out: LeaderboardRow[] = [];
    for (let i = 0; i < levels.length; i++) {
      const l = levels[i];
      const p = this.deps.save.levels[l.id];
      if (!p) continue;
      out.push({
        levelId: l.id,
        levelName: l.name,
        index: i,
        // 步数口径跟随设置：显示玩家选择的那个，避免与游戏页 HUD 不一致
        bestMoves: this.deps.save.settings.moveMetric === 'cells' ? p.bestCells : p.bestMoves,
        stars: p.stars,
      });
      if (out.length >= MAX_ROWS) break;
    }
    return out;
  }

  private rebuild(): void {
    const geo = tabsLayout(this.layout, 2);
    this.tabs = [
      { ...geo[0], id: 'tab-0', label: '全球榜', secondary: this.scope !== 'global' },
      { ...geo[1], id: 'tab-1', label: '好友榜', secondary: this.scope !== 'friends' },
    ];

    const rows = this.visibleRows();
    // 榜单列表从 tabs 下方开始排，因此 listLayout 的 count 用实际行数
    const list = listLayout(this.layout, Math.max(1, rows.length));
    this.rows = rows.map((_, i) => ({
      id: `entry-${i}`,
      x: list.rows[i].x,
      y: list.rows[i].y,
      w: list.rows[i].w,
      h: list.rows[i].h,
      label: '',
    }));

    this.backBtn = backGeometry(this.layout);
  }

  render(): void {
    const ctx = this.ctx;
    const layout = this.layout;
    drawPageBackground(ctx, layout);

    const header = drawHeader(ctx, layout, '排行榜');
    this.backBtn = header.back;

    for (const t of this.tabs) drawUiButton(ctx, t);

    const rows = this.visibleRows();
    if (rows.length === 0) {
      drawEmptyState(ctx, layout, '还没有成绩', '通关任意一关后，这里会出现你的最佳记录');
      drawFootNote(ctx, layout, '本地成绩 · 接入后端后显示真实排行榜');
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      this.drawEntry(ctx, rows[i], this.rows[i], i);
    }

    // 汇总（替代无后端时的"我的排名"）
    const stars = totalStars(this.deps.save);
    const cleared = Object.keys(this.deps.save.levels).length;
    drawFootNote(
      ctx,
      layout,
      `本地成绩　已通关 ${cleared} 关　★ ${stars}`,
    );
  }

  private drawEntry(
    ctx: CanvasRenderingContext2DLike,
    row: LeaderboardRow,
    rect: UiButton,
    i: number,
  ): void {
    ctx.save();
    ctx.fillStyle = i % 2 === 0 ? COLORS.panel : COLORS.cellBg;
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 10);
    ctx.fill();
    ctx.restore();

    // 名次（本地榜单里就是关卡序号，用 1-based 展示）
    drawText(ctx, String(i + 1), rect.x + Math.round(rect.h * 0.5), rect.y + rect.h / 2, {
      font: FONTS.hud,
      color: COLORS.textDim,
      align: 'center',
    });

    // 关卡名（过长时截断，避免压到右侧步数）
    const nameX = rect.x + Math.round(rect.h * 0.95);
    const maxNameW = rect.w - Math.round(rect.h * 0.95) - Math.round(rect.w * 0.3);
    drawText(ctx, clip(ctx, row.levelName, maxNameW), nameX, rect.y + rect.h / 2, {
      font: FONTS.hud,
    });

    // 步数 + 星级
    const unit = this.deps.save.settings.moveMetric === 'cells' ? '格' : '步';
    drawText(
      ctx,
      `${row.bestMoves} ${unit}`,
      rect.x + rect.w - Math.round(rect.w * 0.045),
      rect.y + rect.h / 2,
      { font: FONTS.hud, color: COLORS.primary, align: 'right' },
    );
  }
}

/** 按像素宽度截断文本并补省略号（Canvas 无自动截断） */
function clip(
  ctx: CanvasRenderingContext2DLike,
  text: string,
  maxWidth: number,
): string {
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
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
