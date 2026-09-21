/**
 * 棋盘排版 —— 把逻辑坐标 (row, col)、(x, y) 与屏幕像素互相转换。
 *
 * 自适应要求（docs/06 §L5）：375×667 / 414×896 / 768×1024 下棋盘都必须居中、不变形、不裁切。
 * 做法：以「短边 - 两侧留白 - HUD 高度」为约束求出唯一格子边长，保证正方形格子。
 */

import { COLS, ROWS } from '@rush-hour/core';
import { DESIGN, METRICS } from './theme';
import { clamp } from './farm-theme';

export interface Layout {
  /** 逻辑尺寸（平台 screen()） */
  width: number;
  height: number;
  /** 单格边长（逻辑像素，正方形） */
  cell: number;
  /** 棋盘左上角 */
  boardX: number;
  boardY: number;
  boardSize: number;
  /** 顶部 HUD 总高（含胶囊安全区，见 safeTop） */
  hudHeight: number;
  /** 底部操作区（提示/重置/撤销）高度 */
  bottomBarH: number;
  /** 顶部为微信右上角胶囊预留的安全高度 —— 顶部信息一律画在它下面 */
  safeTop: number;
  /** 右侧为胶囊预留的安全宽度（H5 为 0） */
  safeRight: number;
  /** 缩放因子：设计分辨率 → 实际逻辑尺寸 */
  scale: number;
}

/** 宿主安全区（微信小游戏由胶囊按钮位置决定；H5 无胶囊） */
export interface SafeInsets {
  top?: number;
  right?: number;
}

/**
 * 三段式竖排：顶部信息栏 / 中部棋盘 / 底部操作区。
 *
 * 为什么把底部操作区从"棋盘正下方"改到"屏幕底部"：
 *   1. 对齐 design/design1.jpg 的高保真稿（三个大木按钮贴底）；
 *   2. 大拇指自然落点在屏幕下缘，贴着棋盘放会与拖拽抢区域。
 *
 * 出口通道（exitLane）从**两侧**等量扣除，因此棋盘仍然严格水平居中 ——
 * layout.test 与 e2e/smoke.spec 都断言了 `|左留白 - 右留白| <= 1`。
 */
export function computeLayout(width: number, height: number, insets: SafeInsets = {}): Layout {
  const short = Math.min(width, height);
  const safeTop = Math.round(clamp(insets.top ?? height * 0.065, 20, 50));
  const safeRight = Math.round(clamp(insets.right ?? 0, 0, width * 0.4));
  const hudRowH = Math.round(clamp(height * 0.075, 48, 60));
  const hudHeight = safeTop + hudRowH;
  const bottomBarH = Math.round(clamp(height * 0.12, 64, 96));

  const margin = Math.round(short * METRICS.boardMargin);
  const exitLane = Math.round(short * METRICS.exitLaneRatio);
  const availW = Math.max(60, width - margin * 2 - exitLane);
  const availH = Math.max(60, height - hudHeight - bottomBarH - margin * 2);

  // 取两方向可行边长的较小值 → 保证完全放进屏幕且格子为正方形
  const cell = Math.max(8, Math.floor(Math.min(availW / COLS, availH / ROWS)));
  const boardSize = cell * COLS;

  return {
    width,
    height,
    cell,
    boardX: Math.round((width - boardSize) / 2),
    boardY: Math.round(
      hudHeight + Math.max(0, (height - hudHeight - bottomBarH - boardSize) / 2),
    ),
    boardSize,
    hudHeight,
    bottomBarH,
    safeTop,
    safeRight,
    scale: Math.max(0.6, Math.min(width / DESIGN.width, 1.6)),
  };
}

/** 格子坐标 → 该格左上角像素 */
export function cellToPx(layout: Layout, r: number, c: number): { x: number; y: number } {
  return { x: layout.boardX + c * layout.cell, y: layout.boardY + r * layout.cell };
}

/** 像素 → 格子坐标（可为小数，用于拖拽换算） */
export function pxToCell(layout: Layout, x: number, y: number): { r: number; c: number } {
  return {
    r: (y - layout.boardY) / layout.cell,
    c: (x - layout.boardX) / layout.cell,
  };
}

/** 该像素点是否落在棋盘内 */
export function insideBoard(layout: Layout, x: number, y: number): boolean {
  return (
    x >= layout.boardX &&
    x <= layout.boardX + layout.boardSize &&
    y >= layout.boardY &&
    y <= layout.boardY + layout.boardSize
  );
}

/**
 * 可交互按钮的 id 全集。
 * 开放成一个联合类型而不是每处各写字符串，是为了让"绘制 → 命中 → 断言"
 * 三处共享同一份 id 契约（否则很容易出现画了却没人处理的事件）。
 */
export type ButtonId =
  | 'undo'
  | 'reset'
  | 'hint'
  | 'next'
  | 'replay'
  | 'share'
  | 'pause'
  | 'sound'
  | 'resume'
  | 'restart'
  | 'quit'
  // 以下三个是"纯展示位"（关卡木牌 / 步数木牌 / 金币），
  // 放进联合类型只为让 topBarGeometry 复用 ButtonRect 而不必再造一个矩形类型；
  // 它们不会被 hitButton 命中，因为 GameScreen 的交互按钮表不包含它们。
  | 'level'
  | 'moves'
  | 'coin';

/** 按钮 / 可点区域的矩形 */
export interface ButtonRect {
  id: ButtonId;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/**
 * 底部操作区三个大木按钮：撤销 / 重置 / 提示。
 *
 * 顺序保持 `undo → reset → hint` 不变：e2e（drag/touch）与 input.test 都按
 * "第 1 个是撤销、第 2 个是重置"来点击，改顺序会让一批用例静默点错按钮。
 */
export function hudButtons(layout: Layout): ButtonRect[] {
  const { boardX, boardSize, bottomBarH, height } = layout;
  const gap = Math.max(8, Math.round(boardSize * 0.03));
  const size = Math.max(
    24,
    Math.min(Math.round(bottomBarH * 0.84), Math.round(boardSize / 3.4)),
  );
  const total = size * 3 + gap * 2;
  const startX = boardX + Math.round((boardSize - total) / 2);
  const y = height - bottomBarH + Math.round((bottomBarH - size) / 2);
  const mk = (i: number, id: ButtonRect['id'], label: string): ButtonRect => ({
    id,
    x: startX + i * (size + gap),
    y,
    w: size,
    h: size,
    label,
  });
  return [mk(0, 'undo', '撤销'), mk(1, 'reset', '重置'), mk(2, 'hint', '提示')];
}

/** 顶部信息栏的几何 —— 左侧功能按钮、中部木牌、右侧货币位 */
export interface TopBarGeometry {
  /** 暂停（放左侧，避开微信右上角胶囊） */
  pause: ButtonRect;
  /** 音效开关（同样放左侧） */
  sound: ButtonRect;
  /** 关卡木牌（窄屏会压缩，文案由绘制层用 maxWidth 收窄） */
  levelPlate: ButtonRect;
  /** 步数 / 最佳 木牌 */
  movesPlate: ButtonRect;
  /** 货币（金币）位，预留给后续商业化 / 体力 */
  coinPill: ButtonRect;
  /** 信息栏所在行（木牌与圆形按钮的纵向基准） */
  rowY: number;
  rowH: number;
}

/**
 * 顶部信息栏几何。
 *
 * 关键约束：**所有元素都排在 `safeTop` 之下**。
 * 微信小游戏右上角有原生胶囊（分享/退出，约 87×32），任何画在安全区内的
 * 自绘按钮都会被它盖住且点不到 —— 因此功能按钮统一放左侧，且整行下移。
 */
export function topBarGeometry(layout: Layout): TopBarGeometry {
  const { boardX, boardSize, safeTop, hudHeight } = layout;
  const rowH = Math.max(24, hudHeight - safeTop);
  const cy = safeTop + rowH / 2;
  const gap = Math.max(6, Math.round(layout.width * 0.02));
  const btn = Math.round(clamp(rowH - 16, 30, 44));
  const by = Math.round(cy - btn / 2);

  const pause: ButtonRect = { id: 'pause', x: boardX, y: by, w: btn, h: btn, label: '暂停' };
  const sound: ButtonRect = {
    id: 'sound',
    x: boardX + btn + gap,
    y: by,
    w: btn,
    h: btn,
    label: '音效',
  };

  const coinW = Math.round(clamp(boardSize * 0.2, 46, 84));
  const coinH = Math.round(btn * 0.76);
  const coinPill: ButtonRect = {
    id: 'coin',
    x: boardX + boardSize - coinW,
    y: Math.round(cy - coinH / 2),
    w: coinW,
    h: coinH,
    label: '金币',
  };

  const midX = boardX + btn * 2 + gap * 2;
  const midR = coinPill.x - gap;
  const midW = Math.max(40, midR - midX);
  const plateW = Math.max(40, Math.floor((midW - gap) / 2));

  return {
    pause,
    sound,
    levelPlate: { id: 'level', x: midX, y: by, w: plateW, h: btn, label: '' },
    movesPlate: {
      id: 'moves',
      x: midX + plateW + gap,
      y: by,
      w: plateW,
      h: btn,
      label: '',
    },
    coinPill,
    rowY: by,
    rowH: btn,
  };
}

/**
 * 暂停面板几何。
 *
 * 与 dialogGeometry 同一套纪律：绘制（drawPauseDialog）、命中（onTap）
 * 共用本函数，杜绝"看得到却点不着"。
 */
export interface PauseGeometry {
  panelW: number;
  panelH: number;
  cx: number;
  cy: number;
  buttons: ButtonRect[];
}

export function pauseGeometry(layout: Layout): PauseGeometry {
  const panelW = Math.round(Math.min(layout.width * 0.76, 330));
  const panelH = Math.round(Math.min(layout.height * 0.44, 300));
  const cx = layout.width / 2;
  const cy = layout.height / 2;

  const titleH = Math.round(panelH * 0.26);
  const gap = Math.round(clamp(panelH * 0.05, 8, 18));
  const bh = Math.round(clamp(panelH * 0.17, 34, 50));
  const bw = Math.round(panelW * 0.7);
  const totalH = bh * 3 + gap * 2;
  const startY = Math.round(cy - panelH / 2 + titleH + (panelH - titleH - totalH) / 2);
  const bx = Math.round(cx - bw / 2);

  const ids: Array<[ButtonRect['id'], string]> = [
    ['resume', '继续游戏'],
    ['restart', '重新开始'],
    ['quit', '返回上一页'],
  ];
  const buttons = ids.map(([id, label], i) => ({
    id,
    label,
    x: bx,
    y: startY + i * (bh + gap),
    w: bw,
    h: bh,
  }));

  return { panelW, panelH, cx, cy, buttons };
}

/**
 * 结算弹窗的几何参数。
 * 这里集中定义，保证 **绘制**（canvas2d.drawResultDialog）、
 * **命中测试**（game-screen.onTap）与 **e2e 断言** 三处用的是同一套数值，
 * 不会因为某处改了 0.5 而出现"看得到却点不着"。
 */
export interface DialogGeometry {
  panelW: number;
  panelH: number;
  /** 面板中心 */
  cx: number;
  cy: number;
  /** 绘制期按钮（未含缩放），位于屏幕坐标系下 */
  buttons: ButtonRect[];
}

export function dialogGeometry(layout: Layout): DialogGeometry {
  const panelW = Math.round(layout.width * 0.84);
  const panelH = Math.round(Math.min(360, layout.height * 0.5));
  const cx = layout.width / 2;
  const cy = layout.height / 2 - layout.boardSize * 0.06;

  // 三个按钮并排：重玩 / 分享 / 下一关。
  // 面板宽度固定为屏宽 84%，窄屏（320px）下面板仅 269px，
  // 因此按钮宽度按面板宽而非棋盘宽计算，保证三按钮不溢出。
  const h = Math.round(Math.min(52, Math.max(38, layout.cell * 0.92)));
  const gap = Math.round(panelW * 0.025);
  const w = Math.floor((panelW - gap * 4) / 3);
  const by = cy + panelH / 2 - panelH * 0.16 - h / 2;

  const mk = (i: number, id: ButtonRect['id'], label: string): ButtonRect => ({
    id,
    x: Math.round(cx - panelW / 2 + gap * (i + 1) + w * i),
    y: Math.round(by),
    w,
    h,
    label,
  });

  return {
    panelW,
    panelH,
    cx,
    cy,
    buttons: [mk(0, 'replay', '重玩'), mk(1, 'share', '分享'), mk(2, 'next', '下一关')],
  };
}

/** 入场缩放因子（0→1 时 0.86→1.0） */
export function dialogScale(progress: number): number {
  return 0.86 + 0.14 * Math.min(1, Math.max(0, progress));
}

/**
 * 弹窗按钮的**屏幕**矩形（已应用入场缩放）。
 * 绘制围绕 (cx, cy) 等比缩放，故命中/断言必须做同样的变换。
 */
export function dialogButtonsOnScreen(layout: Layout, progress = 1): ButtonRect[] {
  const g = dialogGeometry(layout);
  const s = dialogScale(progress);
  return g.buttons.map((b) => ({
    id: b.id,
    label: b.label,
    x: (b.x - g.cx) * s + g.cx,
    y: (b.y - g.cy) * s + g.cy,
    w: b.w * s,
    h: b.h * s,
  }));
}

/** 兼容旧调用点：返回未缩放的绘制期按钮（仅供绘制层使用） */
export function dialogButtons(layout: Layout): ButtonRect[] {
  return dialogGeometry(layout).buttons;
}

export function hitButton(btns: ButtonRect[], x: number, y: number): ButtonRect | null {
  for (const b of btns) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

/**
 * 通用矩形命中测试（P4 新增界面的按钮 id 是开放字符串，不能用 ButtonRect 的联合类型）。
 * 与 hitButton 同样遵循"绘制与命中共用同一份矩形的顺序"，先命中的在上层。
 */
export function hitRect<T extends { x: number; y: number; w: number; h: number }>(
  rects: readonly T[],
  x: number,
  y: number,
): T | null {
  // 逆序遍历：绘制顺序里后画的在上层，命中判定应优先取上层
  for (let i = rects.length - 1; i >= 0; i--) {
    const b = rects[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

// ---------------------------------------------------------------- 通用页面几何
//
// P4 新增的界面（主菜单/选关/设置/排行榜/隐私政策/每日挑战）共用下面这组几何函数。
// 与 dialogGeometry 同样的纪律：绘制、命中、e2e 断言三处必须用同一份数据。

/** 通用按钮矩形（ui.ts 的 UiButton 在几何上与此兼容；此处不引入 render 内部依赖循环） */
export interface RectGeom {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  secondary?: boolean;
  disabled?: boolean;
}

/** 页面内容区（去掉左右留白与顶部标题栏） */
export interface ContentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function contentBox(layout: Layout): ContentBox {
  const pad = Math.round(layout.width * 0.05);
  const top = Math.round(layout.height * 0.17);
  return {
    x: pad,
    y: top,
    w: layout.width - pad * 2,
    h: layout.height - top - Math.round(layout.height * 0.08),
  };
}

/**
 * 主菜单布局：标题 + 纵向按钮列表 + 底部版本/合规入口。
 *
 * 按钮数量可变（继续上局按是否有存档决定是否出现），
 * 因此按实际传入的条数均分内容区高度，而不是写死坐标。
 */
export function menuLayout(layout: Layout, count: number): {
  titleY: number;
  buttons: RectGeom[];
  footer: RectGeom;
} {
  const box = contentBox(layout);
  const gap = Math.max(10, Math.round(box.h * 0.035));
  const footerH = Math.max(36, Math.round(box.h * 0.1));
  // 底部留出一个 footer 的高度再均分
  const availH = box.h - footerH - gap;
  const h = Math.max(38, Math.min(58, Math.floor((availH - gap * (count - 1)) / count)));
  const totalH = h * count + gap * (count - 1);
  const startY = box.y + Math.round((availH - totalH) / 2);
  const w = Math.min(box.w, Math.round(layout.width * 0.78));

  const buttons: RectGeom[] = [];
  for (let i = 0; i < count; i++) {
    buttons.push({
      id: `menu-${i}`,
      x: Math.round((layout.width - w) / 2),
      y: startY + i * (h + gap),
      w,
      h,
      label: '',
    });
  }
  return {
    titleY: box.y - Math.round(layout.height * 0.045),
    buttons,
    footer: {
      id: 'privacy',
      x: Math.round((layout.width - w) / 2),
      y: box.y + box.h - footerH,
      w,
      h: footerH,
      label: '隐私政策',
      secondary: true,
    },
  };
}

/**
 * 选关页网格布局。
 *
 * 分页：每页 rows×cols 个格子，格子为正方形（含星级位置），
 * 底部一行放上一页/下一页与页码。
 */
export interface SelectGrid {
  cells: RectGeom[];
  prev: RectGeom;
  next: RectGeom;
  page: number;
  pageCount: number;
}

export function selectLayout(layout: Layout, levelCount: number, page: number): SelectGrid {
  const box = contentBox(layout);
  const navH = Math.max(40, Math.round(box.h * 0.13));
  const gridH = box.h - navH - Math.round(box.h * 0.04);
  const gridY = box.y;

  // 竖屏优先 4 列；宽屏（>=600）用 6 列，避免格子过大到失真
  const cols = layout.width >= 600 ? 6 : 4;
  const rows = Math.max(1, Math.floor(gridH / (box.w / cols)));

  const perPage = cols * rows;
  const pageCount = Math.max(1, Math.ceil(levelCount / perPage));
  const p = Math.min(Math.max(0, page), pageCount - 1);

  const gap = Math.max(8, Math.round(box.w * 0.028));
  const cell = Math.floor((box.w - gap * (cols - 1)) / cols);
  const gridW = cell * cols + gap * (cols - 1);
  const startX = Math.round((layout.width - gridW) / 2);

  const cells: RectGeom[] = [];
  const from = p * perPage;
  const to = Math.min(levelCount, from + perPage);
  for (let i = from; i < to; i++) {
    const k = i - from;
    const r = Math.floor(k / cols);
    const c = k % cols;
    cells.push({
      id: `level-${i}`,
      x: startX + c * (cell + gap),
      y: gridY + r * (cell + gap),
      w: cell,
      h: cell,
      label: '',
    });
  }

  const navY = box.y + box.h - navH;
  const bw = Math.max(80, Math.round(box.w * 0.3));
  return {
    cells,
    prev: { id: 'prev', x: box.x, y: navY, w: bw, h: navH, label: '上一页', secondary: true },
    next: {
      id: 'next',
      x: box.x + box.w - bw,
      y: navY,
      w: bw,
      h: navH,
      label: '下一页',
      secondary: true,
    },
    page: p,
    pageCount,
  };
}

/**
 * 设置页的开关行布局：每行左侧标签、右侧开关胶囊。
 * 「清除存档」这类危险操作用 danger 标记（二次确认由屏幕层负责）。
 */
export interface SettingRowGeom {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** 开关类行：右侧胶囊矩形 */
  toggle?: { x: number; y: number; w: number; h: number };
  /** 危险操作（红色文字 + 二次确认） */
  danger?: boolean;
}

export function settingsLayout(layout: Layout, count: number): SettingRowGeom[] {
  const box = contentBox(layout);
  const gap = Math.max(8, Math.round(box.h * 0.025));
  const h = Math.max(44, Math.min(64, Math.floor((box.h - gap * (count - 1)) / count)));
  const toggleW = Math.max(48, Math.round(box.w * 0.16));
  const toggleH = Math.round(h * 0.46);

  const rows: SettingRowGeom[] = [];
  for (let i = 0; i < count; i++) {
    const y = box.y + i * (h + gap);
    rows.push({
      id: `row-${i}`,
      x: box.x,
      y,
      w: box.w,
      h,
      label: '',
      toggle: {
        x: box.x + box.w - toggleW - Math.round(h * 0.3),
        y: y + Math.round((h - toggleH) / 2),
        w: toggleW,
        h: toggleH,
      },
    });
  }
  return rows;
}

/**
 * 列表型页面（排行榜 / 隐私政策）的行布局。
 * 排行榜需要固定的表头高度 + 可滚动区域。
 */
export function listLayout(
  layout: Layout,
  count: number,
  opts: { headerH?: number } = {},
): { rows: RectGeom[]; headerH: number; rowH: number; top: number } {
  const box = contentBox(layout);
  const headerH = opts.headerH ?? Math.max(34, Math.round(box.h * 0.09));
  const top = box.y + headerH;
  const availH = box.h - headerH;
  const rowH = count > 0 ? Math.max(38, Math.min(60, Math.floor(availH / count))) : 48;
  const rows: RectGeom[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `row-${i}`,
      x: box.x,
      y: top + i * rowH,
      w: box.w,
      h: rowH,
      label: '',
    });
  }
  return { rows, headerH, rowH, top };
}

/** 排行榜的 Tab（全球 / 好友）布局 */
export function tabsLayout(layout: Layout, count: number): RectGeom[] {
  const box = contentBox(layout);
  const h = Math.max(38, Math.round(box.h * 0.1));
  const w = Math.floor(box.w / count);
  const out: RectGeom[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `tab-${i}`,
      x: box.x + i * w,
      y: box.y,
      w,
      h,
      label: '',
    });
  }
  return out;
}
