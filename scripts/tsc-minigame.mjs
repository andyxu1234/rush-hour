/** 对小游戏入口做类型检查（复用 apps/minigame/tsconfig.json 的 paths 配置） */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync('node', ['node_modules/typescript/bin/tsc', '-p', 'apps/minigame/tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});
