/**
 * 小游戏入口 —— 与 H5 入口同构，唯一差别是平台实现换成 WxPlatform。
 *
 * 这正是"冻结 Platform 接口"的回报：核心逻辑、渲染层与全部屏幕零改动即可双端运行。
 * 装配逻辑统一在 AppShell 里，两端入口只差一行 `new XxxPlatform()`。
 */

import { AppShell, LocalOnlyApi, WxPlatform, type RemoteApi } from '@rush-hour/app-bootstrap';

declare const __LEVELS__: unknown;

const platform = new WxPlatform();
// 本轮不做真实后端（P5）；契约先行，实现留空
const remote: RemoteApi = new LocalOnlyApi();

const app = new AppShell({ platform, levelData: __LEVELS__, remote });
app.start();
