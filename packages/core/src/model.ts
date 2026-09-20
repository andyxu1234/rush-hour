/**
 * 棋盘数据模型 —— 与 tools/rush_hour.py 的 Board/Piece 保持严格 1:1 语义。
 *
 * 坐标约定（务必牢记，错一个就全盘皆错）：
 *   - 6×6，(row, col) 均 0-indexed，row 向下增长；
 *   - 出口在第 2 行右边缘（EXIT_ROW = 2），宽 1 格，红车驶出即通关；
 *   - 车辆锚点 = 最上一格（竖车）/ 最左一格（横车）。
 */

export const COLS = 6;
export const ROWS = 6;
export const EXIT_ROW = 2;
export const EXIT_SIDE = 'right' as const;
export const H = 'H' as const;
export const V = 'V' as const;
export const RED_ID = 'R';
/** 红车锚点列 == GOAL_C 即代表已驶出 */
export const GOAL_C = COLS - 2; // 4

/** 搜索上限，与参考实现 MAX_STATES 一致 */
export const MAX_STATES = 100_000;

export type Dir = typeof H | typeof V;
export type MoveDir = 'up' | 'down' | 'left' | 'right';
export type Difficulty = 'starter' | 'easy' | 'medium' | 'hard' | 'expert';

export interface Piece {
  id: string;
  dir: Dir;
  len: 2 | 3;
  /** 最上一格 / 最左一格的行 */
  r: number;
  /** 最上一格 / 最左一格的列 */
  c: number;
}

export interface LevelPar {
  moves: number;
  cellSteps: number;
}

export interface LevelStars {
  /** 三星所需步数（== par.moves） */
  three: number;
  /** 二星所需步数（== par.moves + 2） */
  two: number;
  /** 0 表示只要完成即 1 星 */
  one: number;
}

export interface LevelMetrics {
  reachableStates: number;
  searchDepth: number;
  rootMoves: number;
  maxBranching: number;
  optimalPaths: number;
  goalStates: number;
  solutionSpaceLog2: number;
  idlePieces: number;
  pieces: number;
}

export interface Level {
  id: string;
  pack: string;
  name: string;
  difficulty: Difficulty;
  par: LevelPar;
  stars: LevelStars;
  pieces: Piece[];
  metrics?: LevelMetrics;
  index?: number;
}

export interface LevelPack {
  schemaVersion: number;
  board: { cols: number; rows: number; exitRow: number; exitSide: 'right' };
  generator?: { tool: string; seed: number };
  levels: Level[];
}

/** 一次移动：一辆车沿自身轴向滑动 cells 格（无论几格都算 1 步） */
export interface Move {
  piece: string;
  dir: MoveDir;
  cells: number;
}

// ---------------------------------------------------------------- 难度分级

/** 主指标 = 最少滑动次数。与 rush_hour.py 的 TIERS 完全一致 */
const TIERS: Array<[Difficulty, number, number]> = [
  ['starter', 0, 3],
  ['easy', 4, 7],
  ['medium', 8, 12],
  ['hard', 13, 18],
  ['expert', 19, Number.MAX_SAFE_INTEGER],
];

export function tierOf(moves: number): Difficulty {
  for (const [name, lo, hi] of TIERS) {
    if (moves >= lo && moves <= hi) return name;
  }
  return 'expert';
}

export const TIER_CN: Record<Difficulty, string> = {
  starter: '入门',
  easy: '简单',
  medium: '中等',
  hard: '困难',
  expert: '专家',
};

// ---------------------------------------------------------------- 几何工具

/** 车辆占据的格子列表 */
export function cellsOf(p: Piece): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (p.dir === H) {
    for (let i = 0; i < p.len; i++) out.push([p.r, p.c + i]);
  } else {
    for (let i = 0; i < p.len; i++) out.push([p.r + i, p.c]);
  }
  return out;
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

export const OPPOSITE: Record<MoveDir, MoveDir> = {
  left: 'right',
  right: 'left',
  up: 'down',
  down: 'up',
};

/**
 * 校验并规范化车辆列表：
 *  - 红车必须存在、为 H/len=2、初始位于出口行；
 *  - 车辆长度只能 2/3；
 *  - 不越界、不重叠。
 * 通过则返回按「红车在 index 0，其余按 id 字典序」排序的副本。
 *
 * 排序规则必须与 Python 端 `pieces.sort(key=lambda p: (p.id != RED_ID, p.id))` 一致，
 * 否则状态元组不同构，跨语言比对会失败。
 */
export function normalizePieces(pieces: readonly Piece[]): Piece[] {
  const sorted = [...pieces].sort((a, b) => {
    const ka = a.id === RED_ID ? 0 : 1;
    const kb = b.id === RED_ID ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const red = sorted[0];
  if (!red || red.id !== RED_ID) throw new Error('缺少红车 (id="R")');
  if (red.dir !== H || red.len !== 2) throw new Error('红车必须是横车且长度为 2');
  if (red.r !== EXIT_ROW) throw new Error(`红车初始必须位于出口行 row=${EXIT_ROW}`);

  const seen = new Uint8Array(ROWS * COLS);
  for (const p of sorted) {
    if (p.len !== 2 && p.len !== 3) throw new Error(`${p.id} 长度非法: ${p.len}`);
    for (const [r, c] of cellsOf(p)) {
      if (!inBounds(r, c)) throw new Error(`${p.id} 越界于 (${r},${c})`);
      const k = r * COLS + c;
      if (seen[k]) throw new Error(`${p.id} 与其他车重叠于 (${r},${c})`);
      seen[k] = 1;
    }
  }
  return sorted;
}
