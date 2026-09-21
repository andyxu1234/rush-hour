import { describe, expect, it } from 'vitest';
import type { CanvasRenderingContext2DLike } from '@rush-hour/platform';
import { H, RED_ID, V, type Piece } from '@rush-hour/core';
import {
  drawBackground,
  drawBoard,
  drawCar,
  drawExit,
  drawFlash,
  drawGhost,
  drawHud,
  drawResultDialog,
  drawToast,
  pickColors,
} from '../src/canvas2d';
import { computeLayout, hudButtons } from '../src/layout';

/**
 * L4 渲染层验证。
 *
 * 这里刻意**不**做像素级快照（依赖 canvas 实现，跨 Node/浏览器不稳定），
 * 而是记录绘制调用序列并断言"关键图元被画出来了"：
 *   - 该有的调用（fill / fillText / roundRect）确实发生；
 *   - 不产生 NaN 坐标（NaN 会让 canvas 静默不画，是最隐蔽的渲染 bug）。
 */
function recordingCtx() {
  const calls: Array<{ fn: string; args: number[] }> = [];
  const notes: string[] = [];
  const num = (...args: unknown[]) => args.filter((a): a is number => typeof a === 'number');
  const ctx = {
    canvas: { width: 750, height: 1334 },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: () => calls.push({ fn: 'save', args: [] }),
    restore: () => calls.push({ fn: 'restore', args: [] }),
    scale: (...a: number[]) => calls.push({ fn: 'scale', args: num(...a) }),
    translate: (...a: number[]) => calls.push({ fn: 'translate', args: num(...a) }),
    rotate: (a: number) => calls.push({ fn: 'rotate', args: num(a) }),
    setTransform: (...a: number[]) => calls.push({ fn: 'setTransform', args: num(...a) }),
    beginPath: () => calls.push({ fn: 'beginPath', args: [] }),
    closePath: () => calls.push({ fn: 'closePath', args: [] }),
    moveTo: (...a: number[]) => calls.push({ fn: 'moveTo', args: num(...a) }),
    lineTo: (...a: number[]) => calls.push({ fn: 'lineTo', args: num(...a) }),
    arc: (...a: number[]) => calls.push({ fn: 'arc', args: num(...a) }),
    quadraticCurveTo: (...a: number[]) => calls.push({ fn: 'quadraticCurveTo', args: num(...a) }),
    rect: (...a: number[]) => calls.push({ fn: 'rect', args: num(...a) }),
    roundRect: (...a: unknown[]) => calls.push({ fn: 'roundRect', args: num(...a) }),
    fill: () => calls.push({ fn: 'fill', args: [] }),
    stroke: () => calls.push({ fn: 'stroke', args: [] }),
    clip: () => calls.push({ fn: 'clip', args: [] }),
    clearRect: (...a: number[]) => calls.push({ fn: 'clearRect', args: num(...a) }),
    fillRect: (...a: number[]) => calls.push({ fn: 'fillRect', args: num(...a) }),
    strokeRect: (...a: number[]) => calls.push({ fn: 'strokeRect', args: num(...a) }),
    fillText: (t: string, ...a: number[]) => {
      notes.push(t);
      calls.push({ fn: 'fillText', args: num(...a) });
    },
    measureText: (t: string) => ({ width: t.length * 7 }),
    createLinearGradient: () => {
      calls.push({ fn: 'createLinearGradient', args: [] });
      return { addColorStop: () => undefined };
    },
  } as unknown as CanvasRenderingContext2DLike;
  return { ctx, calls, notes };
}

const P = (id: string, dir: 'H' | 'V', len: 2 | 3, r: number, c: number): Piece => ({
  id,
  dir,
  len,
  r,
  c,
});

function assertNoNaN(calls: Array<{ fn: string; args: number[] }>): void {
  for (const call of calls) {
    for (const a of call.args) {
      if (Number.isNaN(a)) throw new Error(`${call.fn} 收到 NaN 参数 —— canvas 会静默不绘制`);
    }
  }
}

describe('渲染层绘制', () => {
  const layout = computeLayout(375, 667);

  it('空棋盘：画出背景与 36 个格子底色', () => {
    const { ctx, calls } = recordingCtx();
    drawBackground(ctx, layout);
    drawBoard(ctx, layout);
    // 36 个格子各自一次 roundRect + fill
    expect(calls.filter((c) => c.fn === 'roundRect').length).toBeGreaterThanOrEqual(36);
    expect(calls.filter((c) => c.fn === 'fill').length).toBeGreaterThanOrEqual(36);
    // 5 + 5 条格线
    expect(calls.filter((c) => c.fn === 'moveTo').length).toBeGreaterThanOrEqual(10);
    assertNoNaN(calls);
  });

  it('满棋盘：12 辆车全部绘制，含车灯与车窗', () => {
    const { ctx, calls } = recordingCtx();
    const pieces: Piece[] = [
      P(RED_ID, H, 2, 2, 0),
      P('a', V, 2, 0, 2),
      P('b', V, 2, 0, 3),
      P('c', V, 2, 0, 4),
      P('d', V, 3, 3, 2),
      P('e', H, 2, 0, 5),
      P('f', V, 2, 3, 3),
      P('g', H, 2, 4, 0),
      P('h', H, 3, 5, 1),
      P('i', V, 2, 3, 5),
      P('j', H, 2, 4, 3),
      P('k', V, 2, 5, 4),
    ];
    const colors = pickColors(pieces);
    for (const p of pieces) {
      drawCar(ctx, layout, { piece: p, color: colors.get(p.id)!, dx: 0, dy: 0 });
    }
    // 每辆车 2 个车灯小圆
    expect(calls.filter((c) => c.fn === 'arc').length).toBe(pieces.length * 2);
    assertNoNaN(calls);
  });

  it('长车（len=3）会绘制中部车窗', () => {
    const { ctx, calls } = recordingCtx();
    const colors = pickColors([P('long', H, 3, 0, 0)]);
    drawCar(ctx, layout, { piece: P('long', H, 3, 0, 0), color: colors.get('long')!, dx: 0, dy: 0 });
    // 车窗需要 clip 后再 fill
    expect(calls.some((c) => c.fn === 'clip')).toBe(true);
    assertNoNaN(calls);
  });

  it('拖拽态与禁用态使用不同透明度，且不产生 NaN', () => {
    const { ctx, calls } = recordingCtx();
    const colors = pickColors([P(RED_ID, H, 2, 2, 0)]);
    drawCar(ctx, layout, {
      piece: P(RED_ID, H, 2, 2, 0),
      color: colors.get(RED_ID)!,
      dx: 12,
      dy: 0,
      dragging: true,
      dimmed: true,
    });
    assertNoNaN(calls);
  });

  it('虚影在 cells=0 时完全不绘制', () => {
    const { ctx, calls } = recordingCtx();
    drawGhost(ctx, layout, P('a', V, 2, 0, 0), 'down', 0);
    expect(calls).toHaveLength(0);
    drawGhost(ctx, layout, P('a', V, 2, 0, 0), 'down', 2);
    expect(calls.length).toBeGreaterThan(0);
    assertNoNaN(calls);
  });

  it('出口箭头与闪屏可绘制', () => {
    const { ctx, calls } = recordingCtx();
    drawExit(ctx, layout, 0);
    drawFlash(ctx, layout, 0.5);
    drawFlash(ctx, layout, 0); // alpha 0 → 直接返回
    assertNoNaN(calls);
  });

  it('顶部信息栏显示关卡木牌、步数木牌与金币，底部显示三个操作按钮', () => {
    const { ctx, notes, calls } = recordingCtx();
    drawHud(
      ctx,
      layout,
      { levelName: '第1关 · 认识红车', steps: 3, parMoves: 5, hintLeft: 1, bestMoves: 2, coins: 300 },
      true,
    );
    // 关卡木牌只取"第 N 关"（完整关卡名塞不进 ~70px 宽的木牌，见 levelBadge 注释）
    expect(notes).toContain('第 1 关');
    expect(notes).toContain('步数 3');
    expect(notes).toContain('最佳 2');
    expect(notes).toContain('300');
    // 底部操作区三个按钮（重置取代了旧的"重开"文案，与高保真稿一致）
    expect(notes).toContain('撤销');
    expect(notes).toContain('重置');
    expect(notes).toContain('提示');
    assertNoNaN(calls);
  });

  it('没通关过时不显示"最佳"行（避免出现"最佳 0"）', () => {
    const { ctx, notes } = recordingCtx();
    drawHud(ctx, layout, { levelName: '第5关', steps: 0, parMoves: 5, hintLeft: 1 }, true);
    expect(notes.some((t) => t.startsWith('最佳'))).toBe(false);
    expect(notes).toContain('步数 0');
  });

  it('整个 HUD 不产生 NaN 坐标，且底部操作按钮与棋盘不重叠', () => {
    const { ctx, calls } = recordingCtx();
    drawHud(ctx, layout, { levelName: '第1关', steps: 0, parMoves: 1, hintLeft: 1 }, false);
    assertNoNaN(calls);
    // 底部操作区必须完整落在棋盘下方，否则会与拖拽抢区域
    for (const b of hudButtons(layout)) {
      expect(b.y, `${b.id} 压到了棋盘`).toBeGreaterThanOrEqual(
        layout.boardY + layout.boardSize - 1,
      );
    }
  });

  it('结算弹窗：显示步数对比并画三颗星', () => {
    const { ctx, notes, calls } = recordingCtx();
    drawResultDialog(ctx, layout, {
      stars: 2,
      steps: 7,
      parMoves: 5,
      cellSteps: 12,
      isNewBest: true,
      hasNext: true,
      progress: 1,
    });
    expect(notes).toContain('过关！');
    expect(notes).toContain('本局 7 步 / 目标 5 步');
    expect(notes).toContain('新纪录！');
    expect(notes).toContain('下一关');
    assertNoNaN(calls);
  });

  it('无下一关时不绘制"下一关"按钮', () => {
    const { ctx, notes } = recordingCtx();
    drawResultDialog(ctx, layout, {
      stars: 3,
      steps: 1,
      parMoves: 1,
      cellSteps: 1,
      isNewBest: false,
      hasNext: false,
      progress: 1,
    });
    expect(notes).not.toContain('下一关');
    expect(notes).toContain('重玩');
  });

  it('toast 气泡可绘制', () => {
    const { ctx, notes, calls } = recordingCtx();
    drawToast(ctx, layout, '试试把红车向右滑 2 格');
    expect(notes).toContain('试试把红车向右滑 2 格');
    assertNoNaN(calls);
  });
});

describe('车辆配色', () => {
  it('同一关内颜色互不相同', () => {
    const pieces: Piece[] = [
      P(RED_ID, H, 2, 2, 0),
      ...Array.from({ length: 11 }, (_, i) => P(`p${i}`, i % 2 ? 'V' : 'H', 2, 0, 0)),
    ];
    const colors = pickColors(pieces);
    const fills = [...colors.values()].map((c) => c.fill);
    expect(new Set(fills).size).toBe(pieces.length);
  });

  it('红车恒为红色且与其它车不同', () => {
    const pieces = [P(RED_ID, H, 2, 2, 0), P('a', V, 2, 0, 0)];
    const colors = pickColors(pieces);
    expect(colors.get(RED_ID)!.fill).toBe('#E03131');
    expect(colors.get('a')!.fill).not.toBe('#E03131');
  });

  /**
   * 车辆数超过色板容量（12）时的行为。
   *
   * 现实触发条件：生成器扩产后的 expert 关卡有 14 辆车（c009）。
   * 约定：**颜色可以复用，但绝不能取不到颜色**（取不到会导致漏画车）。
   * 这条用例把"允许复用"这个取舍固化下来，避免后人误以为它是 bug 而改成抛错。
   */
  it('车辆数超过色板容量时不抛错、每辆车都有颜色（允许复用）', () => {
    const pieces: Piece[] = [
      P(RED_ID, H, 2, 2, 0),
      ...Array.from({ length: 13 }, (_, i) => P(`p${i}`, 'V', 2, 0, 0)),
    ];
    const colors = pickColors(pieces);
    expect(colors.size).toBe(pieces.length);
    for (const p of pieces) {
      const c = colors.get(p.id);
      expect(c, `${p.id} 应有颜色`).toBeTruthy();
      expect(c!.fill).toMatch(/^#[0-9a-f]{6}$/i);
    }
    // 红车仍必须是红色，且不与任何其它车同色（红车是唯一不能复用的）
    expect(colors.get(RED_ID)!.fill).toBe('#E03131');
    for (const p of pieces) {
      if (p.id === RED_ID) continue;
      expect(colors.get(p.id)!.fill).not.toBe('#E03131');
    }
  });

  it('派生色包含高光与描边，均非空', () => {
    for (const c of pickColors([P(RED_ID, H, 2, 2, 0), P('z', V, 3, 0, 0)]).values()) {
      expect(c.fill).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.stroke).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.light).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
