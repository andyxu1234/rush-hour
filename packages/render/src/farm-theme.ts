/**
 * 农场主题视觉常量 —— 游戏页专属（卡通 Q 版农场风）。
 *
 * 与 theme.ts 的分工：
 *   theme.ts 是**中性 UI 色板**，其余屏幕（主菜单 / 选关 / 设置 / 排行榜…）仍在用；
 *   本文件只服务游戏页的农场皮肤。分成两份是为了「改农场皮肤不会把设置页也染绿」。
 *
 * ⚠️ 全部为代码绘制（Canvas 矢量），不含任何位图：
 *   任意分辨率不失真、不占包体、不需要图集（docs/01 §7 的美术原则）。
 */

/** 农场色板。命名按"用途"而不是"颜色"，换肤时只改这里 */
export const FARM = {
  // —— 草地 ——
  grassLight: '#A9DE63',
  grassTop: '#8FCE4E',
  grassMid: '#77BC3C',
  grassBottom: '#5EA42F',
  grassPatch: '#84C746',
  grassDark: '#4C8C25',
  grassTuft: '#9CD65A',
  // —— 泥土小径 / 棋盘凹槽 ——
  soil: '#C69A63',
  soilDark: '#9C7243',
  soilDeep: '#7E5A33',
  // —— 木头 ——
  woodLight: '#F0C489',
  wood: '#D9A25C',
  woodMid: '#C58E49',
  woodDark: '#A5713A',
  woodEdge: '#6B451E',
  woodGrain: 'rgba(107,69,30,0.30)',
  woodNail: '#8B6534',
  // —— 石板 ——
  stone: '#F1EADA',
  stoneAlt: '#E8DFCB',
  stoneWarm: '#EDE2CB',
  stoneEdge: '#CDBFA2',
  stoneShadow: '#B5A688',
  crack: '#BBAC8D',
  // —— 装饰 ——
  daisy: '#FFFCF2',
  daisyCenter: '#F5C33F',
  leaf: '#4C8C25',
  exitGlow: '#8CF06E',
  arrow: '#43C455',
  arrowDark: '#2C9440',
  barnWall: '#E4675A',
  barnRoof: '#C24A3E',
  hay: '#F2CE72',
  hayDark: '#D8AE4A',
  hayBand: '#B08535',
  // —— 文字 ——
  ink: '#5A3617',
  inkSoft: '#7A5330',
  cream: '#FFF8EA',
  outline: '#452A0F',
  // —— 金币 / 功能色 ——
  coin: '#FFD64F',
  coinDark: '#DFA519',
  coinEdge: '#A97A11',
  panel: '#FFFDF6',
  overlay: 'rgba(24,38,14,0.52)',
  done: '#E23B2E',
} as const;

/**
 * 卡通粗体字。Canvas 只能用系统字体族，因此"胖胖字"靠
 * **大字号 + 800 字重 + 深色描边 + 奶白填充** 三件套堆出来（见 drawCartoonText）。
 */
export function cartoonFont(size: number, weight: '600' | '700' | '800' = '800'): string {
  const px = Math.max(8, Math.round(size));
  return `${weight} ${px}px "PingFang SC", "Microsoft YaHei", -apple-system, "Noto Sans SC", sans-serif`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 确定性伪随机 —— 同一 seed 永远返回同一个 [0,1)。
 *
 * 为什么不能用 Math.random()：草地上的草簇 / 石砖裂纹是每帧重绘的，
 * 用随机数会让整片草地逐帧抖动，看起来像在闪烁。
 * 这里用整数哈希，保证"每次画同一颗草都在同一位置"。
 */
export function noise01(seed: number): number {
  let h = (seed | 0) * 2654435761;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 2246822519) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 4294967296;
}
