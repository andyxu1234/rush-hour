/**
 * 平台抽象层 —— 冻结接口（docs/02-architecture.md §4）
 *
 * 这是全项目唯一的"宿主环境"边界。core / render 只允许依赖本文件的类型，
 * 绝不出现 window / document / wx。H5 与微信小游戏各提供一份实现。
 *
 * ⚠️ 接口一旦冻结，业务代码只依赖它；新增字段属破坏性变更，需同步三端。
 */

// ---------------------------------------------------------------- 基础数值

export interface Vec2 {
  x: number;
  y: number;
}

export interface Size {
  /** 逻辑像素宽 */
  width: number;
  /** 逻辑像素高 */
  height: number;
}

/** 画布的最小可用面（避免把整个 canvas 类型泄漏给 render 层） */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(type: '2d'): CanvasRenderingContext2DLike;
}

/**
 * 2D 上下文的最小接口。小游戏与浏览器实现同构，只声明我们用到的成员。
 * 不索引签名的意义：逼迫 render 层只使用跨端都存在的 API。
 */
export interface CanvasRenderingContext2DLike {
  canvas: CanvasLike;
  fillStyle: string | CanvasGradientLike | CanvasPatternLike;
  strokeStyle: string | CanvasGradientLike | CanvasPatternLike;
  lineWidth: number;
  lineCap: CanvasLineCapLike;
  lineJoin: CanvasLineJoinLike;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  font: string;
  textAlign: CanvasTextAlignLike;
  textBaseline: CanvasTextBaselineLike;
  save(): void;
  restore(): void;
  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  rotate(rad: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  resetTransform?(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number, ccw?: boolean): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
  /** 圆角矩形并非全端原生支持，故为可选；render 层需自带降级路径 */
  roundRect?(x: number, y: number, w: number, h: number, radii: number | number[]): void;
}

export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface CanvasPatternLike {
  // 结构占位，本轮不使用位图纹理
  readonly __pattern?: never;
}

export type CanvasLineCapLike = 'butt' | 'round' | 'square';
export type CanvasLineJoinLike = 'bevel' | 'round' | 'miter';
export type CanvasTextAlignLike = 'start' | 'end' | 'left' | 'right' | 'center';
export type CanvasTextBaselineLike =
  | 'top'
  | 'hanging'
  | 'middle'
  | 'alphabetic'
  | 'ideographic'
  | 'bottom';

// ---------------------------------------------------------------- 输入

export type PointerPhase = 'start' | 'move' | 'end' | 'cancel';

export interface PointerEventLike {
  /** 逻辑像素坐标（实现方负责除以 dpr） */
  x: number;
  y: number;
  phase: PointerPhase;
  /** 多指时用于追踪同一次拖拽 */
  pointerId: number;
  /** 毫秒时间戳 */
  time: number;
}

export type Unsubscribe = () => void;

// ---------------------------------------------------------------- 存储

export interface StorageApi {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

// ---------------------------------------------------------------- 音频

export type SfxName =
  | 'snap'
  | 'blocked'
  | 'undo'
  | 'win'
  | 'click'
  | 'star'
  | 'music';

export interface AudioApi {
  /** 预热：把素材解码进内存，避免首次播放卡顿 */
  load(name: SfxName): Promise<void>;
  play(name: SfxName, opts?: { loop?: boolean }): void;
  stop(name: SfxName): void;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}

// ---------------------------------------------------------------- HTTP / 登录

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  data: T;
}

export interface HttpApi {
  request<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
}

export interface LoginResult {
  code: string;
}

export interface ShareOptions {
  title: string;
  imageUrl?: string;
  query?: string;
}

/** 广告能力。H5 / 未开通时一律返回不可用，调用方须走降级路径 */
export interface AdsApi {
  isRewardedAvailable(): boolean;
  showRewarded(): Promise<{ completed: boolean }>;
  showInterstitial(): Promise<void>;
}

// ---------------------------------------------------------------- Platform

export interface Platform {
  readonly name: 'h5' | 'wx';

  /** 创建主画布；小游戏端调用 wx.createCanvas()，H5 端创建/复用 DOM canvas */
  createCanvas(width: number, height: number): CanvasLike;

  /** 当前可用逻辑尺寸（设计分辨率 375×667，实际按屏幕等比换算） */
  screen(): Size;

  /** 尺寸变化（横竖屏/窗口缩放），返回取消订阅函数 */
  onResize(cb: (size: Size) => void): Unsubscribe;

  /** 设备像素比，用于 canvas 高清适配（上限 3x 由调用方裁剪） */
  devicePixelRatio(): number;

  storage: StorageApi;
  audio: AudioApi;
  http: HttpApi;
  ads: AdsApi;

  /** 指针事件（鼠标 / 触控统一为 pointer 语义） */
  onPointer(cb: (e: PointerEventLike) => void): Unsubscribe;

  /** 生命周期 */
  onShow(cb: () => void): Unsubscribe;
  onHide(cb: () => void): Unsubscribe;

  /** 登录，返回一次性 code 交由后端换取 session */
  login(): Promise<LoginResult>;

  /** 分享（主动分享到会话） */
  share(opts: ShareOptions): void;

  /** 震动反馈（毫秒）。不支持时静默忽略 */
  vibrate(ms: number): void;

  /** 帧循环：由平台驱动，回调参数为时间戳(ms) */
  requestAnimationFrame(cb: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
}

// ---------------------------------------------------------------- 远端 API 契约

export interface SavePayloadV1 {
  v: 1;
  levels: Record<
    string,
    { stars: number; bestMoves: number; bestCells: number; clearedAt: number }
  >;
  tutorialDone: boolean;
  settings: { sfx: boolean; music: boolean; vibrate: boolean; moveMetric: 'moves' | 'cells' };
  dirty: boolean;
}

export interface SubmitScoreRequest {
  levelId: string;
  /** 只提交走子序列，服务端自己重放校验 —— 防作弊（见 docs/02 §4） */
  moves: Array<{ piece: string; dir: 'up' | 'down' | 'left' | 'right'; cells: number }>;
  clientVersion: string;
}

export interface SubmitScoreResponse {
  accepted: boolean;
  bestMoves: number;
  stars: number;
}

/**
 * 后端统一契约。本轮（P0–P2）只提供 LocalOnlyApi 空实现；
 * P5 接入自建 FastAPI 时替换实现，业务层不改动。
 */
export interface RemoteApi {
  /** 拉取远端存档（不存在时返回 null） */
  fetchSave(): Promise<SavePayloadV1 | null>;
  /** 上传本地存档（合并后） */
  pushSave(save: SavePayloadV1): Promise<void>;
  /** 提交成绩，服务端重放校验 */
  submitScore(req: SubmitScoreRequest): Promise<SubmitScoreResponse>;
  /** 关卡排行榜（可选实现） */
  leaderboard(levelId: string): Promise<Array<{ openid: string; moves: number }>>;
}
