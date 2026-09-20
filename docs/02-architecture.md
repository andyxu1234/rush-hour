# 02 · 技术架构与选型

---

## 1. 前端选型：为什么是"纯 TypeScript + Canvas"，而不是 Cocos Creator

| 方案 | 优点 | 致命问题 | 结论 |
|---|---|---|---|
| **Cocos Creator 3.x** | 一键发布小游戏、UI/动画/音频/分包开箱即用 | 场景与预制体由 **GUI 编辑器**产出（`.scene`/`.prefab` 序列化文件）。coding agent 只能在终端里改代码，无法可靠地"在编辑器里拖控件、连引用"，产出的工程极大概率跑不起来 | ❌ |
| LayaAir | 同上 | 同上 | ❌ |
| Unity WebGL → 小游戏 | C# 可复用 | 包体 20MB+、启动慢、WASM 转换链路长，对一个 6×6 网格游戏是巨大浪费 | ❌ |
| **纯 TS + Canvas 2D（代码优先）** | 全部资产用代码描述，agent 可完整读写；包体最小；逻辑可单测；可在 Node/浏览器里自动化验证 | 需自研 UI/动画/音频/适配层（约 1500 行一次投入） | ✅ **采用** |

**决定性理由**：本项目将由 coding agent 开发。凡是"必须人工在图形界面里操作"的技术栈都是阻塞项。代码优先 = 全流程可自动化。

**渲染后端**：先用 `CanvasRenderingContext2D`。6×6 网格 + 十几辆圆角矩形，2D 完全够用，且兼容性最好。若后期要粒子/发光/复杂动效，再切换 WebGL（PixiJS）——**渲染层已抽象成接口，切换只改一个文件**。

---

## 2. 双端架构（一次开发，两个产物）

```
                 packages/core  （纯逻辑，零平台依赖，可跑在 Node 里）
                 规则 / 求解器 / 关卡模型 / 状态机 / 存档结构
                          │
                  packages/render （渲染 + 输入 + 动画，零平台依赖）
                          │  依赖一个 Platform 接口
        ┌─────────────────┴─────────────────┐
   apps/h5  (Platform 的浏览器实现)     apps/minigame (Platform 的 wx 实现)
   Vite dev server + Playwright 自动化   esbuild 打包 + 微信开发者工具/真机
```

- **H5 产物是开发与 CI 的主战场**：`npm run dev` 起本地服务，Playwright 可以真的拖拽、截屏、断言通关状态。小游戏环境无法在 CI 里跑，所以逻辑正确性必须由 H5 侧承担。
- **小游戏产物是发行物**：只比 H5 多一个 `Platform` 实现 + `game.json`。
- 目标复用率 **≥ 95%**。

---

## 3. 仓库结构（pnpm workspace）

```
rush-hour/
├── package.json                 # workspace 根，脚本统一入口
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docs/                        # 本规格书
├── tools/
│   ├── rush_hour.py             # 参考求解器 + 关卡生成器（已跑通）
│   └── check_levels.py          # 校验 data/levels.json 全部不变量（P3）
├── data/
│   ├── levels.json              # 内置关卡包（随包发布）
│   └── levels.verify.json       # 含解答（仅测试，不进包）
├── packages/
│   ├── core/                    # ★ 纯逻辑，无 IO 无渲染
│   │   ├── src/model.ts         # Board/Piece/State 类型与不变量
│   │   ├── src/moves.ts         # 合法走子生成
│   │   ├── src/solver.ts        # BFS / 多源反向 BFS / 最优解条数 DP
│   │   ├── src/game.ts          # 对局状态机（含撤销栈、步数、星级）
│   │   ├── src/levels.ts        # 关卡包加载、解锁规则、进度
│   │   └── test/                # vitest
│   ├── render/
│   │   ├── src/canvas2d.ts      # 渲染后端实现
│   │   ├── src/theme.ts         # 色板/尺寸/圆角（对应 01 的美术规格）
│   │   ├── src/anim.ts          # 补间与缓动
│   │   ├── src/input.ts         # 拖拽/点击手势 → 语义事件
│   │   └── src/screens/         # 每个屏幕一个纯函数式 render
│   └── platform/                # 平台接口 + 两端实现
│       ├── src/types.ts         # Platform / Storage / Audio / Share / Ads / Http
│       ├── src/web.ts
│       └── src/wx.ts
├── apps/
│   ├── h5/                      # index.html + main.ts（开发与测试主入口）
│   └── minigame/                # game.js 入口 + game.json + project.config.json 模板
├── services/
│   ├── api/                     # 方案 B：FastAPI 自建后端
│   └── cloudfunctions/          # 方案 A：微信云开发云函数
└── e2e/                         # Playwright
```

---

## 4. Platform 接口（唯一需要写两遍的地方）

`packages/platform/src/types.ts` —— **必须先冻结这个接口再动手写业务**。

```ts
export interface Platform {
  readonly name: 'web' | 'wx';

  // 画布
  createCanvas(): { canvas: HTMLCanvasElement | any; ctx: CanvasRenderingContext2D };
  readonly screen: { width: number; height: number; dpr: number };
  onResize(cb: (s: { width: number; height: number; dpr: number }) => void): void;

  // 本地存储（同步接口，双端都要支持）
  storage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };

  // 音频
  audio: {
    load(name: string, src: string): Promise<void>;
    play(name: string, opts?: { loop?: boolean; volume?: number }): void;
    stop(name: string): void;
    setMuted(muted: boolean): void;
  };

  // 触控（统一成归一化坐标）
  onPointer(handler: (e: {
    phase: 'down' | 'move' | 'up' | 'cancel';
    x: number; y: number;
  }) => void): void;

  // 生命周期（小游戏切后台要暂停动画与音频）
  onShow(cb: () => void): void;
  onHide(cb: () => void): void;

  // 网络（小游戏需走 wx.request，且域名要白名单）
  http: {
    request(opt: { url: string; method: 'GET' | 'POST'; data?: any;
                    headers?: Record<string, string> }): Promise<{ status: number; data: any }>;
  };

  // 登录（web 端返回 mock，便于 H5 测试）
  login(): Promise<{ code: string }>;

  // 分享 / 广告（web 端为空实现，返回"不可用"）
  share(opt: { title: string; imageUrl?: string; query?: string }): void;
  ads: {
    isRewardedAvailable(): boolean;
    showRewarded(): Promise<{ ok: boolean; reason?: string }>;
    showInterstitial(): void;
  };

  // 震动
  vibrate(kind: 'light' | 'medium' | 'heavy'): void;
}
```

**规则**：`packages/core` 与 `packages/render` 中**禁止**出现 `wx.` 或 `window.`，由 lint 规则强制（`no-restricted-globals`）。所有平台差异只能出现在 `packages/platform` 的两个实现里。

`wx.ts` 关键点：
- 用 `wx.createCanvas()` 拿画布，**没有 DOM**，`render` 层不得使用 `document`/`Image`。
- 触控用 `wx.onTouchStart/Move/End`；坐标是物理像素，需除以 `dpr` 归一。
- 音频用 `wx.createInnerAudioContext()`；注意复用实例（小游戏并发音频实例有上限）。
- `wx.setStorageSync` 单 key 上限约 1MB，存档要控制体积（进度用紧凑数组，不要塞关卡 JSON）。

---

## 5. 构建与打包

| 目标 | 工具 | 命令 |
|---|---|---|
| H5 开发 | Vite | `npm run dev` |
| H5 构建 | Vite | `npm run build:h5` |
| 小游戏构建 | esbuild（IIFE，单文件） | `npm run build:wx` |
| 关卡校验 | Python | `npm run levels:check` |
| TS↔Python 交叉校验 | Node + vitest | `npm run levels:crosscheck` |

小游戏构建产物结构：

```
dist/minigame/
├── game.js            # 所有 TS 编译合并（IIFE，无 import）
├── game.json          # { deviceOrientation: "portrait", ... }
├── project.config.json
├── subpackages/
│   ├── levels/        # 关卡包（若首包超预算）
│   └── audio/
└── open-data/         # 开放数据域（好友排行榜，独立上下文）
```

构建脚本要求：
- **禁止** `eval` / `new Function` / 动态 `import()`（小游戏禁用）。
- 生产构建必须 `minify`，并输出包体报告（脚本自动断言主包 ≤ 4MB，超了直接构建失败）。

### 包体预算（主包 4 MB）

| 项 | 预算 | 说明 |
|---|---|---|
| 游戏代码 | ≤ 350 KB | 压缩后 |
| 关卡数据 | ≤ 150 KB | 66 关约 40 KB，留足冗余 |
| 音效 | ≤ 400 KB | 建议放分包或远端 |
| 位图资源 | ≤ 200 KB | 目标是 **0**：全部代码绘制 |
| 引擎/适配层 | 0 | 无引擎 |
| **主包合计** | **≤ 1.1 MB** | 有极大余量，为后续内容留空间 |

---

## 6. 状态机与存档

### 6.1 对局状态机（`packages/core/src/game.ts`）

```
idle → playing → (undo/redo) → playing
                → solved → (结算) → idle
```

- `moves: Move[]` 作为**唯一事实来源**，棋盘状态由 `moves` 顺序重放得出。
  - 好处：撤销 = 弹栈；存档 = 存 moves 数组；防作弊 = 直接把 moves 提交给服务端重放。三件事共用一套数据。
- 撤销：免费、无限、可重做（`redoStack`）。
- `hint()`：调 `solver.nextOptimalMove(state)`，返回从**当前局面**出发的最优下一步（不是初始局面的第一步，玩家中途偏离也能正确提示）。

### 6.2 存档结构（本地）

```ts
interface SaveV1 {
  v: 1;
  levels: Record<string, { stars: 0|1|2|3; bestMoves: number; bestCells: number;
                           clearedAt: number }>;
  coins?: never;                    // 首版无货币
  settings: { sfx: boolean; music: boolean; vibrate: boolean; moveMetric: 'moves'|'cells' };
  tutorialDone: boolean;
  current?: { levelId: string; moves: Move[]; startedAt: number };  // 断点续玩
  dirty: boolean;                   // 是否有未同步到云端的改动
}
```

- 体积预估 < 8 KB，远低于小游戏 storage 单 key 限制。
- 写入策略：**关键节点写**（通关、撤销后 500ms 防抖、切后台）——不要每帧写。
- 云同步冲突：以 `clearedAt`/`bestMoves` 取更优值合并（**逐关合并**，不是整体覆盖），这样双设备进度不会互相抹掉。

---

## 7. 后端：两套实现，一个契约

| | 方案 A：微信云开发（**首版采用**） | 方案 B：自建 FastAPI |
|---|---|---|
| 部署 | 云函数 + 云数据库 | 阿里云/腾讯云轻量 + Nginx |
| 域名 | **不需要**（免备案） | 需备案域名 + HTTPS + 白名单配置 |
| 运维 | 无 | 有 |
| 成本 | 免费额度够起步 | 服务器 + 域名 |
| 优势 | 1 天可上线 | 可控、可写 Web 管理后台、技术栈自用、面试可讲 |
| 劣势 | 绑定微信生态 | 备案周期 1–3 周 |

**实施方式**：客户端只依赖 `RemoteApi` 接口（见 `04`），两套后端实现同一份契约。
- P0–P4 阶段：`LocalOnlyApi`（纯本地，不发请求），保证游戏完全可离线玩。
- P5 阶段：接 云开发。
- P6+ 阶段（可选）：切 FastAPI，`config.ts` 改一个常量即可。

> **不要**把后端做成核心玩法的依赖。关卡数据必须随包内置——游戏断网、云开发欠费、后端挂了，玩家都得能玩完 66 关。

---

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 小游戏真机与开发者工具表现不一致 | 上线前发现白屏/错位 | P0 就把"真机跑通"设为出口标准，之后每阶段都做真机冒烟 |
| 无 DOM 导致第三方库不可用 | 依赖踩坑 | 依赖白名单机制：只允许 `packages/core` 用纯计算库，其余零依赖 |
| 高难度关卡生成命中率低（M≥19 稀有） | 关卡数量不达标 | 生成器支持"多轮采样 + 放宽车数"，P3 有专项任务；实在不够则用人工校验过的种子棋盘 |
| 关卡被玩家解包读解答 | 失去乐趣 | 解答只存 `levels.verify.json`，不打包；包内只有初始布局与 par |
| 提审被驳（判"非游戏"/隐私协议缺失） | 上线延期 | `04` 合规清单 + `06` 发布 checklist 逐项打勾 |
| 好友排行榜需开放数据域 | 架构遗漏 | P0 就建好 `open-data/` 目录占位，P4 实现 |
