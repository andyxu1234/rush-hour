import { describe, expect, it } from 'vitest';
import { Board, H, RED_ID, V, type Piece } from '../src/index';

const P = (id: string, dir: 'H' | 'V', len: 2 | 3, r: number, c: number): Piece => ({
  id,
  dir,
  len,
  r,
  c,
});

describe('走子生成（规则层红线）', () => {
  it('横车前方有 2 个空位 → 该方向产出 2 个独立候选（滑 1 格 / 滑 2 格）', () => {
    // 红车 (2,0)-(2,1)，右侧 2..5 全空
    const board = new Board([
      P(RED_ID, H, 2, 2, 0),
      P('a', V, 2, 0, 0),
      P('b', V, 2, 0, 5),
    ]);
    const rights = board.genMoves(board.start).filter((m) => m.pieceId === RED_ID && m.dir === 'right');
    expect(rights.map((m) => m.cells).sort()).toEqual([1, 2, 3, 4]);
    // 每个候选状态互不相同，且绝不能只给"滑到底"
    const keys = new Set(rights.map((m) => board.key(m.next)));
    expect(keys.size).toBe(rights.length);
  });

  it('紧邻另一辆车 → 该方向 0 候选', () => {
    // 红车 (2,0)-(2,1)；竖车 a 在 (0,2)-(1,2)，再放一辆横车把 (2,2) 占住
    const board = new Board([
      P(RED_ID, H, 2, 2, 0),
      P('a', H, 2, 2, 2),
      P('b', V, 2, 0, 5),
    ]);
    const rights = board.genMoves(board.start).filter((m) => m.pieceId === RED_ID && m.dir === 'right');
    expect(rights).toHaveLength(0);
    expect(board.maxSlide(board.start, 0, 'right')).toBe(0);
  });

  it('竖车：向下 2 空位 → 2 候选；向上被阻 → 0 候选', () => {
    // 红车 (2,4)-(2,5)；竖车 a 在 (0,0)-(1,0)，其下方 2..5 行全空 → 可下滑 4 格
    const board = new Board([P(RED_ID, H, 2, 2, 4), P('a', V, 2, 0, 0)]);
    const ai = 1; // 红车排序后仍在 0，a 在 1
    const downs = board.genMoves(board.start).filter((m) => m.pieceIndex === ai && m.dir === 'down');
    expect(downs.map((m) => m.cells)).toEqual([1, 2, 3, 4]);
    expect(board.maxSlide(board.start, ai, 'up')).toBe(0); // 已贴顶边
    // 竖车不能左右移动
    expect(board.maxSlide(board.start, ai, 'left')).toBe(0);
    expect(board.maxSlide(board.start, ai, 'right')).toBe(0);
  });

  it('竖车向下恰好 2 空位 → 2 候选', () => {
    // 竖车 b 占 (0,1)-(1,1)：下方 (2,1)(3,1) 空、(4,1) 被横车 c 占住 → 恰好 2 格
    const board = new Board([
      P(RED_ID, H, 2, 2, 4),
      P('b', V, 2, 0, 1),
      P('c', H, 2, 4, 0),
      P('d', H, 2, 5, 2),
    ]);
    const bi = 1;
    const downs = board.genMoves(board.start).filter((m) => m.pieceIndex === bi && m.dir === 'down');
    expect(downs.map((m) => m.cells)).toEqual([1, 2]);
    // 向上贴顶边 → 0
    expect(board.maxSlide(board.start, bi, 'up')).toBe(0);
  });

  it('贴边 + 前方被顶住 → 该方向 0 候选', () => {
    // 竖车 a 占 (2,2)-(3,2)，正好顶住红车右侧 → 向右 0 格
    const board = new Board([P(RED_ID, H, 2, 2, 0), P('a', V, 2, 2, 2)]);
    expect(board.maxSlide(board.start, 0, 'left')).toBe(0); // 左贴边
    expect(board.maxSlide(board.start, 0, 'up')).toBe(0);
    expect(board.maxSlide(board.start, 0, 'down')).toBe(0);
    expect(board.maxSlide(board.start, 0, 'right')).toBe(0); // 被 a 顶住
  });

  it('竖车向上/向下被顶住 → 0 候选', () => {
    // 竖车 a 占 (2,1)-(3,1)：上方 (1,1) 被横车 b 占；(4,1) 被横车 c 占 → 两个方向都 0
    const board = new Board([
      P(RED_ID, H, 2, 2, 4),
      P('a', V, 2, 2, 1),
      P('b', H, 2, 1, 0),
      P('c', H, 2, 4, 0),
    ]);
    const ai = 1;
    expect(board.maxSlide(board.start, ai, 'up')).toBe(0);
    expect(board.maxSlide(board.start, ai, 'down')).toBe(0);
  });

  it('贴边且前方全空 → 滑到边界为止', () => {
    // 红车 (2,0)-(2,1)，其余车辆不占出口行 → 向右 4 格；向左贴边 0 格
    const board = new Board([P(RED_ID, H, 2, 2, 0), P('a', V, 2, 0, 5)]);
    expect(board.maxSlide(board.start, 0, 'left')).toBe(0);
    expect(board.maxSlide(board.start, 0, 'right')).toBe(4);
  });

  it('红车滑到 (2,4) → isGoal 为 true；滑到 (2,3) → false', () => {
    const board = new Board([P(RED_ID, H, 2, 2, 0), P('a', V, 2, 0, 0)]);
    const at4 = board.apply(board.start, RED_ID, 'right', 4)!;
    expect(board.isGoal(at4)).toBe(true);
    expect(board.validateState(at4)).toBe(true);
    const at3 = board.apply(board.start, RED_ID, 'right', 3)!;
    expect(board.isGoal(at3)).toBe(false);
  });

  it('越过滑动上限的移动被拒绝（返回 null）', () => {
    const board = new Board([P(RED_ID, H, 2, 2, 0), P('a', H, 2, 2, 2)]);
    expect(board.apply(board.start, RED_ID, 'right', 1)).toBeNull();
    expect(board.apply(board.start, RED_ID, 'right', 1)).toBeNull();
  });

  it('状态键编码无歧义（不复用十进制拼接）', () => {
    const board = new Board([P(RED_ID, H, 2, 2, 0), P('a', V, 3, 0, 4)]);
    const s1 = board.apply(board.start, RED_ID, 'right', 1)!;
    const s2 = board.apply(board.start, 'a', 'down', 1)!;
    expect(board.key(s1)).not.toBe(board.key(s2));
  });

  it('genMoves 产出的每个候选都满足状态不变式', () => {
    const board = new Board([
      P(RED_ID, H, 2, 2, 0),
      P('a', V, 3, 0, 2),
      P('b', H, 2, 5, 3),
      P('c', V, 2, 3, 4),
    ]);
    for (const m of board.genMoves(board.start)) {
      expect(board.validateState(m.next)).toBe(true);
      expect(m.cells).toBeGreaterThanOrEqual(1);
    }
  });
});
