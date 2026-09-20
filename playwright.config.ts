import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * 根 package.json 没有 "type": "module"，Playwright 以 CJS 加载本配置，
 * 因此这里不能用 import.meta.url —— 用 process.cwd() 推导工作区根即可
 * （Playwright 总是从配置文件所在目录启动）。
 */
const root = process.cwd();
const h5Dir = resolve(root, 'apps/h5');
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');

/**
 * L5 端到端（docs/06 §L5）。
 * 只跑 H5 —— 小游戏侧无法在 CI 里自动化，属"代码可编译"级别验证。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 6_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // ★ 必须开启：否则 page.touchscreen.* 抛 "hasTouch must be enabled"，
    //   而真机只走 touch 路径 —— 关掉它就等于放弃覆盖真实使用场景。
    hasTouch: true,
  },
  /**
   * ⚠️ 每个 project 都必须显式声明 `hasTouch: true`。
   *
   * 顶层 `use.hasTouch` 会被 project 级别的 `use` **覆盖**（不是合并）：
   * 展开 `devices['Desktop Chrome']` 时若该设备默认 hasTouch=false，
   * 顶层设置就被吃掉，于是 `page.touchscreen.tap()` 直接抛
   * "hasTouch must be enabled on the browser context"。
   * 症状极具迷惑性：同一个 spec 在某个 project 下全绿、另一个全红。
   */
  projects: [
    {
      name: 'iphone-375x667',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 667 }, hasTouch: true },
    },
    {
      name: 'iphone-xr-414x896',
      use: { ...devices['Desktop Chrome'], viewport: { width: 414, height: 896 }, hasTouch: true },
    },
    {
      name: 'ipad-768x1024',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
  ],
  webServer: {
    // 用绝对路径指向工作区根的 vite：npm workspace 会把依赖提升到根，
    // 相对路径会以 cwd(apps/h5) 解析而找不到模块。
    command: `node "${viteBin}" preview --port 4173 --host 127.0.0.1 --strictPort`,
    cwd: h5Dir,
    url: 'http://127.0.0.1:4173',
    // ⚠️ 不要复用已有服务：本地调试常残留上一次的 preview 进程，
    // 复用会让本次跑在**旧产物**上（甚至旧进程已死、页面加载失败），
    // 表现为大量用例在几百毫秒内集体失败，极易误判为代码回归。
    // 配合 --strictPort：端口被占时直接报错，而不是静默连到别人的服务。
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
