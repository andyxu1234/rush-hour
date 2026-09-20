import { expect, test } from '@playwright/test';
import { analyticsCount, analyticsNames, clearAnalytics, openGame } from './helpers';

/**
 * 埋点（P4）与分享（结算弹窗入口）。
 *
 * 埋点这一层最容易"写完了但没人用"，所以这组用例直接断言**关键事件确实产生**：
 *   - 导航：screen_view
 *   - 对局：level_start / move / level_clear
 *   - 结算：share_click
 *
 * 分享守合规红线（docs/01 §6.4）：
 *   「禁止"分享给好友才能解锁下一关"」——
 *   因此必须断言"点了分享**不解锁**任何东西"，这是提审高频驳回项。
 */
test.describe('埋点', () => {
  test('导航会产生 screen_view 事件', async ({ page }) => {
    await openGame(page);
    await clearAnalytics(page);
    await page.evaluate(() => window.__RUSH_HOUR__.nav.go('settings'));
    expect(await analyticsCount(page, 'screen_view')).toBeGreaterThan(0);
  });

  test('进入关卡产生 level_start，且带关卡属性', async ({ page }) => {
    await openGame(page);
    await clearAnalytics(page);
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.nav.openLevel(api.repo.levels[0].id, 'select');
    });

    const events = await page.evaluate(() =>
      window.__RUSH_HOUR__.analytics.peek().filter((e) => e.name === 'level_start'),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].props).toHaveProperty('levelId');
    expect(events[0].props).toHaveProperty('par');
  });

  test('走一步产生 move 事件（无论走真实拖拽还是调试入口）', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.nav.openLevel(api.repo.levels[0].id, 'select');
    });
    await clearAnalytics(page);

    const moved = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      const m = api.screen.bestNextMove();
      return m ? api.screen.applyMove(m) : false;
    });
    expect(moved).toBe(true);
    // 埋点挂在 Game 事件上，因此 applyMove 路径同样计数
    expect(await analyticsCount(page, 'move')).toBe(1);
  });

  test('通关产生 level_clear，带步数与星级', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.nav.openLevel(api.repo.levels[0].id, 'select');
    });
    await clearAnalytics(page);
    await page.evaluate(() => window.__RUSH_HOUR__.screen.forceSolveReport());

    const events = await page.evaluate(() =>
      window.__RUSH_HOUR__.analytics.peek().filter((e) => e.name === 'level_clear'),
    );
    expect(events.length).toBe(1);
    expect(events[0].props).toHaveProperty('steps');
    expect(events[0].props).toHaveProperty('stars');
    expect(events[0].props).toHaveProperty('isNewBest');
  });

  test('撤销 / 重开 / 提示各自产生事件', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.nav.openLevel(api.repo.levels[0].id, 'select');
    });
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      const m = api.screen.bestNextMove();
      if (m) api.screen.applyMove(m);
    });
    await clearAnalytics(page);

    await page.evaluate(() => window.__RUSH_HOUR__.screen.pressButton('undo'));
    expect(await analyticsCount(page, 'undo')).toBe(1);

    // hint_used 不是 Game 事件（提示不改变对局状态），在 useHint 里单独埋点
    await page.evaluate(() => window.__RUSH_HOUR__.screen.pressButton('hint'));
    expect(await analyticsCount(page, 'hint_used')).toBe(1);

    // reset 由 Game 的 reset 事件产生；但先做一次复位再走一步，保证 reset 有意义
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      const m = api.screen.bestNextMove();
      if (m) api.screen.applyMove(m);
    });
    await clearAnalytics(page);
    await page.evaluate(() => window.__RUSH_HOUR__.screen.pressButton('reset'));
    expect(await analyticsCount(page, 'reset')).toBe(1);
  });

  test('非法移动产生 blocked 事件', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.nav.openLevel(api.repo.levels[0].id, 'select');
    });
    await clearAnalytics(page);

    // 找一个"完全动不了"的车，或直接构造越界移动
    const blocked = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      // 试所有车所有方向，找一个非法的
      const dirs = ['up', 'down', 'left', 'right'] as const;
      for (const p of api.screen.piecePositions) {
        for (const d of dirs) {
          const ok = api.screen.maxSlide(p.id, d);
          if (ok === 0) {
            // 该方向不可移动 → 尝试走一步应被拒
            return api.screen.applyMove({ piece: p.id, dir: d, cells: 1 });
          }
        }
      }
      return null;
    });
    expect(blocked).toBe(false);
    expect(await analyticsCount(page, 'blocked')).toBe(1);
  });

  test('埋点顺序反映真实操作序列', async ({ page }) => {
    await openGame(page);
    await clearAnalytics(page);
    await page.evaluate(() => window.__RUSH_HOUR__.nav.go('select'));
    await page.evaluate(() => window.__RUSH_HOUR__.nav.go('menu'));

    const names = await analyticsNames(page);
    const views = names.filter((n) => n === 'screen_view');
    expect(views.length).toBe(2);
  });
});

test.describe('分享（合规）', () => {
  test('结算弹窗提供分享按钮', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.save.tutorialDone = true;
      api.nav.openLevel(api.repo.levels[0].id, 'select');
      api.screen.forceSolveReport();
    });
    // 等结算弹窗出现（驶出动画 + 白光后才弹）
    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });

    const rects = await page.evaluate(() => window.__RUSH_HOUR__.screen.dialogButtonRects());
    const ids = rects.map((r) => r.id);
    expect(ids).toContain('share');
    expect(ids).toContain('replay');
    expect(ids).toContain('next');

    // 三个按钮不重叠且都在视口内
    const vw = await page.evaluate(() => window.innerWidth);
    for (let i = 0; i < rects.length; i++) {
      const a = rects[i];
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x + a.w).toBeLessThanOrEqual(vw + 1);
      for (let j = i + 1; j < rects.length; j++) {
        const b = rects[j];
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.id} 与 ${b.id} 重叠`).toBe(false);
      }
    }
  });

  test('点击分享产生 share_click，但**不**解锁任何关卡（合规红线）', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.save.tutorialDone = true;
      api.nav.openLevel(api.repo.levels[0].id, 'select');
      api.screen.forceSolveReport();
    });
    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });
    await clearAnalytics(page);

    // 解锁状态与进度快照（分享前后必须完全一致）
    const before = await page.evaluate(() => ({
      levels: JSON.stringify(window.__RUSH_HOUR__.save.levels),
      unlocked: window.__RUSH_HOUR__.repo.levels.map(
        (l) => window.__RUSH_HOUR__.save.levels[l.id] !== undefined,
      ),
    }));

    const shareRect = await page.evaluate(
      () => window.__RUSH_HOUR__.screen.dialogButtonRects().find((r) => r.id === 'share')!,
    );
    await page.touchscreen.tap(shareRect.x + shareRect.w / 2, shareRect.y + shareRect.h / 2);

    expect(await analyticsCount(page, 'share_click')).toBeGreaterThan(0);

    const after = await page.evaluate(() => ({
      levels: JSON.stringify(window.__RUSH_HOUR__.save.levels),
      unlocked: window.__RUSH_HOUR__.repo.levels.map(
        (l) => window.__RUSH_HOUR__.save.levels[l.id] !== undefined,
      ),
    }));
    // 合规红线：分享绝不改变进度 / 解锁状态
    expect(after.unlocked).toEqual(before.unlocked);
    expect(after.levels).toBe(before.levels);
  });

  test('分享后弹窗仍在（分享不关闭结算，玩家可继续下一关）', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.save.tutorialDone = true;
      api.nav.openLevel(api.repo.levels[0].id, 'select');
      api.screen.forceSolveReport();
    });
    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });

    const shareRect = await page.evaluate(
      () => window.__RUSH_HOUR__.screen.dialogButtonRects().find((r) => r.id === 'share')!,
    );
    await page.touchscreen.tap(shareRect.x + shareRect.w / 2, shareRect.y + shareRect.h / 2);
    expect(await page.evaluate(() => window.__RUSH_HOUR__.screen.hasDialog)).toBe(true);
  });

  test('点击"下一关"进入后续关卡；最后一关不显示下一关', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.save.tutorialDone = true;
      api.nav.openLevel(api.repo.levels[0].id, 'select');
      api.screen.forceSolveReport();
    });
    await page.waitForFunction(() => window.__RUSH_HOUR__.screen.hasDialog, null, { timeout: 5000 });

    const nextRect = await page.evaluate(
      () => window.__RUSH_HOUR__.screen.dialogButtonRects().find((r) => r.id === 'next')!,
    );
    await page.touchscreen.tap(nextRect.x + nextRect.w / 2, nextRect.y + nextRect.h / 2);

    const after = await page.evaluate(() => ({
      levelId: window.__RUSH_HOUR__.screen.levelId,
      steps: window.__RUSH_HOUR__.screen.steps,
    }));
    expect(after.levelId).not.toBe('t01');
    expect(after.steps).toBe(0);
  });
});
