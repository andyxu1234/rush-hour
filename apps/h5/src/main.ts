/**
 * H5 入口 —— 与小游戏入口同构，唯一差别是平台实现换成 WebPlatform。
 *
 * 装配职责已全部下沉到 AppShell（app-bootstrap）：本文件只做三件事：
 *   1. 选择平台实现；
 *   2. 提供远端契约实现；
 *   3. 暴露调试/测试接口。
 * 这样 H5 与小游戏的入口差异被压到最小，不会各自漂移。
 *
 * P5 接入自建 FastAPI 时，把 LocalOnlyApi 换成 HttpRemoteApi 即可，
 * core / render / 各屏幕零改动。
 */

import { AppShell, LocalOnlyApi, WebPlatform, levelData, type RemoteApi } from '@rush-hour/app-bootstrap';

function main(): void {
  const platform = new WebPlatform();
  // 本轮不做真实后端（P5）；契约先行，实现留空
  const remote: RemoteApi = new LocalOnlyApi();

  const app = new AppShell({ platform, levelData, remote });
  app.start();

  // 首屏就绪：移除加载指示（1.5s 内可交互的验收口径从此处开始计）
  globalThis.document?.getElementById('boot')?.remove();

  // 暴露给 e2e / 调试台：Playwright 用它驱动确定性操作，避免依赖像素坐标。
  // 注意必须同时暴露 `screen`（游戏屏）以兼容既有 e2e 辅助函数，
  // 并新增 `nav`（导航）与 `analytics`（埋点）供新用例使用。
  (globalThis as unknown as Record<string, unknown>).__RUSH_HOUR__ = {
    app,
    screen: app.gameScreen,
    select: app.selectScreen,
    menu: app.menuScreen,
    settings: app.settingsScreen,
    leaderboard: app.leaderboardScreen,
    privacy: app.privacyScreen,
    nav: {
      // go 走 push（压栈）而非 navigate：
      //   与"玩家从菜单点击进入"完全一致，这样 back() 才能退回上一屏。
      //   e2e 若用 navigate，就永远测不到真实的返回链路。
      go: (id: string, params?: unknown) => app.manager.push(id as never, params),
      back: () => app.manager.back(),
      reset: (id: string) => app.manager.reset(id as never),
      current: () => app.manager.currentId,
      stackDepth: () => app.manager.stackDepth,
      openLevel: (id: string, from?: 'menu' | 'select' | 'daily') => app.openLevel(id, from),
    },
    analytics: {
      peek: () => app.analytics.peek(),
      drain: () => app.analytics.drain(),
      countOf: (name: string) => app.analytics.countOf(name as never),
      clear: () => app.analytics.clear(),
    },
    repo: app.repo,
    save: app.save,
    wipeSave: () => app.wipeSave(),
  };
}

try {
  main();
} catch (err) {
  console.error('[rush-hour] 启动失败', err);
  const boot = globalThis.document?.getElementById('boot');
  if (boot) boot.textContent = '启动失败，请刷新重试';
}
