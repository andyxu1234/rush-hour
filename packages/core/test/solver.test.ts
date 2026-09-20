import { describe, expect, it } from 'vitest';
import { Board, H, RED_ID, Solver, V, minCellSteps, type Piece } from '../src/index';
import { loadVerifyPack } from './__fixtures';

const P = (id: string, dir: 'H' | 'V', len: 2 | 3, r: number, c: number): Piece => ({
  id,
  dir,
  len,
  r,
  c,
});

describe('求解层', () => {
  it('1 步关 → minMoves === 1', () => {
    const { solver } = Solver.solve([P(RED_ID, H, 2, 2, 3), P('a', V, 2, 0, 0)]);
    expect(solver.solvable).toBe(true);
    expect(solver.minMoves).toBe(1);
  });

  it('2 步关 → minMoves === 2', () => {
    // 红车 (2,0)-(2,1)，竖车 a 在 (2,3)；先下移 a 再右开
    const { solver } = Solver.solve([
      P(RED_ID, H, 2, 2, 0),
      P('a', V, 2, 2, 3),
      P('b', H, 2, 4, 0),
    ]);
    expect(solver.minMoves).toBe(2);
  });

  it('回归：distGoal 覆盖初始状态，min(distGoal) 恒为 0 的坑已被规避', () => {
    const { solver } = Solver.solve([P(RED_ID, H, 2, 2, 3), P('a', V, 2, 0, 0)]);
    // distGoal 含初始状态且其值必然 > 0
    const startGoalDist = solver.distGoal.get(solver.board.key(solver.board.start));
    expect(startGoalDist).toBe(1);
    // 若错误地对 distGoal 取 min 会得到 0；正确实现必须为 1
    expect(Math.min(...solver.distGoal.values())).toBe(0); // 目标态自身为 0
    expect(solver.minMoves).toBe(1);
  });

  it('不可解关（违反定理 2：出口行右侧有横车）→ 返回不可解，不抛异常不死循环', () => {
    const { solver } = Solver.solve([
      P(RED_ID, H, 2, 2, 0),
      P('a', H, 2, 2, 3), // 出口行红车右侧的横车 → 必然不可解
    ]);
    expect(solver.solvable).toBe(false);
    expect(solver.goals).toHaveLength(0);
    expect(Number.isFinite(solver.minMoves)).toBe(false);
    expect(solver.nextOptimalMove(solver.board.start)).toBeNull();
  });

  it('剩余步数随最优走子恰好递减 1（随机模糊 200 次）', () => {
    const pack = loadVerifyPack();
    for (const level of pack.levels) {
      const { solver } = Solver.solve(level.pieces);
      let state = solver.board.cloneState(solver.board.start);
      let guard = 0;
      while (!solver.board.isGoal(state) && guard < 200) {
        guard++;
        const before = solver.remainingMoves(state)!;
        const next = solver.nextOptimalMove(state);
        expect(next, `${level.id} 在剩余 ${before} 步时应能给出提示`).not.toBeNull();
        const applied = solver.board.apply(state, next!.piece, next!.dir, next!.cells);
        expect(applied, `${level.id} 提示的走法必须合法`).not.toBeNull();
        state = applied!;
        const after = solver.remainingMoves(state);
        if (after === null || after !== before - 1) {
          throw new Error(`${level.id}: 剩余步数应为 ${before - 1}，实得 ${after}`);
        }
      }
      expect(solver.board.isGoal(state), `${level.id} 应能走完`).toBe(true);
    }
  });

  it('optimalPathFrom 生成的解长度恰好等于 minMoves', () => {
    const pack = loadVerifyPack();
    for (const level of pack.levels) {
      const { solver } = Solver.solve(level.pieces);
      const path = solver.optimalPathFrom(solver.board.start);
      expect(path, `${level.id} 应存在最优路径`).not.toBeNull();
      expect(path!.length).toBe(solver.minMoves);
      expect(path!.length).toBe(level.par.moves);
    }
  });

  it('minCellSteps 与关卡数据的 cellSteps 一致', () => {
    const pack = loadVerifyPack();
    for (const level of pack.levels) {
      const board = new Board(level.pieces);
      expect(minCellSteps(board), level.id).toBe(level.par.cellSteps);
    }
  });

  it('病态盘面达到搜索上限 → 安全退出不 OOM', () => {
    // 用极小上限强制触发保护分支，验证抛的是我们自己的错误类型而非崩溃
    const pieces = loadVerifyPack().levels[7].pieces;
    expect(() => Solver.solve(pieces, { maxStates: 10 })).toThrowError(/状态空间超过上限/);
  });

  it('验证包里的 solution 序列重放后可通关且步数等于 par', () => {
    const pack = loadVerifyPack();
    for (const level of pack.levels) {
      const board = new Board(level.pieces);
      let state = board.cloneState(board.start);
      for (const m of level.solution) {
        const next = board.apply(state, m.piece, m.dir as any, m.cells);
        expect(next, `${level.id}: 解答中的 ${m.piece} ${m.dir} ${m.cells} 应合法`).not.toBeNull();
        state = next!;
      }
      expect(board.isGoal(state), `${level.id} 解答应抵达目标态`).toBe(true);
      expect(level.solution.length).toBe(level.par.moves);
    }
  });
});
