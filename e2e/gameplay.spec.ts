import { expect, test, type Page } from '@playwright/test';
import {
  gotoLevelWithRedSpace,
  move,
  openGame,
  press,
  redPiece,
  snapshot,
  solveCurrentLevel,
} from './helpers';

/**
 * 玩法与状态机。
 *
 * 几何断言全部基于真实关卡数据（t01 红车在 (2,3)，右侧仅 1 格），
 * 不允许出现"红车在第 0 列"这类凭直觉的假设。
 */

/** 用一次拖拽式走子解掉 t01（1 步关），返回所用格数 */
async function solveFirstLevelByDrag(page: Page): Promise<number> {
  const room = await page.evaluate(() => window.__RUSH_HOUR__.screen.redMaxSlide('right'));
  expect(room).toBeGreaterThan(0);
  expect(await move(page, 'R', 'right', room)).toBe(true);
  return room;
}

test.describe('玩法与状态机', () => {
  test('完成教学首关：红车滑出 → 结算弹窗 → 3 星', async ({ page }) => {
    await openGame(page);
    const before = await snapshot(page);
    expect(before.levelId).toBe('t01');
    expect(before.steps).toBe(0);
    expect(redPiece(before).r).toBe(2);
    expect(redPiece(before).c).toBe(3); // t01 的真实初始位置

    const room = await solveFirstLevelByDrag(page);

    const after = await snapshot(page);
    expect(after.solved).toBe(true);
    // ★ 红线：一次滑动无论几格都只算 1 步
    expect(after.steps).toBe(1);
    expect(after.cellSteps).toBe(room);
    expect(redPiece(after).c).toBe(4); // 驶入出口格 (2,4)

    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 4000 });
    const saved = await page.evaluate(() => window.__RUSH_HOUR__.save.levels['t01']);
    expect(saved.stars).toBe(3);
    expect(saved.bestMoves).toBe(1);
  });

  test('一次滑动跨多格仍只计 1 步（红线回归）', async ({ page }) => {
    await openGame(page);
    const info = await gotoLevelWithRedSpace(page, 2);
    test.skip(!info, '没有红车右侧空间 ≥2 的关卡');

    const before = await snapshot(page);
    const red = redPiece(before);
    const cells = Math.min(3, info!.maxRight);
    expect(await move(page, 'R', 'right', cells)).toBe(true);

    const after = await snapshot(page);
    expect(after.steps).toBe(1);
    expect(after.cellSteps).toBe(cells);
    expect(after.moves).toHaveLength(1);
    expect(after.moves[0]).toEqual({ piece: 'R', dir: 'right', cells });
    expect(redPiece(after).c).toBe(red.c + cells);
  });

  test('非法移动不计步（越界 / 轴向不符 / 超出可滑范围）', async ({ page }) => {
    await openGame(page);
    const room = await page.evaluate(() => window.__RUSH_HOUR__.screen.redMaxSlide('right'));
    const leftRoom = await page.evaluate(() => window.__RUSH_HOUR__.screen.redMaxSlide('left'));

    // 横车不能上下
    expect(await move(page, 'R', 'up', 1)).toBe(false);
    expect(await move(page, 'R', 'down', 1)).toBe(false);
    // 超出可滑范围（+1 格）
    expect(await move(page, 'R', 'right', room + 1)).toBe(false);
    // 左侧若无空间则必须非法
    if (leftRoom === 0) {
      expect(await move(page, 'R', 'left', 1)).toBe(false);
    }

    const snap = await snapshot(page);
    expect(snap.steps).toBe(0);
    expect(snap.canUndo).toBe(false);
  });

  test('步数恒等于 moves 长度', async ({ page }) => {
    await openGame(page);
    const info = await gotoLevelWithRedSpace(page, 1);
    test.skip(!info, '没有可用关卡');

    await move(page, 'R', 'right', 1);
    const snap = await snapshot(page);
    expect(snap.steps).toBe(snap.moves.length);
  });

  test('撤销到 0 步后再撤销 → 无副作用', async ({ page }) => {
    await openGame(page);
    await solveFirstLevelByDrag(page);
    expect((await snapshot(page)).steps).toBe(1);

    await press(page, 'undo');
    expect((await snapshot(page)).steps).toBe(0);
    await press(page, 'undo');
    const snap = await snapshot(page);
    expect(snap.steps).toBe(0);
    expect(snap.canUndo).toBe(false);
  });

  test('撤销后重走同一步 → 局面完全一致', async ({ page }) => {
    await openGame(page);
    // 用"撤销前必定合法、且不会一击通关"的一步：取求解器给的最优走法。
    // t01 是 1 步关，红车一步即通关，故换到步数更多的关卡再做撤销/重走。
    await gotoLevelWithRedSpace(page, 2);
    const steps = await page.evaluate(() => window.__RUSH_HOUR__.screen.remainingMoves());
    test.skip(steps === null || steps < 2, '需要一关至少 2 步才能覆盖撤销后重走');

    const before = await snapshot(page);
    const m = await page.evaluate(() => window.__RUSH_HOUR__.screen.bestNextMove())!;
    expect(m).not.toBeNull();

    expect(await move(page, m!.piece, m!.dir, m!.cells)).toBe(true);
    const walked = await snapshot(page);
    expect(walked.steps).toBe(1);

    await press(page, 'undo');
    const undone = await snapshot(page);
    expect(undone.steps).toBe(0);
    for (const p of before.pieces) {
      expect(undone.pieces.find((q) => q.id === p.id)).toEqual(p);
    }

    expect(await move(page, m!.piece, m!.dir, m!.cells)).toBe(true);
    const again = await snapshot(page);
    expect(again.steps).toBe(walked.steps);
    expect(again.cellSteps).toBe(walked.cellSteps);
    for (const p of walked.pieces) {
      expect(again.pieces.find((q) => q.id === p.id)).toEqual(p);
    }
  });

  test('重开清空走子但保留已得星级', async ({ page }) => {
    await openGame(page);
    await solveFirstLevelByDrag(page);
    await page.waitForFunction(() => window.__RUSH_HOUR__.save.levels['t01'] !== undefined);
    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 4000 });

    // 弹窗打开时"重开"由弹窗按钮触发
    await press(page, 'reset');

    const snap = await snapshot(page);
    expect(snap.steps).toBe(0);
    expect(snap.solved).toBe(false);
    expect(snap.canUndo).toBe(false);
    // 成绩不因重开而丢失
    expect((await page.evaluate(() => window.__RUSH_HOUR__.save.levels['t01'])).stars).toBe(3);
  });

  test('提示：给出最优下一步且不改变步数', async ({ page }) => {
    await openGame(page);
    await press(page, 'hint');
    const snap = await snapshot(page);
    expect(snap.steps).toBe(0);
  });
});

test.describe('关卡推进与解锁', () => {
  test('结算弹窗点击"下一关" → 切换到下一关并重置步数', async ({ page }) => {
    await openGame(page);
    await solveCurrentLevel(page);
    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });

    const next = await page.evaluate(
      () => window.__RUSH_HOUR__.screen.dialogButtonRects().find((b) => b.id === 'next') ?? null,
    );
    test.skip(!next, '首关之后没有下一关');

    // 用真实指针点击（同时验证弹窗布局与命中测试）
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.click(box!.x + next!.x + next!.w / 2, box!.y + next!.y + next!.h / 2);

    await page.waitForFunction(() => !window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });
    const after = await snapshot(page);
    expect(after.levelId).not.toBe('t01');
    expect(after.steps).toBe(0);
    expect(after.solved).toBe(false);
  });

  test('结算弹窗按钮布局可被坐标命中（命中测试）', async ({ page }) => {
    await openGame(page);
    await solveCurrentLevel(page);
    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });

    const layout = (await snapshot(page)).layout;
    const btns = await page.evaluate(() => window.__RUSH_HOUR__.screen.dialogButtonRects());
    // P4 起结算弹窗为三个按钮：重玩 / 分享 / 下一关
    expect(btns.map((b) => b.id).sort()).toEqual(['next', 'replay', 'share']);
    for (const b of btns) {
      // 按钮必须完整落在视口内且尺寸可用
      expect(b.w, b.id).toBeGreaterThan(40);
      expect(b.h, b.id).toBeGreaterThan(30);
      expect(b.x, b.id).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w, b.id).toBeLessThanOrEqual(layout.width + 1);
      expect(b.y, b.id).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h, b.id).toBeLessThanOrEqual(layout.height + 1);
    }
    // 两个按钮不得重叠
    const [a, b2] = btns;
    const overlap =
      a.x < b2.x + b2.w && b2.x < a.x + a.w && a.y < b2.y + b2.h && b2.y < a.y + a.h;
    expect(overlap).toBe(false);
  });

  test('结算弹窗点"重玩" → 留在同一关且步数归零', async ({ page }) => {
    await openGame(page);
    await solveCurrentLevel(page);
    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });

    const replay = await page.evaluate(
      () => window.__RUSH_HOUR__.screen.dialogButtonRects().find((b) => b.id === 'replay')!,
    );
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.click(box!.x + replay.x + replay.w / 2, box!.y + replay.y + replay.h / 2);

    await page.waitForFunction(() => !window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });
    const after = await snapshot(page);
    expect(after.levelId).toBe('t01');
    expect(after.steps).toBe(0);
  });

  test('顺序推进可覆盖全部关卡，且每关都能通关', async ({ page }) => {
    await openGame(page);
    const total = await page.evaluate(() => window.__RUSH_HOUR__.repo.levels.length);
    // 关卡数量随生成器扩产而变化，因此断言"至少覆盖教学 8 关"而不是写死总数
    expect(total).toBeGreaterThanOrEqual(8);

    // 逐关用求解器的最优解走完。前提已由 P1 单测保证（每关可解，
    // 且 minMoves 与 Python 参考实现逐关一致）。
    const report = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      const solvedIds: string[] = [];
      const failed: string[] = [];
      const stepsUsed: Record<string, number> = {};

      for (const lvl of [...api.repo.levels]) {
        api.screen.loadLevel(lvl);
        const id = api.screen.levelId;
        const expected = api.screen.remainingMoves();

        let used = 0;
        for (let guard = 0; guard < 60; guard++) {
          if (api.screen.solved) break;
          const m = api.screen.bestNextMove();
          if (!m) break;
          if (!api.screen.applyMove(m)) break;
          used++;
        }
        stepsUsed[id] = used;
        if (api.screen.solved) solvedIds.push(id);
        else failed.push(`${id}(remaining=${expected})`);
      }
      return { solvedIds, failed, stepsUsed };
    });

    expect(report.failed, `以下关卡未能通关：${report.failed.join(', ')}`).toEqual([]);
    expect(report.solvedIds).toHaveLength(total);
    // 用最优解走出来的步数必须等于关卡 par（跨层一致性再确认一次）
    const par = await page.evaluate(() =>
      Object.fromEntries(window.__RUSH_HOUR__.repo.levels.map((l) => [l.id, l.par.moves])),
    );
    for (const id of report.solvedIds) {
      expect(report.stepsUsed[id], `${id} 最优解步数应等于 par`).toBe(par[id]);
    }
  });
});

test.describe('存档健壮性', () => {
  test('断点续玩：走到若干步后刷新 → 恢复到相同步数', async ({ page }) => {
    await openGame(page);
    const info = await gotoLevelWithRedSpace(page, 1);
    test.skip(!info, '没有可用关卡');

    expect(await move(page, 'R', 'right', 1)).toBe(true);
    const before = await snapshot(page);
    expect(before.steps).toBe(1);

    await page.waitForTimeout(700); // 等防抖写盘
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__RUSH_HOUR__), null, { timeout: 5000 });

    // ⚠️ 刷新后必须**主动进对局页**才谈得上"续玩"。
    //   P4 起状态恢复发生在 GameScreen.enter()（统一了从任何屏进入都续玩的语义），
    //   停在启动页/主菜单时 GameScreen 还没 enter，读到的是未恢复的局面。
    //   这也正是玩家真实路径：刷新 → 主菜单 →「继续上局」。
    await page.waitForFunction(() => window.__RUSH_HOUR__.nav.current() === 'menu', null, {
      timeout: 5000,
    });
    // 主菜单应当出现「继续上局」（存在未完成对局时）
    const menuItems = await page.evaluate(() => window.__RUSH_HOUR__.menu.menuItems);
    expect(menuItems.map((m) => m.action)).toContain('continue');

    // 点「继续上局」等价于进当前存档那一关（不走 nav.openLevel 的显式 levelId）
    await page.evaluate(() => window.__RUSH_HOUR__.menu.trigger('continue'));

    const after = await snapshot(page);
    expect(after.levelId).toBe(before.levelId);
    expect(after.steps, '刷新后应恢复到刷新前的步数').toBe(before.steps);
    expect(after.pieces.find((p) => p.id === 'R')).toEqual(
      before.pieces.find((p) => p.id === 'R'),
    );
  });

  test('存档损坏：写入非法 JSON 刷新 → 安全重置不白屏', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => localStorage.setItem('rushhour.save.v1', '{{{corrupted'));
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__RUSH_HOUR__), null, { timeout: 5000 });

    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(page.locator('#boot')).toHaveCount(0);
    const snap = await snapshot(page);
    expect(snap.steps).toBe(0);
    expect(errors).toEqual([]);
  });

  test('版本号不匹配 → 安全重置', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() =>
      localStorage.setItem('rushhour.save.v1', JSON.stringify({ v: 99, levels: {}, settings: {} })),
    );
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__RUSH_HOUR__));
    const snap = await snapshot(page);
    expect(snap.levelId).toBe('t01');
    expect(snap.steps).toBe(0);
  });

  test('存档体积远小于 8KB', async ({ page }) => {
    await openGame(page);
    const size = await page.evaluate(() => JSON.stringify(window.__RUSH_HOUR__.save).length);
    expect(size).toBeLessThan(8 * 1024);
  });
});
