/**
 * 车辆美术资源映射 —— 把「一辆车」解析成一张已加载的贴图。
 *
 * 设计原则（与 docs/01 §7 的"美术优先代码绘制"并不矛盾，而是一次受控的升级）：
 *   1. 贴图是**可选增强**：任何一张图缺失/加载失败，drawCar 都回落为原来的
 *      矢量绘制。因此素材永远不可能让游戏跑不起来，e2e 也不依赖素材存在。
 *   2. 映射只看「方向 + 长度 + 序号」，不看具体关卡。7 种贴图正好覆盖
 *      6×6 棋盘上所有可能出现的车型（见 pieces 规格：H/V × len 1/2/3）。
 *   3. 同型多车时按序号错开取图，避免一辆长车上出现两张相同的脸。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx / new Image。
 *    图片一律通过 Platform.image.load() 拿到 ImageLike 后由宿主注入。
 */

import type { ImageLike } from '@rush-hour/platform';
import type { Piece } from '@rush-hour/core';

/** 贴图资源名（不含扩展名）。与 scripts/build-car-assets.mjs 的 out 字段一一对应 */
export type CarSpriteName =
  | 'h-red-rooster'
  | 'h-yellow-sheep'
  | 'h-blue-tractor'
  | 'h-pink-pig'
  | 'h-lavender-cat'
  | 'h-purple-bus'
  | 'v-blue-tractor'
  | 'v-pink-pig'
  | 'v-lavender-cat'
  | 'v-purple-bus';

/**
 * 素材相对路径。
 *
 * ⚠️ 用 `assets/cars/...` 这种**无前导 ./ 的相对路径**：
 *   - H5 侧由构建工具 (Vite / esbuild) 按 base 解析；
 *   - 小游戏侧按包内根目录解析。
 *   写成绝对路径 `/assets/...` 在小游戏里会直接找不到文件。
 */
export function spritePath(name: CarSpriteName): string {
  return `assets/cars/${name}.png`;
}

/** 全部需要预加载的贴图（顺序无关，仅用于批量加载） */
export const ALL_CAR_SPRITES: readonly CarSpriteName[] = [
  'h-red-rooster',
  'h-yellow-sheep',
  'h-blue-tractor',
  'h-pink-pig',
  'h-lavender-cat',
  'h-purple-bus',
  'v-blue-tractor',
  'v-pink-pig',
  'v-lavender-cat',
  'v-purple-bus',
];

/**
 * 横向车的贴图候选表。
 *
 * 红车（id === 'R'）必须永远用红色公鸡车 —— 它是全游戏唯一的视觉锚点，
 * 玩家靠它定位目标（docs/01 §7「唯一高亮物是红车」）。因此红车不走轮换。
 */
const H_SPRITES: readonly CarSpriteName[] = [
  'h-yellow-sheep',
  'h-blue-tractor',
  'h-pink-pig',
  'h-lavender-cat',
];

/** 纵向车候选表（正面视角） */
const V_SPRITES: readonly CarSpriteName[] = [
  'v-blue-tractor',
  'v-pink-pig',
  'v-lavender-cat',
];

/** 3 格的横车固定用巴士（横置 3 格只有巴士一张合身素材） */
const H3_SPRITE: CarSpriteName = 'h-purple-bus';
/** 3 格的纵车用旋转 90° 的同一辆巴士（长车的正确形象是长条，不是拉长的车头） */
const V3_SPRITE: CarSpriteName = 'v-purple-bus';

/**
 * 给定车辆 + 它在关卡里的序号，选出贴图名。
 *
 * 车型 → 素材的对应关系（6×6 棋盘上只会出现这 5 种形态）：
 *   H×2 横向双格车 → 侧视轿车（红车固定用红色公鸡车）
 *   H×3 横向三格车 → 侧视巴士
 *   V×2 纵向双格车 → 正面视角轿车/拖拉机
 *   V×3 纵向三格车 → **旋转 90° 的巴士**（长车应当呈现为长条形象）
 *
 * ⚠️ 纵向 3 格不能复用正面视角的轿车素材：
 *   车头正视图只在"1 宽 × 2 高"时成立，硬拉到 3 格高会得到一辆
 *   被纵向扯变形的车。因此纵向长车用旋转后的巴士。
 *
 * @param piece 车辆规格（只看 id / dir / len）
 * @param index 该车在 pieces 数组里的下标（用于同型错开）
 * @returns 贴图名
 */
export function spriteForPiece(piece: Piece, index: number): CarSpriteName | null {
  // 红车永远用红色公鸡车 —— 它是全游戏唯一视觉锚点，玩家靠它定位目标
  if (piece.id === 'R') return 'h-red-rooster';

  if (piece.dir === 'H') {
    // 横向 3 格：巴士（唯一的横向长车素材）
    if (piece.len === 3) return H3_SPRITE;
    // 按 index 错开，保证相邻同型车不至于完全撞脸
    return H_SPRITES[index % H_SPRITES.length];
  }

  // 纵向 3 格：旋转后的巴士（长车形象，见 V3_SPRITE 注释）
  if (piece.len === 3) return V3_SPRITE;

  // 纵向 2 格：正面视角轿车/拖拉机。
  // len=1 的车按定义就是横向，不可能出现在这一支。
  return V_SPRITES[index % V_SPRITES.length];
}

/** 已加载贴图表：资源名 → 位图。缺失的 key 表示加载失败/未加载 */
export type CarSpriteMap = ReadonlyMap<CarSpriteName, ImageLike>;

/**
 * 批量加载车辆贴图。
 *
 * 任一图失败都不抛错，只是不出现在结果表里 —— 渲染时会逐张回落矢量绘制，
 * 因此"素材缺失"表现为"某几辆车是色块"，而不是整局崩掉。
 */
export async function loadCarSprites(
  load: (src: string) => Promise<ImageLike | null>,
): Promise<CarSpriteMap> {
  const entries = await Promise.all(
    ALL_CAR_SPRITES.map(async (name) => {
      const img = await load(spritePath(name));
      return [name, img] as const;
    }),
  );
  const map = new Map<CarSpriteName, ImageLike>();
  for (const [name, img] of entries) {
    // complete=false 的图交给 drawImage 会画出空白，直接当加载失败处理
    if (img && img.complete && img.width > 0 && img.height > 0) map.set(name, img);
  }
  return map;
}
