/**
 * 释放指定端口上的监听进程（默认 4173，即 Playwright 的 preview 端口）。
 *
 * 为什么需要它：本地反复跑 e2e 时，上一次的 `vite preview` 常残留下来占着端口，
 * 于是本次测试要么连到**旧产物**，要么因为服务起不来而整批失败
 * （表现为大量用例在几百毫秒内集体报错，极易被误判成代码回归）。
 *
 * 用法：node scripts/free-port.mjs [port]
 * 实现：用 netstat 找出 LISTENING 的 PID，仅结束那个 PID —— 绝不按进程名杀，
 *       否则会连带杀掉正在运行本脚本的 node 进程。
 */
import { execSync } from 'node:child_process';

const port = Number(process.argv[2] ?? 4173);

function listeningPids(p) {
  let out = '';
  try {
    out = execSync(`netstat -ano -p TCP`, { encoding: 'utf8' });
  } catch {
    return [];
  }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    // 形如：  TCP    127.0.0.1:4173    0.0.0.0:0    LISTENING    12345
    const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/);
    if (m && Number(m[1]) === p) pids.add(Number(m[2]));
  }
  return [...pids];
}

const pids = listeningPids(port);
if (pids.length === 0) {
  console.log(`[free-port] ${port} 未被占用`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    console.log(`[free-port] 已结束占用 ${port} 的进程 PID=${pid}`);
  } catch (e) {
    console.log(`[free-port] 结束 PID=${pid} 失败：${e.message}`);
  }
}
