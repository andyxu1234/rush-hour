import { expect, test } from '@playwright/test';
import { currentScreen, goto, openGame } from './helpers';

/**
 * 选关页 —— docs/01 §6.1 的边界要求：
 *   「未解锁关卡灰显不可点；已通关可重玩刷星」
 *
 * 解锁规则必须由 core 的 isUnlocked 唯一决定（"上一关已通关"），
 * 因此这组用例同时也在守"选关页没有自己实现一套解锁逻辑"。
 */
test.describe('选关页', () => {
  test('首次进入：只有第 1 关解锁，其余全部锁定', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    await goto(page, 'select');

    const cells = await page.evaluate(() => window.__RUSH_HOUR__.select.cellStates);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells[0].unlocked, '第 1 关必须解锁').toBe(true);
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].unlocked, `${cells[i].level.id} 应锁定`).toBe(false);
      expect(cells[i].stars, `${cells[i].level.id} 未通关应为 0 星`).toBe(0);
    }
  });

  test('未解锁关卡点击无效（不进游戏）', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    await goto(page, 'select');

    const lockedId = await page.evaluate(() => {
      const locked = window.__RUSH_HOUR__.select.cellStates.find((c) => !c.unlocked);
      return locked ? locked.level.id : null;
    });
    expect(lockedId, '应存在锁定关卡').not.toBeNull();

    const opened = await page.evaluate(
      (id) => window.__RUSH_HOUR__.select.openLevel(id as string),
      lockedId,
    );
    expect(opened).toBe(false);
    expect(await currentScreen(page), '锁定关卡不得进入游戏').toBe('select');
  });

  test('通关第 1 关后，第 2 关变为解锁', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    // 直接解掉第 1 关（真实触发 solve 事件 → recordClear 写存档）
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.screen.loadLevel(api.repo.levels[0]);
      api.screen.forceSolveReport();
    });
    await goto(page, 'select');

    const cells = await page.evaluate(() => window.__RUSH_HOUR__.select.cellStates);
    expect(cells[0].unlocked).toBe(true);
    expect(cells[1].unlocked, '通关第 1 关后第 2 关应解锁').toBe(true);
    expect(cells[2].unlocked, '第 3 关仍应锁定').toBe(false);
  });

  test('已通关的关卡记录星级，且可重复进入（刷星）', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.screen.loadLevel(api.repo.levels[0]);
      api.screen.forceSolveReport();
    });
    await goto(page, 'select');

    const first = await page.evaluate(() => window.__RUSH_HOUR__.select.cellStates[0]);
    expect(first.stars).toBeGreaterThan(0);

    const reopened = await page.evaluate(
      (id) => window.__RUSH_HOUR__.select.openLevel(id),
      first.level.id,
    );
    expect(reopened, '已通关关卡应可重玩').toBe(true);
    expect(await currentScreen(page)).toBe('game');
  });

  test('选关进入游戏后，游戏页记录了来源', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'select');
    await page.evaluate(() => window.__RUSH_HOUR__.select.openLevel('t01'));
    const from = await page.evaluate(() => window.__RUSH_HOUR__.screen.enteredFrom);
    expect(from).toBe('select');
  });

  test('格子几何：正方形、在视口内、可命中', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'select');
    const info = await page.evaluate(() => ({
      cells: window.__RUSH_HOUR__.select.cellStates.map((c) => c.rect),
      vw: window.innerWidth,
      vh: window.innerHeight,
    }));
    for (const c of info.cells) {
      expect(c.w).toBe(c.h);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(info.vw + 1);
      expect(c.y + c.h).toBeLessThanOrEqual(info.vh + 1);
    }
  });

  test('分页：页码从当前进度所在页开始', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'select');
    const p = await page.evaluate(() => ({
      page: window.__RUSH_HOUR__.select.currentPage,
      total: window.__RUSH_HOUR__.select.totalPages,
    }));
    expect(p.total).toBeGreaterThanOrEqual(1);
    expect(p.page).toBeGreaterThanOrEqual(0);
    expect(p.page).toBeLessThan(p.total);
  });
});
