"""CSS 语法快检：花括号/括号平衡 + 内联自定义属性是否都有定义。"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, "design", "ui-mockup.html")

with open(P, encoding="utf-8") as f:
    html = f.read()

out = []
css = re.search(r"<style>(.*?)</style>", html, re.S).group(1)
out.append(f"CSS 长度 {len(css)} 字符")
out.append(f"花括号: {{={css.count('{')}  }}={css.count('}')}  " +
           ("OK" if css.count("{") == css.count("}") else "**不平衡**"))
out.append(f"圆括号: (={css.count('(')}  )={css.count(')')}  " +
           ("OK" if css.count("(") == css.count(")") else "**不平衡**"))

# 内联样式里用到的自定义属性
inline = re.findall(r'style="([^"]*)"', html)
used = set()
for s in inline:
    used |= set(re.findall(r"var\((--[a-z0-9-]+)\)", s))
    used |= {m for m in re.findall(r"(--[a-z0-9-]+)\s*:", s)}

defined_root = set(re.findall(r"(--[a-z0-9-]+)\s*:", css))
defined_inline = set()
for s in inline:
    defined_inline |= set(re.findall(r"(--[a-z0-9-]+)\s*:", s))

missing = sorted(x for x in used
                 if x not in defined_root and x not in defined_inline)
out.append(f"\n内联样式引用的自定义属性 {len(used)} 个")
out.append(f"未定义: {len(missing)}  " + ("OK" if not missing else "**失败**"))
for m in missing:
    out.append("    " + m)

# keyframes / animation 名称配对
kf = set(re.findall(r"@keyframes\s+([A-Za-z0-9_-]+)", css))
anims = set()
for m in re.findall(r"animation:\s*([A-Za-z0-9_-]+)", css):
    anims.add(m)
out.append(f"\n@keyframes 定义 {sorted(kf)}")
bad_anim = sorted(a for a in anims if a not in kf)
out.append(f"引用了未定义的 animation: {bad_anim if bad_anim else '无'}  " +
           ("OK" if not bad_anim else "**失败**"))

text = "\n".join(out)
with open(os.path.join(ROOT, "csscheck.log"), "w", encoding="utf-8") as f:
    f.write(text)
print(text)
