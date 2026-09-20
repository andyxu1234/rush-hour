/**
 * 拖拽 / 点击交互 —— 手感规则严格对齐 docs/01 §8 的"非法/回弹"定义：
 *
 *   - 拖拽不足 0.5 格        → 回弹，**不计步**
 *   - 拖拽超可用距离        → 吸附最远处，**计 1 步**
 *   - 方向非法（前方无空位）→ 回弹 + 抖动，**不计步**
 *   - 一次拖动无论滑几格    → 只算 **1 步**（本层产出一个 Move，绝不产出多个）
 *
 * 关键设计：本层只产出「点击了哪辆车 / 拖到第几格 / 松手」这类事实，
 * 判断合法性一律交给 core 的 Board，避免两处实现同一套规则而漂移。
 */

import { H, type MoveDir } from '@rush-hour/core';
import type { PointerEventLike } from '@rush-hour/platform';
import { METRICS } from './theme';
import { hitButton, insideBoard, pxToCell, type ButtonRect, type Layout } from './layout';
import type { Board, State } from '@rush-hour/core';

export interface DragState {
  pieceId: string;
  pieceIndex: number;
  /** 主拖拽轴（由车辆朝向决定，横车只能左右） */
  axis: 'x' | 'y';
  /** 手指按下时的格子坐标（可为小数） */
  originR: number;
  originC: number;
  /** 当前累计偏移（格，已夹紧到合法范围，可正可负） */
  deltaCells: number;
  /** 夹紧之前的原始位移（格）；用于判定玩家真实意图方向 */
  rawDelta: number;
  /** 该方向最大可滑格数（正方向为正、负方向取绝对值） */
  maxPositive: number;
  maxNegative: number;
  /** 松手时应落到的格数（吸附后，带符号） */
  snapCells: number;
  /** 是否已开始移动（用于区分"轻点"与"拖拽"） */
  moved: boolean;
}

export type InputIntent =
  | { type: 'grab'; pieceId: string }
  | { type: 'drag'; pieceId: string; deltaCells: number; dir: MoveDir }
  | { type: 'release'; pieceId: string; dir: MoveDir; cells: number; moved: boolean }
  | { type: 'cancel' }
  | { type: 'button'; id: ButtonRect['id'] }
  | { type: 'tap'; x: number; y: number };

export interface InputHost {
  layout: Layout;
  /** 命中测试：返回该像素点下的车（无则 null） */
  pieceAt(x: number, y: number): { id: string; index: number } | null;
  board: Board;
  state: State;
  /** 当前 HUD 按钮（含禁用态） */
  buttons(): ButtonRect[];
  /** 弹窗打开时禁用棋盘拖拽 */
  dialogOpen(): boolean;
}

/** 长按判定（显示该车可移动方向） */
export interface InputCallbacks {
  onLongPress(pieceId: string): void;
  onIntent(intent: InputIntent): void;
}

const LONG_PRESS_MS = METRICS.longPressMs;

export class InputController {
  private drag: DragState | null = null;
  private pressing: { pieceId: string; startTime: number; timer: number | null } | null = null;
  private downAt: { x: number; y: number } | null = null;

  constructor(
    private host: InputHost,
    private cb: InputCallbacks,
  ) {}

  /** 由渲染循环每帧调用，用于长按检测（平台无 setTimeout 时也能工作） */
  tick(now: number): void {
    if (this.pressing && this.drag && !this.drag.moved) {
      if (now - this.pressing.startTime >= LONG_PRESS_MS) {
        const id = this.pressing.pieceId;
        this.pressing = null;
        this.cb.onLongPress(id);
      }
    }
  }

  handle(e: PointerEventLike): void {
    // cancel 与 end 语义不同：cancel 表示系统夺走了这次手势（来电、切后台等），
    // 必须丢弃拖拽态且**不得**提交任何走子，否则会出现"莫名其妙走了一步"。
    if (e.phase === 'cancel') {
      this.onCancel();
      return;
    }
    if (e.phase === 'start') this.onStart(e);
    else if (e.phase === 'move') this.onMove(e);
    else this.onEnd(e);
  }

  private onCancel(): void {
    this.drag = null;
    this.pressing = null;
    this.downAt = null;
    this.cb.onIntent({ type: 'cancel' });
  }

  // onCancel 定义在 handle 之后、onStart 之前；顺序不影响语义，仅为可读性归拢。

  private onStart(e: PointerEventLike): void {
    // 记住按下点，用于"轻点"判定（按下即记录，松手时若未移动即为 tap）
    this.downAt = { x: e.x, y: e.y };

    // 弹窗已打开：不进入拖拽态，只记 downAt；
    // 松手时由 onEnd 派发 tap，交给上层做弹窗按钮命中测试。
    // （早期版本在这里把 downAt 清掉了，导致弹窗按钮永远点不动。）
    if (this.host.dialogOpen()) return;

    // HUD 按钮：按下即触发（按钮无需拖拽语义）
    const btn = hitButton(this.host.buttons(), e.x, e.y);
    if (btn) {
      this.cb.onIntent({ type: 'button', id: btn.id });
      this.downAt = null;
      return;
    }

    // 棋盘外按下：不留拖拽态，但保留 downAt 以便松手时判定为 tap
    if (!insideBoard(this.host.layout, e.x, e.y)) return;

    const hit = this.host.pieceAt(e.x, e.y);
    if (!hit) return;

    const { r, c } = pxToCell(this.host.layout, e.x, e.y);
    const piece = this.host.board.pieces[hit.index];
    const axis: 'x' | 'y' = piece.dir === H ? 'x' : 'y';

    // 只有拖拽起点落在车辆自身格子上才算 grab（棋盘边缘误触不抓车）
    this.drag = {
      pieceId: hit.id,
      pieceIndex: hit.index,
      axis,
      originR: r,
      originC: c,
      deltaCells: 0,
      rawDelta: 0,
      maxPositive: this.host.board.maxSlide(
        this.host.state,
        hit.index,
        axis === 'x' ? 'right' : 'down',
      ),
      maxNegative: this.host.board.maxSlide(this.host.state, hit.index, axis === 'x' ? 'left' : 'up'),
      snapCells: 0,
      moved: false,
    };
    this.pressing = { pieceId: hit.id, startTime: e.time, timer: null };
    this.cb.onIntent({ type: 'grab', pieceId: hit.id });
  }

  private onMove(e: PointerEventLike): void {
    // ⚠️ 不要在这里无条件清空 downAt。
    // 真机上每次点按都伴随 5~15px 的手指抖动，因此 move 事件的到达
    // 完全不代表"玩家想拖动"。只有位移超过 tapSlopPx 才取消轻点判定，
    // 否则 tap 会被抖动吃掉 —— 这正是"结算弹窗按钮点不动"的第二个根因。
    if (this.downAt) {
      const dist = Math.hypot(e.x - this.downAt.x, e.y - this.downAt.y);
      if (dist > METRICS.tapSlopPx) this.downAt = null;
    }

    const d = this.drag;
    if (!d) return;
    const { r, c } = pxToCell(this.host.layout, e.x, e.y);
    const raw = d.axis === 'x' ? c - d.originC : r - d.originR;

    // 记录"玩家意图方向"（夹紧之前）——方向提示与回弹抖动都必须依据它，
    // 否则在贴边/被顶住时会因为位移被夹到 0 而误判成反方向。
    d.rawDelta = raw;

    // 夹紧到「该方向实际可滑范围」内，最大值严格等于 maxPositive / maxNegative。
    //
    // 为什么必须硬夹（不能只做过阻尼）：松手时用 Math.round 吸附，
    // 若允许 3.8 这种值通过，一旦上限变小就会吸附越界。
    // "越距 → 吸附最远处"这条规则依赖 raw 的上限语义（docs/01 §8）。
    let delta = raw;
    if (delta > d.maxPositive) delta = d.maxPositive;
    else if (delta < -d.maxNegative) delta = -d.maxNegative;

    d.deltaCells = delta;
    if (Math.abs(raw) > 0.12) d.moved = true;
    if (d.moved) this.pressing = null;

    // 方向按原始位移符号判定，保证"拖不动"时方向仍与玩家意图一致
    const dir: MoveDir =
      d.axis === 'x' ? (raw < 0 ? 'left' : 'right') : raw < 0 ? 'up' : 'down';
    this.cb.onIntent({ type: 'drag', pieceId: d.pieceId, deltaCells: delta, dir });
  }

  private onEnd(e: PointerEventLike): void {
    const d = this.drag;
    this.pressing = null;
    if (!d) {
      // 没有抓到车 → 交给上层判断是否算轻点。
      // 容差用"手指级"的 tapSlopPx（见 theme.ts 注释），不能用棋盘格尺度，
      // 否则真机上轻微的天然抖动就会被判成拖动，tap 永不派发。
      if (this.downAt) {
        const dx = e.x - this.downAt.x;
        const dy = e.y - this.downAt.y;
        const moved = Math.hypot(dx, dy) > METRICS.tapSlopPx;
        this.downAt = null;
        if (!moved) this.cb.onIntent({ type: 'tap', x: e.x, y: e.y });
      }
      return;
    }
    this.drag = null;
    this.downAt = null;

    const raw = d.deltaCells;
    // 拖拽不足 0.5 格 → 回弹，不计步。
    // 方向依据"夹紧前的原始意图"（rawDelta），这样贴边/被顶住时抖动方向也正确。
    const intent = d.rawDelta;
    const sign = intent === 0 ? 1 : Math.sign(intent);
    const fallbackDir: MoveDir =
      d.axis === 'x' ? (sign < 0 ? 'left' : 'right') : sign < 0 ? 'up' : 'down';
    if (Math.abs(raw) < METRICS.snapThreshold) {
      this.cb.onIntent({
        type: 'release',
        pieceId: d.pieceId,
        dir: fallbackDir,
        cells: 0,
        moved: d.moved,
      });
      return;
    }

    // 吸附方向以夹紧前的意图为准：位移被夹到 0 时（贴边）仍应报出玩家想去的方向
    const dir: MoveDir =
      d.axis === 'x' ? (intent < 0 ? 'left' : 'right') : intent < 0 ? 'up' : 'down';
    const limit = dir === 'right' || dir === 'down' ? d.maxPositive : d.maxNegative;
    let cells = Math.min(Math.round(Math.abs(raw)), limit);
    if (cells < 1) cells = 0;
    this.cb.onIntent({ type: 'release', pieceId: d.pieceId, dir, cells, moved: d.moved });
  }

  get currentDrag(): DragState | null {
    return this.drag;
  }
}
