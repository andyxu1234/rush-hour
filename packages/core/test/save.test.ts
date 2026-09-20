import { describe, expect, it } from 'vitest';
import {
  createEmptySave,
  isUnlocked,
  mergeProgress,
  parseSave,
  recordClear,
  totalStars,
  unlockedCount,
  type Level,
} from '../src/index';
import { loadLevels } from './__fixtures';

describe('存档层', () => {
  const levels = loadLevels();

  it('空存档 → 仅第一关解锁', () => {
    const save = createEmptySave();
    expect(isUnlocked(save, levels, levels[0].id)).toBe(true);
    expect(isUnlocked(save, levels, levels[1].id)).toBe(false);
    expect(unlockedCount(save, levels)).toBeLessThanOrEqual(1);
  });

  it('通关第一关 → 第二关解锁并记录星级', () => {
    const save = createEmptySave();
    const r = recordClear(save, levels[0], 1, 1, 3, 1000);
    expect(r.isNewBestMoves).toBe(true);
    expect(save.levels[levels[0].id]).toEqual({
      stars: 3,
      bestMoves: 1,
      bestCells: 1,
      clearedAt: 1000,
    });
    expect(isUnlocked(save, levels, levels[1].id)).toBe(true);
    expect(save.dirty).toBe(true);
  });

  it('重玩变差时不覆盖更优记录', () => {
    const save = createEmptySave();
    recordClear(save, levels[0], 1, 1, 3, 1000);
    const r = recordClear(save, levels[0], 5, 9, 1, 2000);
    expect(r.isNewBestMoves).toBe(false);
    expect(save.levels[levels[0].id].bestMoves).toBe(1);
    expect(save.levels[levels[0].id].bestCells).toBe(1);
    expect(save.levels[levels[0].id].stars).toBe(3);
  });

  it('存档 JSON 损坏 → 安全降级为全新存档，不崩', () => {
    expect(parseSave('{{{not json')).toEqual(createEmptySave());
    expect(parseSave('null')).toEqual(createEmptySave());
    expect(parseSave('{"v":99}')).toEqual(createEmptySave());
    expect(parseSave('')).toEqual(createEmptySave());
    expect(parseSave('   ')).toEqual(createEmptySave());
    expect(parseSave('[1,2,3]')).toEqual(createEmptySave());
  });

  it('版本号不匹配 → 安全重置', () => {
    const bad = JSON.stringify({ v: 2, levels: {}, settings: {}, tutorialDone: false });
    expect(parseSave(bad).v).toBe(1);
    expect(parseSave(bad).levels).toEqual({});
  });

  it('部分字段缺失/非法 → 逐字段清洗且不崩', () => {
    const raw = JSON.stringify({
      v: 1,
      levels: {
        t01: { stars: 99, bestMoves: 3, bestCells: '1', clearedAt: 7 },
        t02: { stars: 1, bestMoves: -3, bestCells: 0, clearedAt: 0 }, // 负步数被夹到 0
        bad: null, // 非对象 → 丢弃
        bad2: { stars: 'abc' }, // 星级非法 → 丢弃，避免污染解锁判断
      },
      settings: {},
      tutorialDone: 'yes',
      current: { levelId: 't01', moves: [{ piece: 'R', dir: 'sideways', cells: 0 }] },
    });
    const save = parseSave(raw);
    expect(save.levels.t01).toEqual({ stars: 3, bestMoves: 3, bestCells: 1, clearedAt: 7 });
    expect(save.levels.t02).toEqual({ stars: 1, bestMoves: 0, bestCells: 0, clearedAt: 0 });
    expect(save.levels.bad).toBeUndefined();
    expect(save.levels.bad2).toBeUndefined();
    expect(save.tutorialDone).toBe(false);
    expect(save.current?.moves).toEqual([]);
    expect(save.settings.sfx).toBe(true);
  });

  it('顶层结构识别失败 → 整体重置（数组、无关 JSON、缺 levels）', () => {
    expect(parseSave('[1,2,3]')).toEqual(createEmptySave());
    expect(parseSave('{"hello":"world"}')).toEqual(createEmptySave());
    expect(parseSave('{"v":1,"settings":{}}')).toEqual(createEmptySave()); // 缺 levels
  });

  it('子字段损坏但结构完好 → 保留合法进度，只清洗坏项', () => {
    const raw = JSON.stringify({
      v: 1,
      levels: { t01: { stars: 3, bestMoves: 1, bestCells: 1, clearedAt: 5 }, broken: 42 },
      settings: {},
      tutorialDone: false,
    });
    const save = parseSave(raw);
    expect(save.levels.t01?.bestMoves).toBe(1);
    expect(save.levels.broken).toBeUndefined();
    expect(save.settings.music).toBe(true);
  });

  it('parseSave(null) → 全新存档', () => {
    expect(parseSave(null)).toEqual(createEmptySave());
  });

  it('mergeProgress 双端合并取更优值', () => {
    const a = createEmptySave();
    const b = createEmptySave();
    recordClear(a, levels[0], 1, 5, 3, 100);
    recordClear(b, levels[0], 2, 3, 2, 200);
    const m = mergeProgress(a, b);
    expect(m.levels[levels[0].id]).toEqual({
      stars: 3,
      bestMoves: 1, // 取更少步数
      bestCells: 3, // 取更少格数
      clearedAt: 200,
    });
  });

  it('mergeProgress 单侧缺失时直接采用另一侧', () => {
    const a = createEmptySave();
    const b = createEmptySave();
    recordClear(a, levels[0], 1, 1, 3, 1);
    const m = mergeProgress(a, b);
    expect(m.levels[levels[0].id].bestMoves).toBe(1);
    expect(m.tutorialDone).toBe(false);
  });

  it('totalStars 累加全部星级', () => {
    const save = createEmptySave();
    recordClear(save, levels[0], 1, 1, 3, 1);
    recordClear(save, levels[1], 2, 5, 2, 2);
    expect(totalStars(save)).toBe(5);
  });

  it('解锁数量随进度递增', () => {
    const save = createEmptySave();
    const before = unlockedCount(save, levels);
    recordClear(save, levels[0], 1, 1, 3, 1);
    expect(unlockedCount(save, levels)).toBeGreaterThan(before);
  });

  it('存档体积远小于 8KB', () => {
    const save = createEmptySave();
    for (const l of levels as Level[]) recordClear(save, l, l.par.moves, l.par.cellSteps, 3, Date.now());
    expect(JSON.stringify(save).length).toBeLessThan(8 * 1024);
  });
});
