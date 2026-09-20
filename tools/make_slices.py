"""生成截图用的切片 HTML：每次只显示 gallery 里连续的几屏，方便逐屏目视检查。

原文件不含任何 JS，切片只是往 <style> 末尾追加 display:none 规则，不改动原文件。
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "design", "ui-mockup.html")

# (输出名, 保留的 .cellw 序号区间含头含尾, 视口宽, 视口高)
SLICES = [
    ("_shotA", 1, 4, 1600, 1180),
    ("_shotB", 5, 8, 1600, 1180),
    ("_shotC", 9, 10, 900, 1180),
]

HIDE_CHROME = ".phead,.basegrid,.pfoot{display:none!important}"


def main():
    with open(SRC, encoding="utf-8") as f:
        html = f.read()
    assert html.count("</style>") == 1, "style 标签数量异常"
    lines = []
    for name, lo, hi, w, h in SLICES:
        rules = [HIDE_CHROME]
        if lo > 1:
            rules.append(f".gallery>.cellw:nth-child(-n+{lo - 1}){{display:none!important}}")
        rules.append(f".gallery>.cellw:nth-child(n+{hi + 1}){{display:none!important}}")
        css = "\n".join(rules)
        out = html.replace("</style>", "\n/* --- 截图切片 --- */\n" + css + "\n</style>")
        out = out.replace('<div class="wrap">',
                          '<div class="wrap" style="padding-top:16px">')
        p = os.path.join(ROOT, "design", name + ".html")
        with open(p, "w", encoding="utf-8") as f:
            f.write(out)
        lines.append(f"{name}.html  保留第 {lo}-{hi} 屏  视口 {w}x{h}")
    with open(os.path.join(ROOT, "slices.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
