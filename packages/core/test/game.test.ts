import { describe, expect, it } from 'vitest';
import { Game, H, RED_ID, Solver, V, violatesTheorem2, type Level, type Move, type Piece } from '../src/index';

const P = (id: string, dir: 'H' | 'V', len: 2 | 3, r: number, c: number): Piece => ({
  id,
  dir,
  len,
  r,
  c,
});

function mkLevel(pieces: Piece[], moves: number, cellSteps = moves, id = 'x01'): Level {
  return {
    id,
    pack: 'test',
    name: 'test',
    difficulty: 'starter',
    par: { moves, cellSteps },
    stars: { three: moves, two: moves + 2, one: 0 },
    pieces,
  };
}

describe('对局状态机', () => {
  const simple = mkLevel([P(RED_ID, H, 2, 2, 0), P('a', V, 2, 0, 0)], 4);

  it('步数 === moves.length 恒等', () => {
    const g = new Game(simple);
    expect(g.steps).toBe(0);
    g.move({ piece: RED_ID, dir: 'right', cells: 1 });
    expect(g.steps).toBe(1);
    expect(g.steps).toBe(g.moves.length);
    g.move({ piece: RED_ID, dir: 'right', cells: 2 });
    expect(g.steps).toBe(2);
    expect(g.steps).toBe(g.moves.length);
  });

  it('连续移动 5 次撤销 5 次 → 回初始局面且步数归零', () => {
    // 用「长车 a」与红车交替走子：a 竖直 3 格有足够腾挪空间，
    // 且红车走满 4 格即通关 → 每步都走 1 格以确保共 5 步不成关
    const lvl = mkLevel([
      P(RED_ID, H, 2, 2, 0),
      P('a', V, 3, 0, 5),
    ], 6);
    const g = new Game(lvl);
    const startKey = g.board.key(g.board.start);
    expect(g.move({ piece: RED_ID, dir: 'right', cells: 1 })).toBe(true);
    expect(g.move({ piece: 'a', dir: 'down', cells: 1 })).toBe(true);
    expect(g.move({ piece: RED_ID, dir: 'right', cells: 1 })).toBe(true);
    expect(g.move({ piece: 'a', dir: 'up', cells: 1 })).toBe(true);
    expect(g.move({ piece: RED_ID, dir: 'right', cells: 1 })).toBe(true);
    expect(g.steps).toBe(5);
    expect(g.cellSteps).toBe(5);
    for (let i = 0; i < 5; i++) expect(g.undo()).toBe(true);
    expect(g.steps).toBe(0);
    expect(g.board.key(g.state)).toBe(startKey);
    expect(g.cellSteps).toBe(0);
  });

  it('撤销后重做 → 局面完全一致', () => {
    const g = new Game(simple);
    g.move({ piece: RED_ID, dir: 'right', cells: 2 });
    g.move({ piece: RED_ID, dir: 'left', cells: 1 });
    const before = g.board.key(g.state);
    const stepsBefore = g.steps;
    g.undo();
    g.undo();
    expect(g.steps).toBe(0);
    g.redo();
    g.redo();
    expect(g.board.key(g.state)).toBe(before);
    expect(g.steps).toBe(stepsBefore);
  });

  it('撤销 0 次再撤销 → 无副作用', () => {
    const g = new Game(simple);
    expect(g.undo()).toBe(false);
    expect(g.steps).toBe(0);
    expect(g.canRedo).toBe(false);
    expect(g.board.key(g.state)).toBe(g.board.key(g.board.start));
  });

  it('非法移动不计步、不改局面', () => {
    const g = new Game(simple);
    // 红车右侧 2..5 空，向右最多 4 格；向左已贴边 → 非法
    expect(g.move({ piece: RED_ID, dir: 'left', cells: 1 })).toBe(false);
    expect(g.steps).toBe(0);
    expect(g.move({ piece: RED_ID, dir: 'right', cells: 5 })).toBe(false);
    expect(g.steps).toBe(0);
    // 横车不能上下
    expect(g.move({ piece: RED_ID, dir: 'up', cells: 1 })).toBe(false);
    expect(g.steps).toBe(0);
  });

  /**
   * 撤销后的 solved 语义（**曾经写反过，务必看清**）。
   *
   * 正确语义：`solved` 描述的是**当前局面**是否已通关，而不是"本关是否拿到过成绩"。
   * 成绩的持久化由 `recordClear()` 在 solve 时写入存档负责，与 `solved` 无关。
   *
   * 早期实现让 solved 在撤销后保持 true，后果是两个真实故障：
   *   1. `move()` / `redo()` 开头都有 `if (this._solved) return false`，
   *      玩家通关后一撤销就被彻底锁死，怎么拖都不动；
   *   2. 提示功能（game-screen 的 useHint）开头也是 `if (this.game.solved) return`，
   *      点"提示"完全没反应。
   * 因此撤销必须清掉 solved，让局面重新可操作。
   */
  it('通关后撤销 → solved 复位（局面重新可操作），但步数归零', () => {
    const g = new Game(simple);
    // ★ 关键：一次滑动无论几格都算 1 步，不是 4 步
    g.move({ piece: RED_ID, dir: 'right', cells: 4 });
    expect(g.solved).toBe(true);
    expect(g.steps).toBe(1);
    expect(g.cellSteps).toBe(4);
    expect(g.computeStars()).toBe(3);

    g.undo();
    expect(g.solved, '撤销后局面已非通关态，solved 必须复位').toBe(false);
    expect(g.steps).toBe(0);
    expect(g.cellSteps).toBe(0);
    // 局面重新可操作：能再走一步并再次通关
    expect(g.move({ piece: RED_ID, dir: 'right', cells: 4 })).toBe(true);
    expect(g.solved).toBe(true);
  });

  it('par 判定用「滑动次数」而非「滑动格数」（回归：1 步关不等于 4 步关）', () => {
    // t01 的真实形态：红车 (2,3)，向右滑 1 格即通关 → par.moves = 1
    const lvl = mkLevel([P(RED_ID, H, 2, 2, 3), P('a', V, 2, 0, 0)], 1, 1);
    const g = new Game(lvl);
    g.move({ piece: RED_ID, dir: 'right', cells: 1 });
    expect(g.steps).toBe(1);
    expect(g.cellSteps).toBe(1);
    expect(g.computeStars()).toBe(3);
  });

  it('reset 清空走子与成绩', () => {
    const g = new Game(simple);
    g.move({ piece: RED_ID, dir: 'right', cells: 4 });
    g.reset();
    expect(g.steps).toBe(0);
    expect(g.solved).toBe(false);
    expect(g.canUndo).toBe(false);
    expect(g.cellSteps).toBe(0);
  });

  it('星级：恰好 par → 3 星；par+2 → 2 星；更多 → 1 星', () => {
    const lvl = mkLevel([P(RED_ID, H, 2, 2, 0), P('a', V, 2, 0, 0)], 4);
    const g = new Game(lvl);
    g.loadMoves([{ piece: RED_ID, dir: 'right', cells: 4 }]);
    // 4 步 par 但这里只用了 1 步 → 仍按 <= three 判 3 星
    expect(g.computeStars()).toBe(3);

    const lvl2 = mkLevel([P(RED_ID, H, 2, 2, 0), P('a', V, 2, 0, 0)], 2, 2);
    const g2 = new Game(lvl2);
    g2.loadMoves([{ piece: RED_ID, dir: 'right', cells: 4 }]);
    expect(g2.steps).toBe(1);
    expect(g2.computeStars()).toBe(3);
  });

  it('loadMoves 遇到损坏走子时停在上一个合法状态，不崩', () => {
    const g = new Game(simple);
    const bad: Move[] = [
      { piece: RED_ID, dir: 'right', cells: 1 },
      { piece: 'ghost', dir: 'right', cells: 1 },
      { piece: RED_ID, dir: 'right', cells: 1 },
    ];
    g.loadMoves(bad);
    expect(g.steps).toBe(1);
    expect(g.board.validateState(g.state)).toBe(true);
  });

  it('事件顺序：move → solve，非法移动发 blocked', () => {
    const g = new Game(simple);
    const seen: string[] = [];
    g.on((e) => seen.push(e.type));
    g.move({ piece: RED_ID, dir: 'right', cells: 1 });
    g.move({ piece: RED_ID, dir: 'left', cells: 9 });
    g.move({ piece: RED_ID, dir: 'right', cells: 3 });
    expect(seen).toEqual(['move', 'blocked', 'move', 'solve']);
  });

  it('hint() 从任意中间局面都能给出最优下一步', () => {
    const lvl = mkLevel([P(RED_ID, H, 2, 2, 0), P('a', V, 2, 2, 3), P('b', H, 2, 4, 0)], 2);
    const { solver } = Solver.solve(lvl.pieces);
    const g = new Game(lvl, { solver });
    expect(g.remaining).toBe(2);
    const h = g.hint()!;
    expect(h).not.toBeNull();
    expect(g.move(h)).toBe(true);
    expect(g.remaining).toBe(1);
    const h2 = g.hint()!;
    expect(g.move(h2)).toBe(true);
    expect(g.solved).toBe(true);
  });

  it('无求解器时 hint/remaining 安全返回 null', () => {
    const g = new Game(simple);
    expect(g.hint()).toBeNull();
    expect(g.remaining).toBeNull();
  });

  it('定理 2 校验：出口行红车右侧有横车 → 违规', () => {
    expect(violatesTheorem2([P(RED_ID, H, 2, 2, 0), P('a', H, 2, 2, 3)])).toBe(true);
    expect(violatesTheorem2([P(RED_ID, H, 2, 2, 0), P('a', H, 2, 3, 0)])).toBe(false);
    expect(violatesTheorem2([P(RED_ID, H, 2, 2, 0), P('a', V, 2, 2, 3)])).toBe(false); // 竖车不算
  });
});
