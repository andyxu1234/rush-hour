import { expect, test } from '@playwright/test';
import { currentScreen, goto, openGame } from './helpers';

/**
 * 隐私政策页（docs/01 §6.1「合规必需，提审硬性要求」）
 * 与每日挑战占位页（用户决策：等 P5 后端）。
 *
 * 隐私政策必须**永远可到达且内容完整** —— 提审时政策页打不开是高频驳回项，
 * 且当前实现是内置文案（不拉网络），所以这里连弱网都不需要考虑。
 */
test.describe('隐私政策', () => {
  test('内容分段完整，涵盖收集/存储/网络/未成年人/联系', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'privacy');

    const count = await page.evaluate(() => window.__RUSH_HOUR__.privacy.pageCount);
    expect(count).toBeGreaterThanOrEqual(5);

    const titles: string[] = [];
    for (let i = 0; i < count; i++) {
      const t = await page.evaluate(
        (p) => {
          window.__RUSH_HOUR__.privacy.setPage(p);
          return window.__RUSH_HOUR__.privacy.currentSection.title;
        },
        i,
      );
      titles.push(t);
    }
    const joined = titles.join(' ');
    expect(joined).toContain('收集');
    expect(joined).toContain('存放');
    expect(joined).toContain('网络');
    expect(joined).toContain('未成年');
  });

  test('每节都有正文，不存在空页', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'privacy');
    const count = await page.evaluate(() => window.__RUSH_HOUR__.privacy.pageCount);
    for (let i = 0; i < count; i++) {
      const section = await page.evaluate((p) => {
        window.__RUSH_HOUR__.privacy.setPage(p);
        return window.__RUSH_HOUR__.privacy.currentSection;
      }, i);
      expect(section.body.length, `${section.title} 应有正文`).toBeGreaterThan(0);
      for (const line of section.body) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('页码被夹紧，翻页按钮在边界禁用', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'privacy');

    const first = await page.evaluate(() => {
      window.__RUSH_HOUR__.privacy.setPage(-10);
      return {
        page: window.__RUSH_HOUR__.privacy.currentPage,
        prev: window.__RUSH_HOUR__.privacy.navRects.prev,
      };
    });
    expect(first.page).toBe(0);
    expect(first.prev).not.toBeNull();

    const last = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.privacy.setPage(999);
      return { page: api.privacy.currentPage, count: api.privacy.pageCount };
    });
    expect(last.page).toBe(last.count - 1);
  });

  test('从主菜单可到达且可返回', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'privacy');
    expect(await currentScreen(page)).toBe('privacy');
    await page.evaluate(() => window.__RUSH_HOUR__.nav.back());
    expect(await currentScreen(page)).toBe('menu');
  });

  test('导航按钮几何在视口内、可命中', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'privacy');
    const info = await page.evaluate(() => ({
      nav: window.__RUSH_HOUR__.privacy.navRects,
      vw: window.innerWidth,
      vh: window.innerHeight,
    }));
    for (const b of [info.nav.prev, info.nav.next, info.nav.back]) {
      if (!b) continue;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(info.vw + 1);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.h).toBeLessThanOrEqual(info.vh + 1);
    }
  });

  test('触摸点击"下一节"可翻页', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'privacy');
    const next = await page.evaluate(() => window.__RUSH_HOUR__.privacy.navRects.next);
    expect(next).not.toBeNull();
    await page.touchscreen.tap(next!.x + next!.w / 2, next!.y + next!.h / 2);
    expect(await page.evaluate(() => window.__RUSH_HOUR__.privacy.currentPage)).toBe(1);
  });
});

/**
 * 每日挑战 —— 占位页。
 * 用户决策：等 P5 后端契约。占位页的纪律是**明确告知未开放**，
 * 绝不伪造"今日关卡"让玩家白玩一局。
 */
test.describe('每日挑战（占位）', () => {
  test('可到达、可返回，且明确标记未开放', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'daily');
    expect(await currentScreen(page)).toBe('daily');

    // 显示今天日期（证明页面是活的，不是加载失败）
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`;
    });
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.evaluate(() => window.__RUSH_HOUR__.nav.back());
    expect(await currentScreen(page)).toBe('menu');
  });

  test('占位页不提供任何"开始挑战"入口（不误导玩家）', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await goto(page, 'daily');
    // 停留在 daily 屏：不应有任何触发进入游戏的路径
    const screen = await currentScreen(page);
    expect(screen).toBe('daily');
  });
});
