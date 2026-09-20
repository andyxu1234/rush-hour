/**
 * 求解器 —— 1:1 移植 rush_hour.py 的 Board 搜索部分。
 *
 * 核心事实：所有移动可逆 → 状态图无向 → **不存在死局**（定理 1）。
 * 因此可以从目标状态集合做多源反向 BFS，一次性得到"任意局面到通关的最少步数"。
 * 这正是提示功能能做到 O(分支数) 的基础。
 *
 * ⚠️ 踩过的坑（务必保留注释，后来者极易重犯）：
 *   distGoal 会覆盖整个可达集，且必然包含初始状态（其 distStart = 0）。
 *   因此 `Math.min(...distGoal.values())` 恒等于 0，是个静默错误。
 *   求最少步数必须在 **goals 集合**上取 min(distStart)，见 minMovesToGoal()。
 */

import { MAX_STATES, type Piece } from './model';
import { Board, type CandidateMove, type State } from './moves';
import type { Move, MoveDir } from './model';

export class StateSpaceTooLargeError extends Error {
  constructor(limit: number) {
    super(`状态空间超过上限 ${limit}，已安全中止`);
    this.name = 'StateSpaceTooLargeError';
  }
}

export interface SearchResult {
  /** 状态键 -> 从初始状态出发的最少滑动次数 */
  dist: Map<string, number>;
  /** 状态键 -> 该状态的出度（候选移动数） */
  degree: Map<string, number>;
  /** 被真正移动过的车辆索引集合（用于统计装饰车） */
  used: Set<number>;
}

/** 正向 BFS：从初始状态铺满整个可达状态图 */
export function reachable(board: Board, maxStates = MAX_STATES): SearchResult {
  const dist = new Map<string, number>();
  const degree = new Map<string, number>();
  const used = new Set<number>();

  const start = board.start;
  const startKey = board.key(start);
  dist.set(startKey, 0);

  // 手写队列（数组 + 头指针）比 shift() 快得多
  const queue: State[] = [start];
  let head = 0;

  while (head < queue.length) {
    const s = queue[head++];
    const k = board.key(s);
    const moves = board.genMoves(s);
    degree.set(k, moves.length);
    const d = dist.get(k)!;
    for (const m of moves) {
      used.add(m.pieceIndex);
      const nk = board.key(m.next);
      if (!dist.has(nk)) {
        dist.set(nk, d + 1);
        queue.push(m.next);
      }
    }
    if (dist.size > maxStates) throw new StateSpaceTooLargeError(maxStates);
  }

  return { dist, degree, used };
}

export interface GoalDistanceResult {
  /** 状态键 -> 该状态到最近目标状态的最少步数（覆盖整个可达集） */
  distGoal: Map<string, number>;
  /** 真正的目标状态（红车已就位），求 minMoves 必须只在这个集合上取 */
  goals: State[];
}

/**
 * 多源反向 BFS：从所有目标状态出发，只在可达子图内传播。
 * @param states 可达状态集合（键集合），用于裁剪搜索范围
 */
export function goalDist(board: Board, states: Set<string>): GoalDistanceResult {
  const goals: State[] = [];
  for (const k of states) {
    const s = keyToState(k, board.n);
    if (board.isGoal(s)) goals.push(s);
  }
  if (goals.length === 0) return { distGoal: new Map(), goals: [] };

  const distGoal = new Map<string, number>();
  const queue: State[] = [];
  for (const g of goals) {
    distGoal.set(board.key(g), 0);
    queue.push(g);
  }

  let head = 0;
  while (head < queue.length) {
    const s = queue[head++];
    const d = distGoal.get(board.key(s))!;
    for (const m of board.genMoves(s)) {
      const nk = board.key(m.next);
      if (states.has(nk) && !distGoal.has(nk)) {
        distGoal.set(nk, d + 1);
        queue.push(m.next);
      }
    }
  }
  return { distGoal, goals };
}

/** 状态键还原为状态数组（键由 charCode 编码，每个字符代表一格坐标值+1） */
export function keyToState(key: string, n: number): State {
  const s = new Int16Array(n * 2);
  for (let i = 0; i < key.length; i++) s[i] = key.charCodeAt(i) - 1;
  return s;
}

/**
 * 最少滑动步数。
 * ⚠️ 只在 goals 上取 min(distStart)；对 distGoal 取 min 会恒得 0（见文件头注释）。
 */
export function minMovesToGoal(dist: Map<string, number>, goals: State[], board: Board): number {
  let best = Number.POSITIVE_INFINITY;
  for (const g of goals) {
    const d = dist.get(board.key(g));
    if (d !== undefined && d < best) best = d;
  }
  return best;
}

/** 已在解中确定的状态数上限保护（防止病态盘面把提示算爆） */
export interface SolverOptions {
  maxStates?: number;
}

/**
 * 完整求解结果。构造后即可 O(1) 查询任意可达局面的剩余最少步数。
 */
export class Solver {
  readonly board: Board;
  readonly dist: Map<string, number>;
  readonly distGoal: Map<string, number>;
  readonly degree: Map<string, number>;
  readonly goals: State[];
  readonly minMoves: number;

  private constructor(
    board: Board,
    dist: Map<string, number>,
    distGoal: Map<string, number>,
    degree: Map<string, number>,
    goals: State[],
  ) {
    this.board = board;
    this.dist = dist;
    this.distGoal = distGoal;
    this.degree = degree;
    this.goals = goals;
    this.minMoves = minMovesToGoal(dist, goals, board);
  }

  /**
   * 求解。不可解时 goals 为空 —— 不抛异常、不死循环（docs/06 §L1 要求）。
   */
  static solve(pieces: readonly Piece[], opts: SolverOptions = {}) {
    const board = new Board(pieces);
    const { dist, degree, used } = reachable(board, opts.maxStates);
    const { distGoal, goals } = goalDist(board, new Set(dist.keys()));
    return {
      solver: new Solver(board, dist, distGoal, degree, goals),
      used,
    };
  }

  get solvable(): boolean {
    return this.goals.length > 0;
  }

  /** 指定局面的剩余最少步数；不可达或不满足最优条件时返回 null */
  remainingMoves(state: State): number | null {
    const d = this.distGoal.get(this.board.key(state));
    return d === undefined ? null : d;
  }

  /** 任意中间局面的最优下一步（提示用，O(分支数)，实测 << 30ms） */
  nextOptimalMove(state: State): Move | null {
    const cur = this.remainingMoves(state);
    if (cur === null) return null;
    if (cur === 0) return null; // 已通关
    const moves = this.board.genMoves(state);
    let fallback: CandidateMove | null = null;
    for (const m of moves) {
      const d = this.distGoal.get(this.board.key(m.next));
      if (d !== undefined && d === cur - 1) {
        // 反向目标距离恰好减 1 —— 这就是一步最优走子
        if (!fallback) fallback = m;
        // 优先返回"能拉近与初始状态距离"的走法，避免绕路，但任意 min 都合法
        const ds = this.dist.get(this.board.key(m.next));
        if (ds !== undefined) {
          return { piece: m.pieceId, dir: m.dir, cells: m.cells };
        }
      }
    }
    return fallback ? { piece: fallback.pieceId, dir: fallback.dir, cells: fallback.cells } : null;
  }

  /** 从当前局面出发的一条最优解（用于播放"提示演示"或复盘） */
  optimalPathFrom(state: State, guard = 500): Move[] | null {
    let s = state;
    const path: Move[] = [];
    let steps = 0;
    while (!this.board.isGoal(s) && steps < guard) {
      steps++;
      const next = this.nextOptimalMove(s);
      if (!next) return null;
      path.push(next);
      const ns = this.board.apply(s, next.piece, next.dir, next.cells);
      if (!ns) return null;
      s = ns;
    }
    return this.board.isGoal(s) ? path : null;
  }
}

/**
 * 最少"格数"：以滑动格数为边权做 Dijkstra，首次弹出目标态即为答案。
 * 与滑动步数是两个独立口径，用于副指标 bestCells。
 */
export function minCellSteps(board: Board): number | null {
  // 简易二叉堆（本项目规模下单文件实现足够快，避免额外依赖）
  const dist = new Map<string, number>();
  const heap = new MinHeap();
  const startKey = board.key(board.start);
  dist.set(startKey, 0);
  heap.push(0, board.start);

  while (heap.size > 0) {
    const { cost, value: s } = heap.pop()!;
    if (cost > (dist.get(board.key(s)) ?? Number.POSITIVE_INFINITY)) continue;
    if (board.isGoal(s)) return cost;
    for (const m of board.genMoves(s)) {
      const nc = cost + m.cells;
      const nk = board.key(m.next);
      if (nc < (dist.get(nk) ?? Number.POSITIVE_INFINITY)) {
        dist.set(nk, nc);
        heap.push(nc, m.next);
      }
    }
  }
  return null;
}

class MinHeap {
  private keys: number[] = [];
  private vals: State[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: State): void {
    this.keys.push(key);
    this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  pop(): { cost: number; value: State } | null {
    if (this.keys.length === 0) return null;
    const cost = this.keys[0];
    const value = this.vals[0];
    const lk = this.keys.pop()!;
    const lv = this.vals.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lk;
      this.vals[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return { cost, value };
  }

  private swap(a: number, b: number): void {
    const tk = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = tk;
    const tv = this.vals[a];
    this.vals[a] = this.vals[b];
    this.vals[b] = tv;
  }
}

/** 最优解条数（在最优走廊上做 DAG 计数 DP）。数量大 = 冗余度高 = 更容易 */
export function countOptimal(solver: Solver, cap = 1e9): number {
  const corridor: State[] = [];
  for (const k of solver.dist.keys()) {
    const s = keyToState(k, solver.board.n);
    const ds = solver.dist.get(k)!;
    const dg = solver.distGoal.get(k);
    if (dg !== undefined && ds + dg === solver.minMoves) corridor.push(s);
  }
  corridor.sort(
    (a, b) => solver.dist.get(solver.board.key(b))! - solver.dist.get(solver.board.key(a))!,
  );

  const f = new Map<string, number>();
  const corridorSet = new Set(corridor.map((s) => solver.board.key(s)));
  for (const s of corridor) {
    if (solver.board.isGoal(s)) {
      f.set(solver.board.key(s), 1);
      continue;
    }
    const ds = solver.dist.get(solver.board.key(s))!;
    let tot = 0;
    for (const m of solver.board.genMoves(s)) {
      const nk = solver.board.key(m.next);
      if (corridorSet.has(nk) && solver.dist.get(nk) === ds + 1) {
        tot += f.get(nk) ?? 0;
      }
    }
    f.set(solver.board.key(s), Math.min(tot, cap));
  }
  return f.get(solver.board.key(solver.board.start)) ?? 0;
}

/** 便于外部按 id 走子（状态机里 moves 数组的唯一事实来源） */
export function applyMove(board: Board, state: State, move: Move): State | null {
  return board.apply(state, move.piece, move.dir as MoveDir, move.cells);
}
