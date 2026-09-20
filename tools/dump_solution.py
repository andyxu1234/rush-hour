"""打印某关的最优解，供 UI mockup 使用真实数据。"""
import json
import os
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(root, "data", "levels.verify.json"), encoding="utf-8") as f:
    doc = json.load(f)

want = sys.argv[1] if len(sys.argv) > 1 else "c004"
out = []
for lv in doc["levels"]:
    if lv["id"] != want:
        continue
    out.append(f"{lv['id']}  {lv['name']}  par={lv['par']['moves']} 星三={lv['stars']['three']} 星二={lv['stars']['two']}")
    out.append(f"metrics: {lv['metrics']}")
    for i, m in enumerate(lv.get("solution") or [], 1):
        out.append(f"  {i:>2}. 车{m['piece']}  方向={m['dir']:<5} 滑{m['cells']}格")
    if not lv.get("solution"):
        out.append("  (无 solution 字段)")

with open(os.path.join(root, "sol.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(out))
