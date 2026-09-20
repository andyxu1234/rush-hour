/**
 * 游戏页 —— 把 core 的状态机、render 的绘制/交互、platform 的能力缝合成一个可运行屏。
 *
 * 职责边界：
 *   - 本文件**不**实现规则（一律问 Game/Board）；
 *   - 本文件**不**触碰平台 API（一律通过 Platform 接口）；
 *   - 本文件负责"什么时候算一步""什么时候播动画""什么时候存档"。
 *
 * 存档纪律（docs/02 §5）：只在关键节点写 —— 通关、撤销后 500ms 防抖、切后台。
 */

import {
  Game,
  H,
  RED_ID,
  Solver,
  type Analytics,
  type Level,
  type LevelRepository,
  type Move,
  type MoveDir,
  type SaveV1,
} from '@rush-hour/core';
import type { Platform, PointerEventLike } from '@rush-hour/platform';
import { Animator } from '../anim';
import {
  drawBackground,
  drawBoard,
  drawCar,
  drawExit,
  drawFlash,
  drawGhost,
  drawHintArrows,
  drawHud,
  drawResultDialog,
  drawToast,
  pickColors,
  type CarWithOffset,
} from '../canvas2d';
import type { ColorInfo } from '../theme';
import {
  computeLayout,
  dialogButtonsOnScreen,
  hudButtons,
  hitButton,
  insideBoard,
  pxToCell,
  type Layout,
} from '../layout';
import { InputController, type InputIntent } from '../input';
import { METRICS } from '../theme';
import { recordClear } from '@rush-hour/core';
import { TutorialOverlay } from './tutorial-overlay';
import type { Screen, ScreenId, GameParams } from './screen';

export interface GameScreenDeps {
  platform: Platform;
  repo: LevelRepository;
  save: SaveV1;
  /** 存档持久化回调（由宿主决定写哪儿） */
  persist(): void;
  /** 埋点收集器（可选：未传时不记录，便于单测与最小装配） */
  analytics?: Analytics;
  /** 导航回调：屏幕自身不持有 ScreenManager，避免循环依赖 */
  navigate?: (id: ScreenId, params?: unknown) => void;
  /** 返回上一层（结算弹窗"返回"与 HUD 返回按钮用） */
  goBack?: () => void;
}

export interface GameScreenHooks {
  /** 通关后进度变化（宿主可刷新选关/统计） */
  onProgressChanged(): void;
  /** 分享（由宿主接 platform.share；屏幕层不直接调平台分享文案） */
  onShare?: (info: { levelName: string; steps: number; stars: number }) => void;
}

/** 延迟动作：由渲染循环驱动，避免依赖平台 setTimeout 语义差异 */
interface Delayed {
  remaining: number;
  run(): void;
}

export class GameScreen implements Screen {
  readonly id: ScreenId = 'game';
  private layout: Layout;
  private canvas: any;
  private ctx: any;
  private game: Game;
  private solver: Solver | null = null;
  private readonly anim = new Animator();
  private input: InputController;
  private colors = new Map<string, ColorInfo>();
  private readonly grid = new Int16Array(36);

  private lastTime = 0;
  private rafHandle: number | null = null;
  /**
   * 自驱动循环的兼容入口（start/stop）。
   * 由 ScreenManager 驱动时不应调用 start()，否则会出现两个 rAF 同时绘制。
   */
  private selfDriven = false;
  private unsubs: Array<() => void> = [];
  private delayed: Delayed[] = [];

  /** 新手引导遮罩（前 3 关的情境化引导，见 docs/01 §9） */
  private tutorial: TutorialOverlay | null = null;
  /** 从哪个屏进入的（决定返回目标） */
  private from: GameParams['from'] = 'menu';

  private dragging: { pieceId: string; deltaCells: number; dir: MoveDir } | null = null;
  private ghosts: Array<{ pieceId: string; dir: MoveDir; cells: number }> = [];
  private toast: { text: string; until: number } | null = null;
  private saveTimer = 0;

  private dialog: { stars: number; steps: number; cellSteps: number; isNewBest: boolean } | null =
    null;
  private exitAnimating = false;
  private solveHandled = false;
  private hintUsedInLevel = 0;

  constructor(
    private readonly deps: GameScreenDeps,
    private readonly hooks: GameScreenHooks,
  ) {
    this.canvas = deps.platform.createCanvas(1, 1);
    this.ctx = this.canvas.getContext('2d');
    this.layout = computeLayout(deps.platform.screen().width, deps.platform.screen().height);

    this.game = this.buildGame(deps.repo.first);
    this.colors = pickColors(this.game.board.pieces);
    this.input = this.createInput();
    this.resize();

    this.unsubs.push(deps.platform.onHide(() => this.flushSave()));

    this.buildSolver();
  }

  // ---------------------------------------------------------------- Screen 生命周期

  /**
   * 进入游戏屏。params.levelId 指定关卡；不指定则续玩存档里的当前关（若有）。
   *
   * 之所以把"断点续玩"放在这里而不是宿主入口：从任何屏进入游戏页都应能续玩，
   * 逻辑集中一处才不会出现"H5 续玩、小游戏不续玩"这种双端漂移。
   */
  enter(params?: unknown): void {
    const p = (params ?? {}) as GameParams;
    this.from = p.from ?? 'menu';
    this.lastTime = 0;

    if (p.forceTutorial) this.deps.save.tutorialDone = false;

    const cur = this.deps.save.current;
    const targetId = p.levelId ?? (cur && this.deps.repo.get(cur.levelId) ? cur.levelId : undefined);
    const level = (targetId && this.deps.repo.get(targetId)) || this.deps.repo.first;
    this.loadLevel(level);

    // 续玩：仅当目标关与存档当前关一致时才重放，避免"跳到别的关却带着上一关的走子"
    if (cur && cur.levelId === level.id && cur.moves.length > 0) {
      for (const m of cur.moves) this.applyMove(m);
    }

    this.deps.analytics?.track('level_start', {
      levelId: level.id,
      difficulty: level.difficulty,
      par: level.par.moves,
    });
    this.maybeStartTutorial();
  }

  exit(): void {
    this.stop();
    this.flushSave();
    this.tutorial = null;
  }

  /** 由 ScreenManager 每帧调用 */
  update(dt: number, now: number): void {
    this.lastTime = now;
    this.tutorial?.update(now);
    this.anim.advance(dt);
    this.input.tick(now);
    if (this.toast && now > this.toast.until) this.toast = null;

    if (this.saveTimer > 0) {
      this.saveTimer -= dt;
      if (this.saveTimer <= 0) this.flushSave();
    }

    if (this.delayed.length > 0) {
      const still: Delayed[] = [];
      for (const d of this.delayed) {
        d.remaining -= dt;
        if (d.remaining <= 0) d.run();
        else still.push(d);
      }
      this.delayed = still;
    }
  }

  onPointer(e: PointerEventLike): void {
    // 引导遮罩优先吞掉指针：引导期间不应该能操作棋盘
    if (this.tutorial && this.tutorial.handle(e)) return;
    this.input.handle(e);
  }

  onResize(): void {
    this.resize();
  }

  // ---------------------------------------------------------------- 组装

  /**
   * 输入宿主必须是"活引用"：layout / board / state 会随 resize、关卡切换、走子而变化，
   * 用普通对象快照会在切关后指向旧棋盘（已踩过，务必保留 getter 形式）。
   */
  private createInput(): InputController {
    const self = this;
    const host = {
      get layout(): Layout {
        return self.layout;
      },
      get board() {
        return self.game.board;
      },
      get state() {
        return self.game.state;
      },
      pieceAt: (x: number, y: number) => self.pieceAt(x, y),
      buttons: () => hudButtons(self.layout),
      dialogOpen: () => self.dialog !== null,
    };
    return new InputController(host as any, {
      onLongPress: (id) => this.showMovableDirs(id),
      onIntent: (intent) => this.onIntent(intent),
    });
  }

  /**
   * 装配 Game 并订阅其事件。
   *
   * ★ 埋点必须挂在**这里**，而不是各个交互回调里。
   *   `Game` 是唯一的事实来源（docs/02 §5），它的 move/blocked/undo/redo/solve/reset
   *   事件覆盖了所有会改变对局状态的路径 —— 无论走的是真实拖拽、HUD 按钮，
   *   还是 e2e 的 `applyMove()` 调试入口。
   *   早期把埋点写在 onRelease/onButton 里，导致"通过 applyMove 走的子不计入 move 事件"，
   *   既会让埋点漏数，也会让 e2e 断言与实际行为不一致（已踩过）。
   */
  private buildGame(level: Level): Game {
    const g = new Game(level);
    g.on((e) => {
      switch (e.type) {
        case 'solve':
          this.onSolved();
          break;
        case 'blocked':
          this.onBlocked(e.move);
          break;
        case 'move':
          // 动画与音效属于"交互反馈"，只在真实拖拽路径里播（见 onRelease）；
          // 事件这里只负责埋点，保证任何路径走的子都被统计。
          this.deps.analytics?.track('move', {
            levelId: level.id,
            piece: e.move.piece,
            dir: e.move.dir,
            cells: e.move.cells,
            steps: e.steps,
          });
          break;
        case 'undo':
          this.deps.analytics?.track('undo', { levelId: level.id, steps: e.steps });
          // 从"已通关"撤销回来：Game 会清掉 solved，这里必须同步关掉结算弹窗
          // 与 solveHandled 标记，否则弹窗盖着棋盘、且再通关时不再弹出（已踩过）。
          this.onUnsolved();
          break;
        case 'redo':
          this.deps.analytics?.track('redo', { levelId: level.id, steps: e.steps });
          break;
        case 'reset':
          this.deps.analytics?.track('reset', { levelId: level.id });
          break;
      }
    });
    return g;
  }

  /**
   * 求解器按需构建。构建失败（关卡过大 / 不可解）只降级为"无提示"，不阻塞试玩。
   * 定理 1 保证状态图无向 → 从任意中间局面都能得到最优下一步。
   */
  private buildSolver(): void {
    try {
      const { solver } = Solver.solve(this.game.level.pieces);
      this.solver = solver.solvable ? solver : null;
    } catch {
      this.solver = null;
    }
  }

  // ---------------------------------------------------------------- 生命周期

  resize(): void {
    const dpr = this.deps.platform.devicePixelRatio();
    const size = this.deps.platform.screen();
    this.layout = computeLayout(size.width, size.height);
    const el = this.canvas;
    // canvas 的 backing store 用物理像素，绘制用逻辑像素（ctx.setTransform(dpr, ...)）
    el.width = Math.round(size.width * dpr);
    el.height = Math.round(size.height * dpr);
    // CSS 尺寸必须等于逻辑尺寸：输入层的坐标换算依赖这个 1:1 关系，
    // 一旦不一致就会出现"点不中车/拖拽无效"这类难查的问题。
    if (el.style) {
      el.style.width = `${size.width}px`;
      el.style.height = `${size.height}px`;
      el.style.position = 'fixed';
      el.style.left = '0';
      el.style.top = '0';
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * 自驱动循环（**兼容入口**）。
   *
   * 仅供"单屏模式"（不接 ScreenManager 的宿主，如部分单测）使用。
   * 一旦 ScreenManager.start() 在跑，就绝不能调用本方法 —— 两个 rAF
   * 会同时对同一张 canvas 绘制，表现为闪烁与输入错乱。
   */
  start(): void {
    if (this.rafHandle !== null) return;
    this.selfDriven = true;
    const loop = (t: number) => {
      const dt = this.lastTime === 0 ? 16 : Math.max(0, Math.min(64, t - this.lastTime));
      this.lastTime = t;
      this.update(dt, t);
      this.render();
      this.rafHandle = this.deps.platform.requestAnimationFrame(loop);
    };
    this.rafHandle = this.deps.platform.requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafHandle !== null) this.deps.platform.cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    this.selfDriven = false;
  }

  /** 是否处于自驱动模式（e2e 断言"没有双重循环"用） */
  get isSelfDriven(): boolean {
    return this.selfDriven;
  }

  dispose(): void {
    this.stop();
    this.flushSave();
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }

  // ---------------------------------------------------------------- 交互

  private onIntent(intent: InputIntent): void {
    switch (intent.type) {
      case 'button':
        this.onButton(intent.id);
        break;
      case 'grab':
        break;
      case 'drag':
        this.dragging = { pieceId: intent.pieceId, deltaCells: intent.deltaCells, dir: intent.dir };
        this.updateGhosts();
        break;
      case 'release':
        this.dragging = null;
        this.ghosts = [];
        this.onRelease(intent.pieceId, intent.dir, intent.cells);
        break;
      case 'cancel':
        this.dragging = null;
        this.ghosts = [];
        break;
      case 'tap':
        this.onTap(intent.x, intent.y);
        break;
    }
  }

  private onTap(x: number, y: number): void {
    if (this.dialog) {
      // 命中测试用「动画结束后的最终矩形」：入场缩放期间画面略微缩小，
      // 但玩家点击的目标位置就是稳定态的位置；用最终矩形判定更宽容、也更符合直觉。
      const hit = hitButton(dialogButtonsOnScreen(this.layout, 1), x, y);
      if (!hit) return; // 点弹窗空白处：吞掉点击，避免误触棋盘
      if (hit.id === 'share') {
        this.deps.analytics?.track('share_click', { levelId: this.game.level.id });
        this.hooks.onShare?.({
          levelName: this.game.level.name,
          steps: this.dialog.steps,
          stars: this.dialog.stars,
        });
        return;
      }
      if (hit.id === 'next') this.goNext();
      else this.restartLevel();
      return;
    }
    if (!insideBoard(this.layout, x, y)) return;
    const hit = this.pieceAt(x, y);
    if (hit) this.deps.platform.audio.play('click');
  }

  /**
   * 松手结算 —— "一次滑动 = 1 步"的红线在此落地：
   * cells 恒为一个数值，Game.move() 只调用一次，绝不按格数拆成多步。
   */
  private onRelease(pieceId: string, dir: MoveDir, cells: number): void {
    if (this.dialog || this.exitAnimating) return;

    if (cells === 0) {
      // 拖拽不足 0.5 格 → 回弹，不计步
      this.anim.shake(pieceId, axisOf(dir), 90, 2);
      return;
    }

    const move: Move = { piece: pieceId, dir, cells };
    if (!this.game.move(move)) {
      // 非法方向由 Game 发 blocked 事件统一处理（回弹 + 抖动 + 音效），此处不重复
      return;
    }

    // 滑动手感：120ms/格、上限 240ms、easeOutCubic（由 SlideTween 内部插值）
    const duration = Math.min(METRICS.slideMsMax, METRICS.slideMsPerCell * move.cells);
    this.anim.slide(pieceId, 0, 0, duration);
    this.deps.platform.audio.play('snap');
    if (this.deps.save.settings.vibrate) this.deps.platform.vibrate(8);
    this.scheduleSaveDebounced();
  }

  private onBlocked(move: Move): void {
    this.anim.shake(move.piece, axisOf(move.dir), METRICS.bounceMs, 4);
    this.deps.platform.audio.play('blocked');
    if (this.deps.save.settings.vibrate) this.deps.platform.vibrate(15);
    this.deps.analytics?.track('blocked', {
      levelId: this.game.level.id,
      piece: move.piece,
      dir: move.dir,
    });
  }

  private onButton(id: 'undo' | 'reset' | 'hint' | 'next' | 'replay' | 'share'): void {
    // 结算弹窗的三个按钮由 onTap 处理（需要坐标命中），这里只处理 HUD 与直接调用
    if (id === 'next' || id === 'replay' || id === 'share') return;
    this.deps.platform.audio.play('click');
    this.deps.analytics?.track('button_click', { id, levelId: this.game.level.id });
    if (id === 'undo') {
      const last = this.game.moves[this.game.moves.length - 1];
      if (!this.game.undo()) return;
      this.deps.platform.audio.play('undo');
      if (last) {
        this.anim.slide(
          last.piece,
          last.dir === 'left' ? last.cells : last.dir === 'right' ? -last.cells : 0,
          last.dir === 'up' ? last.cells : last.dir === 'down' ? -last.cells : 0,
          METRICS.slideMsPerCell,
        );
      }
      this.scheduleSaveDebounced(); // 撤销后 500ms 防抖写存档
      return;
    }
    if (id === 'reset') {
      this.restartLevel();
      return;
    }
    if (id === 'hint') this.useHint();
  }

  private useHint(): void {
    if (this.game.solved) return;
    if (this.hintUsedInLevel > 0) {
      // 每关免费提示 1 次，之后看激励视频；H5 无广告 → 自动降级为直接提示
      void this.deps.platform.ads.showRewarded();
    }
    const h = this.solver?.nextOptimalMove(this.game.state);
    if (!h) {
      this.showToast('这一步已经走不通了，试试撤销');
      return;
    }
    this.hintUsedInLevel++;
    this.deps.analytics?.track('hint_used', {
      levelId: this.game.level.id,
      times: this.hintUsedInLevel,
    });
    const which = h.piece === RED_ID ? '红车' : `「${h.piece}」车`;
    this.showToast(`试试把${which}向${cnDir(h.dir)}滑 ${h.cells} 格`);
    this.ghosts = [{ pieceId: h.piece, dir: h.dir, cells: h.cells }];
    this.delay(1600, () => {
      if (!this.dragging) this.ghosts = [];
    });
  }

  private showMovableDirs(pieceId: string): void {
    const idx = this.game.board.pieces.findIndex((p) => p.id === pieceId);
    if (idx < 0) return;
    const p = this.game.board.pieces[idx];
    const cand: MoveDir[] = p.dir === H ? ['left', 'right'] : ['up', 'down'];
    const dirs = cand.filter((d) => this.game.board.maxSlide(this.game.state, idx, d) > 0);
    this.ghosts = dirs.map((d) => ({ pieceId, dir: d, cells: 1 }));
    this.showToast(dirs.length === 0 ? '这辆车被顶住了，动不了' : '这些方向可以动');
    this.delay(1600, () => {
      if (!this.dragging) this.ghosts = [];
    });
  }

  private updateGhosts(): void {
    const d = this.dragging;
    if (!d) {
      this.ghosts = [];
      return;
    }
    const cells = Math.round(Math.abs(d.deltaCells));
    this.ghosts = cells >= 1 ? [{ pieceId: d.pieceId, dir: d.dir, cells }] : [];
  }

  // ---------------------------------------------------------------- 通关

  private onSolved(): void {
    if (this.solveHandled) return;
    this.solveHandled = true;
    this.exitAnimating = true;
    this.deps.platform.audio.play('win');
    this.anim.startExit(METRICS.exitAnimMs, this.layout.boardSize * 0.9);

    const report = this.game.buildReport(this.bestMovesFor(this.game.level.id));
    const res = recordClear(
      this.deps.save,
      this.game.level,
      report.steps,
      report.cellSteps,
      report.stars,
      Date.now(),
    );
    this.hooks.onProgressChanged();
    this.flushSave(); // 通关是关键节点：立即写
    this.deps.analytics?.track('level_clear', {
      levelId: this.game.level.id,
      difficulty: this.game.level.difficulty,
      steps: report.steps,
      par: report.parMoves,
      cellSteps: report.cellSteps,
      stars: report.stars,
      isNewBest: report.isNewBest,
    });

    // 驶出动画 + 白光结束后弹结算
    this.delay(METRICS.exitAnimMs + METRICS.flashMs, () => {
      this.exitAnimating = false;
      this.dialog = {
        stars: report.stars,
        steps: report.steps,
        cellSteps: report.cellSteps,
        isNewBest: res.isNewBestMoves,
      };
      this.anim.startFlash(METRICS.flashMs);
      this.anim.startDialog(220);
      this.deps.platform.audio.play('star');
    });
  }

  private bestMovesFor(levelId: string): number {
    const p = this.deps.save.levels[levelId];
    return p ? p.bestMoves : Number.POSITIVE_INFINITY;
  }

  // ---------------------------------------------------------------- 关卡流转

  /**
   * 从"已通关"回退到"未通关"时清理残留状态。
   *
   * 触发路径：结算弹窗还开着时点 HUD 撤销（或存档回放导致 solved 被清）。
   * 不清的话会有两个可见故障：
   *   1. 结算弹窗永远盖在棋盘上，玩家点不动棋盘；
   *   2. `solveHandled` 仍是 true，再次通关时 onSolved() 直接 return，弹窗不再出现。
   */
  private onUnsolved(): void {
    if (this.game.solved) return;
    this.dialog = null;
    this.solveHandled = false;
    this.exitAnimating = false;
    this.anim.clear();
  }

  private restartLevel(): void {
    this.resetTransient();
    this.game.reset();
    this.scheduleSaveDebounced();
  }

  /**
   * 顺序推进到下一关。
   * 完整选关页属 P4；本轮用"顺序通关"满足连续游玩的最小可用要求。
   */
  private goNext(): void {
    const next = this.deps.repo.next(this.game.level.id);
    this.loadLevel(next ?? this.deps.repo.first);
  }

  loadLevel(level: Level): void {
    this.resetTransient();
    this.game = this.buildGame(level);
    this.colors = pickColors(this.game.board.pieces);
    this.input = this.createInput();
    this.buildSolver();
    this.deps.save.current = { levelId: level.id, moves: [], startedAt: Date.now() };
    this.flushSave();
  }

  private resetTransient(): void {
    this.dialog = null;
    this.solveHandled = false;
    this.exitAnimating = false;
    this.hintUsedInLevel = 0;
    this.ghosts = [];
    this.dragging = null;
    this.toast = null;
    this.delayed = [];
    this.anim.clear();
  }

  // ---------------------------------------------------------------- 命中测试

  private pieceAt(x: number, y: number): { id: string; index: number } | null {
    const { r, c } = pxToCell(this.layout, x, y);
    const rr = Math.floor(r);
    const cc = Math.floor(c);
    if (rr < 0 || rr > 5 || cc < 0 || cc > 5) return null;
    // 36 格重建成本可忽略；刻意不复用 Board 内部缓冲，避免隐性耦合
    this.grid.fill(-1);
    const pieces = this.game.board.pieces;
    const state = this.game.state;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const pr = state[i * 2];
      const pc = state[i * 2 + 1];
      if (p.dir === H) {
        for (let k = 0; k < p.len; k++) this.grid[pr * 6 + pc + k] = i;
      } else {
        for (let k = 0; k < p.len; k++) this.grid[(pr + k) * 6 + pc] = i;
      }
    }
    const idx = this.grid[rr * 6 + cc];
    if (idx < 0) return null;
    return { id: pieces[idx].id, index: idx };
  }

  // ---------------------------------------------------------------- 存档

  private scheduleSaveDebounced(): void {
    this.saveTimer = 500; // 由 update() 倒计时驱动
  }

  private flushSave(): void {
    this.saveTimer = 0;
    this.deps.save.current = {
      levelId: this.game.level.id,
      moves: [...this.game.moves],
      startedAt: this.deps.save.current?.startedAt ?? Date.now(),
    };
    this.deps.persist();
  }

  private delay(ms: number, run: () => void): void {
    this.delayed.push({ remaining: ms, run });
  }

  // ---------------------------------------------------------------- 新手引导

  /**
   * 前 3 关的情境化引导（docs/01 §9）。
   * 判定依据是**关卡在关卡包中的序号**而非 id 前缀：这样即使教学关 id 变更、
   * 或包内顺序调整，引导依然落在"玩家最先玩到的 3 关"上。
   */
  private maybeStartTutorial(): void {
    if (this.deps.save.tutorialDone) return;
    const idx = this.deps.repo.levels.findIndex((l) => l.id === this.game.level.id);
    if (idx < 0 || idx >= 3) return;
    const highlightPieceId = this.tutorialHighlightFor(idx);
    this.tutorial = new TutorialOverlay(
      {
        step: (idx + 1) as 1 | 2 | 3,
        layout: this.layout,
        highlightPieceId,
        highlightPos: highlightPieceId ? this.pieceGridPos(highlightPieceId) : undefined,
      },
      {
        onFinish: () => {
          this.tutorial = null;
          this.deps.save.tutorialDone = true;
          this.deps.persist();
          this.deps.analytics?.track('button_click', { id: 'tutorial_done' });
        },
      },
    );
  }

  /** 引导高亮的车：t01 只高亮红车；t02/t03 高亮"当前该动的车"（求解器给出） */
  private tutorialHighlightFor(idx: number): string | null {
    if (idx === 0) return RED_ID;
    const h = this.solver?.nextOptimalMove(this.game.state);
    return h?.piece ?? RED_ID;
  }

  /** 设置页"重看引导"入口 */
  restartTutorial(): void {
    this.deps.save.tutorialDone = false;
    const idx = this.deps.repo.levels.findIndex((l) => l.id === this.game.level.id);
    if (idx >= 0 && idx < 3) this.maybeStartTutorial();
  }

  get hasTutorial(): boolean {
    return this.tutorial !== null;
  }

  /** 从哪个屏进入的（决定返回目标：选关页进入就回选关页） */
  get enteredFrom(): GameParams['from'] {
    return this.from;
  }

  /** 某辆车当前的网格位置（供引导高亮使用） */
  private pieceGridPos(id: string): { r: number; c: number; len: number; dir: string } | undefined {
    const pieces = this.game.board.pieces;
    const state = this.game.state;
    for (let i = 0; i < pieces.length; i++) {
      if (pieces[i].id !== id) continue;
      return {
        r: state[i * 2],
        c: state[i * 2 + 1],
        len: pieces[i].len,
        dir: pieces[i].dir,
      };
    }
    return undefined;
  }

  /** 引导高亮车的屏幕矩形（e2e 断言挖洞位置用） */
  tutorialHoleRect(): { x: number; y: number; w: number; h: number } | null {
    const id = this.tutorial?.highlightPieceId;
    if (!id) return null;
    const pos = this.pieceGridPos(id);
    if (!pos) return null;
    const pad = Math.round(this.layout.cell * 0.12);
    const x = this.layout.boardX + pos.c * this.layout.cell - pad;
    const y = this.layout.boardY + pos.r * this.layout.cell - pad;
    const w = (pos.dir === H ? pos.len : 1) * this.layout.cell + pad * 2;
    const h = (pos.dir === 'V' ? pos.len : 1) * this.layout.cell + pad * 2;
    return { x, y, w, h };
  }

  /** 引导遮罩的按钮矩形（绘制、命中、e2e 断言同源，避免测试自己猜坐标） */
  tutorialButtonRects(): {
    ok: { x: number; y: number; w: number; h: number } | null;
    skip: { x: number; y: number; w: number; h: number } | null;
    bubble: { x: number; y: number; w: number; h: number } | null;
  } {
    const t = this.tutorial;
    if (!t) return { ok: null, skip: null, bubble: null };
    const ok = t.okRect;
    const skip = t.skipRect;
    const bubble = t.bubbleRectPublic;
    return {
      ok: { x: ok.x, y: ok.y, w: ok.w, h: ok.h },
      skip: { x: skip.x, y: skip.y, w: skip.w, h: skip.h },
      bubble,
    };
  }

  /** 当前引导步骤文案（e2e 断言文案与规格一致） */
  get tutorialText(): string | null {
    return this.tutorial?.text ?? null;
  }

  get tutorialStep(): number | null {
    return this.tutorial?.step ?? null;
  }

  // ---------------------------------------------------------------- 渲染

  render(): void {
    const ctx = this.ctx;
    const layout = this.layout;
    drawBackground(ctx, layout);
    drawBoard(ctx, layout);
    drawExit(ctx, layout, 0);

    const pieces = this.game.board.pieces;
    const state = this.game.state;

    // 拖拽中的车按手指位移实时跟随
    let dragDx = 0;
    let dragDy = 0;
    if (this.dragging) {
      const idx = pieces.findIndex((p) => p.id === this.dragging!.pieceId);
      if (idx >= 0) {
        const px = this.dragging.deltaCells * layout.cell;
        if (pieces[idx].dir === H) dragDx = px;
        else dragDy = px;
      }
    }

    // 虚影先画（位于车下方）
    for (const g of this.ghosts) {
      const idx = pieces.findIndex((p) => p.id === g.pieceId);
      if (idx < 0) continue;
      const p = { ...pieces[idx], r: state[idx * 2], c: state[idx * 2 + 1] };
      drawGhost(ctx, layout, p, g.dir, g.cells);
    }

    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const placed = { ...p, r: state[i * 2], c: state[i * 2 + 1] };
      const off = this.anim.offsetFor(p.id, layout.cell);
      const isDragging = this.dragging?.pieceId === p.id;
      const canMove = this.canMoveAt(i);
      const car: CarWithOffset = {
        piece: placed,
        color: this.colors.get(p.id) ?? pickColors([p]).get(p.id)!,
        dx: off.dx + (isDragging ? dragDx : 0),
        dy: off.dy + (isDragging ? dragDy : 0),
        dragging: isDragging,
        // 拖拽中且完全无路可走 → 变暗，给出"顶住感"
        dimmed: isDragging && !canMove && this.ghosts.length === 0,
      };
      drawCar(ctx, layout, car);
    }

    // 长按/提示的方向箭头
    if (this.ghosts.length > 0 && !this.dragging && this.ghosts[0].cells === 1) {
      const g0 = this.ghosts[0];
      const idx = pieces.findIndex((p) => p.id === g0.pieceId);
      if (idx >= 0) {
        const p = { ...pieces[idx], r: state[idx * 2], c: state[idx * 2 + 1] };
        drawHintArrows(
          ctx,
          layout,
          p,
          this.ghosts.map((g) => g.dir),
        );
      }
    }

    drawHud(
      ctx,
      layout,
      {
        levelName: this.game.level.name,
        steps: this.game.steps,
        parMoves: this.game.parMoves,
        hintLeft: Math.max(0, 1 - this.hintUsedInLevel),
      },
      this.game.canUndo,
    );

    if (this.toast) drawToast(ctx, layout, this.toast.text);
    if (this.anim.flash) drawFlash(ctx, layout, this.anim.flash.alpha);

    if (this.dialog) {
      drawResultDialog(ctx, layout, {
        stars: this.dialog.stars,
        steps: this.dialog.steps,
        parMoves: this.game.parMoves,
        cellSteps: this.dialog.cellSteps,
        isNewBest: this.dialog.isNewBest,
        hasNext: this.deps.repo.next(this.game.level.id) !== null,
        progress: this.anim.dialog ? this.anim.dialog.t : 1,
        shareEnabled: this.hooks.onShare !== undefined,
      });
    }

    // 引导遮罩画在最上层：必须盖住结算弹窗与 HUD，否则玩家能点到下面的按钮
    this.tutorial?.render(ctx);
  }

  private canMoveAt(index: number): boolean {
    const p = this.game.board.pieces[index];
    const a = p.dir === H ? 'left' : 'up';
    const b = p.dir === H ? 'right' : 'down';
    return (
      this.game.board.maxSlide(this.game.state, index, a as MoveDir) +
        this.game.board.maxSlide(this.game.state, index, b as MoveDir) >
      0
    );
  }

  private showToast(text: string): void {
    this.toast = { text, until: this.lastTime + 1800 };
  }

  // ---------------------------------------------------------------- 只读访问器（供 e2e 与调试）

  get levelId(): string {
    return this.game.level.id;
  }
  get steps(): number {
    return this.game.steps;
  }
  get cellSteps(): number {
    return this.game.cellSteps;
  }
  get solved(): boolean {
    return this.game.solved;
  }
  get currentLayout(): Layout {
    return this.layout;
  }
  get hasDialog(): boolean {
    return this.dialog !== null;
  }
  get canUndo(): boolean {
    return this.game.canUndo;
  }
  get moveList(): readonly Move[] {
    return this.game.moves;
  }
  /** 供 e2e 断言：返回当前棋盘上每辆车的网格位置 */
  get piecePositions(): Array<{ id: string; r: number; c: number; dir: string; len: number }> {
    const pieces = this.game.board.pieces;
    const state = this.game.state;
    return pieces.map((p, i) => ({
      id: p.id,
      r: state[i * 2],
      c: state[i * 2 + 1],
      dir: p.dir,
      len: p.len,
    }));
  }
  /** 供 e2e 使用：程序化走一步（等价于一次拖拽松手） */
  applyMove(move: Move): boolean {
    return this.game.move(move);
  }
  /** 供 e2e 使用：点击 HUD 按钮 */
  pressButton(id: 'undo' | 'reset' | 'hint'): void {
    this.onButton(id);
  }
  /** 供 e2e 使用：红车在出口行且无遮挡时的最大可滑格数 */
  redMaxSlide(dir: MoveDir): number {
    return this.game.board.maxSlide(this.game.state, 0, dir);
  }
  /** 供 e2e 使用：任意车辆在指定方向的最大可滑格数 */
  maxSlide(pieceId: string, dir: MoveDir): number {
    const idx = this.game.board.pieces.findIndex((p) => p.id === pieceId);
    return idx < 0 ? 0 : this.game.board.maxSlide(this.game.state, idx, dir);
  }
  /** 供 e2e 使用：求解器给出的最优下一步（离线已校验，必可走到通关） */
  bestNextMove(): Move | null {
    if (!this.solver) return null;
    return this.solver.nextOptimalMove(this.game.state);
  }
  /** 供 e2e 使用：当前局面的剩余最少步数 */
  remainingMoves(): number | null {
    return this.solver ? this.solver.remainingMoves(this.game.state) : null;
  }
  /** 供 e2e 使用：直接触发一次通关结算流程（用于验证弹窗交互，避免依赖动画时序） */
  forceSolveReport(): void {
    if (this.game.solved) return;
    // 用求解器生成的完整最优解一次走完，保证真实触发 solve 事件
    const path = this.solver?.optimalPathFrom(this.game.state);
    if (!path) return;
    for (const m of path) this.game.move(m);
    if (this.game.solved) this.onSolved();
  }
  /** 供 e2e 使用：HUD 按钮的真实屏幕矩形（用于像素级点击验证命中测试） */
  hudButtonRects(): Array<{ id: string; label: string; x: number; y: number; w: number; h: number }> {
    return hudButtons(this.layout);
  }
  /**
   * 供 e2e 使用：结算弹窗按钮的屏幕矩形（稳定态，与命中测试同一口径）。
   * 与命中测试、绘制共用 layout 层的 dialogButtonsOnScreen，避免三处公式漂移。
   */
  dialogButtonRects(): Array<{ id: string; label: string; x: number; y: number; w: number; h: number }> {
    if (!this.dialog) return [];
    return dialogButtonsOnScreen(this.layout, 1).map((b) => ({
      id: b.id,
      label: b.label,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
    }));
  }
}

function axisOf(dir: MoveDir): 'x' | 'y' {
  return dir === 'left' || dir === 'right' ? 'x' : 'y';
}

function cnDir(d: MoveDir): string {
  return { up: '上', down: '下', left: '左', right: '右' }[d];
}
