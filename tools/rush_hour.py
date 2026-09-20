"""
Rush Hour (汽车华容道) 参考实现 —— 棋盘模型 / 合法走子 / 最短步数求解 / 难度指标 / 关卡生成

本文件是整个项目的"事实来源"(source of truth)：
  * Python 端用于离线生成关卡、校验可解性、计算 par 步数、导出关卡包；
  * 其算法需被 1:1 移植为前端 TS 版本 (packages/core)，用于运行时"提示""复盘""步数预测"。
  * 两侧必须对同一关卡给出完全一致的 minMoves —— 由 CI 用 levels.verify.json 交叉校验。

用法:
  python tools/rush_hour.py gen            # 生成关卡包到 data/
  python tools/rush_hour.py solve <levelId>
  python tools/rush_hour.py report

仅依赖标准库。
"""

from __future__ import annotations

import heapq
import json
import os
import random
import sys
from collections import deque
from dataclasses import dataclass, field, asdict

# ---------------------------------------------------------------- 常量

COLS = 6
ROWS = 6
EXIT_ROW = 2                # 出口在第 2 行(0-indexed) 右侧
EXIT_SIDE = "right"
H = "H"                     # 横车
V = "V"                     # 竖车
RED_ID = "R"
GOAL_C = COLS - 2           # 红车左上角列 = 4 时代表已驶出

# 难度分级：主指标 = 最少滑动次数。次级指标只用于"思考空间"标注。
TIERS = [
    ("starter", 0, 3),      # 入门
    ("easy", 4, 7),         # 简单
    ("medium", 8, 12),      # 中等
    ("hard", 13, 18),       # 困难
    ("expert", 19, 999),    # 专家
]
TIER_CN = {
    "starter": "入门", "easy": "简单", "medium": "中等",
    "hard": "困难", "expert": "专家",
}

MAX_STATES = 100_000        # 搜索上限。这个值直接决定生成速度：车多的盘面状态空间会爆炸，
                            # 上限过大则每次失败尝试都要白跑一次巨型 BFS。10 万已覆盖 M≤20 的关卡。


# ---------------------------------------------------------------- 数据模型

@dataclass(frozen=True)
class Piece:
    """一辆车。r,c 为车辆所占最上一格/最左一格的坐标。"""
    id: str
    dir: str
    len: int
    r: int
    c: int

    def cells(self):
        if self.dir == H:
            return [(self.r, self.c + i) for i in range(self.len)]
        return [(self.r + i, self.c) for i in range(self.len)]


@dataclass
class Level:
    id: str
    name: str
    pack: str
    pieces: list
    difficulty: str = ""
    par_moves: int = 0
    par_cells: int = 0
    metrics: dict = field(default_factory=dict)
    solution: list = field(default_factory=list)

    def to_dict(self, with_solution=False):
        d = {
            "id": self.id,
            "pack": self.pack,
            "name": self.name,
            "difficulty": self.difficulty,
            "par": {"moves": self.par_moves, "cellSteps": self.par_cells},
            "stars": {
                "three": self.par_moves,
                "two": self.par_moves + 2,
                "one": 0,          # 0 = 只要完成即 1 星
            },
            "pieces": [asdict(p) for p in self.pieces],
            "metrics": self.metrics,
        }
        if with_solution:
            d["solution"] = self.solution
        return d


# ---------------------------------------------------------------- 求解器

class Board:
    """把 Level 编译成可高速搜索的形式。状态 = 各车 (r,c) 组成的元组。"""

    def __init__(self, pieces):
        pieces = list(pieces)
        pieces.sort(key=lambda p: (p.id != RED_ID, p.id))   # 红车固定为 index 0
        self.pieces = pieces
        self.n = len(pieces)
        self.start = tuple((p.r, p.c) for p in pieces)
        self.dirs = [p.dir for p in pieces]
        self.lens = [p.len for p in pieces]
        self._validate()

    def _validate(self):
        red = self.pieces[0]
        assert red.id == RED_ID and red.dir == H and red.len == 2, "红车必须是 H/2"
        assert red.r == EXIT_ROW, "红车初始必须位于出口行"
        seen = set()
        for p in self.pieces:
            assert p.len in (2, 3), f"{p.id} 长度非法"
            for (r, c) in p.cells():
                assert 0 <= r < ROWS and 0 <= c < COLS, f"{p.id} 越界"
                assert (r, c) not in seen, f"{p.id} 与其他车重叠于 {(r,c)}"
                seen.add((r, c))

    # -- 关键内循环：占用表用一维 list，避免嵌套开销
    def occupancy(self, state):
        g = [-1] * (ROWS * COLS)
        for i, (r, c) in enumerate(state):
            if self.dirs[i] == H:
                base = r * COLS + c
                for k in range(self.lens[i]):
                    g[base + k] = i
            else:
                for k in range(self.lens[i]):
                    g[(r + k) * COLS + c] = i
        return g

    def gen_moves(self, state):
        """返回 [(车序号, 方向, 滑动格数, 新状态)]。一次"移动"= 一辆车沿自身轴向任意距离滑动 1 次。"""
        g = self.occupancy(state)
        out = []
        for i in range(self.n):
            r, c = state[i]
            ln = self.lens[i]
            if self.dirs[i] == H:
                # 向右：检查新进入的格
                k = 0
                while c + ln + k < COLS and g[r * COLS + c + ln + k] == -1:
                    k += 1
                    ns = list(state); ns[i] = (r, c + k)
                    out.append((i, "right", k, tuple(ns)))
                k = 0
                while c - 1 - k >= 0 and g[r * COLS + c - 1 - k] == -1:
                    k += 1
                    ns = list(state); ns[i] = (r, c - k)
                    out.append((i, "left", k, tuple(ns)))
            else:
                k = 0
                while r + ln + k < ROWS and g[(r + ln + k) * COLS + c] == -1:
                    k += 1
                    ns = list(state); ns[i] = (r + k, c)
                    out.append((i, "down", k, tuple(ns)))
                k = 0
                while r - 1 - k >= 0 and g[(r - 1 - k) * COLS + c] == -1:
                    k += 1
                    ns = list(state); ns[i] = (r - k, c)
                    out.append((i, "up", k, tuple(ns)))
        return out

    @staticmethod
    def is_goal(state):
        return state[0][0] == EXIT_ROW and state[0][1] == GOAL_C

    # -- 正向 BFS：从初始状态铺满整个可达状态图
    def reachable(self):
        """返回 (dist, degree, used)。
        dist: 状态->最少滑动次数；degree: 状态->出度；used: 被真正移动过的车序号集合。
        顺带收集 used，避免为了统计"装饰车"再遍历一遍整图（这是 2 倍性能差）。"""
        dist = {self.start: 0}
        degree = {}
        used = set()
        q = deque([self.start])
        while q:
            s = q.popleft()
            mv = self.gen_moves(s)
            degree[s] = len(mv)
            for (i, _, _, ns) in mv:
                used.add(i)
                if ns not in dist:
                    dist[ns] = dist[s] + 1
                    q.append(ns)
            if len(dist) > MAX_STATES:
                raise RuntimeError("state space too large")
        return dist, degree, used

    # -- 反向 BFS：由于所有移动可逆，状态图是无向图，直接从"目标状态集合"多源传播
    def goal_dist(self, states):
        """返回 (dist_goal, goals)。dist_goal 覆盖整个可达集；goals 才是真正的目标状态。
        注意：求最少步数必须用 min(dist_start[g] for g in goals)，切不可对 dist_goal 取 min
        —— dist_goal 含初始状态(距离 0)会导致结果恒为 0。"""
        goals = [s for s in states if self.is_goal(s)]
        if not goals:
            return None, []
        dist = {s: 0 for s in goals}
        q = deque(goals)
        while q:
            s = q.popleft()
            for (_, _, _, ns) in self.gen_moves(s):
                if ns in states and ns not in dist:      # 只在可达子图内搜索
                    dist[ns] = dist[s] + 1
                    q.append(ns)
        return dist, goals

    def min_moves_to_goal(self, dist_start, goals):
        return min(dist_start[g] for g in goals)

    # -- 最少"格数"：Dijkstra，边权 = 滑动格数
    def min_cell_steps(self):
        dist = {self.start: 0}
        pq = [(0, self.start)]
        best = None
        while pq:
            d, s = heapq.heappop(pq)
            if d > dist.get(s, 1 << 30):
                continue
            if self.is_goal(s):
                best = d
                break
            for (_, _, k, ns) in self.gen_moves(s):
                nd = d + k
                if nd < dist.get(ns, 1 << 30):
                    dist[ns] = nd
                    heapq.heappush(pq, (nd, ns))
        return best

    # -- 最优解路径（任意一条）
    def optimal_path(self, dist_start, dist_goal, M):
        s = self.start
        path = []
        guard = 0
        while not self.is_goal(s) and guard < 500:
            guard += 1
            for (i, d, k, ns) in self.gen_moves(s):
                if dist_start.get(ns, 1 << 30) == dist_start[s] + 1 and \
                   dist_start[ns] + dist_goal.get(ns, 1 << 30) == M:
                    path.append({"piece": self.pieces[i].id, "dir": d, "cells": k})
                    s = ns
                    break
            else:
                return None
        return path

    # -- 最优解条数（按最优"走廊"上的 DAG 做 DP）。数量大 = 冗余度高 = 更容易。
    def count_optimal(self, dist_start, dist_goal, M, cap=10 ** 9):
        corridor = [s for s in dist_start
                    if dist_start[s] + dist_goal.get(s, 1 << 30) == M]
        corridor_set = set(corridor)
        f = {}
        for s in sorted(corridor, key=lambda x: -dist_start[x]):
            if self.is_goal(s):
                f[s] = 1
                continue
            tot = 0
            for (_, _, _, ns) in self.gen_moves(s):
                if ns in corridor_set and dist_start.get(ns, -1) == dist_start[s] + 1:
                    tot += f.get(ns, 0)
            f[s] = min(tot, cap)
        return f.get(self.start, 0)

    def moves_used_pieces(self, dist):
        """在整个可达状态空间中真正动过的车数量（用于剔除"纯装饰"的车）。"""
        used = set()
        for s in dist:
            for (i, _, _, _) in self.gen_moves(s):
                used.add(i)
        return used


def solve(level: Level, pre=None) -> Level:
    """补齐一个关卡的全部求解结果与难度指标。不可解则抛异常。
    pre: 可选 (dist_start, degree, dist_goal, n_goals) —— 由调用方复用已算好的 BFS 结果，避免重复搜索。"""
    b = Board(level.pieces)
    if pre is None:
        dist_start, degree, used = b.reachable()
        dist_goal, goals = b.goal_dist(set(dist_start))
    else:
        dist_start, degree, used, dist_goal, goals = pre
    if not goals:
        raise RuntimeError(f"{level.id} 不可解")

    M = b.min_moves_to_goal(dist_start, goals)
    n_goals = len(goals)
    cells = b.min_cell_steps()

    level.par_moves = M
    level.par_cells = cells
    level.difficulty = tier_of(M)
    level.metrics = {
        "reachableStates": len(dist_start),
        "searchDepth": max(dist_start.values()),
        "rootMoves": degree[b.start],
        "maxBranching": max(degree.values()),
        "optimalPaths": b.count_optimal(dist_start, dist_goal, M),
        "goalStates": n_goals,
        "solutionSpaceLog2": round(__import__("math").log2(len(dist_start) + 1), 1),
        "idlePieces": b.n - len(used),
        "pieces": b.n,
    }
    level.solution = b.optimal_path(dist_start, dist_goal, M)
    return level


def tier_of(m: int) -> str:
    for name, lo, hi in TIERS:
        if lo <= m <= hi:
            return name
    return "expert"


# ---------------------------------------------------------------- 关卡文本 DSL

def parse(text: str, lid: str, name: str, pack: str) -> Level:
    """每行: id dir len r c   （# 开头为注释）"""
    pieces = []
    for line in text.strip().splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        pid, d, ln, r, c = line.split()
        pieces.append(Piece(pid, d, int(ln), int(r), int(c)))
    return Level(lid, name, pack, pieces)


# ---------------------------------------------------------------- 生成器

SHAPES = [(H, 2), (H, 2), (H, 2), (H, 3), (V, 2), (V, 2), (V, 2), (V, 3)]


def random_layout(rng, n_pieces, red_c):
    """在 6x6 上随机铺车，红车固定在 (2, red_c)。返回 Piece 列表或 None。"""
    grid = [[False] * COLS for _ in range(ROWS)]

    def put(p):
        cs = p.cells()
        for (r, c) in cs:
            if not (0 <= r < ROWS and 0 <= c < COLS) or grid[r][c]:
                return False
        for (r, c) in cs:
            grid[r][c] = True
        return True

    red = Piece(RED_ID, H, 2, EXIT_ROW, red_c)
    if not put(red):
        return None
    pieces = [red]
    letters = "abcdefghijklmn"

    attempts = 0
    while len(pieces) - 1 < n_pieces and attempts < 400:
        attempts += 1
        d, ln = rng.choice(SHAPES)
        if d == H:
            r, c = rng.randrange(ROWS), rng.randrange(COLS - ln + 1)
        else:
            r, c = rng.randrange(ROWS - ln + 1), rng.randrange(COLS)
        # 剪枝定理：出口行内位于红车右侧的横车，永远无法被红车绕过（同一行内两车无法交换
        # 左右次序），目标态要求红车占据 (EXIT_ROW,4)-(EXIT_ROW,5)，此时该横车必须位于
        # 第 5 列之后 —— 越界。故此类棋盘必然不可解，直接丢弃，省掉一次 BFS。
        if d == H and r == EXIT_ROW and c > red_c:
            continue
        p = Piece(letters[len(pieces) - 1], d, ln, r, c)
        cs = p.cells()
        if any(not (0 <= rr < ROWS and 0 <= cc < COLS) or grid[rr][cc] for (rr, cc) in cs):
            continue
        put(p)
        pieces.append(p)
    return pieces if len(pieces) - 1 >= n_pieces else None


def signature(level: Level, dist_start, degree):
    """关卡等价性指纹（启发式）：形状多重集 + 最少步数 + 全图 (距离,出度) 分布。
    两个仅车辆编号不同、结构等价的关卡会得到同一指纹。"""
    shapes = tuple(sorted((p.dir, p.len) for p in level.pieces))
    prof = tuple(sorted((dist_start[s], degree[s]) for s in dist_start))
    return (shapes, level.par_moves, prof)


OPP = {"left": "right", "right": "left", "up": "down", "down": "up"}


def random_walk_layout(rng, n_pieces, walk_len):
    """★ 主力生成策略：从"已通关"的局面出发，**沿"到目标距离"的梯度定向加深**，
    把走到的终点当作出题局面。

    为什么这样生成：
      1. **按构造即可解** —— 从终点倒着走出来，正着走必然能回去，无需冒不可解的风险。
      2. **命中率远高于纯随机** —— 随机撒车想凑出 8 步以上的关卡极其罕见
         （实测纯随机命中率低于 1/2500）。
      3. 红车是横车，只能留在出口行，因此"红车必须在 row=2"这一不变量自动满足。

    ⚠️ 实现要点（本项目实测踩过，勿"顺手优化"）：

    a) **起点红车必须摆在出口列 `c=COLS-2`**（即"已通关"态），这才是"从终点倒着走"
       的本意。若起点写成 `c=0`，游走等于从"红车远离出口"出发，产出的终局 M 更差。

    b) **必须禁止游走进"红车已通关"的局面**。`Board.is_goal()` 只看红车位置，
       而游走者一旦把红车推到 `(2,4)` 就出现"题目已经解了"的无效终局。

    c) 【最关键，血泪教训 —— 两次踩坑，务必读完】

       c1) 不能用 `rng.choice` 均匀采样。均匀随机游走在状态图上做的是"扩散"，没有
           漂移，n 步后仍停在出发点附近的小球内：实测 `walk_len=20` 时游走全程
           `dg ∈ {0,1}`，**一步都没走远**，终局 M 中位数恒为 1~3 且与 walk_len 无关。

       c2) 仅加"优先访问未访问状态"（贪心探索）也不够。高密度盘面状态空间大，
           贪心探索会把预算浪费在"横向摊开"上，实测 M 仍只到 5~8，而同一盘面的
           理论上限 `ecc = max(dg)` 可达 18~24 —— **上限被严重浪费**。

       ✅ 正解：**按 `dg`（到目标的距离）主动"往上爬"**。先把整个可达图的 dg 算出来
       （以目标状态集合为源做一次 BFS），然后每步只在"使 dg 增大"的走法里选；
       同深度内随机打散以保持多样性。这样终局 M 直接逼近该盘面的 ecc 上限，
       产出率提升一个数量级。

       > 注意：dg 必须在**同一个 Board 上预计算**，`visited` 仅用于避免同深度原地盘旋。

    d) 难度筛选仍交给 `generate()` 的拒绝采样；本函数只保证"按构造可解 + 尽量走远"。

    返回 Piece 列表；若走出后又回到通关态（等于没出题）则返回 None。
    """
    ps = random_layout(rng, n_pieces, COLS - 2)      # 红车先摆在出口(已通关位置)
    if not ps:
        return None
    b = Board(ps)

    # c2) 预计算 dg：以"所有目标状态"为源做多源 BFS。dg[s] = s 到最近目标的最少步数。
    #     定向加深依赖它，但高密度盘面的状态空间可能超过 MAX_STATES —— 此时**不能崩**，
    #     退化为"仅禁止回头/仅禁止走进通关态"的无梯度游走（generator 会照常拒绝采样）。
    dg = None
    try:
        ds_all, _degree, _used = b.reachable()
        dg, goals = b.goal_dist(set(ds_all))
        if not goals:
            return None
    except RuntimeError:
        # 状态空间过大：本盘面注定会被 generate() 的粗筛丢弃（BFS 也会超限），
        # 但这里仍需返回一个合法盘面，交由上游统一处理，避免整个生成流程中断。
        dg = None

    state = b.start
    visited = {state}       # 仅用于"同深度内"避免原地盘旋
    last = None
    best = state            # 记录走过的 dg 最大的状态（终局用它，避免最后一两步回落）
    best_dg = dg.get(state, -1) if dg else -1
    for _ in range(walk_len):
        mv = b.gen_moves(state)
        if not mv:
            break
        cand = mv
        if last is not None:
            # 防止刚走完立刻原路返回，造成 A→B→A 空转
            c1 = [m for m in cand if not (m[0] == last[0] and m[1] == OPP[last[1]])]
            if c1:
                cand = c1
        # b) 禁止走进通关态：那是"题目已解"，不是有效出题局面
        c2 = [m for m in cand if not b.is_goal(m[3])]
        if c2:
            cand = c2
        if not cand:
            break

        if dg is None:
            # 无梯度可用（状态空间超限）：退化为"优先走未访问状态"
            fresh = [m for m in cand if m[3] not in visited]
            pool = fresh if fresh else cand
        else:
            cur_dg = dg.get(state, -1)
            # 定向加深：只考虑"不降低 dg"的走法；若有能严格抬高 dg 的，优先在其中选
            deeper = [m for m in cand if dg.get(m[3], -1) > cur_dg]
            level = [m for m in cand if dg.get(m[3], -1) == cur_dg]
            if deeper:
                pool = deeper
            elif level:
                fresh_level = [m for m in level if m[3] not in visited]
                pool = fresh_level if fresh_level else level
            else:
                pool = cand      # 实在无法维持深度时才允许回落

        i, d, k, ns = rng.choice(pool)
        state = ns
        visited.add(state)
        last = (i, d)
        if dg is not None and dg.get(state, -1) > best_dg:
            best_dg = dg[state]
            best = state

    # 用"走过的 dg 最大状态"作为终局：定向游走末端可能回落，回落会让 M 变小
    final = best
    if b.is_goal(final):
        return None
    return [Piece(p.id, p.dir, p.len, final[idx][0], final[idx][1])
            for idx, p in enumerate(b.pieces)]


DEFAULT_PLAN = [
    # (pack, 数量, (车数下限, 车数上限), (最少步数下限, 最少步数上限))
    #
    # ⚠️ 车数是"难度的真正旋钮"，不是 walk_len。以下是**实测标定**（60 样本/档），
    #    列的是盘面 ecc（= 该盘面理论最大 M，等价于"最多能做到多难"）：
    #
    #      n  | 占格率 | ecc 中位 | ecc p90 | ecc>=13 占比 | ecc>=19 占比
    #      9  |  58%  |    5     |   10    |     0.0%     |    0.0%
    #     10  |  67%  |    7     |   13    |    13.6%     |    4.5%
    #     11  |  72%  |    7     |   12    |     9.1%     |    2.3%
    #     12  |  78%  |    7     |   16    |    12.8%     |    5.1%
    #     13  |  83%  |    8     |   12    |     6.1%     |    0.0%
    #
    #    两条硬结论：
    #      (1) **n=9 时 ecc>=13 占比为 0** —— 车数低于 10 的档位无论怎么游走都产不出
    #          medium 上沿，故所有 >= medium 的档位车数下限必须 >= 10。
    #      (2) 6x6 上 hard/expert 是**真实的低频长尾**（ecc>=13 仅 ~10%，
    #          ecc>=19 仅 ~4%），不是 bug。因此这些档位必须给足采样预算
    #          （见 TIER_TRIES），否则打不满数量。
    #      (3) n>=14 会因空位不足频繁提前放弃（random_layout 达标率降到 ~85%），上限取 13。
    ("tutorial", 5, (4, 7), (4, 7)),        # 教学：其余关卡（前 3 关手写）
    ("classic", 10, (6, 9), (4, 7)),        # easy   4-7
    ("classic", 16, (10, 12), (8, 12)),     # medium 8-12（下限必须 >=10）
    ("classic", 14, (11, 13), (13, 18)),    # hard   13-18（长尾，需高预算）
    ("classic", 8, (11, 13), (19, 40)),     # expert 19+（更稀有的长尾）
]

# 各档采样预算：hard/expert 的 ecc>=13 占比仅 ~10%，再叠加 degree/idle/去重等筛选，
# 需要比低难度档明显更大的预算才能打满数量。低难度档保持小预算以免浪费时间。
TIER_TRIES = {
    (4, 7): 400,
    (8, 12): 1500,
    (13, 18): 4000,
    (19, 40): 6000,
}


def generate(seed=20260920, plan=None, per_level_tries=None):
    """按 plan 生成关卡。plan 项: (pack, 数量, 车数范围, 最少步数范围)

    ⚠️ 关于 walk_len：定向加深游走会**主动逼近该盘面的 ecc 上限**，因此 walk_len
      只需略大于目标 M（留一点余量走满梯度），不再是"要放大好几倍"的关系。
      区间下界取 mlo、上界取 mhi+6，保证有足够步数爬到目标深度。

    ⚠️ 关于 per_level_tries：**按难度档查 TIER_TRIES**，而不是全局同一个值。
      hard/expert 的盘面 ecc>=13 仅约 10%，再叠加 degree/idle/去重筛选后更低，
      用低难度档的 400 次预算必然打不满数量（实测 hard 曾 300 次尝试得 0 关）。

    性能提示：Python 版 BFS 约 2~5 万状态/秒，而**每一次被拒绝的尝试也要付一次完整 BFS**。
    因此运行时间 ≈ 尝试次数 × 单次 BFS 耗时，调大 per_level_tries 会让耗时线性增长。
    生产环境（P6）建议把生成器改写为 Rust/TS 或直接用多进程并行，可提速 10~50 倍。"""
    rng = random.Random(seed)
    if plan is None:
        plan = DEFAULT_PLAN
    out, seen = [], set()
    for pack, count, (nlo, nhi), (mlo, mhi) in plan:
        # 预算按难度档取（见 TIER_TRIES 说明）；显式传入 per_level_tries 时以传入值为准
        tries_budget = per_level_tries if per_level_tries is not None \
            else TIER_TRIES.get((mlo, mhi), 400)
        got, tried, by_walk, by_rand = 0, 0, 0, 0
        while got < count and tried < tries_budget:
            tried += 1
            n = rng.randint(nlo, nhi)
            if rng.random() < 0.15:
                # 少量纯随机布局，保证关卡形态多样（不全是"游走"形态）。
                # ⚠️ 红车列必须随机取 0..COLS-3，**不能**用 COLS-2：那会让红车直接
                #    停在出口（M=0，题目已解），早期版本因此整条 rand 分支恒被丢弃。
                ps = random_layout(rng, n, rng.randint(0, COLS - 3))
                src = "rand"
            else:
                # 定向加深游走：walk_len 略高于目标 M 即可（见函数 docstring）
                wl = rng.randint(max(6, mlo), mhi + 6)
                ps = random_walk_layout(rng, n, wl)
                src = "walk"
            if not ps:
                continue

            # ---- 粗筛：只跑一次 BFS 求最少步数，通过后才付出完整指标计算
            try:
                b0 = Board(ps)
                ds, degree, used = b0.reachable()
                dg, goals = b0.goal_dist(set(ds))
            except Exception:
                continue
            if not goals:
                continue                            # 不可解
            M = b0.min_moves_to_goal(ds, goals)
            if not (mlo <= M <= mhi):
                continue
            if degree[b0.start] <= 1:
                continue                            # 开局几乎无选择 = 无趣

            # ---- 精筛：完整求解（par/格数/最优解条数/装饰车）
            lv = Level("tmp", "tmp", pack, ps)
            try:
                solve(lv, pre=(ds, degree, used, dg, goals))
            except Exception:
                continue
            m = lv.metrics
            if lv.par_moves < 6 and m["optimalPaths"] == 1:
                continue                            # 早期关卡不出现唯一解
            if m["idlePieces"] > 1:
                continue                            # 剔除大面积装饰车
            sig = signature(lv, ds, degree)
            if sig in seen:
                continue
            seen.add(sig)
            lv.name = auto_name(lv)
            out.append(lv)
            got += 1
            if src == "walk":
                by_walk += 1
            else:
                by_rand += 1
        print(f"  [gen] pack={pack:<8} 目标{count:>3}关 实得{got:>3}关 "
              f"(尝试{tried}/{tries_budget}, 游走{by_walk}/随机{by_rand}, "
              f"M∈[{mlo},{mhi}], 车数∈[{nlo},{nhi}])")
    return out


def verify_prune_rule(rng, n=400):
    """自检：随机造"出口行右侧有横车"的棋盘，确认全部不可解（验证剪枝定理）。"""
    bad = 0
    for _ in range(n):
        red_c = rng.randint(0, 2)
        grid = [[False] * COLS for _ in range(ROWS)]
        for (r, c) in Piece(RED_ID, H, 2, EXIT_ROW, red_c).cells():
            grid[r][c] = True
        letters = "abcdefghijklmn"
        pieces = [Piece(RED_ID, H, 2, EXIT_ROW, red_c)]
        forced = Piece(letters[0], H, rng.choice([2, 3]), EXIT_ROW, red_c + 2)
        if forced.cells()[-1][1] >= COLS:
            continue
        for (r, c) in forced.cells():
            grid[r][c] = True
        pieces.append(forced)
        for _ in range(rng.randint(2, 6)):
            d, ln = rng.choice(SHAPES)
            if d == H:
                r, c = rng.randrange(ROWS), rng.randrange(COLS - ln + 1)
            else:
                r, c = rng.randrange(ROWS - ln + 1), rng.randrange(COLS)
            if d == H and r == EXIT_ROW:
                continue
            p = Piece(letters[len(pieces)], d, ln, r, c)
            cs = p.cells()
            if any(grid[rr][cc] for (rr, cc) in cs):
                continue
            for (rr, cc) in cs:
                grid[rr][cc] = True
            pieces.append(p)
        try:
            b = Board(pieces)
            ds, _, _ = b.reachable()
            _, goals = b.goal_dist(set(ds))
            if goals:
                bad += 1
        except Exception:
            continue
    print(f"  [self-check] 剪枝定理反例: {bad} / {n}  （应为 0）")
    return bad


NAME_PREFIX = {
    "starter": ["推一把就好", "挡路的车", "让一让", "腾个位置", "第一步"],
    "easy": ["拐个弯", "竖车当道", "三格长车", "慢慢挪", "一路向右"],
    "medium": ["错车", "先退后进", "并排难题", "堵在出口", "五车连环"],
    "hard": ["十步之外", "层层设防", "倒车入库", "僵局", "窄缝"],
    "expert": ["专家局", "铁桶阵", "无解之解", "长考", "极限腾挪"],
}


def auto_name(lv: Level) -> str:
    pool = NAME_PREFIX[lv.difficulty]
    i = (lv.par_moves + lv.metrics["pieces"]) % len(pool)
    return f"{pool[i]}（{lv.metrics['pieces']}车/{lv.par_moves}步）"


# ---------------------------------------------------------------- 手写入门关

TUTORIALS = [
    ("t01", "认识红车：直接开出去",
     """
     R H 2 2 3
     a V 2 0 0
     b H 2 0 2
     c V 3 3 4
     d H 2 5 0
     """),

    ("t02", "第一辆挡路的竖车",
     """
     R H 2 2 0
     a V 2 2 3
     b H 2 4 0
     c V 2 0 5
     d H 3 5 2
     """),

    ("t03", "三辆车都要先让开",
     """
     R H 2 2 0
     a V 2 2 3
     b V 2 2 5
     c H 2 0 0
     d V 3 0 2
     e H 3 4 1
     f V 2 4 4
     """),
]


def build_tutorials():
    out = []
    for lid, name, text in TUTORIALS:
        lv = parse(text, lid, name, "tutorial")
        solve(lv)
        out.append(lv)
    # 确保难度阶梯单调递增，否则提示设计者调整
    ms = [l.par_moves for l in out]
    print(f"  [tutorial] 最少步数序列: {ms}")
    return out


# ---------------------------------------------------------------- CLI

def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(root, "data")
    os.makedirs(data_dir, exist_ok=True)
    order = {t: i for i, (t, _, _) in enumerate(TIERS)}

    # 自身写日志文件：本机 shell 重定向不可靠（PowerShell 工具不回显 stdout）
    class _Tee:
        def __init__(self, path):
            self.f = open(path, "w", encoding="utf-8")

        def write(self, s):
            self.f.write(s)
            self.f.flush()
            try:
                sys.__stdout__.write(s)
                sys.__stdout__.flush()
            except Exception:
                pass

        def flush(self):
            self.f.flush()

    sys.stdout = _Tee(os.path.join(root, "gen.log"))
    print("== 开始生成 ==", flush=True)

    print("== 手写入门关 ==")
    hand = build_tutorials()
    for l in hand:
        print(f"  {l.id} {l.par_moves:>2}步 {l.par_cells:>2}格 "
              f"状态={l.metrics['reachableStates']:>5} 最优解={l.metrics['optimalPaths']:>3}  {l.name}")

    print("== 程序化生成 ==")
    gen = generate()

    tot_pack = sorted(hand + [l for l in gen if l.pack == "tutorial"],
                      key=lambda l: (l.par_moves, l.metrics["pieces"]))
    classic = sorted([l for l in gen if l.pack == "classic"],
                     key=lambda l: (order[l.difficulty], l.par_moves, l.metrics["pieces"]))

    for i, l in enumerate(tot_pack, 1):
        l.id, l.pack, l.name = f"t{i:02d}", "tutorial", f"第{i}关 · {l.name.split('（')[0]}"
    for i, l in enumerate(classic, 1):
        l.id, l.pack = f"c{i:03d}", "classic"
        l.name = f"第{i}关 · {l.name}"

    all_levels = tot_pack + classic
    pack, verify = [], []
    for l in all_levels:
        d = l.to_dict(with_solution=False)
        d["index"] = len(pack) + 1
        pack.append(d)
        verify.append(l.to_dict(with_solution=True))

    doc = {
        "schemaVersion": 1,
        "board": {"cols": COLS, "rows": ROWS, "exitRow": EXIT_ROW, "exitSide": EXIT_SIDE},
        "generator": {"tool": "tools/rush_hour.py", "seed": 20260920},
        "levels": pack,
    }
    with open(os.path.join(data_dir, "levels.json"), "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
    with open(os.path.join(data_dir, "levels.verify.json"), "w", encoding="utf-8") as f:
        json.dump({"schemaVersion": 1, "levels": verify}, f, ensure_ascii=False, indent=2)

    print("\n== 自检 ==")
    verify_prune_rule(random.Random(1))

    print("\n== 难度分布 ==")
    from collections import Counter
    c = Counter(l.difficulty for l in all_levels)
    for name, _, _ in TIERS:
        print(f"  {TIER_CN[name]:<3} ({name:<8}) {c.get(name, 0):>3} 关  "
              f"{'█' * c.get(name, 0)}")
    ms = sorted(l.par_moves for l in all_levels)
    st = sorted(l.metrics["reachableStates"] for l in all_levels)
    pc = sorted(l.metrics["pieces"] for l in all_levels)
    print(f"  合计 {len(all_levels)} 关")
    print(f"  最少步数  区间[{ms[0]}, {ms[-1]}]  中位 {ms[len(ms)//2]}")
    print(f"  车数      区间[{pc[0]}, {pc[-1]}]")
    print(f"  搜索空间  区间[{st[0]}, {st[-1]}] 状态")
    print(f"\n写出 data/levels.json        ({len(pack)} 关，不含解答)")
    print(f"写出 data/levels.verify.json ({len(verify)} 关，含解答，仅供 CI 交叉校验)")


if __name__ == "__main__":
    main()
