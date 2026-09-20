import { expect, test, type Page } from '@playwright/test';
import {
  findEmptyCell,
  gotoLevelWithRedSpace,
  openGame,
  redPiece,
  snapshot,
  type Snapshot,
} from './helpers';

/**
 * 输入层（真实指针拖拽）—— 覆盖 docs/01 §8 的吸附与回弹手感规则。
 *
 * ⚠️ 所有几何一律从 snapshot 推导。首关 t01 的红车位于 (2,3)，向右只能滑 1 格，
 *    左侧也不是贴边 —— 任何"红车在第 0 列"的假设都会误报。
 */

/** 格子中心 → 页面像素（含 canvas 在页面中的偏移） */
async function toPage(page: Page, snap: Snapshot, r: number, c: number) {
  const box = await page.locator('canvas').boundingBox();
  return {
    x: box!.x + snap.layout.boardX + (c + 0.5) * snap.layout.cell,
    y: box!.y + snap.layout.boardY + (r + 0.5) * snap.layout.cell,
  };
}

/**
 * 执行一次真实拖拽：从某格中心按 (dxCells, dyCells) 拖动后松手。
 * 先 move 到起点再 down，确保浏览器先派发 mousemove 定位（否则部分内核下
 * down 的坐标可能沿用上一次位置）。
 */
async function dragBy(
  page: Page,
  snap: Snapshot,
  r: number,
  c: number,
  dxCells: number,
  dyCells: number,
) {
  const from = await toPage(page, snap, r, c);
  const cell = snap.layout.cell;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dxCells * cell, from.y + dyCells * cell, { steps: 8 });
  await page.mouse.up();
}

test.describe('拖拽交互', () => {
  test('拖拽不足 0.5 格松手 → 回弹，不计步', async ({ page }) => {
    await openGame(page);
    const snap = await snapshot(page);
    const red = redPiece(snap);

    await dragBy(page, snap, red.r, red.c, 0.25, 0);

    const after = await snapshot(page);
    expect(after.steps).toBe(0);
    expect(after.canUndo).toBe(false);
    expect(after.pieces.find((p) => p.id === 'R')!.c).toBe(red.c);
  });

  test('向右拖满一格松手 → 吸附并计 1 步', async ({ page }) => {
    await openGame(page);
    const snap = await snapshot(page);
    const red = redPiece(snap);
    // 先确认向右确实有空间，否则本用例无意义
    const room = await page.evaluate(() => window.__RUSH_HOUR__.screen.maxSlide('R', 'right'));
    test.skip(room < 1, '红车右侧无空间，无法覆盖向右吸附');

    await dragBy(page, snap, red.r, red.c, 1, 0);

    const after = await snapshot(page);
    expect(after.steps).toBe(1);
    expect(after.cellSteps).toBe(1);
    expect(after.pieces.find((p) => p.id === 'R')!.c).toBe(red.c + 1);
  });

  test('向右拖 3 格但只有空间时 → 吸附到可滑上限，仍只计 1 步', async ({ page }) => {
    await openGame(page);
    // 首关空间不足 → 换成有富余空间的关卡
    const info = await gotoLevelWithRedSpace(page, 3);
    test.skip(!info, '没有红车右侧空间 ≥3 的关卡');

    const snap = await snapshot(page);
    const red = redPiece(snap);
    await dragBy(page, snap, red.r, red.c, info!.maxRight + 4, 0);

    const after = await snapshot(page);
    expect(after.steps).toBe(1);
    expect(after.pieces.find((p) => p.id === 'R')!.c).toBe(red.c + info!.maxRight);
  });

  test('向右拖 3.6 格 → 四舍五入吸附到 4 格（仅 1 步）', async ({ page }) => {
    await openGame(page);
    const info = await gotoLevelWithRedSpace(page, 4);
    test.skip(!info || info.maxRight < 4, '没有红车右侧空间 ≥4 的关卡');

    const snap = await snapshot(page);
    const red = redPiece(snap);
    await dragBy(page, snap, red.r, red.c, 3.6, 0);

    const after = await snapshot(page);
    expect(after.steps).toBe(1);
    expect(after.pieces.find((p) => p.id === 'R')!.c).toBe(red.c + 4);
  });

  test('被顶住的方向拖拽 → 回弹，不计步且坐标不变', async ({ page }) => {
    await openGame(page);
    // 换到红车左侧贴边（c === 0）的关卡，向左必然被挡住
    const info = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      for (const lvl of api.repo.levels) {
        api.screen.loadLevel(lvl);
        const red = api.screen.piecePositions.find((p) => p.id === 'R')!;
        if (red.r === 2 && red.c === 0 && api.screen.maxSlide('R', 'left') === 0) {
          return { levelId: lvl.id, redC: red.c, redR: red.r };
        }
      }
      return null;
    });
    test.skip(!info, '没有红车左侧贴边的关卡');

    const snap = await snapshot(page);
    await dragBy(page, snap, info!.redR, info!.redC, -2, 0);

    const after = await snapshot(page);
    expect(after.steps).toBe(0);
    expect(after.pieces.find((p) => p.id === 'R')!.c).toBe(info!.redC);
  });

  test('竖车只能沿竖直方向拖拽（横向拖动无效）', async ({ page }) => {
    await openGame(page);
    const snap = await snapshot(page);
    const v = snap.pieces.find((p) => p.dir === 'V');
    test.skip(!v, '该关没有竖车');

    await dragBy(page, snap, v!.r, v!.c, 2, 0);

    const after = await snapshot(page);
    expect(after.steps).toBe(0);
    const vAfter = after.pieces.find((p) => p.id === v!.id)!;
    expect({ r: vAfter.r, c: vAfter.c }).toEqual({ r: v!.r, c: v!.c });
  });

  test('竖车沿竖直方向拖动可生效', async ({ page }) => {
    await openGame(page);
    const snap = await snapshot(page);
    const v = snap.pieces.find((p) => p.dir === 'V');
    test.skip(!v, '该关没有竖车');
    const up = await page.evaluate(
      (id) => window.__RUSH_HOUR__.screen.maxSlide(id, 'up'),
      v!.id,
    );
    test.skip(up < 1, '该竖车向上无空间');

    await dragBy(page, snap, v!.r, v!.c, 0, -1);

    const after = await snapshot(page);
    expect(after.steps).toBe(1);
    expect(after.pieces.find((p) => p.id === v!.id)!.r).toBe(v!.r - 1);
  });

  test('在空白格拖动不会抓车', async ({ page }) => {
    await openGame(page);
    const snap = await snapshot(page);
    const empty = findEmptyCell(snap);
    test.skip(!empty, '棋盘已满，无空白格');

    await dragBy(page, snap, empty!.r, empty!.c, 2, 0);
    expect((await snapshot(page)).steps).toBe(0);
  });

  test('撤销按钮在 0 步时点击无效', async ({ page }) => {
    await openGame(page);
    const snap = await snapshot(page);
    const box = await page.locator('canvas').boundingBox();
    const btns = await page.evaluate(() => window.__RUSH_HOUR__.screen.hudButtonRects());
    const undo = btns.find((b) => b.id === 'undo')!;

    await page.mouse.click(box!.x + undo.x + undo.w / 2, box!.y + undo.y + undo.h / 2);

    expect((await snapshot(page)).steps).toBe(0);
  });

  test('真实点击撤销按钮可回退一步', async ({ page }) => {
    await openGame(page);
    // ⚠️ 不能用 t01：它是 1 步关，红车一滑就通关、结算弹窗会盖住 HUD，
    // 此时点击撤销会被弹窗吞掉（这本身是正确行为）。
    // 因此换到"第一步不会通关"的关卡，才能真正验证 HUD 按钮。
    const info = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      for (const lvl of api.repo.levels) {
        if (lvl.par.moves < 2) continue;
        api.screen.loadLevel(lvl);
        // 选一辆能动、且动完不会直接通关的车
        for (const p of api.screen.piecePositions) {
          for (const d of ['up', 'down', 'left', 'right'] as const) {
            if (api.screen.maxSlide(p.id, d) >= 1) {
              const ok = api.screen.applyMove({ piece: p.id, dir: d, cells: 1 });
              if (ok && !api.screen.solved) {
                return { levelId: lvl.id, piece: p.id, dir: d, solved: false };
              }
              // 回退并继续尝试
              api.screen.loadLevel(lvl);
            }
          }
        }
      }
      return null;
    });
    test.skip(!info, '找不到"走一步但未通关"的关卡');

    const before = await snapshot(page);
    const moved = before.pieces.find((p) => p.id === info!.piece)!;
    expect(before.steps).toBe(1);
    expect(before.solved).toBe(false);
    expect(before.hasDialog).toBe(false);

    const box = await page.locator('canvas').boundingBox();
    const btns = await page.evaluate(() => window.__RUSH_HOUR__.screen.hudButtonRects());
    const undo = btns.find((b) => b.id === 'undo')!;
    await page.mouse.click(box!.x + undo.x + undo.w / 2, box!.y + undo.y + undo.h / 2);

    const after = await snapshot(page);
    expect(after.steps, '真实点击撤销必须回退一步').toBe(0);
    expect(after.solved).toBe(false);
    // 车辆位置应回到关卡初始态
    expect(after.pieces.find((p) => p.id === info!.piece)).not.toEqual(moved);
    void redPiece;
  });
});
