/**
 * 对局状态机（docs/02-architecture.md §5）。
 *
 *   idle → playing → (undo / redo) → playing → solved → (结算) → idle
 *
 * 设计核心：`moves: Move[]` 是**唯一事实来源**。
 * 棋盘状态一律由 moves 顺序重放得出，因此：
 *   - 撤销 = 弹栈；
 *   - 存档 = 存 moves 数组；
 *   - 防作弊 = 提交 moves 由服务端重放。
 * 三件事共用同一份数据，永远不会互相漂移。
 */

import type { Level, Move } from './model';
import { Board, type State } from './moves';
import { Solver } from './solver';

export class IllegalMoveError extends Error {
  constructor(move: Move) {
    super(`非法移动: ${move.piece} ${move.dir} ${move.cells}`);
    this.name = 'IllegalMoveError';
  }
}

export interface GameSnapshot {
  levelId: string;
  /** 当前步数 == moves.length */
  steps: number;
  state: State;
  solved: boolean;
  moves: readonly Move[];
}

export interface SolveReport {
  steps: number;
  parMoves: number;
  cellSteps: number;
  parCellSteps: number;
  stars: 1 | 2 | 3;
  isNewBest: boolean;
}

export type GameEvent =
  | { type: 'move'; move: Move; steps: number }
  | { type: 'blocked'; move: Move }
  | { type: 'undo'; steps: number }
  | { type: 'redo'; steps: number }
  | { type: 'solve'; report: SolveReport }
  | { type: 'reset' };

type Listener = (e: GameEvent) => void;

export class Game {
  readonly level: Level;
  readonly board: Board;
  private readonly solver: Solver | null;

  private _state: State;
  private readonly _moves: Move[] = [];
  private readonly redoStack: Move[] = [];
  private _solved = false;
  private _cellSteps = 0;
  private listeners = new Set<Listener>();

  constructor(level: Level, opts: { solver?: Solver | null } = {}) {
    this.level = level;
    this.board = new Board(level.pieces);
    this._state = this.board.cloneState(this.board.start);
    // P1 阶段求解器为可选注入：单机试玩不需要 BFS，避免冷启动开销；
    // 需要"提示/par 校验"时由外部传入实例。
    this.solver = opts.solver === undefined ? null : opts.solver;
  }

  // ---------------------------------------------------------------- 查询

  get state(): State {
    return this._state;
  }

  get steps(): number {
    return this._moves.length;
  }

  get cellSteps(): number {
    return this._cellSteps;
  }

  get solved(): boolean {
    return this._solved;
  }

  get moves(): readonly Move[] {
    return this._moves;
  }

  get canUndo(): boolean {
    return this._moves.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get parMoves(): number {
    return this.level.par.moves;
  }

  /** 剩余最少步数（需要求解器；无求解器时返回 null） */
  get remaining(): number | null {
    return this.solver ? this.solver.remainingMoves(this._state) : null;
  }

  snapshot(): GameSnapshot {
    return {
      levelId: this.level.id,
      steps: this.steps,
      state: this._state,
      solved: this._solved,
      moves: [...this._moves],
    };
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(e: GameEvent): void {
    for (const l of this.listeners) l(e);
  }

  // ---------------------------------------------------------------- 变更

  /**
   * 走一步。步数恒等于 moves.length（docs/06 §L1 恒等式要求）。
   * 非法移动不改变任何状态，返回 false（由调用方播放回弹动画）。
   */
  move(move: Move): boolean {
    if (this._solved) return false;
    const next = this.board.apply(this._state, move.piece, move.dir, move.cells);
    if (!next) {
      this.emit({ type: 'blocked', move });
      return false;
    }
    this._state = next;
    this._moves.push(move);
    this._cellSteps += move.cells;
    this.redoStack.length = 0;
    this.emit({ type: 'move', move, steps: this._moves.length });
    this.checkSolved();
    return true;
  }

  /** 撤销：免费、无限（定理 1 保证无死局）。撤销后可重做 */
  undo(): boolean {
    const m = this._moves.pop();
    if (!m) return false;
    this.redoStack.push(m);
    this._cellSteps -= m.cells;
    this.replay();
    // ⚠️ 必须清掉 _solved。
    //   `_solved` 是在 checkSolved 里单向置位的；若撤销后不清，
    //   局面明明回到了未通关状态，对外却仍报 solved=true —— 后果：
    //     - move()/redo() 被 `if (this._solved) return false` 挡死，玩家卡住；
    //     - 提示（useHint）直接 early-return，点了没反应。
    //   成绩本身已在 solve 时通过 recordClear 写入存档，因此清掉 _solved
    //   不影响"成绩不回退"，只是让局面重新可操作。
    this._solved = false;
    this.emit({ type: 'undo', steps: this._moves.length });
    return true;
  }

  redo(): boolean {
    if (this._solved) return false;
    const m = this.redoStack.pop();
    if (!m) return false;
    const next = this.board.apply(this._state, m.piece, m.dir, m.cells);
    if (!next) return false;
    this._state = next;
    this._moves.push(m);
    this._cellSteps += m.cells;
    this.emit({ type: 'redo', steps: this._moves.length });
    this.checkSolved();
    return true;
  }

  /** 重开：清空全部走子与成绩 */
  reset(): void {
    this._moves.length = 0;
    this.redoStack.length = 0;
    this._cellSteps = 0;
    this._solved = false;
    this._state = this.board.cloneState(this.board.start);
    this.emit({ type: 'reset' });
  }

  /** 从走子序列恢复（断点续玩 / 存档加载 / 服务端重放校验共用） */
  loadMoves(moves: readonly Move[]): void {
    this._moves.length = 0;
    this.redoStack.length = 0;
    this._cellSteps = 0;
    this._solved = false;
    this._state = this.board.cloneState(this.board.start);
    for (const m of moves) {
      const next = this.board.apply(this._state, m.piece, m.dir, m.cells);
      if (!next) {
        // 存档损坏：停在最后一个合法步，不崩
        break;
      }
      this._state = next;
      this._moves.push(m);
      this._cellSteps += m.cells;
    }
    this.checkSolved();
  }

  private replay(): void {
    this._state = this.board.cloneState(this.board.start);
    this._cellSteps = 0;
    for (const m of this._moves) {
      const next = this.board.apply(this._state, m.piece, m.dir, m.cells);
      if (!next) break;
      this._state = next;
      this._cellSteps += m.cells;
    }
  }

  private checkSolved(): void {
    if (this._solved) return;
    if (!this.board.isGoal(this._state)) return;
    this._solved = true;
    this.emit({ type: 'solve', report: this.buildReport() });
  }

  /** 星级：★★★ = 恰好 par；★★ = par + 2 以内；★ = 完成即得 */
  computeStars(): 1 | 2 | 3 {
    const s = this.level.stars;
    if (this.steps <= s.three) return 3;
    if (this.steps <= s.two) return 2;
    return 1;
  }

  buildReport(bestMoves = Number.POSITIVE_INFINITY): SolveReport {
    return {
      steps: this.steps,
      parMoves: this.level.par.moves,
      cellSteps: this._cellSteps,
      parCellSteps: this.level.par.cellSteps,
      stars: this.computeStars(),
      isNewBest: this.steps < bestMoves,
    };
  }

  /** 提示：返回当前局面下的最优下一步（需要求解器） */
  hint(): Move | null {
    if (!this.solver || this._solved) return null;
    return this.solver.nextOptimalMove(this._state);
  }
}

/**
 * 定理 2 校验（编辑器实时校验 + 生成器剪枝复用）：
 * 出口行内位于红车右侧的横车 → 必不可能被红车绕过（同行两车无法交换左右次序），
 * 目标态要求红车占据 (2,4)-(2,5)，此时该横车须位于第 5 列之后 —— 越界。
 */
export function violatesTheorem2(pieces: readonly { id: string; dir: string; len: number; r: number; c: number }[]): boolean {
  const red = pieces.find((p) => p.id === 'R');
  if (!red) return true;
  for (const p of pieces) {
    if (p.id === 'R') continue;
    if (p.dir === 'H' && p.r === red.r && p.c > red.c) return true;
  }
  return false;
}
