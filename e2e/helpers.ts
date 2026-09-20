import type { Page } from '@playwright/test';

/**
 * e2e 通过 window.__RUSH_HOUR__ 驱动游戏，而不是靠猜像素坐标。
 *
 * 为什么这么做：像素级拖拽在 3 种视口下极易脆弱，且失败时难以定位是
 * "布局错了"还是"输入错了"。这里用确定性 API 断言**玩法与状态机**，
 * 另用真实拖拽用例（drag.spec.ts）覆盖输入层本身。
 *
 * ⚠️ 重要：关卡几何必须**从关卡数据推导**，不能凭直觉假设红车在第 0 列。
 *   实测 t01 的红车在 (2,3)，向右只能滑 1 格 —— 早期用 `c === 0` 假定的
 *   用例全部误报失败。所有断言一律基于 snapshot 里的真实坐标。
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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

export interface GameDebugApi {
  screen: {
    levelId: string;
    steps: number;
    cellSteps: number;
    solved: boolean;
    hasDialog: boolean;
    canUndo: boolean;
    hasTutorial: boolean;
    enteredFrom: string;
    isSelfDriven: boolean;
    moveList: Array<{ piece: string; dir: string; cells: number }>;
    piecePositions: Array<{ id: string; r: number; c: number; dir: string; len: number }>;
    currentLayout: {
      width: number;
      height: number;
      cell: number;
      boardX: number;
      boardY: number;
      boardSize: number;
      hudHeight: number;
    };
    /** 用于 e2e 的确定性走子（等价于一次拖拽松手） */
    applyMove(m: { piece: string; dir: string; cells: number }): boolean;
    pressButton(id: 'undo' | 'reset' | 'hint'): void;
    redMaxSlide(dir: string): number;
    maxSlide(pieceId: string, dir: string): number;
    /** 求解器给出的最优下一步（离线已与 Python 交叉校验） */
    bestNextMove(): { piece: string; dir: 'up' | 'down' | 'left' | 'right'; cells: number } | null;
    /** 当前局面的剩余最少步数 */
    remainingMoves(): number | null;
    /** 用求解器的最优解一次走完并触发结算（用于弹窗交互测试） */
    forceSolveReport(): void;
    loadLevel(level: { id: string }): void;
    /** HUD / 弹窗按钮的真实屏幕矩形，供像素点击 */
    hudButtonRects(): Array<Rect & { id: string; label: string }>;
    dialogButtonRects(): Array<Rect & { id: string; label: string }>;
    /** 引导遮罩高亮洞的屏幕矩形 */
    tutorialHoleRect(): Rect | null;
    /** 设置页"重看引导" */
    restartTutorial(): void;
  };
  /** P4 新增：屏幕导航接口 */
  nav: {
    go(id: ScreenId, params?: unknown): void;
    back(): boolean;
    reset(id: ScreenId): void;
    current(): ScreenId | null;
    stackDepth(): number;
    openLevel(id: string, from?: 'menu' | 'select' | 'daily'): boolean;
  };
  /** P4 新增：选关屏调试接口 */
  select: {
    cellStates: Array<{
      level: { id: string; name: string };
      index: number;
      unlocked: boolean;
      stars: number;
      rect: Rect;
    }>;
    currentPage: number;
    totalPages: number;
    navRects: { prev: Rect | null; next: Rect | null; back: Rect | null };
    openLevel(id: string): boolean;
    setPage(p: number): void;
  };
  /** P4 新增：主菜单调试接口 */
  menu: {
    menuItems: Array<{ action: string; label: string; secondary?: boolean }>;
    buttonRects: Array<Rect & { id: string; label: string }>;
    trigger(action: string): void;
  };
  /** P4 新增：设置屏调试接口 */
  settings: {
    settingItems: Array<{ id: string; label: string; kind: 'toggle' | 'action'; danger?: boolean; disabled?: boolean }>;
    confirmingId: string | null;
    rowRects: Array<Rect & { id: string }>;
    backRect: Rect | null;
    trigger(id: string): void;
  };
  /** P4 新增：排行榜屏调试接口 */
  leaderboard: {
    currentScope: 'global' | 'friends';
    showingRows: Array<{ levelId: string; levelName: string; index: number; bestMoves: number; stars: number }>;
    tabRects: Array<Rect & { id: string; label: string }>;
    setScope(scope: 'global' | 'friends'): void;
  };
  /** P4 新增：隐私政策屏调试接口 */
  privacy: {
    currentPage: number;
    pageCount: number;
    currentSection: { title: string; body: string[] };
    navRects: { prev: (Rect & { id: string }) | null; next: (Rect & { id: string }) | null; back: (Rect & { id: string }) | null };
    setPage(p: number): void;
  };
  /** P4 新增：埋点接口 */
  analytics: {
    peek(): Array<{ name: string; props: Record<string, unknown>; at: number }>;
    drain(): Array<{ name: string; props: Record<string, unknown>; at: number }>;
    countOf(name: string): number;
    clear(): void;
  };
  repo: {
    levels: Array<{ id: string; name: string; par: { moves: number; cellSteps: number } }>;
    next(id: string): { id: string } | null;
  };
  save: {
    levels: Record<string, { stars: number; bestMoves: number; bestCells: number }>;
    settings: { sfx: boolean; music: boolean; vibrate: boolean; moveMetric: 'moves' | 'cells' };
    tutorialDone: boolean;
    current?: { levelId: string; moves: unknown[] };
  };
  wipeSave(): void;
}

declare global {
  interface Window {
    __RUSH_HOUR__: GameDebugApi;
  }
}

export interface OpenGameOptions {
  /**
   * 是否保留新手引导（默认 false）。
   *
   * ⚠️ 默认**跳过引导**，原因：引导遮罩会吞掉所有指针事件（这是它的正确行为），
   * 于是任何"进游戏直接拖拽/点按钮"的用例都会被它挡住。
   * 把"跳过引导"做成默认值，可以让所有玩法类用例保持简洁；
   * 只有专门验证引导的 tutorial.spec.ts 才传 `{ keepTutorial: true }`。
   */
  keepTutorial?: boolean;
  /**
   * 是否直接落在对局页（默认 true）。
   *
   * ⚠️ 这一点至关重要：P4 起指针事件由 ScreenManager **只分发给当前屏幕**。
   * 若停留在主菜单，游戏屏收不到任何拖拽 —— 不是输入层坏了，而是它根本没在前台。
   * 玩法类用例默认进对局页；只验证导航/菜单的用例传 `{ enterGame: false }`。
   *
   * 传入关卡 id 则直接进入该关（否则续玩存档或第一关）。
   */
  enterGame?: boolean | string;
}

/** 打开首页并等待应用就绪（同时收集 console error 供断言） */
export async function openGame(page: Page, options: OpenGameOptions = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__RUSH_HOUR__), null, { timeout: 5000 });
  // 启动页会自动跳主菜单；等它跳完，否则后续断言会撞上 boot 屏
  await page.waitForFunction(
    () => window.__RUSH_HOUR__.nav.current() === 'menu',
    null,
    { timeout: 5000 },
  );
  // 引导状态先于进关设置：enter() 会在装载关卡后立刻检查它
  if (!options.keepTutorial) {
    await page.evaluate(() => {
      window.__RUSH_HOUR__.save.tutorialDone = true;
    });
  }

  const enter = options.enterGame ?? true;
  if (enter !== false) {
    await page.evaluate((levelId) => {
      const api = window.__RUSH_HOUR__;
      const id = typeof levelId === 'string' ? levelId : api.repo.levels[0].id;
      api.nav.openLevel(id, 'select');
    }, enter);
    await page.waitForFunction(() => window.__RUSH_HOUR__.nav.current() === 'game', null, {
      timeout: 5000,
    });
  }
  return errors;
}

/**
 * 导航到指定屏幕（跳过启动页等待，用于已就绪的页面）。
 *
 * 走 `go`（= ScreenManager.push，压栈）：
 *   这样调用后 `nav.back()` 能退回上一屏 —— 与"玩家真实点击菜单"的路径一致。
 *   用 `reset` 会导致栈被清空，back 无路可退，测不到真实的返回链路。
 */
export async function goto(page: Page, id: ScreenId, params?: unknown): Promise<void> {
  await page.evaluate(
    ([s, p]) => window.__RUSH_HOUR__.nav.go(s as never, p),
    [id, params] as const,
  );
  await page.waitForFunction(
    (want) => window.__RUSH_HOUR__.nav.current() === want,
    id,
    { timeout: 3000 },
  );
}

/** 回到主菜单并清空导航栈（用于隔离用例之间的导航历史） */
export async function goHome(page: Page): Promise<void> {
  await page.evaluate(() => window.__RUSH_HOUR__.nav.reset('menu'));
  await page.waitForFunction(() => window.__RUSH_HOUR__.nav.current() === 'menu', null, {
    timeout: 3000,
  });
}

/** 当前屏幕 id */
export async function currentScreen(page: Page): Promise<ScreenId | null> {
  return page.evaluate(() => window.__RUSH_HOUR__.nav.current());
}

export type Snapshot = Awaited<ReturnType<typeof snapshot>>;

/** 读出当前对局快照 */
export async function snapshot(page: Page) {
  return page.evaluate(() => {
    const s = window.__RUSH_HOUR__.screen;
    return {
      levelId: s.levelId,
      steps: s.steps,
      cellSteps: s.cellSteps,
      solved: s.solved,
      hasDialog: s.hasDialog,
      canUndo: s.canUndo,
      layout: s.currentLayout,
      pieces: s.piecePositions,
      moves: s.moveList,
    };
  });
}

/** 走一步（等价于一次拖拽松手），返回是否成功 */
export async function move(
  page: Page,
  piece: string,
  dir: 'up' | 'down' | 'left' | 'right',
  cells: number,
): Promise<boolean> {
  return page.evaluate(
    ([p, d, c]) => window.__RUSH_HOUR__.screen.applyMove({ piece: p, dir: d, cells: c }),
    [piece, dir, cells] as const,
  );
}

export async function press(page: Page, id: 'undo' | 'reset' | 'hint'): Promise<void> {
  await page.evaluate((b) => window.__RUSH_HOUR__.screen.pressButton(b), id);
}

/** 查询任意车辆在指定方向上的最大可滑格数 */
export async function maxSlide(
  page: Page,
  pieceId: string,
  dir: 'up' | 'down' | 'left' | 'right',
): Promise<number> {
  return page.evaluate(
    ([id, d]) => window.__RUSH_HOUR__.screen.maxSlide(id, d),
    [pieceId, dir] as const,
  );
}

/** 红车当前所在位置 */
export function redPiece(snap: Snapshot): { id: string; r: number; c: number; dir: string; len: number } {
  const red = snap.pieces.find((p) => p.id === 'R');
  if (!red) throw new Error('快照中找不到红车');
  return red;
}

/** 棋盘上被占用的格子集合（用于找空格） */
export function occupiedCells(snap: Snapshot): Set<string> {
  const out = new Set<string>();
  for (const p of snap.pieces) {
    if (p.dir === 'H') {
      for (let k = 0; k < p.len; k++) out.add(`${p.r},${p.c + k}`);
    } else {
      for (let k = 0; k < p.len; k++) out.add(`${p.r + k},${p.c}`);
    }
  }
  return out;
}

/** 找一个空格（找不到返回 null，表示棋盘已满） */
export function findEmptyCell(snap: Snapshot): { r: number; c: number } | null {
  const occ = occupiedCells(snap);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      if (!occ.has(`${r},${c}`)) return { r, c };
    }
  }
  return null;
}

/**
 * 换到一关「红车右侧有足够空间」的关卡，用于覆盖多格滑动 / 越距吸附。
 *
 * 注意：loadLevel 本身就是全新局面（moves 为空），无需再 reset；
 * 多调一次 reset 会额外触发一次防抖存档，反而干扰断点续玩类用例。
 * 返回该关红车的初始列与向右可滑格数；找不到合适关卡时返回 null。
 */
export async function gotoLevelWithRedSpace(
  page: Page,
  minSpace: number,
): Promise<{ levelId: string; redC: number; maxRight: number } | null> {
  return page.evaluate((need) => {
    const api = window.__RUSH_HOUR__;
    for (const lvl of api.repo.levels) {
      api.screen.loadLevel(lvl);
      const red = api.screen.piecePositions.find((p) => p.id === 'R')!;
      const maxRight = api.screen.maxSlide('R', 'right');
      // 必须已归零步数（loadLevel 的语义），否则后续断言会基于错误基线
      if (red.r === 2 && maxRight >= need && api.screen.steps === 0) {
        return { levelId: lvl.id, redC: red.c, maxRight };
      }
    }
    return null;
  }, minSpace);
}

/** 重载页面并清空存档，保证用例之间互不影响 */
export async function resetStorage(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
}

/**
 * 用求解器的最优解把当前关卡走完（真实触发 solve 事件与结算流程）。
 * 返回实际使用的步数。
 *
 * 之所以不靠"暴力试所有走子"：那会把状态机推进到 solved 之后再继续试，
 * 结果既慢又难定位。求解器已被 L2 跨语言校验过，用它驱动最稳。
 */
export async function solveCurrentLevel(page: Page): Promise<number> {
  return page.evaluate(() => {
    const api = window.__RUSH_HOUR__;
    let n = 0;
    for (let guard = 0; guard < 60; guard++) {
      if (api.screen.solved) break;
      const m = api.screen.bestNextMove();
      if (!m) break;
      if (!api.screen.applyMove(m)) break;
      n++;
    }
    return n;
  });
}

/** 打开指定关卡并解掉它（不依赖顺序推进） */
export async function openAndSolve(page: Page, levelId: string): Promise<void> {
  await page.evaluate((id) => {
    const api = window.__RUSH_HOUR__;
    api.nav.openLevel(id, 'menu');
  }, levelId);
  await solveCurrentLevel(page);
}

/** 埋点：某事件出现次数 */
export async function analyticsCount(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => window.__RUSH_HOUR__.analytics.countOf(n), name);
}

/** 埋点：取出全部事件名（便于断言顺序） */
export async function analyticsNames(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__RUSH_HOUR__.analytics.peek().map((e) => e.name));
}

/** 清空埋点缓冲，让后续断言只看到本用例产生的事件 */
export async function clearAnalytics(page: Page): Promise<void> {
  await page.evaluate(() => window.__RUSH_HOUR__.analytics.clear());
}

/** 设置页 / 通知类：等待若干毫秒 */
export async function wait(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}
