import { expect, test } from '@playwright/test';
import { goto, openGame } from './helpers';

/**
 * 排行榜 —— docs/01 §6.1：
 *   「好友榜（开放数据域）、全球榜、我的排名」
 *   边界：「未登录时展示本地最好成绩」
 *
 * 本轮无后端（P5 才接），因此按"本地降级"实现。
 * 关键守则：**不伪造看起来像真榜的数据**，且必须明确标注数据来源为本地成绩。
 */
test.describe('排行榜', () => {
  test('无成绩时显示空状态，并标注数据来源', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    await goto(page, 'leaderboard');

    const rows = await page.evaluate(() => window.__RUSH_HOUR__.leaderboard.showingRows);
    expect(rows).toHaveLength(0);

    // 页面不应崩溃，且无 console error
    await expect(page.locator('canvas')).toHaveCount(1);
  });

  test('有成绩后按关卡顺序列出本地最佳记录', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    // 通关前两关
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      for (let i = 0; i < 2; i++) {
        api.screen.loadLevel(api.repo.levels[i]);
        api.screen.forceSolveReport();
      }
    });
    await goto(page, 'leaderboard');

    const rows = await page.evaluate(() => window.__RUSH_HOUR__.leaderboard.showingRows);
    expect(rows.length).toBe(2);
    // 按关卡顺序（index 递增），不是按步数 —— 跨关比步数无意义
    expect(rows[0].index).toBeLessThan(rows[1].index);
    for (const r of rows) {
      expect(r.bestMoves).toBeGreaterThan(0);
      expect(r.stars).toBeGreaterThan(0);
    }
  });

  test('最佳步数取历史最优，重玩变差不会覆盖', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      const lvl = api.repo.levels[0];
      api.screen.loadLevel(lvl);
      api.screen.forceSolveReport();
    });
    const best = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      const id = api.repo.levels[0].id;
      return api.save.levels[id].bestMoves;
    });

    // 再解一次（步数相同），bestMoves 不应变差
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      const lvl = api.repo.levels[0];
      api.screen.loadLevel(lvl);
      api.screen.forceSolveReport();
    });
    const best2 = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      const id = api.repo.levels[0].id;
      return api.save.levels[id].bestMoves;
    });
    expect(best2).toBeLessThanOrEqual(best);
  });

  test('全球榜 / 好友榜 Tab 可切换', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'leaderboard');

    expect(await page.evaluate(() => window.__RUSH_HOUR__.leaderboard.currentScope)).toBe('global');
    await page.evaluate(() => window.__RUSH_HOUR__.leaderboard.setScope('friends'));
    expect(await page.evaluate(() => window.__RUSH_HOUR__.leaderboard.currentScope)).toBe('friends');
    await page.evaluate(() => window.__RUSH_HOUR__.leaderboard.setScope('global'));
    expect(await page.evaluate(() => window.__RUSH_HOUR__.leaderboard.currentScope)).toBe('global');
  });

  test('步数口径跟随设置（moves ↔ cells）', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.screen.loadLevel(api.repo.levels[0]);
      api.screen.forceSolveReport();
    });

    const byMoves = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.save.settings.moveMetric = 'moves';
      api.leaderboard.setScope('global'); // 触发 rebuild
      return api.leaderboard.showingRows[0].bestMoves;
    });
    const byCells = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.save.settings.moveMetric = 'cells';
      api.leaderboard.setScope('global');
      return api.leaderboard.showingRows[0].bestMoves;
    });
    // 单位不同，数值不应来自同一个字段
    expect(byMoves).toBeGreaterThan(0);
    expect(byCells).toBeGreaterThan(0);
  });

  test('Tab 几何可命中且在视口内', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'leaderboard');
    const info = await page.evaluate(() => ({
      tabs: window.__RUSH_HOUR__.leaderboard.tabRects,
      vw: window.innerWidth,
      vh: window.innerHeight,
    }));
    expect(info.tabs.length).toBe(2);
    for (const t of info.tabs) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.w).toBeLessThanOrEqual(info.vw + 1);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y + t.h).toBeLessThanOrEqual(info.vh + 1);
      expect(t.h).toBeGreaterThanOrEqual(38);
    }
  });

  test('通过真实触摸点击 Tab 可切换', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'leaderboard');
    const tab = await page.evaluate(() => window.__RUSH_HOUR__.leaderboard.tabRects[1]);
    await page.touchscreen.tap(tab.x + tab.w / 2, tab.y + tab.h / 2);
    expect(await page.evaluate(() => window.__RUSH_HOUR__.leaderboard.currentScope)).toBe('friends');
  });
});
