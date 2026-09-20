/**
 * 存档 (SaveV1) —— docs/02-architecture.md §5。
 *
 * 硬性约束：
 *   - 体积 < 8KB；
 *   - **关键节点写**（通关、撤销后 500ms 防抖、切后台），绝不每帧写；
 *   - JSON 损坏 / 版本不匹配 → 安全降级为全新存档，绝不白屏。
 */

import type { Level } from './model';
import type { Move } from './model';

export const SAVE_KEY = 'rushhour.save.v1';
export const SAVE_VERSION = 1;

export interface LevelProgress {
  stars: number;
  bestMoves: number;
  bestCells: number;
  clearedAt: number;
}

export interface SaveSettings {
  sfx: boolean;
  music: boolean;
  vibrate: boolean;
  moveMetric: 'moves' | 'cells';
}

export interface CurrentSession {
  levelId: string;
  moves: Move[];
  startedAt: number;
}

export interface SaveV1 {
  v: 1;
  levels: Record<string, LevelProgress>;
  settings: SaveSettings;
  tutorialDone: boolean;
  current?: CurrentSession;
  /** 是否存在尚未同步到远端的改动 */
  dirty: boolean;
}

export function createEmptySave(): SaveV1 {
  return {
    v: SAVE_VERSION,
    levels: {},
    settings: { sfx: true, music: true, vibrate: true, moveMetric: 'moves' },
    tutorialDone: false,
    dirty: false,
  };
}

/** 严格数值解析：仅接受有限数字或纯数字字符串，其余（含 null/undefined/''/NaN）返回 null */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 顶层结构识别：只认「看起来像我们的存档」的四个关键字段。
 * 数组（typeof 'object'）、null、以及完全无关的 JSON 都会被挡下。
 *
 * 注意这里**不**校验子字段类型 —— 损坏的子字段交给 sanitize 逐项清洗，
 * 否则一个空 settings 就会把整个存档判死、丢掉全部通关进度（已踩过）。
 */
function isSaveLike(v: unknown): v is Partial<SaveV1> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const s = v as Partial<SaveV1>;
  if (s.v !== SAVE_VERSION) return false;
  if (!s.levels || typeof s.levels !== 'object' || Array.isArray(s.levels)) return false;
  if (!s.settings || typeof s.settings !== 'object' || Array.isArray(s.settings)) return false;
  return true;
}

/** 解析存档；损坏或版本不匹配一律安全重置为全新存档 */
export function parseSave(raw: string | null | undefined): SaveV1 {
  // 空串 / null / undefined 一律视为"无存档"，不视作"损坏"
  if (raw === null || raw === undefined || raw.trim() === '') return createEmptySave();
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return createEmptySave();
  }
  if (!isSaveLike(obj)) return createEmptySave();
  // 补全可能缺失或非法的字段（向前兼容 + 逐项清洗）
  const s = obj as Partial<SaveV1>;
  const settings = (s.settings ?? {}) as Partial<SaveSettings>;
  return {
    v: SAVE_VERSION,
    levels: sanitizeProgress((s.levels ?? {}) as Record<string, LevelProgress>),
    settings: {
      sfx: settings.sfx !== false,
      music: settings.music !== false,
      vibrate: settings.vibrate !== false,
      moveMetric: settings.moveMetric === 'cells' ? 'cells' : 'moves',
    },
    tutorialDone: s.tutorialDone === true,
    current: sanitizeSession(s.current),
    dirty: s.dirty === true,
  };
}

function sanitizeProgress(levels: Record<string, LevelProgress>): Record<string, LevelProgress> {
  const out: Record<string, LevelProgress> = {};
  for (const [k, v] of Object.entries(levels ?? {})) {
    if (!v || typeof v !== 'object') continue;
    // 用 toNumber 而非 Number()：Number('') 与 Number(null) 都是 0，
    // 会把"字段根本不存在"伪装成合法值，属于静默数据污染。
    const stars = toNumber((v as any).stars);
    const bestMoves = toNumber((v as any).bestMoves);
    if (stars === null || bestMoves === null) continue;
    out[k] = {
      stars: Math.max(0, Math.min(3, Math.floor(stars))),
      bestMoves: Math.max(0, Math.floor(bestMoves)),
      bestCells: Math.max(0, Math.floor(toNumber((v as any).bestCells) ?? 0)),
      clearedAt: Math.max(0, Math.floor(toNumber((v as any).clearedAt) ?? 0)),
    };
  }
  return out;
}

function sanitizeSession(s: unknown): CurrentSession | undefined {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return undefined;
  const cur = s as Partial<CurrentSession>;
  if (typeof cur.levelId !== 'string' || cur.levelId === '') return undefined;
  if (!Array.isArray(cur.moves)) return undefined;
  const moves: Move[] = [];
  for (const m of cur.moves) {
    if (!m || typeof m !== 'object') continue;
    const mv = m as Partial<Move>;
    if (typeof mv.piece !== 'string') continue;
    if (mv.dir !== 'up' && mv.dir !== 'down' && mv.dir !== 'left' && mv.dir !== 'right') continue;
    const cells = toNumber(mv.cells);
    if (cells === null || cells < 1) continue;
    moves.push({ piece: mv.piece, dir: mv.dir, cells: Math.floor(cells) });
  }
  return { levelId: cur.levelId, moves, startedAt: toNumber(cur.startedAt) ?? 0 };
}

// ---------------------------------------------------------------- 解锁规则

/**
 * 关卡解锁：第一关恒解锁；其余关卡要求**上一关已通关**。
 * 之所以按 index 顺序而非 pack 分组：本轮采用顺序推进，与最小可用方案一致。
 */
export function isUnlocked(save: SaveV1, levels: readonly Level[], levelId: string): boolean {
  const i = levels.findIndex((l) => l.id === levelId);
  if (i <= 0) return i === 0;
  const prev = levels[i - 1];
  return save.levels[prev.id] !== undefined;
}

export function unlockedCount(save: SaveV1, levels: readonly Level[]): number {
  let n = 0;
  for (let i = 0; i < levels.length; i++) {
    if (i === 0 || save.levels[levels[i - 1].id]) n++;
    else break;
  }
  return n;
}

// ---------------------------------------------------------------- 记录成绩

export interface ClearResult {
  isNewBestMoves: boolean;
  isNewBestCells: boolean;
  prevStars: number;
}

/**
 * 记录一次通关。取"更优值"合并，绝不因重玩变差。
 * 注意：par 由求解器离线算出，客户端**不得**自行推算 par 后写入存档。
 */
export function recordClear(
  save: SaveV1,
  level: Level,
  moves: number,
  cells: number,
  stars: number,
  now: number,
): ClearResult {
  const prev = save.levels[level.id];
  const isNewBestMoves = !prev || moves < prev.bestMoves;
  const isNewBestCells = !prev || cells < prev.bestCells;
  save.levels[level.id] = {
    stars: Math.max(prev?.stars ?? 0, stars),
    bestMoves: prev ? Math.min(prev.bestMoves, moves) : moves,
    bestCells: prev ? Math.min(prev.bestCells, cells) : cells,
    clearedAt: now,
  };
  save.dirty = true;
  return { isNewBestMoves, isNewBestCells, prevStars: prev?.stars ?? 0 };
}

/** 解锁数量变化后，第一关永远可玩 */
export function totalStars(save: SaveV1): number {
  let n = 0;
  for (const v of Object.values(save.levels)) n += v.stars;
  return n;
}

// ---------------------------------------------------------------- 双端合并

/** 双端存档合并：逐关取更优值（步数更少、星级更高），避免互相覆盖 */
export function mergeProgress(a: SaveV1, b: SaveV1): SaveV1 {
  const out = createEmptySave();
  const ids = new Set([...Object.keys(a.levels), ...Object.keys(b.levels)]);
  for (const id of ids) {
    const pa = a.levels[id];
    const pb = b.levels[id];
    if (!pa) out.levels[id] = { ...pb! };
    else if (!pb) out.levels[id] = { ...pa };
    else {
      out.levels[id] = {
        stars: Math.max(pa.stars, pb.stars),
        bestMoves: Math.min(pa.bestMoves, pb.bestMoves),
        bestCells: Math.min(pa.bestCells, pb.bestCells),
        clearedAt: Math.max(pa.clearedAt, pb.clearedAt),
      };
    }
  }
  out.tutorialDone = a.tutorialDone || b.tutorialDone;
  out.current = a.current ?? b.current;
  out.settings = { ...b.settings };
  out.dirty = a.dirty || b.dirty;
  return out;
}
