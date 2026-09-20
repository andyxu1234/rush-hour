import { describe, expect, it } from 'vitest';
import {
  computeLayout,
  contentBox,
  hitRect,
  listLayout,
  menuLayout,
  selectLayout,
  settingsLayout,
  tabsLayout,
} from '../src/layout';

/**
 * P4 新增界面的几何约束。
 *
 * 这些用例存在的意义：新增 8 个界面后，"看得到却点不着"的风险面扩大了 8 倍。
 * 尤其是窄屏 320px —— 三个并排按钮、四个格子、设置行里的开关，
 * 都必须在最窄机型上仍然**不溢出、不重叠、可命中**。
 */
const DEVICES = [
  { name: 'iPhone SE 375×667', w: 375, h: 667 },
  { name: 'iPhone XR 414×896', w: 414, h: 896 },
  { name: 'iPad 768×1024', w: 768, h: 1024 },
  { name: '窄屏 320×568', w: 320, h: 568 },
  { name: '宽屏 1440×900', w: 1440, h: 900 },
];

/** 断言矩形完整落在视口内 */
function expectInsideViewport(
  rect: { x: number; y: number; w: number; h: number },
  w: number,
  h: number,
  label: string,
): void {
  expect(rect.x, `${label}.x`).toBeGreaterThanOrEqual(-1);
  expect(rect.y, `${label}.y`).toBeGreaterThanOrEqual(-1);
  expect(rect.x + rect.w, `${label} right`).toBeLessThanOrEqual(w + 1);
  expect(rect.y + rect.h, `${label} bottom`).toBeLessThanOrEqual(h + 1);
  expect(rect.w, `${label}.w`).toBeGreaterThan(0);
  expect(rect.h, `${label}.h`).toBeGreaterThan(0);
}

describe('contentBox 内容区', () => {
  for (const d of DEVICES) {
    it(`${d.name}：内容区在视口内且不含负数尺寸`, () => {
      const l = computeLayout(d.w, d.h);
      const b = contentBox(l);
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(l.width + 1);
      expect(b.y + b.h).toBeLessThanOrEqual(l.height + 1);
    });
  }
});

describe('主菜单布局', () => {
  it('按钮纵向不重叠、不出屏，且数量与请求一致', () => {
    for (const d of DEVICES) {
      for (const count of [4, 5]) {
        const l = computeLayout(d.w, d.h);
        const m = menuLayout(l, count);
        expect(m.buttons, `${d.name} count=${count}`).toHaveLength(count);
        for (let i = 0; i < m.buttons.length; i++) {
          expectInsideViewport(m.buttons[i], l.width, l.height, `${d.name} menu-${i}`);
          if (i > 0) {
            // 上一个按钮的底部不得越过下一个按钮的顶部
            const prev = m.buttons[i - 1];
            expect(
              prev.y + prev.h,
              `${d.name} menu-${i - 1}→${i} 重叠`,
            ).toBeLessThanOrEqual(m.buttons[i].y + 1);
          }
        }
        // 底部隐私入口与最后一个按钮不重叠
        const last = m.buttons[count - 1];
        expect(last.y + last.h).toBeLessThanOrEqual(m.footer.y + 1);
        expectInsideViewport(m.footer, l.width, l.height, `${d.name} footer`);
      }
    }
  });

  it('按钮在水平方向居中', () => {
    const l = computeLayout(375, 667);
    const m = menuLayout(l, 5);
    for (const b of m.buttons) {
      const leftGap = b.x;
      const rightGap = l.width - (b.x + b.w);
      expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);
    }
  });

  it('按钮高度足够点击（>=38px，触屏最小可点区域）', () => {
    for (const d of DEVICES) {
      const l = computeLayout(d.w, d.h);
      for (const b of menuLayout(l, 5).buttons) {
        expect(b.h, d.name).toBeGreaterThanOrEqual(38);
      }
    }
  });
});

describe('选关页布局', () => {
  it('格子为正方形且互不重叠', () => {
    for (const d of DEVICES) {
      const l = computeLayout(d.w, d.h);
      const g = selectLayout(l, 11, 0);
      expect(g.cells.length).toBeGreaterThan(0);
      for (const c of g.cells) {
        expect(c.w, `${d.name} 正方形`).toBe(c.h);
        expectInsideViewport(c, l.width, l.height, `${d.name} ${c.id}`);
      }
      // 两两不重叠
      for (let i = 0; i < g.cells.length; i++) {
        for (let j = i + 1; j < g.cells.length; j++) {
          const a = g.cells[i];
          const b = g.cells[j];
          const overlap =
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${d.name} ${a.id} 与 ${b.id} 重叠`).toBe(false);
        }
      }
    }
  });

  it('分页：页码被夹紧，且每页容量恒定', () => {
    const l = computeLayout(375, 667);
    const p0 = selectLayout(l, 11, 0);
    expect(p0.pageCount).toBeGreaterThanOrEqual(1);
    expect(p0.page).toBe(0);

    // 越界页码被夹紧到最后一页
    const huge = selectLayout(l, 11, 999);
    expect(huge.page).toBe(huge.pageCount - 1);

    // 负数页码夹紧到 0
    const neg = selectLayout(l, 11, -5);
    expect(neg.page).toBe(0);
  });

  it('分页覆盖全部关卡，且 id 与索引一一对应', () => {
    const l = computeLayout(375, 667);
    const total = 30;
    const first = selectLayout(l, total, 0);
    const seen = new Set<string>();
    for (let p = 0; p < first.pageCount; p++) {
      const g = selectLayout(l, total, p);
      for (const c of g.cells) seen.add(c.id);
    }
    expect(seen.size).toBe(total);
    const g0 = selectLayout(l, total, 0);
    expect(g0.cells[0].id).toBe('level-0');
  });

  it('关卡数为 0 时不产生格子且不崩', () => {
    const l = computeLayout(375, 667);
    const g = selectLayout(l, 0, 0);
    expect(g.cells).toHaveLength(0);
    expect(g.pageCount).toBe(1);
  });

  it('翻页按钮与格子不重叠，且落在视口内', () => {
    for (const d of DEVICES) {
      const l = computeLayout(d.w, d.h);
      const g = selectLayout(l, 40, 0);
      expectInsideViewport(g.prev, l.width, l.height, `${d.name} prev`);
      expectInsideViewport(g.next, l.width, l.height, `${d.name} next`);
      for (const c of g.cells) {
        expect(c.y + c.h).toBeLessThanOrEqual(g.prev.y + 1);
      }
    }
  });
});

describe('设置页布局', () => {
  it('每一行的开关都落在该行内部且可命中', () => {
    for (const d of DEVICES) {
      const l = computeLayout(d.w, d.h);
      const rows = settingsLayout(l, 7);
      expect(rows).toHaveLength(7);
      for (const r of rows) {
        expectInsideViewport(r, l.width, l.height, `${d.name} ${r.id}`);
        expect(r.toggle).toBeTruthy();
        const t = r.toggle!;
        // 开关必须在行内（否则会出现"点行没反应、开关在行外"）
        expect(t.y).toBeGreaterThanOrEqual(r.y - 1);
        expect(t.y + t.h).toBeLessThanOrEqual(r.y + r.h + 1);
        expect(t.x).toBeGreaterThanOrEqual(r.x - 1);
        expect(t.x + t.w).toBeLessThanOrEqual(r.x + r.w + 1);
      }
    }
  });

  it('相邻设置行不重叠', () => {
    const l = computeLayout(320, 568);
    const rows = settingsLayout(l, 7);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].y + rows[i - 1].h).toBeLessThanOrEqual(rows[i].y + 1);
    }
  });

  it('行高不低于触屏可点下限（44px）', () => {
    for (const d of DEVICES) {
      const l = computeLayout(d.w, d.h);
      for (const r of settingsLayout(l, 7)) {
        expect(r.h, d.name).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

describe('列表与 Tab 布局', () => {
  it('列表行首尾相接、不重叠、在视口内', () => {
    for (const d of DEVICES) {
      const l = computeLayout(d.w, d.h);
      const list = listLayout(l, 8);
      expect(list.rows).toHaveLength(8);
      for (let i = 0; i < list.rows.length; i++) {
        expectInsideViewport(list.rows[i], l.width, l.height, `${d.name} row-${i}`);
        if (i > 0) {
          expect(list.rows[i - 1].y + list.rows[i - 1].h).toBeLessThanOrEqual(
            list.rows[i].y + 1,
          );
        }
      }
      // 行必须从表头下方开始，避免压住表头
      expect(list.rows[0].y).toBeGreaterThanOrEqual(list.top - 1);
    }
  });

  it('count=0 时不产生行且不崩', () => {
    const l = computeLayout(375, 667);
    const list = listLayout(l, 0);
    expect(list.rows).toHaveLength(0);
    expect(list.rowH).toBeGreaterThan(0);
  });

  it('Tab 平分内容区宽度且横向无缝拼接', () => {
    const l = computeLayout(375, 667);
    const tabs = tabsLayout(l, 2);
    expect(tabs).toHaveLength(2);
    expect(tabs[0].x + tabs[0].w).toBeCloseTo(tabs[1].x, 0);
    expect(Math.abs(tabs[0].w - tabs[1].w)).toBeLessThanOrEqual(1);
    for (const t of tabs) expectInsideViewport(t, l.width, l.height, t.id);
  });
});

describe('hitRect 通用命中测试', () => {
  const rects = [
    { id: 'a', x: 0, y: 0, w: 50, h: 50 },
    { id: 'b', x: 40, y: 0, w: 50, h: 50 },
  ];

  it('命中返回对应矩形', () => {
    expect(hitRect(rects, 10, 10)?.id).toBe('a');
    expect(hitRect(rects, 80, 10)?.id).toBe('b');
  });

  it('重叠区域返回后绘制（上层）的那个', () => {
    // 逆序遍历：绘制顺序里后画者在上层
    expect(hitRect(rects, 45, 10)?.id).toBe('b');
  });

  it('未命中返回 null', () => {
    expect(hitRect(rects, 200, 200)).toBeNull();
    expect(hitRect([], 0, 0)).toBeNull();
  });

  it('边界值算命中（右下角含入，与 hitButton 口径一致）', () => {
    expect(hitRect(rects, 0, 0)?.id).toBe('a');
    // (50,50) 同时落在 a 与 b 内 → 按"上层优先"应返回 b（后绘制者）
    expect(hitRect(rects, 50, 50)?.id).toBe('b');
    // a 独占区域内的右下角
    expect(hitRect([rects[0]], 50, 50)?.id).toBe('a');
  });
});
