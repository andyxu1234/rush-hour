import { expect, test } from '@playwright/test';
import { goto, openGame } from './helpers';

/**
 * 新手引导遮罩 —— docs/01 §9。
 *
 * 规格要求（原文）：前 3 关即教学关，用**情境化遮罩 + 文案**：
 *   t01：「向右拖动红车开出出口」
 *   t02：「竖车只能上下移动，先把它挪开」
 *   t03：「一次只能动一辆车，想好顺序」
 *
 * 重点守三条：
 *   1. 引导必须是**前 3 关**触发，第 4 关起不再出现；
 *   2. 引导期间**吞掉指针**（否则玩家能在遮罩下面误操作棋盘）；
 *   3. 引导状态持久化到存档，且设置页可重看。
 *
 * ?? 本文件是唯一使用 `keepTutorial: true` 的 spec：
 *    其余玩法类用例默认跳过引导（遮罩会吞指针，否则全被挡住）。
 */
test.describe('新手引导', () => {
  /** 打开游戏并停在第 idx 关，保留引导 */
  async function openTutorialLevel(page: import('@playwright/test').Page, idx: number) {
    await openGame(page, { keepTutorial: true, enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    await page.evaluate((i) => {
      const api = window.__RUSH_HOUR__;
      api.nav.openLevel(api.repo.levels[i].id, 'select');
    }, idx);
  }

  test('首次进入第 1 关触发引导遮罩', async ({ page }) => {
    await openTutorialLevel(page, 0);
    expect(await page.evaluate(() => window.__RUSH_HOUR__.screen.hasTutorial)).toBe(true);
  });

  test('引导高亮洞落在红车所在位置（情境化而非全屏文案）', async ({ page }) => {
    await openTutorialLevel(page, 0);

    const info = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      const hole = api.screen.tutorialHoleRect();
      const red = api.screen.piecePositions.find((p) => p.id === 'R')!;
      const l = api.screen.currentLayout;
      return { hole, red, layout: l };
    });
    expect(info.hole, '第 1 关应挖洞高亮红车').not.toBeNull();

    // 洞必须覆盖红车所在格（允许 METRICS 的 pad 与取整误差）
    const redX = info.layout.boardX + info.red.c * info.layout.cell;
    const redY = info.layout.boardY + info.red.r * info.layout.cell;
    expect(info.hole!.x).toBeLessThanOrEqual(redX);
    expect(info.hole!.x + info.hole!.w).toBeGreaterThanOrEqual(redX + info.layout.cell);
    expect(info.hole!.y).toBeLessThanOrEqual(redY);
    expect(info.hole!.y + info.hole!.h).toBeGreaterThanOrEqual(redY + info.layout.cell);
  });

  test('引导期间棋盘不可操作（指针被吞）', async ({ page }) => {
    await openTutorialLevel(page, 0);

    const before = await page.evaluate(() => window.__RUSH_HOUR__.screen.steps);
    expect(before).toBe(0);

    // 在红车位置拖拽：引导层应吞掉，步数必须不变
    const info = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      const red = api.screen.piecePositions.find((p) => p.id === 'R')!;
      const l = api.screen.currentLayout;
      return {
        x: l.boardX + red.c * l.cell + l.cell,
        y: l.boardY + red.r * l.cell + l.cell / 2,
      };
    });
    await page.touchscreen.tap(info.x, info.y);

    const after = await page.evaluate(() => window.__RUSH_HOUR__.screen.steps);
    expect(after, '引导期间不应产生任何走子').toBe(0);
  });

  test('点"我知道了"完成引导，状态写入存档', async ({ page }) => {
    await openTutorialLevel(page, 0);
    expect(await page.evaluate(() => window.__RUSH_HOUR__.screen.hasTutorial)).toBe(true);

    // 从真实的按钮矩形取坐标（不猜像素，否则布局一改就误报）
    const rects = await page.evaluate(() => window.__RUSH_HOUR__.screen.tutorialButtonRects());
    expect(rects.ok, '应暴露"我知道了"按钮矩形').not.toBeNull();
    const btn = rects.ok!;

    const vw = await page.evaluate(() => window.innerWidth);
    const vh = await page.evaluate(() => window.innerHeight);
    expect(btn.x).toBeGreaterThanOrEqual(0);
    expect(btn.y).toBeGreaterThanOrEqual(0);
    expect(btn.x + btn.w).toBeLessThanOrEqual(vw + 1);
    expect(btn.y + btn.h).toBeLessThanOrEqual(vh + 1);

    await page.touchscreen.tap(btn.x + btn.w / 2, btn.y + btn.h / 2);

    const state = await page.evaluate(() => ({
      hasTutorial: window.__RUSH_HOUR__.screen.hasTutorial,
      tutorialDone: window.__RUSH_HOUR__.save.tutorialDone,
    }));
    expect(state.hasTutorial).toBe(false);
    expect(state.tutorialDone).toBe(true);
  });

  test('点"跳过"同样完成引导', async ({ page }) => {
    await openTutorialLevel(page, 0);

    const rects = await page.evaluate(() => window.__RUSH_HOUR__.screen.tutorialButtonRects());
    expect(rects.skip).not.toBeNull();
    const skip = rects.skip!;
    await page.touchscreen.tap(skip.x + skip.w / 2, skip.y + skip.h / 2);

    expect(await page.evaluate(() => window.__RUSH_HOUR__.screen.hasTutorial)).toBe(false);
    expect(await page.evaluate(() => window.__RUSH_HOUR__.save.tutorialDone)).toBe(true);
  });

  test('三关的引导文案与规格书一致', async ({ page }) => {
    const expected = [
      '向右拖动红车开出出口',
      '竖车只能上下移动，先把它挪开',
      '一次只能动一辆车，想好顺序',
    ];
    // 刻意留在同一个页面会话里连续切关（不 reload）：
    //   reload 会重新解析存档、重建 AppShell，把"切关是否让引导跟随"这件事
    //   和"冷启动是否正确"两件事混在一起，失败时无法区分是哪一侧的问题。
    await openGame(page, { keepTutorial: true, enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());

    for (let i = 0; i < 3; i++) {
      // 先切关，再单独查询 —— 把"切关"与"读状态"分两个 evaluate，
      // 避免某些内核下 evaluate 内的连续读取与 rAF 帧交错导致读到中间态。
      await page.evaluate((idx) => {
        const api = window.__RUSH_HOUR__;
        api.nav.openLevel(api.repo.levels[idx].id, 'select');
      }, i);
      await page.waitForFunction(
        (idx) => window.__RUSH_HOUR__.screen.levelId === `t0${idx + 1}`,
        i,
        { timeout: 3000 },
      );
      const actual = await page.evaluate(() => ({
        text: window.__RUSH_HOUR__.screen.tutorialText,
        step: window.__RUSH_HOUR__.screen.tutorialStep,
        levelId: window.__RUSH_HOUR__.screen.levelId,
      }));
      expect(actual.levelId, `应停在第 ${i + 1} 关`).toBe(`t0${i + 1}`);
      expect(actual.step, `第 ${i + 1} 关的引导步号`).toBe(i + 1);
      expect(actual.text, `第 ${i + 1} 关引导文案`).toBe(expected[i]);
    }
  });

  test('引导完成后再进第 1 关不再弹出', async ({ page }) => {
    await openGame(page); // 默认已标记 tutorialDone
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.save.tutorialDone = true;
      api.nav.openLevel(api.repo.levels[0].id, 'select');
    });
    expect(await page.evaluate(() => window.__RUSH_HOUR__.screen.hasTutorial)).toBe(false);
  });

  test('第 4 关及之后不触发引导（只教学前 3 关）', async ({ page }) => {
    await openGame(page, { keepTutorial: true, enterGame: false });
    await page.evaluate(() => window.__RUSH_HOUR__.wipeSave());
    const has = await page.evaluate(() => {
      const api = window.__RUSH_HOUR__;
      api.nav.openLevel(api.repo.levels[3].id, 'select');
      return api.screen.hasTutorial;
    });
    expect(has, '第 4 关不应触发引导').toBe(false);
  });

  test('前 3 关逐关触发引导', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await openTutorialLevel(page, i);
      const has = await page.evaluate(() => window.__RUSH_HOUR__.screen.hasTutorial);
      expect(has, `第 ${i + 1} 关应触发引导`).toBe(true);
    }
  });

  test('设置页"重看引导"能再次触发', async ({ page }) => {
    await openGame(page, { enterGame: false });
    await page.evaluate(() => {
      window.__RUSH_HOUR__.save.tutorialDone = true;
    });
    // 必须真正进入设置页再触发（设置页是触发入口，不是在任意屏都能调的）
    await goto(page, 'settings');
    await page.evaluate(() => window.__RUSH_HOUR__.settings.trigger('tutorial'));

    const state = await page.evaluate(() => ({
      screen: window.__RUSH_HOUR__.nav.current(),
      hasTutorial: window.__RUSH_HOUR__.screen.hasTutorial,
      tutorialDone: window.__RUSH_HOUR__.save.tutorialDone,
    }));
    expect(state.screen).toBe('game');
    expect(state.hasTutorial).toBe(true);
    expect(state.tutorialDone).toBe(false);
  });
});
