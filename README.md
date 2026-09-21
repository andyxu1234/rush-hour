# rush-hour · 汽车华容道

6×6 棋盘滑块解谜：把红车开到右侧出口，**滑动次数越少越好**（一辆车滑一次算一步，不论几格）。

纯 TypeScript + Canvas 2D，一套代码同时产出 **H5 网页版** 与 **微信小游戏版**。当前实现范围为 **P0–P2**：可玩的单机版本，含内置 11 关。

---

## 快速开始

要求 Node ≥ 18（使用 npm workspaces，无需 pnpm）。

```bash
npm install --loglevel verbose   # 安装依赖
npm run dev                      # H5 开发服务器，默认 http://localhost:5173
npm run check                    # 一键质量门：类型检查 + 单测 + 双端构建 + 产物红线
```

小游戏侧：

```bash
npm run build:wx                 # 产出 apps/minigame/dist/minigame/
```

用**微信开发者工具**打开该目录即可预览（`project.config.json` 中 `appid` 为占位 `touristappid`，上线前需替换）。

---

## 命令一览

| 命令 | 作用 |
|---|---|
| `npm run dev` | H5 开发服务器（Vite，端口 5173） |
| `npm run build` | 顺序执行 `build:h5` + `build:wx` |
| `npm run build:h5` | 构建 H5 到 `apps/h5/dist/` |
| `npm run build:wx` | 用 esbuild 打包小游戏到 `apps/minigame/dist/minigame/` |
| `npm run preview` | 预览 H5 产物（端口 4173） |
| `npm run test` | Vitest 单测（core + render） |
| `npm run test:watch` | 单测 watch 模式 |
| `npm run test:coverage` | 单测覆盖率 |
| `npm run verify:levels` | 只跑 L2 跨语言一致性校验（TS 求解器 vs Python 参考实现） |
| `npm run typecheck` | H5 + 小游戏两套 TS 类型检查 |
| `npm run lint` | ESLint（强制架构红线，见下） |
| `npm run e2e` | Playwright 端到端（3 种视口，含真实触摸路径） |
| `npm run check` | 一键质量门（推荐提交前执行） |
| `npm run site:build` | 构建落地页 + 试玩产物（`site/`） |
| `npm run site:serve` | 本地预览落地页（http://localhost:4180） |
| `npm run site:check` | 落地页冒烟检查 |

---

## 仓库结构

```
rush-hour/
├── packages/
│   ├── platform/          @rush-hour/platform  冻结的宿主抽象层（接口 + web/wx 实现）
│   ├── core/              @rush-hour/core      纯逻辑内核：模型/走子/求解器/状态机/关卡/存档
│   ├── render/            @rush-hour/render    Canvas 2D 渲染、布局、动画、输入、屏幕
│   └── app-bootstrap/     @rush-hour/app-bootstrap  双端共享装配出口（仅再导出，无逻辑）
├── apps/
│   ├── h5/                @rush-hour/h5         Vite 构建，产物 dist/game.js（单文件）
│   └── minigame/                                 esbuild → IIFE 单文件 + game.json / project.config.json
├── data/
│   ├── levels.json                              内置关卡包（随包发布，不含解答）
│   └── levels.verify.json                       含解答，仅 CI 交叉校验用（绝不进包）
├── tools/
│   └── rush_hour.py                              Python 参考求解器 / 关卡生成器
├── e2e/                                          Playwright：smoke / gameplay / drag / touch
├── scripts/                                      check-all / free-port / tsc-minigame / run-e2e
├── docs/                                         规格书 + 实现说明
├── tsconfig.base.json                            严格模式 + 跨包 paths 映射
├── vitest.config.ts                              单测配置
└── playwright.config.ts                          e2e 配置（3 种视口）
```

### 各包职责

**`@rush-hour/platform`** —— 冻结的宿主抽象层。所有平台能力（画布、存储、网络、音频、广告、分享）都通过 `Platform` 接口获取，实现有两种：

- `WebPlatform`：H5 端（基于 DOM / localStorage / WebAudio）
- `WxPlatform`：小游戏端（基于 `wx.*` API）
- `LocalOnlyApi`：无后端的存档/成绩实现，占位 `RemoteApi` 契约

**`@rush-hour/core`** —— 纯逻辑，零平台依赖。导出模块：

| 模块 | 内容 |
|---|---|
| `model.ts` | `Piece` / `Level` / `LevelPack` / `Move` / `Difficulty` 等类型，`normalizePieces()` 校验 |
| `moves.ts` | `Board` 与 `State`：一步滑动的候选生成（1 格 / 2 格… 均为独立候选）、合法性判定、目标判定 |
| `solver.ts` | `Solver`：BFS 求最少步数、`remainingMoves()`、`nextOptimalMove()`（提示） |
| `game.ts` | `Game` 状态机（idle → playing → undo/redo → solved）、事件订阅、星级计算、`violatesTheorem2()` 校验 |
| `levels.ts` | `parseLevelPack()`：关卡包解析 + fail-fast 校验（坏数据在装载期就暴露） |
| `save.ts` | `SaveV1` 存档：`parseSave` / `createEmptySave` / `mergeProgress` / `recordClear` 与各字段清洗 |

**`@rush-hour/render`** —— Canvas 2D 渲染层，不直接触碰平台 API：

| 模块 | 内容 |
|---|---|
| `theme.ts` | `pickColors()`、`COLORS` / `METRICS` / `FONTS` |
| `car-art.ts` | `spriteForPiece()`：车型（H/V × 1/2/3 格）→ 贴图名；`loadCarSprites()` 批量加载。**缺图自动回落矢量绘制** |
| `layout.ts` | `computeLayout()`、`dialogGeometry()`，以及 P4 新增的 `menuLayout()` / `selectLayout()` / `settingsLayout()` / `listLayout()` / `tabsLayout()` / `hitRect()`：全部布局几何（绘制 / 命中检测 / e2e 断言同源） |
| `anim.ts` | 缓动与动画时长 |
| `ui.ts` | P4 新增：通用 UI 组件（`drawPanel` / `drawUiButton` / `drawStarRow` / `drawHeader` / `drawEmptyState` / `roundRectPath`） |
| `canvas2d.ts` | 棋盘、车辆、HUD、结算弹窗的绘制 |
| `input.ts` | 拖拽 / 轻点判定（`tapSlopPx` 手指级容差，见「实现要点」） |
| `screens/` | 屏幕层，见下 |

**`@rush-hour/render` 的屏幕层（`src/screens/`）**

| 文件 | 界面 | 规格出处 |
|---|---|---|
| `screen-manager.ts` | 唯一帧循环 + 导航栈（`push` / `back` / `reset`） | `02 §Screen 装配` |
| `boot-screen.ts` | 启动页（logo + 进度条，1.5s 内可交互） | `01 §6.1` |
| `menu-screen.ts` | 主菜单（继续上局 / 开始闯关 / 每日挑战 / 排行榜 / 设置 / 隐私政策） | `01 §6.1` |
| `select-screen.ts` | 选关页（星级、锁定态、分页） | `01 §6.1` |
| `game-screen.ts` | 对局页 + 结算弹窗（含分享） | `01 §6.1/§6.2` |
| `tutorial-overlay.ts` | 新手引导遮罩（前 3 关情境化引导 + 挖洞高亮） | `01 §9` |
| `settings-screen.ts` | 设置页（音效 / 音乐 / 震动 / 步数口径 / 重看引导 / 清档二次确认） | `01 §6.1` |
| `leaderboard-screen.ts` | 排行榜（全球 / 好友 Tab，无后端时降级为本地成绩） | `01 §6.1` |
| `daily-screen.ts` | 每日挑战（**占位页**，等 P5 后端契约） | `01 §6.1` |
| `privacy-screen.ts` | 隐私政策（5 节内置文案，合规必需） | `01 §6.1` |
| `share-card.ts` | 分享卡片（代码绘制，可选分享、不解锁关卡） | `01 §6.4` |

---

## 架构红线

`packages/core` 与 `packages/render` 内**禁止**出现 `window` / `document` / `wx` / `localStorage` / `Image` / `eval` / `new Function`，由 ESLint 强制。

平台能力一律通过 `Platform` 接口获取——这是同一套代码能同时编译到 H5 与小游戏的前提（小游戏无 DOM/BOM，且禁用 `eval` / `new Function`）。

> **关于位图**：P2 之后新增了车辆贴图（见「车辆美术」一节）。render 层仍然
> **不允许**自己构造 `Image`，而是通过 `Platform.image.load()` 拿到 `ImageLike`。
> H5 用 `new Image()`、小游戏用 `wx.createImage()`，构造方式不同但产物同构——
> 这正是把图片能力放进 `Platform` 而不是 render 层的原因。

---

## 落地页与 GitHub Pages

`site/` 是项目介绍页（含**可直接试玩的网页版**），由 GitHub Actions 自动部署。

线上地址：`https://andyxu1234.github.io/rush-hour/`

```
site/
├── index.html          介绍页（Hero / 项目概览 / 玩法 / 界面展示 / 车辆图鉴 / 架构）
├── styles.css
├── assets/
│   ├── hero.jpg        主视觉（design/design.jpg 压缩稿，2.9MB → 258KB）
│   ├── labels/         木牌标签（关卡 / 步数 / 得分），已抠除棋盘格背景
│   ├── cars/           车辆贴图，与游戏内完全一致
│   └── shots/          7 张真实截图（menu / select / game / game-move / win / settings / leaderboard）
└── play/               ← 在线试玩，由 npm run site:play 从 apps/h5/dist 拷入（不入库）
```

常用命令：

| 命令 | 作用 |
|---|---|
| `npm run site:build` | 一键：车辆素材 → 落地页素材 → 构建 H5 → 拷进 `site/play/` |
| `npm run site:serve` | 本地预览，http://localhost:4180 |
| `npm run site:shots` | 重新抓取截图（需先起 `npm run preview`） |
| `npm run site:check` | 冒烟检查：图片全部加载、区块齐全、试玩页可启动 |

> **截图不能手画**。`scripts/capture-screens.mjs` 用 Playwright 驱动**真实构建产物**
> 截图，改 UI 后重跑一次即可，不会出现"页面上的图与实现漂移"。
> `site:check` 会把 404 的图片、缺失的区块、起不来的试玩页全部拦在部署前。

### 首次部署需要做一次设置

Actions 产物默认不会自动成为 Pages 站点，需要在仓库里打开开关：

**Settings → Pages → Source 选 `GitHub Actions`**

之后每次 push 到 `main`（且改动命中 `site/**`、`apps/h5/**`、`packages/**`、`data/**`、
`scripts/**`、`package.json` 等路径）就会自动重新构建并发布。

### 为什么 H5 放到 `site/play/` 也能跑

H5 构建产物使用**相对路径**（`./game.js`）且车辆贴图按 `assets/cars/*.png` 相对加载，
因此放在 `/rush-hour/play/` 这类子路径下无需改任何配置。

---

## 车辆美术（卡通贴图）

棋盘上的车辆使用卡通贴图渲染；**贴图是可选增强，不是运行前提**——任何一张图
加载失败都会自动回落为 P0–P2 的矢量色块车，因此素材永远不可能让游戏跑不起来。

### 素材流水线

```
design/assets/*.png                     原始素材（约 4.4MB，含被拍平的棋盘格背景）
        │
        │  npm run assets  →  scripts/build-car-assets.mjs
        │  ① 抠掉"画出来的"透明棋盘格  ② 裁到内容包围盒  ③ 缩放压缩
        ▼
packages/render/assets/assets/cars/*.png    发布用贴图（约 124KB）
        │
        ├─ H5：Vite publicDir → dist/assets/cars/
        └─ 小游戏：build.mjs cpSync → assets/cars/
```

处理脚本解决的两个实际问题（都不是"顺手优化"能省掉的）：

1. **素材的透明区是被画上去的**。原始 PNG 虽然带 alpha 通道，但 alpha 全是
   `255`——所谓"透明背景"其实是 Photoshop 那种灰白棋盘格像素（`254` / `212`）。
   不做抠除，棋盘格会跟着车一起画到游戏里。脚本按「低饱和 + 中高亮度」判据
   清除它，并额外覆盖车身阴影与棋盘格**混合**产生的 `170~215` 中灰
   （残留会让车底拖出一条棋盘格尾巴）。
2. **巴士/纵向拖拉机素材里混入了标注文字与邻车**。`sprite_028` 顶部印着
   `Compact` / `Purple Limo Bus`，`sprite_022` 右侧带邻车边缘，靠 `crop` 显式框出。

### 车型 → 贴图

| 车型 | 贴图 | 说明 |
|---|---|---|
| H×2 | 侧视轿车 | 红车（`id==='R'`）**固定**用红色公鸡车，它是唯一视觉锚点 |
| H×3 | 侧视巴士 | 唯一的横向长车素材 |
| V×2 | 正面视角轿车/拖拉机 | 车头正视图 |
| V×3 | **旋转 90° 的巴士** | 长车必须呈现为"长条"，正面车头硬拉到 3 格高会变形 |

尺寸规则（`canvas2d.ts:drawCarSprite`）：横向车以**格高**为基准、纵向车以
**格宽**为基准，各自按 `len` 变化长度。两类车必须用不同基准轴，否则会出现
「车比占格小、底部留缝」或「红车变小」——两处都实际踩过。

### 包体

| 项 | 实测 | 上限 |
|---|---|---|
| 发布贴图总量 | 124 KB | 150 KB（脚本内断言） |
| H5 素材 | 124 KB | 300 KB |
| H5 代码 | 105 KB | 350 KB |
| 小游戏主包（代码+素材） | 228 KB | 4 MB |

---

## 关卡数据

| 文件 | 是否进包 | 用途 |
|---|---|---|
| `data/levels.json` | 是 | 客户端唯一读取源，**不含解答** |
| `data/levels.verify.json` | 否 | 含 `solution` / `difficulty` 指标，仅供 CI 与 Python 参考实现交叉校验 |

当前内置 **17 关**：教学 8 关（`t01`–`t08`）+ 经典 9 关（`c001`–`c009`）。难度分布：

| 难度 | 步数区间 | 关卡数 |
|---|---|---|
| starter | 0–3 | 2 |
| easy | 4–7 | 13 |
| medium | 8–12 | 1 |
| expert | 19+ | 1 |

关卡包在构建期被内联为常量 `__LEVELS__`（Vite 的 `define` / esbuild 的 `define`），运行时由 `parseLevelPack()` 校验后装载。

> 关卡总量仍未达规格目标（`docs/03-level-system.md` 要求 60+ 关）。`hard` 区间仍为 0，难度梯度尚不连续，详见 `docs/07-implementation-notes.md` §5。

---

## 测试与质量门

| 层级 | 内容 | 命令 |
|---|---|---|
| L1 | 单测：`packages/core/test/`（model / moves / solver / game / save）+ `packages/render/test/`（layout / input / draw-calls） | `npm run test` |
| L2 | 跨语言一致性：TS 求解器复算 `levels.verify.json`，`minMoves` / `cellSteps` / `difficulty` / `reachableStates` / `optimalPaths` / `goalStates` 逐关与 Python 参考实现一致 | `npm run verify:levels` |
| L4 | 渲染层单测（布局、输入判定、绘制调用） | `npm run test` |
| L5 | e2e：`smoke` / `gameplay` / `drag` / `touch`，3 种视口，触摸用例通过 CDP 派发带抖动的真实手势 | `npm run e2e` |

`npm run check` 依次执行类型检查（H5 + 小游戏）→ 单测 → H5 构建 → 小游戏构建，并做产物红线检查：

- H5 包体 ≤ 350 KB
- H5 产物不含 `solution` 字段（确认 `levels.verify.json` 未混入）
- H5 产物不含 `eval(` / `new Function`
- 小游戏主包 ≤ 4 MB

### e2e 排障

`npm run e2e` 会先执行 `scripts/free-port.mjs 4173`。原因：反复跑测试时上一次的 `vite preview` 常残留占用 4173，Playwright 的 `reuseExistingServer` 会让本次跑在**旧产物**上，表现为几十条用例在几百毫秒内集体失败，极易误判为代码回归。

手工后台跑并留存日志：

```bash
node scripts/run-e2e.mjs e2e                                  # 结果写入 e2e.log
node scripts/run-e2e.mjs touch e2e/touch.spec.ts --project=iphone-375x667
```

---

## 实现要点

以下均为实际调试中撞到并已修复的问题，改动处留有注释，请勿「顺手优化」掉。完整记录见 `docs/07-implementation-notes.md` §4。

-**`moves` 是唯一事实来源**。棋盘状态一律由走子序列重放得出，因此「撤销 = 弹栈」「存档 = 存 moves」「防作弊 = 服务端重放 moves」三件事共用同一份数据，永远不会互相漂移。

-**一次滑动 = k 个独立候选**。`Board.genMoves()` 必须为每个可达格数产出独立候选（滑 1 格、滑 2 格…），不能只生成「滑到底」。解法搜索与 par 校验都依赖这一点。

-**输入容差必须按物理像素给足**。真机点按天然伴随 5~15px 手指抖动。轻点判定曾用 4px（棋盘尺度），且 `onMove` 无条件清空基线，导致结算弹窗按钮在真机上完全点不动。现为 `METRICS.tapSlopPx = 18` + 欧氏距离判定 + `onMove` 仅在超阈值时清空。回归防护：`e2e/touch.spec.ts`（带 2px 抖动的真实触摸手势）。

-**画布 CSS 尺寸与逻辑尺寸 1:1**。写成 `100%` 会因 flex 居中 / 滚动条引入误差，表现为「点不中车 / 拖拽吞事件」。`GameScreen.resize()` 每次显式设置 `width/height`，高清屏用 `ctx.setTransform(dpr, …)`。

-**弹窗几何三处同源**。绘制、命中检测、e2e 断言统一走 `layout.ts`，避免「看得到却点不着」；命中测试使用稳定态矩形，规避入场缩放期间点击落空。

-**存档子字段损坏不应丢全部进度**。`isSaveLike()` 只识别顶层关键字段，子字段交给 `sanitizeProgress()` / `sanitizeSession()` 逐项清洗——否则一个空的 `settings` 就会把整个存档判死。

---

## 已知不足

1. **关卡只有 11 关且难度断层**：tutorial 4 + classic 7，`hard` / `expert` 为 0。需先修 `tools/rush_hour.py` 的反向游走命中率。
2. **音频为程序化合成**：H5 端用 WebAudio 实时合成（无素材文件）；小游戏端 `WxAudioApi` 指向 `audio/*.mp3`，素材缺失时静默降级。正式上线前需补素材。
3. **求解器在客户端构建**：每关进入时同步跑一次 BFS。当前 11 关耗时可控；若扩到 60+ 关且含 expert 关，需改为 Web Worker 或预计算 `distGoal` 表随关卡下发。
4. **无选关页**：当前用「顺序推进 + 结算弹窗下一关」满足连续游玩。`SaveV1.levels` 已记录进度与星级，可直接支撑后续选关页。
5. **未做埋点、深色模式、横屏适配**（设计分辨率为 375×667 竖屏）。`GameScreen` 已发 `move` / `blocked` / `undo` / `redo` / `solve` / `reset` 六类事件，接埋点时可直接监听。
6. **后端仅预留契约**：`RemoteApi` + `LocalOnlyApi`，自建 FastAPI 服务端未实现。

---

## 文档地图

`docs/` 是完整规格书（可执行的规格，非概念稿），`README.md` 只描述当前实现状态。

| 文档 | 内容 |
|---|---|
| `docs/01-game-design.md` | 精确规则、可逆性/剪枝两条定理、计步口径、难度分级、UI 屏幕清单、美术与音效规格、手感参数 |
| `docs/02-architecture.md` | 技术选型与取舍理由、仓库结构、H5/小游戏双端架构、适配层接口、包体预算、状态与存档 |
| `docs/03-level-system.md` | 关卡 JSON 格式、求解器与生成器算法、去重指纹、难度公式、关卡验收不变量 |
| `docs/04-backend-api.md` | 统一 API 契约、数据表 DDL、登录时序、服务端重放防作弊、广告/分享接入、合规与资质 |
| `docs/05-development-plan.md` | 阶段 P0–P7 任务分解、每阶段交付物与 DoD、风险表 |
| `docs/06-testing-acceptance.md` | 测试分层、关键用例、性能预算、真机清单、发布 checklist |
| `docs/07-implementation-notes.md` | **实际实现与规格的对应关系、偏离项、踩坑记录**（读代码前建议先读本文） |

### 阶段状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 工程脚手架、`Platform` 接口冻结 | 完成 |
| P1 | 纯逻辑内核 + L1 单测 + L2 跨语言校验 | 完成 |
| P2 | Canvas 2D 渲染、拖拽交互、动画、HUD、结算弹窗、自适应 | 完成 |
| P3 | 关卡生成器修复、扩产 | **部分完成**：生成器已修好并扩产到 17 关（新增 medium/expert 各 1 关），但 `hard` 仍为 0、未达 60 关 |
| P4 | 主菜单、选关页、引导、设置、排行榜、隐私政策、分享、埋点 | **完成**（每日挑战按决策只做占位页，等 P5） |
| P5 | 后端实现（目前仅契约） | 未做 |
| P6 | 关卡编辑器 | 未做 |
| P7 | 广告变现与上线准备 | 未做 |

---

## 关键决策

| # | 决策 | 结论 |
|---|---|---|
| D1 | 平台形态 | 微信**小游戏**（非小程序） |
| D2 | 前端技术 | 纯 TypeScript + Canvas 2D，代码优先，不用 Cocos/Laya |
| D3 | 双端复用 | 同一套代码编译到 H5 与小游戏，复用率 ~95% |
| D4 | 计步口径 | 默认 = 滑动次数（一辆车滑一次算一步，不论几格） |
| D5 | 后端 | 首版微信云开发 / 自建 FastAPI（**实现时改为自建 FastAPI，目前仅落契约**） |
| D6 | 关卡来源 | 程序化生成 + 求解器校验，不用人工摆放 |
| D7 | 防作弊 | 提交完整走子序列，服务端重放校验 |
| D8 | 变现 | IAA 纯广告（激励视频换提示 + 插屏） |
| D9 | 难度主指标 | 最少滑动步数 `par.moves` |
| D10 | 关卡包发布 | 内置离线包 + 服务端热更新（版本号比对） |

> 与规格的偏离项（npm workspaces 替代 pnpm、新增 `app-bootstrap` 包、关卡数量未达 66 关、每日挑战只做占位等）均记录在 `docs/07-implementation-notes.md`。
