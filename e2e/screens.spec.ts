import { expect, test } from '@playwright/test';
import { currentScreen, goHome, goto, openGame } from './helpers';

/**
 * P4 界面体系的导航可达性。
 *
 * 这一组用例守的是"**每个界面都到得了、都退得出**"：
 * 提审时"某个页面没有返回路径"是硬伤，而这种 bug 在只手动测主流程时
 * 极容易漏掉（比如从选关进游戏后再返回，到底回哪一页）。
 */
test.describe('导航可达性', () => {
  test('启动后自动进入主菜单，且不残留 boot 屏', async ({ page }) => {
    await openGame(page, { enterGame: false });
    expect(await currentScreen(page)).toBe('menu');
  });

  test('主菜单六个入口都能到达对应屏幕', async ({ page }) => {
    await openGame(page, { enterGame: false });

    const routes: Array<[string, string]> = [
      ['select', 'select'],
      ['daily', 'daily'],
      ['leaderboard', 'leaderboard'],
      ['settings', 'settings'],
      ['privacy', 'privacy'],
    ];

    for (const [screen] of routes) {
      await goto(page, screen as never);
      expect(await currentScreen(page), `导航到 ${screen}`).toBe(screen);
    }

    // 游戏页单独验证（需要 levelId 参数）
    await page.evaluate(() => window.__RUSH_HOUR__.nav.go('game', { levelId: 't01', from: 'menu' }));
    expect(await currentScreen(page)).toBe('game');
  });

  test('每个子页面都能返回主菜单（无死路）', async ({ page }) => {
    await openGame(page, { enterGame: false });
    for (const screen of ['select', 'settings', 'leaderboard', 'daily', 'privacy'] as const) {
      // 每个页面都从干净的主菜单状态进入，避免上一个循环的栈残留干扰断言
      await goHome(page);
      await goto(page, screen);
      const ok = await page.evaluate(() => window.__RUSH_HOUR__.nav.back());
      expect(ok, `${screen} 应有可返回的栈`).toBe(true);
      expect(await currentScreen(page), `${screen} 返回后应是 menu`).toBe('menu');
    }
  });

  test('游戏页返回：从选关进入回选关页，从主菜单进入回主菜单', async ({ page }) => {
    await openGame(page, { enterGame: false });

    // 主菜单 → 游戏 → 返回 → 主菜单
    await goHome(page);
    await page.evaluate(() =>
      window.__RUSH_HOUR__.nav.go('game', { levelId: 't01', from: 'menu' }),
    );
    expect(await currentScreen(page)).toBe('game');
    await page.evaluate(() => window.__RUSH_HOUR__.nav.back());
    expect(await currentScreen(page), '从主菜单进游戏，返回应回主菜单').toBe('menu');

    // 选关页 → 游戏 → 返回 → 选关页
    await goto(page, 'select');
    await page.evaluate(() => window.__RUSH_HOUR__.select.openLevel('t01'));
    expect(await currentScreen(page)).toBe('game');
    await page.evaluate(() => window.__RUSH_HOUR__.nav.back());
    expect(await currentScreen(page), '从选关进游戏，返回应回选关页').toBe('select');
  });

  test('导航栈深度不会无限增长（maxStack 上限生效）', async ({ page }) => {
    await openGame(page, { enterGame: false });
    // 反复在多个页面间来回导航：实现里有 maxStack 上限，栈不应失控。
    // 这是真实风险：玩家连续点"返回/前进"几十次后栈若不设上限，
    // 会一直持有已退出屏幕的引用（内存泄漏）。
    const pages = ['settings', 'leaderboard', 'privacy', 'daily', 'select'] as const;
    for (let i = 0; i < 20; i++) {
      await page.evaluate((p) => window.__RUSH_HOUR__.nav.go(p as never), pages[i % pages.length]);
    }
    const depth = await page.evaluate(() => window.__RUSH_HOUR__.nav.stackDepth());
    expect(depth).toBeLessThanOrEqual(8);
  });

  test('游戏页处于"被管理器驱动"模式，没有自驱动 rAF 竞争', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.nav.go('game', { levelId: 't01', from: 'menu' }));
    // 双 rAF 会互相覆盖绘制；selfDriven 必须为 false
    const selfDriven = await page.evaluate(() => window.__RUSH_HOUR__.screen.isSelfDriven);
    expect(selfDriven).toBe(false);
  });
});
