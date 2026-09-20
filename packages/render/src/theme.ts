/**
 * 视觉主题常量 —— 严格取自 docs/01-game-design.md §6.3 / §7。
 * 全部为代码绘制（Canvas 矢量），不含任何位图资源。
 */

export const COLORS = {
  bg: '#F4F6F8',
  boardBg: '#FFFFFF',
  gridLine: '#E9ECEF',
  cellBg: '#F8F9FA',
  redCar: '#E03131',
  redCarStroke: '#B02525',
  exit: '#12B886',
  text: '#212529',
  textDim: '#868E96',
  overlay: 'rgba(33,37,41,0.45)',
  panel: '#FFFFFF',
  panelStroke: '#DEE2E6',
  star: '#FCC419',
  starEmpty: '#CED4DA',
  primary: '#4C6EF5',
  primaryText: '#FFFFFF',
} as const;

/** 冷色组 / 暖色组。同一关内车辆颜色必须互不相同（见 pickColors） */
export const CAR_PALETTE = [
  '#4C6EF5',
  '#15AABF',
  '#7048E8',
  '#F59F00',
  '#F76707',
  '#37B24D',
  '#E8590C',
  '#0CA678',
  '#1098AD',
  '#AE3EC9',
  '#4263EB',
  '#D6336C',
] as const;

export type ColorInfo = { fill: string; stroke: string; light: string; dark: string };

/** 由十六进制色推导高光/阴影描边，避免手工维护三份色板 */
export function derive(fill: string): ColorInfo {
  const n = parseInt(fill.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (c: number, t: number, amt: number) => Math.round(c + (t - c) * amt);
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  const light = `#${toHex(mix(r, 255, 0.34))}${toHex(mix(g, 255, 0.34))}${toHex(mix(b, 255, 0.34))}`;
  const dark = `#${toHex(mix(r, 0, 0.28))}${toHex(mix(g, 0, 0.28))}${toHex(mix(b, 0, 0.28))}`;
  return { fill, stroke: dark, light, dark };
}

/** 设计分辨率（逻辑像素）。棋盘按此比例居中排版 */
export const DESIGN = { width: 375, height: 667 } as const;

export const METRICS = {
  /** 棋盘四周留白比例 */
  boardMargin: 0.05,
  /** 格子圆角 */
  cellRadius: 8,
  /** 车辆相对格子的内缩（px，逻辑像素） */
  carInset: 3,
  carRadius: 9,
  /** 拖拽吸附阈值（格） */
  snapThreshold: 0.5,
  /**
   * 轻点判定容差（逻辑像素）。
   *
   * ⚠️ 这个值必须是"手指级"的宽松度，不能沿用 0.5 格这种棋盘尺度。
   * 真机上一次点按天然会抖动 5~15px（触屏采样 + 手指微动）；
   * 早期误用 snapThreshold * 8 = 4px，导致绝大多数真实点按被判成"拖动"，
   * 于是 tap 从未派发 —— 表现为"结算弹窗按钮点不动"。已在 e2e 用带抖动的
   * 触摸手势守住该回归（e2e/touch.spec.ts）。
   */
  tapSlopPx: 18,
  /** 同一方向最长滑行时间（ms） */
  slideMsPerCell: 120,
  slideMsMax: 240,
  /** 非法回弹 */
  bounceMs: 160,
  /** 过关动画 */
  exitAnimMs: 400,
  flashMs: 120,
  /** 长按显示可动方向 */
  longPressMs: 800,
  /**
   * 新手引导遮罩不透明度。
   * 需要"看得见下面的棋盘"（玩家要看着车学操作），因此不能像弹窗遮罩那样到 0.45。
   */
  tutorialMaskAlpha: 0.62,
} as const;

export const FONTS = {
  hud: '600 16px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  hudLarge: '700 22px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  button: '600 17px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  small: '500 13px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  title: '700 20px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
} as const;
