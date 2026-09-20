# 03 · 关卡系统（数据格式 · 生成器 · 求解器 · 验收）

> 本项目的核心工程量在此。玩法内核只有约 400 行，而关卡生成与校验管线才是"关卡好不好玩"的决定因素。
> 参考实现已跑通：`tools/rush_hour.py`（Python，纯标准库）。

---

## 1. 关卡数据格式

### 1.1 关卡包 `data/levels.json`（**随包发布，不含解答**）

```json
{
  "schemaVersion": 1,
  "board": { "cols": 6, "rows": 6, "exitRow": 2, "exitSide": "right" },
  "generator": { "tool": "tools/rush_hour.py", "seed": 20260920 },
  "levels": [
    {
      "id": "t02",
      "index": 2,
      "pack": "tutorial",
      "name": "第2关 · 第一辆挡路的竖车",
      "difficulty": "starter",
      "par": { "moves": 2, "cellSteps": 5 },
      "stars": { "three": 2, "two": 4, "one": 0 },
      "pieces": [
        { "id": "R", "dir": "H", "len": 2, "r": 2, "c": 0 },
        { "id": "a", "dir": "V", "len": 2, "r": 2, "c": 3 },
        { "id": "b", "dir": "H", "len": 2, "r": 4, "c": 0 },
        { "id": "c", "dir": "V", "len": 2, "r": 0, "c": 5 },
        { "id": "d", "dir": "H", "len": 3, "r": 5, "c": 2 }
      ],
      "metrics": {
        "reachableStates": 1133,
        "searchDepth": 9,
        "rootMoves": 6,
        "maxBranching": 14,
        "optimalPaths": 2,
        "goalStates": 1,
        "solutionSpaceLog2": 10.1,
        "idlePieces": 0,
        "pieces": 5
      }
    }
  ]
}
```

### 1.2 字段说明

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | string | 教学 `t01..`、经典 `c001..`；**一旦发布不可更改**（存档键） |
| `index` | int | 1-based 展示序号 |
| `par.moves` | int | **求解器产出**，最少滑动次数；禁止人工填写 |
| `par.cells` | int | Dijkstra 产出，最少总格数 |
| `stars.three/two` | int | 三/二星门槛；`one: 0` 表示完成即一星 |
| `pieces[].r/c` | int | 车辆左上角坐标，0-indexed |
| `metrics.*` | int | 见 `01-game-design.md` §4，仅供展示与调优 |

### 1.3 解答文件 `data/levels.verify.json`（**不进包，仅 CI 用**）

结构与 `levels.json` 相同，额外带 `solution` 字段（最优走子序列）：

```json
{ "solution": [ { "piece": "a", "dir": "down", "cells": 1 },
                { "piece": "R", "dir": "right", "cells": 4 } ] }
```

**用途**：
1. L2 跨语言一致性测试的**期望值来源**（TS 求解器必须复算出相同 `par.moves`）。
2. 通关回归测试（按 solution 走一遍必须通关）。
3. **绝不打包**——否则玩家解包即得全部答案。

---

## 2. 求解器算法（TS 与 Python 必须逐字节等价地实现）

### 2.1 状态表示

- 状态 = 每辆车 `(r, c)` 组成的定长序列，车辆按 **红车在前、其余按 id 字典序**固定排序。
- 用作哈希键时：
  - Python：`tuple((r,c), ...)`
  - TS：`Int8Array` 经 `String.fromCharCode(...)` 或直接拼接整数字符串。**不要**用对象/JOIN 数组（会慢 1–2 个数量级）。
- 占用表：一维 `Int8Array(36)`，值 = 车辆索引，`-1` 为空。每步重算，比维护稀疏结构更快（36 格成本极低）。

### 2.2 走子生成（关键：每个可达格数都是一个候选）

```
generateMoves(state):
  occ = buildOccupancy(state)
  for each piece i:
    for each 方向 d in 该车轴向的两个方向:
      k = 0
      while 前进 k+1 格进入的格子在界内 且 为空:
        k += 1
        yield (i, d, k, stateWith(i 移动 k 格))     # 每个 k 都是一个独立的候选，均计 1 步
```

> **这是最容易写错的地方**。若只 yield "滑到最远"，BFS 会算出偏大的 `par`，且与经典华容道的步数口径不符。

### 2.3 最短步数

1. **正向 BFS** 从初始状态铺满整个可达状态图 → `distStart`，同时记录每个状态的出度 `degree`。
2. **多源反向 BFS** 从**所有目标状态**（红车位于 `(2,4)` 的全部状态，可能不止一个）出发，在可达子图内传播 → `distGoal`。
   - 依据定理 1（可逆性），状态图无向，反向 BFS 可复用同一套邻接关系，无需构造反向边。
3. `minMoves = min(distStart[g] for g in goals)`

> ⚠️ **必须避免的坑（本项目已实际踩过）**：`distGoal` 覆盖整个可达集（因为反向传播会走遍全图），其中包含初始状态本身，其 `distStart = 0`。若写成 `min(distStart[s] for s in distGoal)` 会**恒得 0**。必须只在 `goals` 集合上取最小。参考实现中已用 `min_moves_to_goal()` 封装并配注释。

### 2.4 最少格数（副指标）

以"滑动格数"为边权做 Dijkstra，首次弹出目标状态即为 `par.cells`。

### 2.5 最优解条数（难度关键指标）

在"最优走廊"上做 DAG 计数 DP：

```
corridor = { s | distStart[s] + distGoal[s] == minMoves }
按 distStart 降序处理：
  f(s) = 1                                 若 s 是目标状态
  f(s) = Σ f(ns)  对每个满足 distStart[ns] == distStart[s]+1 且 ns ∈ corridor 的后续状态 ns
optimalPaths = f(initial)
```

- `optimalPaths == 1` → **唯一解**，玩家容错为 0，明显更难。
- `optimalPaths` 大 → 冗余路径多，更容易。
- 计数可能爆炸，实现需设上限（如 10⁹）。

### 2.6 复杂度与实测

| 指标 | 实测范围（66 关） |
|---|---|
| 可达状态数 | 约 10³ – 10⁵ |
| 单关求解耗时 | 数毫秒 – 数百毫秒（Python） |
| 搜索上限保护 | 120,000 状态（超出即判定"病态盘面"并丢弃） |

TS 实现需保证 `nextOptimalMove`（提示）在 **≤ 30 ms** 内返回；因提示只需从当前局面搜到最近目标，可用"双向 BFS"或直接复用已算好的 `distGoal` 做贪心下降（**推荐**：预计算一次 `distGoal` 表，提示即"选一个使 distGoal 减 1 的走法"，O(分支数)）。

---

## 3. 生成器流程

### 3.1 主力策略：从终点反向随机游走（★ 关键）

**不要用纯随机撒车 + 筛选的思路**。实测纯随机采样凑出 8 步以上关卡的命中率低于 1/2500，生成器会卡死。

正确做法是把题目"走"出来：

```
random_walk_layout(rng, n_pieces, walk_len):
  1. 随机撒车，但把红车摆在 COLS-2（即已经通关的位置）
  2. 从该状态出发，随机走 walk_len 步合法移动（每步 = 一辆车滑任意格数）
     · 记录上一步，禁止立刻原路返回（否则会来回震荡、白走）
  3. 把走到的终点状态作为"出题局面"
```

三个好处：
1. **按构造即可解** —— 从终点倒着走出来，正着走必然能回去。不需要赌运气。
2. **高难度命中率大幅提升** —— 期望的最少步数随 `walk_len` 增长，可以直接"点菜"。
3. **不变量自动满足** —— 红车是横车只能留在出口行，所以"红车必须在 `row=2`"天然成立。

> 另有 ~15% 的关卡走纯随机布局，用于保证关卡形态多样（避免全部呈现"游走"特征）。

### 3.2 完整流水线

```
for 每个难度批次:
  循环:
    1. 布局        —— 85% 反向游走(按目标步数设定 walk_len) / 15% 纯随机
    2. 前置剪枝    —— 命中定理 2 直接丢弃（省一次 BFS）
    3. 粗筛        —— 一次 BFS 求 minMoves；不在目标区间 → 丢弃
                      开局出度 ≤ 1 → 丢弃
    4. 完整求解    —— 算 par.cells / optimalPaths / idlePieces
    5. 质量筛选    —— idlePieces > 1 → 丢弃
                      minMoves < 6 且 optimalPaths == 1 → 丢弃（早期不给唯一解）
    6. 去重        —— 指纹已存在 → 丢弃
    7. 命名分级    —— 收下
```

`walk_len` 取值：`randint(⌈mlo × 1.2⌉ + 1, ⌊mhi × 1.4⌋ + 4)`，即目标步数越大走得越远。

进度与命中率（含游走/随机来源计数）会打印到 `gen.log`，便于调参。

### 3.3 去重指纹（启发式）

```python
signature = ( 形状多重集,                 # sorted((dir, len) for p in pieces)
              minMoves,
              sorted((distStart[s], degree[s]) for s in 全部可达状态) )
```

- 作用：剔除"仅车辆编号不同、结构完全等价"的重复关卡。
- 为什么够用：全图 `(距离, 出度)` 分布是状态图同构的强不变量；仅靠"距离直方图"会漏判。
- 局限：这是**启发式**，不是严格的图同构判定。若需严格去重，可升级为 `networkx` 的 WL 图哈希（可选优化，非必需）。

### 3.4 生成参数（默认 plan）

| 包 | 数量 | 车数 | `minMoves` | `walk_len` |
|---|---|---|---|---|
| tutorial | 5 | 4–7 | 4–7 | 5–13 |
| classic | 10 | 5–8 | 4–7 | 5–13 |
| classic | 16 | 6–9 | 8–12 | 11–20 |
| classic | 14 | 7–10 | 13–18 | 17–29 |
| classic | 8 | 7–11 | 19–40 | 24–60 |
| 手写教学 | 3 | — | 1 / 2 / 6 | — |

- 每批尝试上限 800 次（反向游走命中率高，无需更多）。
- 搜索上限 100,000 状态，超出即判定"病态盘面"丢弃。
- 种子固定为 `20260920` → **结果完全可复现**，任何人重跑都得到同一套关卡。

---

## 4. 关卡验收不变量

见 `06-testing-acceptance.md` §3 的 I1–I12。核心三条：

1. **可解**（I4）：由求解器保证，不可解的直接丢弃。
2. **par 正确**（I5）：永远由求解器计算，人工只允许"摆车"。
3. **解答不外泄**（I11）：`solution` 只能在 `levels.verify.json`。

---

## 5. 人工关卡的定位：只用来"教学"，不用来"造难题"

实测教训（本项目真实踩过）：

> 手写的"横车挡路"关卡 `t04` 被求解器判定**不可解**。根因是定理 2——出口行内红车右侧的横车永远无法被绕过。
> 另一例：手算某关"应该是 4 步"，求解器给出 **6 步**。人工推算在 4 步以上就不可靠了。

因此确立纪律：
- **人工只负责前 3 关**（1/2/6 步，逐一介绍规则），且必须过求解器校验。
- **其余全部由生成器产出**。
- 任何人工构造的盘面，`par` 一律由求解器计算，**不接受人工填写**。

---

## 6. 扩产路线（P6）

| 阶段 | 关卡数 | 手段 |
|---|---|---|
| v1.0 | 66 | 默认 plan（已可用） |
| v1.1 | 120 | 放宽 `minMoves` 区间 + 增加批次 + 提高尝试上限 |
| v2.0 | 200+ | 引入"种子棋盘 + 局部扰动"策略：取已知好关卡，扰动 1–2 辆车后重新求解并筛选，命中率显著高于纯随机 |
| 每日挑战 | 无限 | 按日期种子确定性生成，全服同题；服务端定时任务预先算好并缓存 |

**每日挑战生成要求**：
- 种子 = `hash(YYYY-MM-DD)`（**北京时间**，服务端须显式使用 UTC+8）。
- 难度固定为 `medium` 区间（8–12 步），保证公平。
- 服务端预生成后存入 `daily_challenge` 表，避免同一日期不同用户拿到不同题。

---

## 7. 关卡热更新

- 客户端内置 `packVersion`；启动时（不阻塞首屏）与服务端比对。
- 服务端返回 `{ version, url, sha256 }`；客户端下载后**校验 sha256** 再落盘。
- 新关卡包必须**向后兼容已有 id**：已发布的关卡 id 与 `par` 永不修改（否则玩家已获得的星级会失效）。
- 需要下线问题关卡时，用 `enabled: false` 标记而非删除。
- 热更新失败必须静默降级到内置版本，不弹报错。

---

## 8. 参考实现使用说明

```bash
# 生成关卡包 + 自检 + 打印难度分布（结果写入 data/ 与 gen.log）
python tools/rush_hour.py

# 单独求解某一关（调试用，P3 补充 CLI）
python tools/rush_hour.py solve c001
```

`tools/rush_hour.py` 已包含：
- `Board`：占用表、走子生成、正向 BFS、多源反向 BFS、Dijkstra、最优解 DP、最优路径回溯
- `solve()`：补齐 par 与全部 metrics
- `random_layout()` / `generate()`：带剪枝的生成器
- `verify_prune_rule()`：定理 2 的随机反例自检（**反例数必须为 0**）
- 手写教学关文本 DSL（每行 `id dir len r c`）

**移植到 TS 时**，`packages/core/src/solver.ts` 必须与上述 6 个方法一一对应，并通过 L2 交叉校验。
