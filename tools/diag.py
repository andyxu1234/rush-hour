"""诊断：反向游走产出的布局，到底死在哪一步的过滤上。

不改动 rush_hour.py，只 import 它的原语，逐条统计拒绝原因。
"""
import os
import random
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rush_hour as rh


def diag_walk(n_trials=400, n_lo=4, n_hi=7, m_lo=4, m_hi=7, seed=20260920):
    rng = random.Random(seed)
    reasons = Counter()
    Ms = []
    for _ in range(n_trials):
        n = rng.randint(n_lo, n_hi)
        wl = rng.randint(m_lo, m_hi + 3)
        ps = rh.random_walk_layout(rng, n, wl)
        if not ps:
            reasons["walk_returned_None"] += 1
            continue
        try:
            b = rh.Board(ps)
        except AssertionError as e:
            reasons["board_invalid"] += 1
            continue
        try:
            ds, degree, used = b.reachable()
        except RuntimeError:
            reasons["state_space_too_large"] += 1
            continue
        dg, goals = b.goal_dist(set(ds))
        if not goals:
            reasons["unsolvable"] += 1
            continue
        M = b.min_moves_to_goal(ds, goals)
        Ms.append(M)
        if not (m_lo <= M <= m_hi):
            reasons[f"M_out_of_range(M<{m_lo})" if M < m_lo else f"M_out_of_range(M>{m_hi})"] += 1
            continue
        if degree[b.start] <= 1:
            reasons["root_degree<=1"] += 1
            continue
        lv = rh.Level("tmp", "tmp", "classic", ps)
        rh.solve(lv, pre=(ds, degree, used, dg, goals))
        if lv.metrics["idlePieces"] > 1:
            reasons["idlePieces>1"] += 1
            continue
        if lv.par_moves < 6 and lv.metrics["optimalPaths"] == 1:
            reasons["unique_solution_early"] += 1
            continue
        reasons["ACCEPTED"] += 1

    print(f"\n=== walk 诊断 (n={n_lo}..{n_hi}, wl={m_lo}..{m_hi + 3}, {n_trials} 次) ===")
    for k, v in reasons.most_common():
        print(f"  {k:<26} {v:>4}  ({v / n_trials * 100:5.1f}%)")
    if Ms:
        Ms.sort()
        hist = Counter(min(m, 30) for m in Ms)
        print(f"\n  M 分布 (n={len(Ms)}, 中位={Ms[len(Ms) // 2]}, 最大={Ms[-1]}):")
        for m in sorted(hist):
            print(f"    M={m:>2} {'█' * hist[m]} {hist[m]}")


def diag_rand(n_trials=400, n_lo=4, n_hi=7, m_lo=4, m_hi=7, seed=7):
    """对照组：纯随机布局。"""
    rng = random.Random(seed)
    reasons = Counter()
    for _ in range(n_trials):
        n = rng.randint(n_lo, n_hi)
        ps = rh.random_layout(rng, n, rng.randint(0, 3))
        if not ps:
            reasons["layout_None"] += 1
            continue
        try:
            b = rh.Board(ps)
            ds, degree, used = b.reachable()
        except Exception:
            reasons["bfs_failed"] += 1
            continue
        dg, goals = b.goal_dist(set(ds))
        if not goals:
            reasons["unsolvable"] += 1
            continue
        M = b.min_moves_to_goal(ds, goals)
        if not (m_lo <= M <= m_hi):
            reasons["M_out_of_range"] += 1
            continue
        reasons["M_in_range"] += 1
    print(f"\n=== rand 对照 (n={n_lo}..{n_hi}, {n_trials} 次) ===")
    for k, v in reasons.most_common():
        print(f"  {k:<26} {v:>4}  ({v / n_trials * 100:5.1f}%)")


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    diag_walk()
    diag_rand()
