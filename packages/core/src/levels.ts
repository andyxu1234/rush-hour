/**
 * 关卡装载 —— 客户端只读取 data/levels.json（不含解答）。
 * data/levels.verify.json（含解答）**绝不进包**，仅供 CI 交叉校验。
 */

import { normalizePieces, type Difficulty, type Level, type LevelPack, type Piece } from './model';

const VALID_DIFFICULTY: readonly Difficulty[] = ['starter', 'easy', 'medium', 'hard', 'expert'];

function assertLevel(raw: any, idx: number): Level {
  if (!raw || typeof raw !== 'object') throw new Error(`levels[${idx}] 不是对象`);
  if (typeof raw.id !== 'string' || !raw.id) throw new Error(`levels[${idx}].id 非法`);
  if (raw.par?.moves == null) throw new Error(`${raw.id}.par.moves 缺失`);
  if (!Array.isArray(raw.pieces) || raw.pieces.length === 0) {
    throw new Error(`${raw.id}.pieces 缺失`);
  }
  if (!VALID_DIFFICULTY.includes(raw.difficulty)) {
    throw new Error(`${raw.id}.difficulty 非法: ${raw.difficulty}`);
  }
  const pieces: Piece[] = raw.pieces.map((p: any) => ({
    id: String(p.id),
    dir: p.dir === 'V' ? 'V' : 'H',
    len: p.len === 3 ? 3 : 2,
    r: Number(p.r),
    c: Number(p.c),
  }));
  normalizePieces(pieces); // 触发红车/重叠/越界校验，坏数据在装载期就暴露
  return {
    id: raw.id,
    pack: String(raw.pack ?? 'classic'),
    name: String(raw.name ?? raw.id),
    difficulty: raw.difficulty,
    par: { moves: Number(raw.par.moves), cellSteps: Number(raw.par.cellSteps ?? 0) },
    stars: {
      three: Number(raw.stars?.three ?? raw.par.moves),
      two: Number(raw.stars?.two ?? raw.par.moves + 2),
      one: Number(raw.stars?.one ?? 0),
    },
    pieces,
    metrics: raw.metrics,
    index: typeof raw.index === 'number' ? raw.index : idx + 1,
  };
}

/** 解析并校验一个关卡包；任何结构问题都抛错（fail fast，避免带病上线） */
export function parseLevelPack(raw: unknown): LevelPack {
  const doc = raw as Partial<LevelPack>;
  if (!doc || typeof doc !== 'object') throw new Error('关卡包不是对象');
  if (doc.schemaVersion !== 1) throw new Error(`不支持的关卡包版本: ${doc.schemaVersion}`);
  if (!Array.isArray(doc.levels)) throw new Error('levels 字段缺失');
  const levels = doc.levels.map((l, i) => assertLevel(l, i));
  const ids = new Set<string>();
  for (const l of levels) {
    if (ids.has(l.id)) throw new Error(`关卡 id 重复: ${l.id}`);
    ids.add(l.id);
  }
  return {
    schemaVersion: 1,
    board: doc.board ?? { cols: 6, rows: 6, exitRow: 2, exitSide: 'right' },
    generator: doc.generator,
    levels,
  };
}

export class LevelRepository {
  private readonly byId = new Map<string, Level>();
  readonly levels: readonly Level[];

  constructor(pack: LevelPack) {
    this.levels = [...pack.levels].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const l of this.levels) this.byId.set(l.id, l);
  }

  get(id: string): Level | undefined {
    return this.byId.get(id);
  }

  /** 第一关 */
  get first(): Level {
    const l = this.levels[0];
    if (!l) throw new Error('关卡包为空');
    return l;
  }

  /**
   * 顺序推进的下一关。
   *
   * 之所以需要它：完整选关页属 P4 范围，本轮（P0–P2）需要一个最小可用的
   * 关卡推进机制来满足"连续游玩"的验收要求。
   */
  next(id: string): Level | null {
    const i = this.levels.findIndex((l) => l.id === id);
    if (i < 0 || i + 1 >= this.levels.length) return null;
    return this.levels[i + 1];
  }

  byPack(pack: string): Level[] {
    return this.levels.filter((l) => l.pack === pack);
  }
}
