/**
 * 走子生成 —— 本文件是全项目的性能与正确性核心，逐行对齐 rush_hour.py 的 Board。
 *
 * ⚠️ 红线（docs/01 §1「一次滑动 = 1 步」）：
 *    一次拖动若可滑 k 格，必须生成 k 个**互不相同**的候选状态（各计 1 步），
 *    绝不能只生成"滑到底"。解法搜索与"是否还能达到 par"都依赖这一点。
 */

import { COLS, H, RED_ID, ROWS, cellsOf, normalizePieces, type MoveDir, type Piece } from './model';

/** 状态 = 各车 (r,c) 的扁平数组，长度 = n*2，按 normalizePieces 后的顺序排列 */
export type State = Int16Array;

export interface CandidateMove {
  /** 车辆在内部数组中的索引（红车恒为 0） */
  pieceIndex: number;
  pieceId: string;
  dir: MoveDir;
  /** 滑动格数，恒 >= 1 */
  cells: number;
  /** 移动后的新状态 */
  next: State;
}

/**
 * 编译后的棋盘：预计算方向/长度，并把状态表示为 Int16Array 以避免 GC 抖动。
 * 状态哈希用 String.fromCharCode 拼接（比 JOIN 数组快 1~2 个数量级）。
 */
export class Board {
  readonly pieces: Piece[];
  readonly n: number;
  readonly start: State;
  private readonly dirs: Uint8Array; // 0 = H, 1 = V
  private readonly lens: Uint8Array;
  private readonly ids: string[];
  /** 复用缓冲：占用表，避免每次 genMoves 都分配 */
  private readonly occ = new Int16Array(ROWS * COLS);

  constructor(pieces: readonly Piece[]) {
    this.pieces = normalizePieces(pieces);
    this.n = this.pieces.length;
    this.dirs = new Uint8Array(this.n);
    this.lens = new Uint8Array(this.n);
    this.ids = new Array(this.n);
    this.start = new Int16Array(this.n * 2);
    for (let i = 0; i < this.n; i++) {
      const p = this.pieces[i];
      this.dirs[i] = p.dir === H ? 0 : 1;
      this.lens[i] = p.len;
      this.ids[i] = p.id;
      this.start[i * 2] = p.r;
      this.start[i * 2 + 1] = p.c;
    }
  }

  get redIndex(): number {
    return 0;
  }

  /** 状态 -> 紧凑字符串键。用 charCode 而非十进制拼接，避免 "1,11" 与 "11,1" 类歧义 */
  key(s: State): string {
    let out = '';
    for (let i = 0; i < s.length; i++) out += String.fromCharCode(s[i] + 1);
    return out;
  }

  /** 从任意状态克隆出一份可写副本 */
  cloneState(s: State): State {
    return new Int16Array(s);
  }

  piecesAsList(s: State): Piece[] {
    const out: Piece[] = new Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const p = this.pieces[i];
      out[i] = { id: p.id, dir: p.dir, len: p.len, r: s[i * 2], c: s[i * 2 + 1] };
    }
    return out;
  }

  /**
   * 生成当前状态的所有合法移动。
   * 每个可达格数产出独立的候选（见文件头红线）。
   */
  genMoves(s: State): CandidateMove[] {
    const occ = this.occ;
    occ.fill(-1);
    for (let i = 0; i < this.n; i++) {
      const r = s[i * 2];
      const c = s[i * 2 + 1];
      const len = this.lens[i];
      if (this.dirs[i] === 0) {
        const base = r * COLS + c;
        for (let k = 0; k < len; k++) occ[base + k] = i;
      } else {
        for (let k = 0; k < len; k++) occ[(r + k) * COLS + c] = i;
      }
    }

    const out: CandidateMove[] = [];
    for (let i = 0; i < this.n; i++) {
      const r = s[i * 2];
      const c = s[i * 2 + 1];
      const len = this.lens[i];

      if (this.dirs[i] === 0) {
        // 向右：只检查新进入的格子
        for (let k = 1; c + len + k - 1 < COLS && occ[r * COLS + c + len + k - 1] === -1; k++) {
          const ns = this.cloneState(s);
          ns[i * 2 + 1] = c + k;
          out.push({ pieceIndex: i, pieceId: this.ids[i], dir: 'right', cells: k, next: ns });
        }
        for (let k = 1; c - k >= 0 && occ[r * COLS + c - k] === -1; k++) {
          const ns = this.cloneState(s);
          ns[i * 2 + 1] = c - k;
          out.push({ pieceIndex: i, pieceId: this.ids[i], dir: 'left', cells: k, next: ns });
        }
      } else {
        for (let k = 1; r + len + k - 1 < ROWS && occ[(r + len + k - 1) * COLS + c] === -1; k++) {
          const ns = this.cloneState(s);
          ns[i * 2] = r + k;
          out.push({ pieceIndex: i, pieceId: this.ids[i], dir: 'down', cells: k, next: ns });
        }
        for (let k = 1; r - k >= 0 && occ[(r - k) * COLS + c] === -1; k++) {
          const ns = this.cloneState(s);
          ns[i * 2] = r - k;
          out.push({ pieceIndex: i, pieceId: this.ids[i], dir: 'up', cells: k, next: ns });
        }
      }
    }
    return out;
  }

  /**
   * 指定车辆在某方向上的最大可滑动格数（用于拖拽吸附与 UI 范围提示）。
   * 返回 0 表示该方向完全被阻。
   */
  maxSlide(s: State, pieceIndex: number, dir: MoveDir): number {
    const occ = this.occ;
    occ.fill(-1);
    for (let i = 0; i < this.n; i++) {
      const r = s[i * 2];
      const c = s[i * 2 + 1];
      const len = this.lens[i];
      if (this.dirs[i] === 0) {
        const base = r * COLS + c;
        for (let k = 0; k < len; k++) occ[base + k] = i;
      } else {
        for (let k = 0; k < len; k++) occ[(r + k) * COLS + c] = i;
      }
    }
    const r = s[pieceIndex * 2];
    const c = s[pieceIndex * 2 + 1];
    const len = this.lens[pieceIndex];
    let k = 0;
    if (this.dirs[pieceIndex] === 0) {
      if (dir === 'right') {
        while (c + len + k < COLS && occ[r * COLS + c + len + k] === -1) k++;
      } else if (dir === 'left') {
        while (c - 1 - k >= 0 && occ[r * COLS + c - 1 - k] === -1) k++;
      } else {
        return 0; // 横车不能上下移动
      }
    } else {
      if (dir === 'down') {
        while (r + len + k < ROWS && occ[(r + len + k) * COLS + c] === -1) k++;
      } else if (dir === 'up') {
        while (r - 1 - k >= 0 && occ[(r - 1 - k) * COLS + c] === -1) k++;
      } else {
        return 0; // 竖车不能左右移动
      }
    }
    return k;
  }

  /** 从当前状态应用一次移动，返回新状态；非法则返回 null */
  apply(s: State, pieceId: string, dir: MoveDir, cells: number): State | null {
    const i = this.ids.indexOf(pieceId);
    if (i < 0) return null;
    const max = this.maxSlide(s, i, dir);
    if (cells < 1 || cells > max) return null;
    const ns = this.cloneState(s);
    if (dir === 'left') ns[i * 2 + 1] -= cells;
    else if (dir === 'right') ns[i * 2 + 1] += cells;
    else if (dir === 'up') ns[i * 2] -= cells;
    else ns[i * 2] += cells;
    return ns;
  }

  /**
   * 通关判定：红车锚点位于 (EXIT_ROW, GOAL_C)，即占据 (2,4)-(2,5)。
   * 注意不能简单判「贴到最右」，因为出口行右侧可能还有其他车（不可解盘面）。
   */
  isGoal(s: State): boolean {
    return s[0] === 2 && s[1] === 4;
  }

  /** 当前状态是否已违反基本不变式（供单测/调试使用） */
  validateState(s: State): boolean {
    if (s.length !== this.n * 2) return false;
    const seen = new Uint8Array(ROWS * COLS);
    for (let i = 0; i < this.n; i++) {
      const p: Piece = {
        id: this.ids[i],
        dir: this.dirs[i] === 0 ? H : 'V',
        len: this.lens[i] as 2 | 3,
        r: s[i * 2],
        c: s[i * 2 + 1],
      };
      for (const [r, c] of cellsOf(p)) {
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
        const k = r * COLS + c;
        if (seen[k]) return false;
        seen[k] = 1;
      }
    }
    return true;
  }
}

export { RED_ID };
