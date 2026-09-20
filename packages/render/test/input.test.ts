import { describe, expect, it } from 'vitest';
import { Board, H, RED_ID, V, type Piece } from '@rush-hour/core';
import { InputController, type InputIntent } from '../src/input';
import type { PointerEventLike } from '@rush-hour/platform';
import { computeLayout, hudButtons } from '../src/layout';

const P = (id: string, dir: 'H' | 'V', len: 2 | 3, r: number, c: number): Piece => ({
  id,
  dir,
  len,
  r,
  c,
});

/**
 * 构造测试棋盘：
 *   红车 (2,0)-(2,1)  —— 右侧 2..5 全空 → 可右滑 4 格；左侧贴边 → 左滑 0 格
 *   竖车 a (3,5)-(5,5) —— 不占出口行，因此不会挡住红车
 */
function makeHost() {
  const board = new Board([P(RED_ID, H, 2, 2, 0), P('a', V, 3, 3, 5)]);
  const layout = computeLayout(375, 667);
  const occupied = (x: number, y: number) => {
    // 直接复用游戏屏同样的 36 格查表
    const gc = Math.floor((x - layout.boardX) / layout.cell);
    const gr = Math.floor((y - layout.boardY) / layout.cell);
    if (gr < 0 || gr > 5 || gc < 0 || gc > 5) return null;
    for (let i = 0; i < board.pieces.length; i++) {
      const p = board.pieces[i];
      if (p.dir === H) {
        if (p.r === gr && gc >= p.c && gc < p.c + p.len) return { id: p.id, index: i };
      } else if (p.c === gc && gr >= p.r && gr < p.r + p.len) {
        return { id: p.id, index: i };
      }
    }
    return null;
  };
  const host = {
    layout,
    board,
    state: board.start,
    pieceAt: occupied,
    buttons: () => hudButtons(layout),
    dialogOpen: () => false,
  };
  const intents: InputIntent[] = [];
  const longPresses: string[] = [];
  const ctrl = new InputController(host as any, {
    onIntent: (i) => intents.push(i),
    onLongPress: (id) => longPresses.push(id),
  });
  return { ctrl, intents, longPresses, layout, board };
}

/** 格子中心 → 像素 */
function center(layout: ReturnType<typeof computeLayout>, r: number, c: number) {
  return {
    x: layout.boardX + (c + 0.5) * layout.cell,
    y: layout.boardY + (r + 0.5) * layout.cell,
  };
}

function pt(x: number, y: number, phase: PointerEventLike['phase'], time = 0): PointerEventLike {
  return { x, y, phase, pointerId: 1, time };
}

function lastRelease(intents: InputIntent[]) {
  const r = intents.filter((i) => i.type === 'release');
  return r[r.length - 1] as Extract<InputIntent, { type: 'release' }>;
}

describe('输入层（吸附与回弹）', () => {
  it('拖拽不足 0.5 格松手 → cells=0（回弹，不计步）', () => {
    const { ctrl, intents, layout } = makeHost();
    const from = center(layout, 2, 0);
    ctrl.handle(pt(from.x, from.y, 'start'));
    ctrl.handle(pt(from.x + layout.cell * 0.3, from.y, 'move'));
    ctrl.handle(pt(from.x + layout.cell * 0.3, from.y, 'end'));
    expect(lastRelease(intents).cells).toBe(0);
  });

  it('拖拽 1 格 → cells=1', () => {
    const { ctrl, intents, layout } = makeHost();
    const from = center(layout, 2, 0);
    ctrl.handle(pt(from.x, from.y, 'start'));
    ctrl.handle(pt(from.x + layout.cell, from.y, 'move'));
    ctrl.handle(pt(from.x + layout.cell, from.y, 'end'));
    const rel = lastRelease(intents);
    expect(rel.dir).toBe('right');
    expect(rel.cells).toBe(1);
  });

  it('拖拽 3.4 格 → 吸附到 3 格', () => {
    const { ctrl, intents, layout } = makeHost();
    const from = center(layout, 2, 0);
    ctrl.handle(pt(from.x, from.y, 'start'));
    ctrl.handle(pt(from.x + layout.cell * 3.4, from.y, 'move'));
    ctrl.handle(pt(from.x + layout.cell * 3.4, from.y, 'end'));
    expect(lastRelease(intents).cells).toBe(3);
  });

  it('拖拽 3.6 格 → 吸附到 4 格（四舍五入）', () => {
    const { ctrl, intents, layout } = makeHost();
    const from = center(layout, 2, 0);
    ctrl.handle(pt(from.x, from.y, 'start'));
    ctrl.handle(pt(from.x + layout.cell * 3.6, from.y, 'move'));
    ctrl.handle(pt(from.x + layout.cell * 3.6, from.y, 'end'));
    expect(lastRelease(intents).cells).toBe(4);
  });

  it('拖拽超出可用距离 → 吸附到最远处（上限 4 格），仍只产出一个 release', () => {
    const { ctrl, intents, layout } = makeHost();
    const from = center(layout, 2, 0);
    ctrl.handle(pt(from.x, from.y, 'start'));
    ctrl.handle(pt(from.x + layout.cell * 12, from.y, 'move'));
    ctrl.handle(pt(from.x + layout.cell * 12, from.y, 'end'));
    const rel = lastRelease(intents);
    expect(rel.cells).toBe(4);
    // 关键：一次拖动只产出一个 release 意图（外部由此只调用一次 Game.move）
    expect(intents.filter((i) => i.type === 'release')).toHaveLength(1);
  });

  it('向左拖但贴边无空位 → cells=0，不计步', () => {
    const { ctrl, intents, layout } = makeHost();
    const from = center(layout, 2, 0);
    ctrl.handle(pt(from.x, from.y, 'start'));
    ctrl.handle(pt(from.x - layout.cell * 2, from.y, 'move'));
    ctrl.handle(pt(from.x - layout.cell * 2, from.y, 'end'));
    const rel = lastRelease(intents);
    expect(rel.dir).toBe('left');
    expect(rel.cells).toBe(0);
  });

  it('横车纵向拖拽 → 只沿横轴生效，纵向位移被忽略', () => {
    const { ctrl, intents, layout } = makeHost();
    const from = center(layout, 2, 0);
    ctrl.handle(pt(from.x, from.y, 'start'));
    // 纯纵向拖动：横车的 deltaCells 应为 0（axis 为 x）
    ctrl.handle(pt(from.x, from.y + layout.cell * 2, 'move'));
    ctrl.handle(pt(from.x, from.y + layout.cell * 2, 'end'));
    expect(lastRelease(intents).cells).toBe(0);
  });

  it('竖车纵向拖拽生效（axis 为 y）', () => {
    const { ctrl, intents, layout } = makeHost();
    // 竖车 a 占 (3,5)-(5,5)：向下已贴底 → 向上可滑 3 格
    const from = center(layout, 3, 5);
    ctrl.handle(pt(from.x, from.y, 'start'));
    ctrl.handle(pt(from.x, from.y - layout.cell * 2, 'move'));
    ctrl.handle(pt(from.x, from.y - layout.cell * 2, 'end'));
    const rel = lastRelease(intents);
    expect(rel.dir).toBe('up');
    expect(rel.cells).toBe(2);
  });

  it('拖拽时连续产生 drag 意图且方向随符号变化', () => {
    const { ctrl, intents, layout } = makeHost();
    const from = center(layout, 2, 0);
    ctrl.handle(pt(from.x, from.y, 'start'));
    ctrl.handle(pt(from.x + layout.cell * 1.2, from.y, 'move'));
    ctrl.handle(pt(from.x - layout.cell * 0.4, from.y, 'move'));
    const drags = intents.filter((i) => i.type === 'drag') as Array<
      Extract<InputIntent, { type: 'drag' }>
    >;
    expect(drags.length).toBeGreaterThanOrEqual(2);
    expect(drags[0].dir).toBe('right');
    expect(drags[drags.length - 1].dir).toBe('left');
  });

  it('长按 800ms → 触发长按回调（用于显示可动方向）', () => {
    const { ctrl, longPresses, layout } = makeHost();
    const from = center(layout, 2, 0);
    ctrl.handle(pt(from.x, from.y, 'start', 1000));
    expect(longPresses).toHaveLength(0);
    ctrl.tick(1000 + 500);
    expect(longPresses).toHaveLength(0);
    ctrl.tick(1000 + 900);
    expect(longPresses).toEqual([RED_ID]);
  });

  it('长按期间一旦移动就不再触发长按', () => {
    const { ctrl, longPresses, layout } = makeHost();
    const from = center(layout, 2, 0);
    ctrl.handle(pt(from.x, from.y, 'start', 0));
    ctrl.handle(pt(from.x + layout.cell, from.y, 'move', 100));
    ctrl.tick(2000);
    expect(longPresses).toHaveLength(0);
  });

  it('点击 HUD 按钮产生 button 意图，不产生 grab', () => {
    const { ctrl, intents, layout } = makeHost();
    const btn = hudButtons(layout)[1]; // 重开
    ctrl.handle(pt(btn.x + btn.w / 2, btn.y + btn.h / 2, 'start'));
    ctrl.handle(pt(btn.x + btn.w / 2, btn.y + btn.h / 2, 'end'));
    expect(intents.some((i) => i.type === 'button' && i.id === 'reset')).toBe(true);
    expect(intents.some((i) => i.type === 'grab')).toBe(false);
  });

  it('弹窗打开时不抓车、不拖拽', () => {
    const { intents, layout, board } = makeHost();
    const c2 = new InputController(
      {
        layout,
        board,
        state: board.start,
        pieceAt: () => ({ id: RED_ID, index: 0 }),
        buttons: () => hudButtons(layout),
        dialogOpen: () => true,
      } as any,
      { onIntent: (i) => intents.push(i), onLongPress: () => undefined },
    );
    const from = center(layout, 2, 0);
    c2.handle(pt(from.x, from.y, 'start'));
    c2.handle(pt(from.x + layout.cell * 2, from.y, 'move'));
    c2.handle(pt(from.x + layout.cell * 2, from.y, 'end'));

    expect(intents.some((i) => i.type === 'grab')).toBe(false);
    expect(intents.some((i) => i.type === 'drag')).toBe(false);
    expect(intents.some((i) => i.type === 'release')).toBe(false);
  });

  it('弹窗打开时轻点会产生 tap（回归：弹窗按钮点不动）', () => {
    const { intents, layout, board } = makeHost();
    const c2 = new InputController(
      {
        layout,
        board,
        state: board.start,
        pieceAt: () => null,
        buttons: () => hudButtons(layout),
        dialogOpen: () => true,
      } as any,
      { onIntent: (i) => intents.push(i), onLongPress: () => undefined },
    );
    // 点弹窗按钮所在位置（画布中部）
    const bx = layout.width / 2;
    const by = layout.height / 2 + layout.boardSize * 0.14;
    c2.handle(pt(bx, by, 'start'));
    c2.handle(pt(bx, by, 'end'));

    const taps = intents.filter((i) => i.type === 'tap');
    expect(taps, '弹窗打开时轻点必须产生 tap，否则按钮永远点不动').toHaveLength(1);
    expect((taps[0] as Extract<InputIntent, { type: 'tap' }>).x).toBeCloseTo(bx, 5);
  });

  it('弹窗打开时按下并轻微移动后松手 → 不产生 tap（避免误触）', () => {
    const { intents, layout, board } = makeHost();
    const c2 = new InputController(
      {
        layout,
        board,
        state: board.start,
        pieceAt: () => null,
        buttons: () => hudButtons(layout),
        dialogOpen: () => true,
      } as any,
      { onIntent: (i) => intents.push(i), onLongPress: () => undefined },
    );
    const bx = layout.width / 2;
    const by = layout.height / 2;
    c2.handle(pt(bx, by, 'start'));
    c2.handle(pt(bx + 40, by + 40, 'move'));
    c2.handle(pt(bx + 40, by + 40, 'end'));
    expect(intents.filter((i) => i.type === 'tap')).toHaveLength(0);
  });

  it('真机级手指抖动（≤12px）仍判定为 tap（回归：真机按钮点不动）', () => {
    const { intents, layout, board } = makeHost();
    const c2 = new InputController(
      {
        layout,
        board,
        state: board.start,
        pieceAt: () => null,
        buttons: () => hudButtons(layout),
        dialogOpen: () => true,
      } as any,
      { onIntent: (i) => intents.push(i), onLongPress: () => undefined },
    );

    // 模拟真实点按：按下后手指轻微漂移 8px（触屏采样 + 手抖的典型量级）
    const bx = layout.width / 2;
    const by = layout.height / 2;
    c2.handle(pt(bx, by, 'start'));
    c2.handle(pt(bx + 6, by + 4, 'move'));
    c2.handle(pt(bx + 8, by + 6, 'end'));

    const taps = intents.filter((i) => i.type === 'tap');
    expect(taps, '轻微抖动不得让 tap 丢失').toHaveLength(1);
  });

  it('手指明显滑动（>24px）不判定为 tap', () => {
    const { intents, layout, board } = makeHost();
    const c2 = new InputController(
      {
        layout,
        board,
        state: board.start,
        pieceAt: () => null,
        buttons: () => hudButtons(layout),
        dialogOpen: () => true,
      } as any,
      { onIntent: (i) => intents.push(i), onLongPress: () => undefined },
    );
    const bx = layout.width / 2;
    const by = layout.height / 2;
    c2.handle(pt(bx, by, 'start'));
    c2.handle(pt(bx + 30, by + 20, 'move'));
    c2.handle(pt(bx + 30, by + 20, 'end'));
    expect(intents.filter((i) => i.type === 'tap')).toHaveLength(0);
  });

  it('棋盘内空白处按下 → 不 grab 车辆', () => {
    const { ctrl, intents, layout } = makeHost();
    // (0,0) 是空白格（红车在 row2，竖车在 col5）
    const from = center(layout, 0, 0);
    ctrl.handle(pt(from.x, from.y, 'start'));
    ctrl.handle(pt(from.x + layout.cell, from.y, 'end'));
    expect(intents.some((i) => i.type === 'grab')).toBe(false);
  });

  it('棋盘外轻点 → 产生 tap 意图', () => {
    const { ctrl, intents, layout } = makeHost();
    ctrl.handle(pt(10, layout.height - 10, 'start'));
    ctrl.handle(pt(11, layout.height - 10, 'end'));
    expect(intents.some((i) => i.type === 'tap')).toBe(true);
  });

  it('cancel 阶段清空拖拽态，不产生 release', () => {
    const { ctrl, intents, layout } = makeHost();
    const from = center(layout, 2, 0);
    ctrl.handle(pt(from.x, from.y, 'start'));
    ctrl.handle(pt(from.x + layout.cell * 2, from.y, 'move'));
    ctrl.handle(pt(from.x + layout.cell * 2, from.y, 'cancel'));
    expect(intents.some((i) => i.type === 'release')).toBe(false);
    expect(ctrl.currentDrag).toBeNull();
  });
});
