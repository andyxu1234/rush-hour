# 实现说明（P0–P2 交付）

> 本文记录**实际实现**与文档规格的对应关系、偏离项、以及踩过的坑。
> 规格以 `01`–`06` 为准；本文只补充"落地时才知道的事"。

## 1. 交付范围

按确认的范围交付 **P0 + P1 + P2**：可玩的单机 H5 版本 + 可编译的小游戏版本。

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | npm workspace + TS 严格模式工程脚手架、Platform 接口冻结 | 完成 |
| P1 | 纯逻辑内核（规则 / 求解器 / 状态机 / 存档）+ L1 单测 + L2 跨语言校验 | 完成 |
| P2 | Canvas 2D 渲染、拖拽交互、动画、HUD、结算弹窗、自适应 | 完成 |
| P3 | 关卡生成器修复、66 关扩产、`check_levels.py` | **未做**（依赖用户决策） |
| P4 | 主菜单、选关页、引导遮罩、设置页、每日挑战、分享、排行榜、埋点 | **未做** |
| P5 | 自建 FastAPI 后端 | **仅预留契约**（`RemoteApi` + `LocalOnlyApi`） |
| P6 | 关卡编辑器 | 未做 |
| P7 | 广告变现与上线准备 | 未做 |

### 与文档的偏离（均经用户确认）

1. **`pnpm` → `npm workspaces`**。用户指定。
2. **微信云开发 → 自建 FastAPI**（覆盖 `02` §7 决策 D5）。本轮只落契约，未实现服务端。
3. **66 关 → 现有 8 关**。`tools/rush_hour.py` 的反向游走命中率问题未修（见 `gen.log` / `diag.py`），
   直接使用 `data/levels.json` 的 8 关（tutorial 4 + classic 4）。
4. **加入 `packages/app-bootstrap`**（文档未规划）。原因：H5 与小游戏两个入口要装配同一套东西，
   集中一处再导出可避免两端各写一份 import 而逐渐漂移。不含逻辑，只是再导出。

## 2. 仓库结构

```
package.json                 # npm workspaces + 统一脚本
tsconfig.base.json           # 严格模式 + 跨包 paths 映射
vitest.config.ts             # 单测（core + render）
playwright.config.ts         # e2e（3 种视口）
scripts/check-all.mjs        # 一键质量门
scripts/tsc-minigame.mjs
packages/platform/src/       # 冻结接口 + web.ts / wx.ts / local-api.ts
packages/core/src/           # model / moves / solver / game / levels / save
packages/core/test/          # L1 + L2
packages/render/src/         # theme / layout / anim / canvas2d / input / screens
packages/render/test/        # L4
packages/app-bootstrap/src/  # 双端共享装配出口
apps/h5/                     # Vite
apps/minigame/               # esbuild IIFE + game.json / project.config.json
e2e/                         # L5 smoke / gameplay / drag
```

**架构红线**由 `.eslintrc.cjs` 强制：`packages/core` 与 `packages/render` 内禁止
`window` / `document` / `wx` / `localStorage` / `Image` / `eval` / `new Function`。
平台能力一律通过 `Platform` 接口。

## 3. 验证结果

```
$ npm run check
  ✓ typecheck:h5            ✓ typecheck:minigame
  ✓ test                    (100 tests, 8 files)
  ✓ build:h5                ✓ build:wx
  ✓ H5 包体 ~48 KB ≤ 350KB
  ✓ H5 产物不含 solution 字段（levels.verify.json 未进包）
  ✓ H5 产物不含 eval( / new Function
  ✓ 小游戏包体 ~46 KB ≤ 4MB

$ npm run e2e
  96 passed, 12 skipped（12 skip 为"该关几何不适用"的条件跳过）
  # 含 e2e/touch.spec.ts：15 条真实触摸手势用例，覆盖 3 种视口
```

**L2 跨语言一致性**（最重要的一道门）：用 TS 求解器复算 `levels.verify.json` 的 8 关，
`minMoves` / `cellSteps` / `difficulty` / `reachableStates` / `optimalPaths` / `goalStates`
全部与 Python 参考实现逐关一致。

## 4. 实现要点（踩过的坑）

以下每条都是实际调试中撞到并已修复的问题，改动处都留了注释，请勿"顺手优化"掉。

### 4.1 `min(distGoal)` 恒为 0

`distGoal` 覆盖整个可达集，且**必然包含初始状态**（`distStart = 0`）。
写成 `Math.min(...distGoal.values())` 会静默得到 0。
求最少步数必须只在 `goals` 集合上取 `min(distStart)` —— 已封装为 `minMovesToGoal()`。
单测里专门留了一条回归用例。

### 4.2 一次滑动 = k 个独立候选

`Board.genMoves()` 必须为每个可达格数产出**独立**候选状态（滑 1 格、滑 2 格 …），
不能只生成"滑到底"。解法搜索与"是否还能达到 par"都依赖这一点。

### 4.3 输入层：意图方向必须用"夹紧前的位移"

`DragState` 同时保存 `deltaCells`（已夹到合法范围）与 `rawDelta`（原始位移）。
方向判定与回弹抖动一律依据 `rawDelta` —— 否则红车贴左边时向左拖，
`deltaCells` 被夹成 0，方向会被误判成 `right`。

### 4.4 弹窗打开时 `downAt` 被清空 → 按钮点不动

`onStart` 里若在"弹窗已打开"分支把 `downAt` 置 null，`onEnd` 就永远不会派发 `tap`，
弹窗按钮彻底失效。现在弹窗打开时**保留** `downAt`，由 `onEnd` 统一派发 `tap`。
单测 `弹窗打开时轻点会产生 tap` 专门守住这条。

### 4.4b 真机点不动：轻点容差用了棋盘尺度（**最重要的一条**）

线上真机反馈"结算弹窗的下一关/重玩点了没反应"，而当时**全部鼠标用例与纯 touch 用例
都是绿的** —— 因为测试发送的手势抖动为 0。

真实手机上，一次点按天然伴随 **5~15px** 的手指抖动（触屏采样 + 手指微动）。
而轻点判定曾写成：

```ts
// 错：4px —— 这是棋盘尺度，不是手指尺度
const moved = |e.x-downAt.x| + |e.y-downAt.y| > METRICS.snapThreshold * 8; // 0.5*8 = 4
```

两处叠加导致 tap 永远丢失：

1. **`onEnd` 的容差仅 4px**，抖动 5px 就被判成"拖动"；
2. **`onMove` 无条件 `this.downAt = null`** —— 只要收到任何 move 事件（哪怕 1px）
   就清空了轻点基线，`onEnd` 里 `downAt` 已为 null，连判断机会都没有。

**修复**：
- 新增 `METRICS.tapSlopPx = 18`（手指级容差），判定改用 `Math.hypot(dx, dy)`（欧氏距离，
  比曼哈顿距离更符合"位移"直觉）；
- `onMove` 只在位移**超过 `tapSlopPx`** 时才清空 `downAt`。
- 顺带把 touch 监听从 canvas 移到 `window`（手指滑出画布也能收到 `touchend`），
  并加"触摸后 700ms 内忽略合成鼠标事件"的去重（防同一次点按被处理两次）。

**回归防护**：新增 `e2e/touch.spec.ts`（15 例，三视口全覆盖），
用 CDP `Input.dispatchTouchEvent` 派发**带 2px 抖动**的真实触摸手势；
单测也补了"抖动 8px 仍应 tap"与"滑动 30px 不应 tap"两条边界。

**教训**：涉及"手指输入"的判定，容差必须按物理像素给足，且测试手势必须带抖动。
用棋盘/逻辑尺度推导输入容差是错的；不带抖动的测试等于没测。

### 4.5 画布 CSS 尺寸必须与逻辑尺寸 1:1

`WebPlatform.screen()` 返回 `window.innerWidth/innerHeight`。
若 canvas 的 CSS 尺寸写成 `100%`（受 flex 居中/滚动条影响可能不等于视口），
输入坐标换算就会引入误差，表现为"点不中车 / 拖拽吞事件"。
现在 `GameScreen.resize()` 每次把 canvas 的 `width/height` 显式设为逻辑尺寸，
并用 `ctx.setTransform(dpr,…)` 处理高清屏。

### 4.6 弹窗几何三处必须同源

`drawResultDialog`（绘制）、`onTap`（命中）、e2e 断言三者若各写一套坐标公式，
必然出现"看得到却点不着"。现在统一走 `layout.ts` 的 `dialogGeometry()` +
`dialogButtonsOnScreen()`；命中测试用**稳定态**（progress = 1）矩形，
避免入场缩放期间点击落空。

### 4.7 存档：子字段损坏不应丢全部进度

`isSaveLike()` 只识别顶层四个关键字段（`v` / `levels` / `settings` / 其余），
**不在结构判定里校验子字段类型** —— 否则一个空的 `settings` 就会把整个存档判死，
玩家全部通关记录丢失。子字段一律交给 `sanitizeProgress()` / `sanitizeSession()` 逐项清洗。

## 5. 已知不足 / 后续建议

1. **关卡只有 8 关，难度断层**：`gen.log` 实测 starter 2 / easy 5 / medium 1，hard 与 expert 为 0。
   这是 P3 的阻塞项，需先修 `tools/rush_hour.py` 的反向游走命中率。
2. **音频为程序化合成**：H5 端用 WebAudio 实时合成（无素材文件），
   小游戏端 `WxAudioApi` 指向 `audio/*.mp3`（素材缺失时静默降级）。
   正式上线前需补 ≤400KB 的音效与 8-bit BGM。
3. **求解器在客户端构建**：每关进入时 `Solver.solve()` 同步跑一次 BFS。
   当前 8 关最大 30812 个状态，耗时可控；若扩到 66 关且含 expert 关，
   需改为 Web Worker 或预计算 `distGoal` 表随关卡下发。
4. **无选关页**：本轮用"顺序推进 + 结算弹窗下一关"满足连续游玩，
   完整选关页属 P4；`SaveV1.levels` 已记录进度与星级，P4 可直接消费。
5. **深色模式 / 横屏未处理**：设计分辨率 375×667 竖屏。
   `computeLayout()` 已能适配任意尺寸，但横屏下 HUD 与棋盘会显得空旷。
6. **未做埋点**：P4 的埋点体系未接。`GameScreen` 已发 `move` / `blocked` / `undo` /
   `redo` / `solve` / `reset` 六类事件，接埋点时可直接监听，无需改动内核。

## 6. 常用命令

```bash
npm install --loglevel verbose   # 安装依赖
npm run dev                      # H5 开发服务器（默认 5173）
npm run check                    # 类型检查 + 单测 + 双端构建 + 产物红线
npm run e2e                      # Playwright 端到端（3 种视口，含触摸路径）
npm run verify:levels            # 只跑 L2 跨语言一致性
npm run build:wx                 # 产出 apps/minigame/dist/minigame/
```

### e2e 排障提示

`npm run e2e` 会先执行 `scripts/free-port.mjs 4173` 释放端口，原因：
本地反复跑测试时，上一次的 `vite preview` 常残留占着 4173，
`reuseExistingServer` 会让本次跑在**旧产物**上，甚至服务已死导致页面加载失败 ——
表现为**几十条用例在几百毫秒内集体失败**，极易误判成代码回归。

若想手工后台跑并看日志：

```bash
node scripts/run-e2e.mjs e2e          # 结果写入 e2e.log（含 [exit N] 标记）
node scripts/run-e2e.mjs touch e2e/touch.spec.ts --project=iphone-375x667
```

小游戏侧产物在 `apps/minigame/dist/minigame/`，用微信开发者工具打开该目录即可
（`project.config.json` 中 `appid` 为占位 `touristappid`，上线前需替换）。
