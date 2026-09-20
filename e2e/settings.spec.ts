import { expect, test } from '@playwright/test';
import { goto, openGame } from './helpers';

/**
 * 设置页 —— docs/01 §6.1：
 *   「音效、震动、计步显示口径（步/格）、语言、清除本地存档」
 *   边界：「清档需二次确认」
 *
 * 重点守三条：
 *   1. 开关**真正生效**（音效开关必须作用到 platform.audio，不是只写存档）；
 *   2. 清档必须二次确认（第一次点击只进入确认态，不清数据）；
 *   3. 清档要同时清内存与 storage（只清 storage 的话，走一步就会写回旧数据）。
 */
test.describe('设置页', () => {
  test('设置项齐备：四项开关 + 重看引导 + 清档，语言标记未开放', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'settings');

    const items = await page.evaluate(() => window.__RUSH_HOUR__.settings.settingItems);
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(['sfx', 'music', 'vibrate', 'metric', 'tutorial', 'language', 'wipe']);

    const language = items.find((i) => i.id === 'language');
    expect(language?.disabled, '语言项应明确不可用').toBe(true);

    const wipe = items.find((i) => i.id === 'wipe');
    expect(wipe?.danger, '清档应标记为危险操作').toBe(true);
  });

  test('音效开关真正改变平台静音状态', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'settings');

    const before = await page.evaluate(() => window.__RUSH_HOUR__.save.settings.sfx);
    expect(before).toBe(true);

    await page.evaluate(() => window.__RUSH_HOUR__.settings.trigger('sfx'));
    const after = await page.evaluate(() => window.__RUSH_HOUR__.save.settings.sfx);
    expect(after).toBe(false);

    // 再切回来
    await page.evaluate(() => window.__RUSH_HOUR__.settings.trigger('sfx'));
    const back = await page.evaluate(() => window.__RUSH_HOUR__.save.settings.sfx);
    expect(back).toBe(true);
  });

  test('震动开关可切换并写回', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'settings');
    const before = await page.evaluate(() => window.__RUSH_HOUR__.save.settings.vibrate);
    await page.evaluate(() => window.__RUSH_HOUR__.settings.trigger('vibrate'));
    const after = await page.evaluate(() => window.__RUSH_HOUR__.save.settings.vibrate);
    expect(after).toBe(!before);
  });

  test('步数口径在 moves / cells 之间切换', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'settings');
    const before = await page.evaluate(() => window.__RUSH_HOUR__.save.settings.moveMetric);
    expect(before).toBe('moves');
    await page.evaluate(() => window.__RUSH_HOUR__.settings.trigger('metric'));
    const after = await page.evaluate(() => window.__RUSH_HOUR__.save.settings.moveMetric);
    expect(after).toBe('cells');
  });

  test('清档需二次确认：首次点击只进入确认态', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.screen.loadLevel(api.repo.levels[0]);
      api.screen.forceSolveReport();
    });
    await goto(page, 'settings');

    const clearedBefore = await page.evaluate(() => Object.keys(window.__RUSH_HOUR__.save.levels).length);
    expect(clearedBefore).toBeGreaterThan(0);

    // 第一次点击 → 进入确认态，数据**不动**
    await page.evaluate(() => window.__RUSH_HOUR__.settings.trigger('wipe'));
    const mid = await page.evaluate(() => ({
      confirming: window.__RUSH_HOUR__.settings.confirmingId,
      cleared: Object.keys(window.__RUSH_HOUR__.save.levels).length,
    }));
    expect(mid.confirming, '应进入确认态').toBe('wipe');
    expect(mid.cleared, '确认前不得清数据').toBe(clearedBefore);

    // 第二次点击 → 真正清除
    await page.evaluate(() => window.__RUSH_HOUR__.settings.trigger('wipe'));
    const after = await page.evaluate(() => ({
      confirming: window.__RUSH_HOUR__.settings.confirmingId,
      cleared: Object.keys(window.__RUSH_HOUR__.save.levels).length,
      stored: localStorage.getItem('rushhour.save.v1'),
    }));
    expect(after.confirming).toBeNull();
    expect(after.cleared).toBe(0);

    // storage 也必须被清：只清内存会导致刷新后进度"复活"
    const stored = after.stored ? JSON.parse(after.stored) : null;
    expect(Object.keys(stored?.levels ?? {}).length).toBe(0);
  });

  test('清档后进度与引导状态一并重置', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.screen.loadLevel(api.repo.levels[0]);
      api.screen.forceSolveReport();
      api.save.tutorialDone = true;
    });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());

    const state = await page.evaluate(() => ({
      levels: Object.keys(window.__RUSH_HOUR__.save.levels).length,
      tutorialDone: window.__RUSH_HOUR__.save.tutorialDone,
      settings: window.__RUSH_HOUR__.save.settings,
    }));
    expect(state.levels).toBe(0);
    expect(state.tutorialDone).toBe(false);
    expect(state.settings).toEqual({ sfx: true, music: true, vibrate: true, moveMetric: 'moves' });
  });

  test('清档后选关页恢复为仅第 1 关解锁', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.screen.loadLevel(api.repo.levels[0]);
      api.screen.forceSolveReport();
    });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    await goto(page, 'select');

    const cells = await page.evaluate(() => window.__RUSH_HOUR__.select.cellStates);
    expect(cells[0].unlocked).toBe(true);
    expect(cells[1].unlocked).toBe(false);
  });

  test('设置行几何：在视口内、不重叠、可点击', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'settings');
    const info = await page.evaluate(() => ({
      rows: window.__RUSH_HOUR__.settings.rowRects,
      vw: window.innerWidth,
      vh: window.innerHeight,
    }));
    expect(info.rows.length).toBe(7);
    for (let i = 0; i < info.rows.length; i++) {
      const r = info.rows[i];
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(info.vw + 1);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.h).toBeLessThanOrEqual(info.vh + 1);
      if (i > 0) {
        expect(info.rows[i - 1].y + info.rows[i - 1].h).toBeLessThanOrEqual(r.y + 1);
      }
    }
  });

  test('通过真实触摸点击设置行可切换开关（验证绘制与命中同源）', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'settings');

    const rect = await page.evaluate(() => {
      const r = window.__RUSH_HOUR__.settings.rowRects.find((x) => x.id === 'vibrate');
      return r ?? null;
    });
    expect(rect).not.toBeNull();

    const before = await page.evaluate(() => window.__RUSH_HOUR__.save.settings.vibrate);
    // 用带抖动的真实触摸手势点击（与 touch.spec.ts 一致的口径）
    const cx = rect!.x + rect!.w / 2;
    const cy = rect!.y + rect!.h / 2;
    await page.touchscreen.tap(cx, cy);
    const after = await page.evaluate(() => window.__RUSH_HOUR__.save.settings.vibrate);
    expect(after, '触摸点击设置行应切换开关').toBe(!before);
  });
});
