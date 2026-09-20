"""静态校验 ui-mockup.html：标签闭合、残留占位符、关键元素计数。

不引第三方库，用标准库 HTMLParser 做栈式配对。
"""
import os
import re
import sys
from collections import Counter
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "design", "ui-mockup.html")

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr"}


class Checker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.errors = []
        self.counts = Counter()
        self.attrs_seen = []

    def handle_starttag(self, tag, attrs):
        self.counts[tag] += 1
        d = dict(attrs)
        for k in ("class", "style"):
            if k in d:
                self.attrs_seen.append((tag, k, d[k]))
        if tag not in VOID:
            self.stack.append((tag, self.getpos()))

    def handle_startendtag(self, tag, attrs):
        self.counts[tag] += 1

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append(f"多余的 </{tag}> 于 {self.getpos()}")
            return
        top, pos = self.stack[-1]
        if top == tag:
            self.stack.pop()
        else:
            self.errors.append(
                f"</{tag}> 于 {self.getpos()} 与未闭合的 <{top}> (开于 {pos}) 不匹配")
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    del self.stack[i:]
                    break


def main():
    with open(PATH, encoding="utf-8") as f:
        html = f.read()

    out = []
    out.append(f"文件: {os.path.relpath(PATH, ROOT)}")
    out.append(f"大小: {len(html)} 字节 / {html.count(chr(10)) + 1} 行")

    # 1. 残留占位符
    leftover = html.count("<!--CHUNK-->")
    out.append(f"\n[1] 残留占位符 <!--CHUNK--> : {leftover}  " +
               ("OK" if leftover == 0 else "**失败**"))

    # 2. 标签配对
    c = Checker()
    c.feed(html)
    c.close()
    unclosed = [f"<{t}> 开于 {p}" for t, p in c.stack]
    out.append(f"\n[2] 标签配对错误: {len(c.errors)}")
    for e in c.errors[:20]:
        out.append("    " + e)
    out.append(f"    未闭合标签: {len(unclosed)}")
    for u in unclosed[:20]:
        out.append("    " + u)

    # 3. 关键元素计数
    out.append("\n[3] 关键元素计数")
    for tag, want in [("div", None), ("svg", None)]:
        out.append(f"    {tag:<6} {c.counts[tag]}")
    phones = html.count('class="phone')
    boards = html.count('class="board')
    cars = len(re.findall(r'class="car\b', html))
    gates = len(re.findall(r'class="gate\b', html))
    modals = html.count('class="modal"')
    capsules = html.count('class="capsule"')
    out.append(f"    .phone    {phones}  (期望 10)  " + ("OK" if phones == 10 else "**失败**"))
    out.append(f"    .board    {boards}  (期望 6: 菜单1 + 初始1 + 拖拽1 + 对准1 + 结算1 + 提示1)")
    out.append(f"    .car      {cars}")
    out.append(f"    .gate     {gates}")
    out.append(f"    .modal    {modals}  (期望 2)")
    out.append(f"    .capsule  {capsules}  (期望 10)  " + ("OK" if capsules == 10 else "**失败**"))

    # 4. 车辆的网格坐标合法性（--x/--y/--w/--h 必须 0<=x<=5, x+w<=6, y+h<=6）
    out.append("\n[4] 车辆网格坐标合法性（6x6 越界检查）")
    bad = []
    for m in re.finditer(r'class="(car|ghost)[^"]*"\s+style="([^"]*)"', html):
        kind, style = m.group(1), m.group(2)
        v = {}
        for k in ("x", "y", "w", "h"):
            mm = re.search(r"--%s:\s*([0-9.]+)" % k, style)
            v[k] = float(mm.group(1)) if mm else None
        if None in v.values():
            continue
        # 拖拽中的车允许小数偏移；只校验整数位的静态车
        if v["x"] % 1 or v["y"] % 1:
            continue
        x, y, w, h = int(v["x"]), int(v["y"]), int(v["w"]), int(v["h"])
        if x + w > 6 or y + h > 6 or x < 0 or y < 0:
            bad.append(f"{kind} x={x} y={y} w={w} h={h} → 越界")
    out.append(f"    越界车辆: {len(bad)}  " + ("OK" if not bad else "**失败**"))
    for b in bad[:20]:
        out.append("    " + b)

    # 5. 每块棋盘内车色唯一性
    out.append("\n[5] 同一棋盘内车色唯一性（避免玩家误以为同色车可互换）")
    for bi, blk in enumerate(re.findall(r'<div class="board[^"]*">(.*?)(?=<div class="gate|<div class="scrim)', html, re.S)):
        colors = re.findall(r"class=\"car[^\"]*?(c-[a-z])\"", blk)
        dup = [k for k, n in Counter(colors).items() if n > 1]
        status = "OK" if not dup else f"**重复 {dup}**"
        out.append(f"    棋盘#{bi + 1}: {len(colors)} 车, {len(set(colors))} 种色  {status}")

    text = "\n".join(out)
    with open(os.path.join(ROOT, "check.log"), "w", encoding="utf-8") as f:
        f.write(text)
    print(text)


if __name__ == "__main__":
    main()
