import { describe, expect, it } from 'vitest';
import {
  cellToPx,
  computeLayout,
  dialogButtons,
  dialogButtonsOnScreen,
  dialogGeometry,
  dialogScale,
  hitButton,
  hitRect,
  hudButtons,
  insideBoard,
  pauseGeometry,
  pxToCell,
  topBarGeometry,
} from '../src/layout';

/**
 * L4 自适应（docs/06 §L5）：375×667 / 414×896 / 768×1024
 * 三种目标机型下棋盘都必须居中、正方形、不裁切。
 */
const DEVICES = [
  { name: 'iPhone SE 375×667', w: 375, h: 667 },
  { name: 'iPhone XR 414×896', w: 414, h: 896 },
  { name: 'iPad 768×1024', w: 768, h: 1024 },
  { name: '窄屏 320×568', w: 320, h: 568 },
  { name: '宽屏 1440×900', w: 1440, h: 900 },
];

describe('棋盘排版自适应', () => {
  for (const d of DEVICES) {
    it(`${d.name}：正方形、居中、不裁切`, () => {
      const l = computeLayout(d.w, d.h);
      // 正方形格子 + 棋盘为 6 格
      expect(l.boardSize).toBe(l.cell * 6);
      expect(l.cell).toBeGreaterThan(0);

      // 水平居中（±1px 取整误差）
      const leftGap = l.boardX;
      const rightGap = l.width - (l.boardX + l.boardSize);
      expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1);

      // 完全落在视口内
      expect(l.boardX).toBeGreaterThanOrEqual(0);
      expect(l.boardX + l.boardSize).toBeLessThanOrEqual(l.width);
      expect(l.boardY).toBeGreaterThanOrEqual(0);
      expect(l.boardY + l.boardSize).toBeLessThanOrEqual(l.height);

      // 不压住 HUD
      expect(l.boardY).toBeGreaterThanOrEqual(l.hudHeight - 1);
    });
  }

  it('像素 ↔ 格子坐标互为逆运算', () => {
    const l = computeLayout(375, 667);
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 6; c++) {
        const { x, y } = cellToPx(l, r, c);
        const back = pxToCell(l, x + l.cell / 2, y + l.cell / 2);
        expect(Math.floor(back.r)).toBe(r);
        expect(Math.floor(back.c)).toBe(c);
      }
    }
  });

  it('insideBoard 边界判定正确', () => {
    const l = computeLayout(375, 667);
    expect(insideBoard(l, l.boardX, l.boardY)).toBe(true);
    expect(insideBoard(l, l.boardX + l.boardSize, l.boardY + l.boardSize)).toBe(true);
    expect(insideBoard(l, l.boardX - 1, l.boardY)).toBe(false);
    expect(insideBoard(l, l.boardX, l.boardY - 1)).toBe(false);
    expect(insideBoard(l, l.boardX + l.boardSize + 1, l.boardY)).toBe(false);
  });

  it('HUD 三个按钮落在棋盘宽度内且不重叠', () => {
    for (const d of DEVICES) {
      const l = computeLayout(d.w, d.h);
      const btns = hudButtons(l);
      expect(btns.map((b) => b.id)).toEqual(['undo', 'reset', 'hint']);
      for (const b of btns) {
        expect(b.x).toBeGreaterThanOrEqual(l.boardX - 1);
        expect(b.x + b.w).toBeLessThanOrEqual(l.boardX + l.boardSize + 1);
        expect(b.h).toBeGreaterThan(20);
      }
      // 相邻按钮不重叠
      expect(btns[0].x + btns[0].w).toBeLessThanOrEqual(btns[1].x);
      expect(btns[1].x + btns[1].w).toBeLessThanOrEqual(btns[2].x);
    }
  });

  it('弹窗按钮居中对称且可命中', () => {
    const l = computeLayout(375, 667);
    // P4 起结算弹窗为三按钮：重玩 / 分享 / 下一关（见 layout.ts dialogGeometry）
    const btns = dialogButtons(l);
    expect(btns.map((b) => b.id)).toEqual(['replay', 'share', 'next']);
    const [replay, share, next] = btns;
    const center = l.width / 2;
    // 三个按钮整体相对面板中心对称：首尾按钮到中心的距离应相等
    const leftEdge = replay.x;
    const rightEdge = next.x + next.w;
    expect(Math.abs(leftEdge - center - (center - rightEdge))).toBeLessThanOrEqual(2);
    // 中间按钮（分享）自身居中
    expect(Math.abs(share.x + share.w / 2 - center)).toBeLessThanOrEqual(2);
    // 依次不重叠
    expect(replay.x + replay.w).toBeLessThanOrEqual(share.x);
    expect(share.x + share.w).toBeLessThanOrEqual(next.x);
    // 三个按钮都能被正确命中
    for (const b of btns) {
      expect(hitButton(btns, b.x + b.w / 2, b.y + b.h / 2)?.id).toBe(b.id);
    }
    expect(hitButton(btns, 0, 0)).toBeNull();
  });

  it('弹窗按钮在入场缩放期间仍可被正确命中（回归：看得到却点不着）', () => {
    const l = computeLayout(375, 667);
    const s = dialogScale(0.5);
    expect(s).toBeLessThan(1);

    // 缩放到 0.5 进度时，屏幕矩形必须比绘制期矩形更靠近面板中心
    const geo = dialogGeometry(l);
    const onScreen = dialogButtonsOnScreen(l, 0.5);
    // 三按钮（重玩/分享/下一关）在缩放期也全部保留
    expect(onScreen).toHaveLength(geo.buttons.length);
    expect(onScreen.map((b) => b.id)).toEqual(geo.buttons.map((b) => b.id));

    for (const b of onScreen) {
      // 宽度按缩放因子收缩
      const drawW = geo.buttons.find((g) => g.id === b.id)!.w;
      expect(b.w).toBeCloseTo(drawW * s, 5);
      // 中心点围绕 (cx, cy) 缩放后仍落在自身矩形内 → 可被点击命中
      const cxB = (b.x + b.w + b.x) / 2;
      const cyB = b.y + b.h / 2;
      expect(hitButton(onScreen, cxB, cyB)?.id).toBe(b.id);
    }
  });

  it('弹窗按钮矩形始终完整落在视口内（多机型）', () => {
    for (const d of DEVICES) {
      const l = computeLayout(d.w, d.h);
      for (const progress of [0, 0.5, 1]) {
        for (const b of dialogButtonsOnScreen(l, progress)) {
          expect(b.x, `${d.name} ${b.id}@${progress}`).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w, `${d.name} ${b.id}@${progress}`).toBeLessThanOrEqual(l.width + 1);
          expect(b.y, `${d.name} ${b.id}@${progress}`).toBeGreaterThanOrEqual(0);
          expect(b.y + b.h, `${d.name} ${b.id}@${progress}`).toBeLessThanOrEqual(l.height + 1);
          expect(b.w).toBeGreaterThan(30);
          expect(b.h).toBeGreaterThan(20);
        }
      }
    }
  });

  it('顶部信息栏整体落在胶囊安全区之下，且不溢出视口', () => {
    for (const d of DEVICES) {
      const l = computeLayout(d.w, d.h);
      const g = topBarGeometry(l);
      const items = [
        ['pause', g.pause],
        ['sound', g.sound],
        ['level', g.levelPlate],
        ['moves', g.movesPlate],
        ['coin', g.coinPill],
      ] as const;

      for (const [name, r] of items) {
        // 微信右上角胶囊由 safeTop 高度兜住：任何自绘按钮都必须排到它下面
        expect(r.y, `${d.name} ${name} 侵入胶囊区`).toBeGreaterThanOrEqual(l.safeTop - 1);
        expect(r.h, `${d.name} ${name} 高度`).toBeGreaterThan(0);
        expect(r.x, `${d.name} ${name} 左越界`).toBeGreaterThanOrEqual(-1);
        expect(r.x + r.w, `${d.name} ${name} 右越界`).toBeLessThanOrEqual(l.width + 1);
        expect(r.y + r.h, `${d.name} ${name} 下越界`).toBeLessThanOrEqual(l.hudHeight + 1);
      }

      // 从左到右依次排列，互不重叠（暂停 → 音效 → 关卡牌 → 步数牌 → 金币）
      for (let i = 1; i < items.length; i++) {
        expect(
          items[i - 1][1].x + items[i - 1][1].w,
          `${d.name} ${items[i - 1][0]} 与 ${items[i][0]} 重叠`,
        ).toBeLessThanOrEqual(items[i][1].x + 1);
      }
    }
  });

  it('顶部功能按钮足够大（>=30px，触屏最小可点区域）', () => {
    for (const d of DEVICES) {
      const l = computeLayout(d.w, d.h);
      const g = topBarGeometry(l);
      expect(g.pause.w, d.name).toBeGreaterThanOrEqual(30);
      expect(g.sound.w, d.name).toBeGreaterThanOrEqual(30);
      expect(g.pause.h, d.name).toBeGreaterThanOrEqual(30);
    }
  });

  it('暂停面板：按钮在面板内、互不重叠、可命中', () => {
    for (const d of DEVICES) {
      const l = computeLayout(d.w, d.h);
      const g = pauseGeometry(l);
      expect(g.buttons.map((b) => b.id)).toEqual(['resume', 'restart', 'quit']);
      const panelTop = g.cy - g.panelH / 2;
      const panelLeft = g.cx - g.panelW / 2;
      for (let i = 0; i < g.buttons.length; i++) {
        const b = g.buttons[i];
        expect(b.x, `${d.name} ${b.id}`).toBeGreaterThanOrEqual(panelLeft - 1);
        expect(b.x + b.w, `${d.name} ${b.id}`).toBeLessThanOrEqual(panelLeft + g.panelW + 1);
        expect(b.y, `${d.name} ${b.id}`).toBeGreaterThanOrEqual(panelTop - 1);
        expect(b.y + b.h, `${d.name} ${b.id}`).toBeLessThanOrEqual(panelTop + g.panelH + 1);
        expect(b.h, `${d.name} ${b.id} 高度`).toBeGreaterThanOrEqual(34);
        // 绘制与命中共用同一份矩形 → 中心点必须能命中自己
        expect(hitRect(g.buttons, b.x + b.w / 2, b.y + b.h / 2)?.id).toBe(b.id);
        if (i > 0) {
          expect(g.buttons[i - 1].y + g.buttons[i - 1].h).toBeLessThanOrEqual(b.y + 1);
        }
      }
      // 整块面板不溢出视口
      expect(panelLeft).toBeGreaterThanOrEqual(0);
      expect(panelTop).toBeGreaterThanOrEqual(0);
      expect(panelLeft + g.panelW).toBeLessThanOrEqual(l.width + 1);
      expect(panelTop + g.panelH).toBeLessThanOrEqual(l.height + 1);
    }
  });

  it('弹窗面板与按钮不重叠（按钮位于面板内部下半区）', () => {
    const l = computeLayout(375, 667);
    const geo = dialogGeometry(l);
    const panelTop = geo.cy - geo.panelH / 2;
    const panelBottom = geo.cy + geo.panelH / 2;
    for (const b of geo.buttons) {
      expect(b.y).toBeGreaterThanOrEqual(panelTop);
      expect(b.y + b.h).toBeLessThanOrEqual(panelBottom);
    }
  });
});
