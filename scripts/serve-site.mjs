/**
 * 落地页本地预览服务器。
 *
 * 为什么不用 `npx serve`：多一个临时依赖，且这里只需要"静态目录 + 正确 MIME"。
 * 用 node 内置 http 起一个约 40 行的静态服务器即可，零依赖、行为可预期。
 *
 * 用法：
 *   npm run site:assets && npm run build:h5 && npm run site:play && npm run site:serve
 * 然后访问 http://localhost:4180/
 */

import { createServer } from 'node:http';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const PORT = Number(process.env.PORT ?? 4180);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  // 归一化后强制留在 site/ 内，避免 ../ 穿越读任意文件
  let file = normalize(join(root, url));
  if (!file.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');

  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  res.end(readFileSync(file));
}).listen(PORT, () => {
  console.log(`[site] 落地页预览 → http://localhost:${PORT}/`);
});
