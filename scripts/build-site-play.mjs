/**
 * 把 H5 构建产物拷进 site/play/，让落地页的「在线试玩」按钮真的能玩。
 *
 * 为什么拷而不是软链：GitHub Pages 上传的是静态产物快照，软链不会被展开。
 *
 * 用法（本地预览）：
 *   npm run build:h5 && npm run site:play && npm run site:serve
 */

import { cpSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'apps', 'h5', 'dist');
const OUT = join(root, 'site', 'play');

if (!existsSync(DIST)) {
  console.error('[site:play] 未找到 apps/h5/dist，请先执行 npm run build:h5');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(DIST, OUT, { recursive: true });

console.log(`[site:play] 已拷入 site/play/（来自 apps/h5/dist）`);
