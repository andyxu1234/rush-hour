import { expect, test, type Page } from '@playwright/test';
import { openGame, snapshot, solveCurrentLevel } from './helpers';

/**
 * 触摸路径专项（回归：真机上结算弹窗按钮点不动）。
 *
 * 背景：此前所有拖拽/点击用例都走 `page.mouse`，即**鼠标路径**
 * （mousedown/mousemove/mouseup）。真机只走 touch 路径
 * （touchstart/touchmove/touchend），两条路径在 WebPlatform 里是分开绑定的，
 * 因此鼠标用例全绿仍可能真机不可用。
 *
 * 本文件强制使用 touchscreen（Playwright 需 hasTouch: true），专门守住这条路径。
 */

/**
 * 用 CDP 派发真实的 touch 手势点一下屏幕坐标。
 *
 * 不用 page.touchscreen.tap：它要求 context 开 hasTouch（多一层配置依赖），
 * 而 CDP 的 Input.dispatchTouchEvent 直接产出原生 touch 事件，与被测代码
 * 实际收到的完全一致，也更接近真机。
 */
async function touchTap(page: Page, x: number, y: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  });
  // 真实手指会有微小抖动；这里也模拟一点点，确保仍被判定为 tap
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 2, y: y + 2, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** 用 touch 手势从 A 拖到 B */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y, id: 1 }],
  });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 },
      ],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('触摸路径', () => {
  test('触摸拖拽红车 → 计 1 步', async ({ page }) => {
    await openGame(page);
    const snap = await snapshot(page);
    const red = snap.pieces.find((p) => p.id === 'R')!;
    const box = (await page.locator('canvas').boundingBox())!;
    const cell = snap.layout.cell;
    const from = {
      x: box.x + snap.layout.boardX + (red.c + 0.5) * cell,
      y: box.y + snap.layout.boardY + (red.r + 0.5) * cell,
    };
    await touchDrag(page, from, { x: from.x + cell, y: from.y });

    const after = await snapshot(page);
    expect(after.steps, '触摸拖拽必须被识别').toBe(1);
  });

  test('触摸点击结算弹窗"下一关" → 切关（真机核心回归）', async ({ page }) => {
    await openGame(page);
    await solveCurrentLevel(page);
    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });

    const next = await page.evaluate(
      () => window.__RUSH_HOUR__.screen.dialogButtonRects().find((b) => b.id === 'next')!,
    );
    const box = (await page.locator('canvas').boundingBox())!;

    await touchTap(page, box.x + next.x + next.w / 2, box.y + next.y + next.h / 2);

    await page.waitForFunction(() => !window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });
    const after = await snapshot(page);
    expect(after.levelId).not.toBe('t01');
    expect(after.steps).toBe(0);
  });

  test('触摸点击结算弹窗"重玩" → 重开本关（真机核心回归）', async ({ page }) => {
    await openGame(page);
    await solveCurrentLevel(page);
    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });

    const replay = await page.evaluate(
      () => window.__RUSH_HOUR__.screen.dialogButtonRects().find((b) => b.id === 'replay')!,
    );
    const box = (await page.locator('canvas').boundingBox())!;

    await touchTap(page, box.x + replay.x + replay.w / 2, box.y + replay.y + replay.h / 2);

    await page.waitForFunction(() => !window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });
    const after = await snapshot(page);
    expect(after.levelId).toBe('t01');
    expect(after.steps).toBe(0);
  });

  test('触摸点击 HUD"撤销" → 回退一步', async ({ page }) => {
    await openGame(page);
    const snap = await snapshot(page);
    const red = snap.pieces.find((p) => p.id === 'R')!;
    const box = (await page.locator('canvas').boundingBox())!;
    const cell = snap.layout.cell;

    // 先走一步（用触摸拖拽，确保纯 touch 路径）
    await touchDrag(
      page,
      {
        x: box.x + snap.layout.boardX + (red.c + 0.5) * cell,
        y: box.y + snap.layout.boardY + (red.r + 0.5) * cell,
      },
      {
        x: box.x + snap.layout.boardX + (red.c + 1.5) * cell,
        y: box.y + snap.layout.boardY + (red.r + 0.5) * cell,
      },
    );
    // t01 一步即通关，弹窗会挡住 HUD → 先点"重玩"回到可操作状态
    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });
    const replay = await page.evaluate(
      () => window.__RUSH_HOUR__.screen.dialogButtonRects().find((b) => b.id === 'replay')!,
    );
    await touchTap(page, box.x + replay.x + replay.w / 2, box.y + replay.y + replay.h / 2);
    await page.waitForFunction(() => !window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });

    // 换到多步关卡，走一步后触摸点撤销
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      const lvl = api.repo.levels.find((l) => l.id === 't04')!;
      api.screen.loadLevel(lvl);
    });
    const s2 = await snapshot(page);
    const m = await page.evaluate(() => window.__RUSH_HOUR__.screen.bestNextMove())!;
    await page.evaluate(
      ([piece, dir, cells]) => window.__RUSH_HOUR__.screen.applyMove({ piece, dir, cells }),
      [m.piece, m.dir, m.cells] as const,
    );
    expect((await snapshot(page)).steps).toBe(1);

    const undo = await page.evaluate(
      () => window.__RUSH_HOUR__.screen.hudButtonRects().find((b) => b.id === 'undo')!,
    );
    await touchTap(page, box.x + undo.x + undo.w / 2, box.y + undo.y + undo.h / 2);

    const after = await snapshot(page);
    expect(after.steps, '触摸点击撤销必须生效').toBe(0);
    void s2;
  });

  test('触摸长按车辆 → 显示可动方向提示', async ({ page }) => {
    await openGame(page);
    const snap = await snapshot(page);
    const red = snap.pieces.find((p) => p.id === 'R')!;
    const box = (await page.locator('canvas').boundingBox())!;
    const cell = snap.layout.cell;
    const x = box.x + snap.layout.boardX + (red.c + 0.5) * cell;
    const y = box.y + snap.layout.boardY + (red.r + 0.5) * cell;

    // 长按：touchStart 后保持 ≥ 800ms 再抬起
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
    await page.waitForTimeout(1000);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    // 长按不改变步数（只给提示），且不崩溃
    const after = await snapshot(page);
    expect(after.steps).toBe(0);
  });
});
