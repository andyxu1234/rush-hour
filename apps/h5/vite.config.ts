import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const CAR_ASSETS_DIR = fileURLToPath(new URL('../../packages/render/assets', import.meta.url));

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** 构建期把关卡包内联进产物：data/levels.json 进包，levels.verify.json 绝不进包 */
const LEVELS = readFileSync(r('../../data/levels.json'), 'utf8');

export default defineConfig({
  root: r('.'),
  base: './',
  define: {
    __LEVELS__: LEVELS,
  },
  resolve: {
    alias: {
      // 直接用源码（monorepo 内部包不预编译，保证 HMR 与断点可用）
      '@rush-hour/core': r('../../packages/core/src/index.ts'),
      '@rush-hour/render': r('../../packages/render/src/index.ts'),
      '@rush-hour/platform': r('../../packages/platform/src/index.ts'),
      '@rush-hour/app-bootstrap': r('../../packages/app-bootstrap/src/index.ts'),
    },
  },
  /**
   * 车辆贴图是运行期按 URL 加载的（不走 import），因此 Vite 不会自动收集它们，
   * 必须显式把 packages/render/assets 映射到 /assets 下。
   * dev 与 preview 都要挂：否则 dev 能显示车、构建产物打开却全是色块。
   */
  publicDir: CAR_ASSETS_DIR,
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2019',
    outDir: r('./dist'),
    emptyOutDir: true,
    // 小游戏环境禁用动态 import；H5 侧同样保持单文件，便于 Playwright 断言首屏
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'game.js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
