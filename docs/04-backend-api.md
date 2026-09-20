# 04 · 后端契约、数据模型与合规

**核心原则：后端是"锦上添花"，不是必需依赖。** 66 关全部随包内置，断网、云开发欠费、后端宕机，玩家都必须能完整通关。

---

## 1. 统一 API 契约

所有后端实现（云开发 / FastAPI）必须实现以下契约。客户端只依赖接口，切换实现只改一个常量。

### 1.1 类型

```ts
export interface RemoteApi {
  login(): Promise<{ token: string; userId: string; isNew: boolean }>;

  /** 关卡包版本比对；返回 null 表示本地已是最新 */
  checkLevelPack(localVersion: number): Promise<{ version: number; url: string;
                                                  sha256: string } | null>;

  /** 提交一局成绩；服务端必须重放校验后才落库 */
  submitResult(req: SubmitResultReq): Promise<SubmitResultRes>;

  getProgress(): Promise<{ levels: Record<string, LevelProgress>; serverTime: number }>;
  putProgress(req: { levels: Record<string, LevelProgress> }): Promise<{ merged: Record<string, LevelProgress> }>;

  getLeaderboard(opt: { scope: 'global' | 'friends'; levelId?: string;
                        limit: number; cursor?: string }): Promise<LeaderboardRes>;

  getDailyChallenge(date: string): Promise<{ date: string; level: Level; parMoves: number }>;

  /** 上报"我看完激励视频了"；服务端校验广告回调后发放提示次数 */
  claimReward(req: { levelId: string; scene: 'hint' }): Promise<{ hintsRemaining: number }>;

  reportError(evt: { message: string; stack?: string; context?: Record<string, unknown> }): Promise<void>;
}
```

### 1.2 接口清单

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| POST | `/auth/login` | `{ code }` → token + userId | 否 |
| GET | `/levels/pack?version=N` | 版本比对，返回下载地址 | 否 |
| GET | `/levels/pack/file` | 关卡包文件（静态 CDN） | 否 |
| POST | `/game/submit` | 提交成绩（**含完整走子序列**） | 是 |
| GET | `/progress` | 拉取云端进度 | 是 |
| POST | `/progress` | 上传进度（返回合并结果） | 是 |
| GET | `/leaderboard` | 排行榜（分页游标） | 是 |
| GET | `/daily?date=YYYY-MM-DD` | 每日挑战题目 | 是 |
| POST | `/reward/claim` | 领取激励视频奖励 | 是 |
| POST | `/log/error` | 错误上报 | 否 |

### 1.3 提交成绩的请求/响应（防作弊核心）

```ts
interface SubmitResultReq {
  levelId: string;
  moves: Move[];          // [{ piece: 'a', dir: 'right', cells: 2 }, ...] 权威数据
  clientMoves: number;    // 客户端自算步数，仅用于一致性比对
  clientCells: number;
  durationMs: number;
  isDaily?: boolean;
  date?: string;
}

interface SubmitResultRes {
  accepted: boolean;
  rejectReason?: 'illegal_move' | 'not_solved' | 'steps_mismatch'
               | 'level_unknown' | 'rate_limited' | 'already_better';
  parMoves: number;       // 服务端权威 par
  stars: 0 | 1 | 2 | 3;   // 服务端判定
  bestMoves: number;
}
```

**服务端重放算法（必须与客户端同源的规则）：**

```
1. 查 levelId 对应的关卡定义（服务端持有关卡权威副本）
2. 校验关卡存在；校验 moves 长度 ≤ 上限（如 300），否则 rate_limited
3. state ← level 初始状态
4. for mv in moves:
     legal ← generateMoves(state)          // 与客户端同一套规则
     if 找不到 (piece, dir, 恰好 cells 格) 的合法移动: reject illegal_move
     state ← 应用该移动
5. if state 不是通关态: reject not_solved
6. serverMoves ← moves.length
   if serverMoves != clientMoves: reject steps_mismatch
7. stars ← 依据 level.parMoves 与 serverMoves 计算
8. 仅当 serverMoves < 该用户该关历史 bestMoves 时才更新 bestMoves（否则 already_better）
9. 落库 + 更新排行榜
```

> **为什么重放而不是查表**：关卡规则是确定的、状态空间不大（实测 10³–10⁵ 状态），重放一局的成本是毫秒级，而它能彻底杜绝"改包上报 1 步通关"。这是本游戏性价比最高的一道防线。

**风控附加规则**：
- 同一 userId 同一 levelId 每日提交上限 200 次。
- `durationMs < 500`（人类不可能这么快）→ 记入风控日志，成绩仍接受但不进排行榜。
- 排行榜只收录通过重放校验且 `durationMs ≥ 800` 的成绩。

---

## 2. 数据模型（方案 B · MySQL 8.0）

```sql
CREATE TABLE `user` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `openid`      VARCHAR(64)  NOT NULL COMMENT '微信 openid（唯一）',
  `unionid`     VARCHAR(64)  NULL,
  `nickname`    VARCHAR(64)  NULL,
  `avatar_url`  VARCHAR(512) NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_login`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `banned`      TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_openid` (`openid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `level` (
  `id`          VARCHAR(16)  NOT NULL COMMENT '如 c001',
  `pack`        VARCHAR(16)  NOT NULL,
  `name`        VARCHAR(64)  NOT NULL,
  `difficulty`  VARCHAR(16)  NOT NULL,
  `par_moves`   SMALLINT     NOT NULL COMMENT '求解器算出的最少滑动步数',
  `par_cells`   SMALLINT     NOT NULL,
  `pieces`      JSON         NOT NULL COMMENT '初始布局',
  `pack_version` INT         NOT NULL DEFAULT 1,
  `enabled`     TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '可下线问题关卡',
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pack_version` (`pack_version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `user_level` (
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `level_id`    VARCHAR(16)  NOT NULL,
  `stars`       TINYINT      NOT NULL DEFAULT 0,
  `best_moves`  SMALLINT     NOT NULL DEFAULT 32767,
  `best_cells`  SMALLINT     NOT NULL DEFAULT 32767,
  `cleared_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `level_id`),
  KEY `idx_level_moves` (`level_id`, `best_moves`) COMMENT '排行榜查询',
  CONSTRAINT `fk_ul_user` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `submit_log` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL,
  `level_id`    VARCHAR(16)  NOT NULL,
  `moves`       JSON         NOT NULL COMMENT '原始走子序列，用于申诉与风控',
  `moves_count` SMALLINT     NOT NULL,
  `duration_ms` INT          NOT NULL,
  `accepted`    TINYINT(1)   NOT NULL,
  `reject_reason` VARCHAR(32) NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_user_time` (`user_id`, `created_at`),
  KEY `idx_level` (`level_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `daily_challenge` (
  `date`        DATE         NOT NULL COMMENT '北京时间日期',
  `seed`        BIGINT       NOT NULL COMMENT '生成种子',
  `pieces`      JSON         NOT NULL,
  `par_moves`   SMALLINT     NOT NULL,
  PRIMARY KEY (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**索引说明**：排行榜查询是 `WHERE level_id = ? ORDER BY best_moves ASC LIMIT 50`，因此 `(level_id, best_moves)` 复合索引是必须的，不是可选项。

---

## 3. 登录时序

```
小程序端                       服务端
  │  wx.login() → code
  │──────────────────────────►  POST /auth/login { code }
  │                              ├─ code2session(appid, secret, code)
  │                              │    → { openid, session_key }
  │                              ├─ upsert user by openid
  │                              ├─ 签发 token（JWT，7 天，含 userId）
  │◄──────────────────────────  { token, userId, isNew }
  │  storage.set('token', token)
```

要点：
- `appid` / `secret` **只能存在服务端**（云函数环境变量），绝不可打包进客户端。
- token 过期后静默重登（重新 `wx.login`），不要弹窗打扰。
- 首版即使不接后端，也要把 `login()` 走通并把 token 存起来，避免 P5 大改。

---

## 4. 客户端与云端的进度合并规则

```ts
function mergeProgress(a: LevelProgress, b: LevelProgress): LevelProgress {
  return {
    stars: Math.max(a.stars, b.stars),
    bestMoves: Math.min(a.bestMoves, b.bestMoves),   // 步数越小越好
    bestCells: Math.min(a.bestCells, b.bestCells),
    clearedAt: Math.max(a.clearedAt, b.clearedAt),
  };
}
```

- **逐关合并**（不是整体覆盖），因此双设备进度不会互相抹掉。
- 客户端保留 `dirty` 标记：有未上传改动时，`putProgress` 携带本地更优值，服务端合并后回传，客户端以回传结果为准。
- 离线队列：提交失败写入本地队列，联网后按 `createdAt` 顺序补交，最多保留 100 条。

---

## 5. 广告接入

### 5.1 点位

| 场景 | 广告类型 | 频率 |
|---|---|---|
| 提示（免费 1 次用完后再要） | 激励视频 30s | 玩家主动触发 |
| 关卡结算后 | 插屏 | 每完成 3 关一次 |
| 每日挑战完成后 | 激励视频（可选，换"再来一次"） | 玩家主动触发 |

### 5.2 广告状态机（必须带兜底，禁止卡死）

复用成熟经验：**每个 phase 都要有超时与异常出口**。

```
idle ──trigger──► loading ──onLoad──► playing ──onClose──► rewarded ──► closed
   ▲                 │                    │                    │
   └─────────────────┴────────────────────┴────────────────────┘
              超时 8s / onError / 无可用广告 → closed(failed)
```

| 事件 | 处理 |
|---|---|
| `onLoad` 后 2s 未播放 | 视为失败，走失败出口 |
| 整体 35s 超时 | 强制关闭并走失败出口 |
| `onError`（无填充/网络） | 失败出口，**不扣玩家已有提示** |
| 播放中途退出 | 不发放奖励（`res.isEnded === false`） |
| 失败出口 | 提示"暂时没有广告，免费送你一次"（避免玩家挫败，成本可接受） |

### 5.3 合规红线

- ❌ **禁止**"分享给好友才能解锁下一关"——微信审核高频驳回项。
- ❌ 禁止在关卡进行中弹插屏广告。
- ❌ 禁止广告按钮伪装成游戏 UI（如把"提示"做成纯广告位）。
- ✅ 激励视频必须有明确的"看完得什么"预告。

---

## 6. 合规与资质清单

### 6.1 上线资质（个人主体 + 纯广告变现路径）

| 项 | 要求 | 获取周期 |
|---|---|---|
| 主体 | 个人可注册小游戏 | 即时 |
| 类目 | **游戏 → 休闲游戏**（必须选游戏类目，否则被判"非游戏"） | 即时 |
| 版号 | **无需**（不开通虚拟支付/内购即免版号） | — |
| 软著 / 电子版权认证 | 通常需要提交（电子版权认证比纸质软著快，约 3–5 工作日 vs 约 30 工作日） | 3–30 工作日 |
| 游戏自审自查报告 | 需提交 | 当天可写 |
| ICP 备案 | 若用自建后端域名：需要；若用云开发：不需要 | 1–3 周 |
| 隐私政策 | 游戏内必须有可访问入口 | 当天 |
| 适龄提示 | 必须展示 | 当天 |
| 流量主 | 上线后累计独立访客 UV ≥ 1000 才可开通 | 视导流 |

> 上述为个人主体 + IAA 路径的常规要求。**平台规则会变**，提审前务必以微信公众平台后台当时的实际要求为准（`06` 的发布 checklist 含此项复核）。
> 若未来要开内购：必须转为**企业主体** + 申请**版号** + ICP 证 + 文网文，周期以半年计——这也是首版坚持 IAA 的原因。

### 6.2 内容合规

- 无暴力/血腥/政治敏感元素（本游戏天然安全）。
- 无随机抽卡、无虚拟货币（避免概率公示与充值纠纷）。
- 不收集非必要的用户信息；不索取非必要权限。
- 排行榜仅展示昵称/头像，需玩家授权。

---

## 7. 埋点事件表（P4-10 固定，不得随意改名）

| 事件 | 参数 | 用途 |
|---|---|---|
| `app_launch` | `cold: boolean`, `net: boolean` | 冷启动耗时、离线率 |
| `level_start` | `levelId`, `par`, `isDaily`, `attemptN` | 关卡漏斗分母 |
| `level_win` | `levelId`, `moves`, `par`, `stars`, `durationMs`, `undos` | 难度校准主依据 |
| `level_quit` | `levelId`, `moves`, `durationMs` | 卡关定位 |
| `hint_used` | `levelId`, `source: 'free'|'ad'`, `moveIndex` | 提示价值评估 |
| `ad_show` / `ad_result` | `scene`, `result: 'ok'|'timeout'|'error'|'skipped'` | 广告收益与稳定性 |
| `share_click` | `levelId`, `channel` | 拉新效果 |
| `progress_sync` | `result: 'ok'|'fail'`, `pendingN` | 存档可靠性 |
| `submit_rejected` | `levelId`, `reason` | 风控命中与 bug 识别 |
| `error` | `message`, `stack`, `context` | 崩溃排查 |

**关卡漏斗分析口径**：`level_win / level_start` 按 `levelId` 分组，低于 40% 的关卡标记为"卡关"，进入 P7-8 的难度再校准。

---

## 8. 云开发 vs 自建 FastAPI 的落地差异

| 关注点 | 云开发 | FastAPI |
|---|---|---|
| 登录 | 云函数直接拿 `OPENID`（无需 code2session） | 自实现 code2session |
| 重放校验 | 云函数（Node.js，可复用前端 TS 编译产物） | Python 直接复用 `tools/rush_hour.py` |
| 数据库 | 云数据库（文档型，需建索引） | MySQL 8.0，见上文 DDL |
| 排行榜 | 云数据库聚合，或 `db.collection.orderBy` | SQL 直查，更灵活 |
| 定时任务 | 云函数定时触发器（生成每日挑战） | APScheduler（**注意时区必须显式设为北京时间 UTC+8**） |
| 关卡热更新 | 云存储 + CDN | 静态文件 + Nginx |

> **时区是已知踩坑点**：每日挑战按**北京时间**换题，服务端必须显式使用 UTC+8，不要依赖服务器本地时区。
