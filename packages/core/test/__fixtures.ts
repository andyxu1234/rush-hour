import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseLevelPack, type Level, type LevelPack } from '../src/index';

const root = fileURLToPath(new URL('../../../', import.meta.url));

function load(rel: string): unknown {
  return JSON.parse(readFileSync(root + rel, 'utf8'));
}

/** 客户端关卡包（不含解答） */
export function loadClientPack(): LevelPack {
  return parseLevelPack(load('data/levels.json'));
}

export interface VerifiedLevel extends Level {
  solution: Array<{ piece: string; dir: string; cells: number }>;
}

/**
 * 含解答的校验包（仅测试使用，绝不进包）。
 * 注意：本题材里 levels.verify.json 与 levels.json 的 t03/t04 并不同源
 * （见 levels.verify.test.ts 顶部说明），因此这里独立解析、独立使用。
 */
export function loadVerifyPack(): { schemaVersion: number; levels: VerifiedLevel[] } {
  const raw = load('data/levels.verify.json') as {
    schemaVersion: number;
    levels: any[];
  };
  return {
    schemaVersion: raw.schemaVersion,
    levels: raw.levels.map((l) => ({
      id: l.id,
      pack: l.pack,
      name: l.name,
      difficulty: l.difficulty,
      par: { moves: l.par.moves, cellSteps: l.par.cellSteps },
      stars: l.stars,
      pieces: l.pieces.map((p: any) => ({
        id: String(p.id),
        dir: p.dir === 'V' ? 'V' : 'H',
        len: p.len === 3 ? 3 : 2,
        r: Number(p.r),
        c: Number(p.c),
      })),
      metrics: l.metrics,
      solution: l.solution ?? [],
    })),
  };
}

export function loadLevels(): Level[] {
  return loadClientPack().levels;
}
