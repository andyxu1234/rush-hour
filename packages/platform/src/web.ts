/**
 * H5 平台实现（浏览器）—— 开发 / CI / Playwright 的主要载体。
 *
 * 注意：本文件是**唯一**允许访问 DOM 的地方；core / render 一律通过 Platform 接口。
 * 触控与鼠标统一翻译成 pointer 语义，逻辑坐标 = 物理像素 / dpr。
 */

import type {
  AdsApi,
  AudioApi,
  CanvasLike,
  HttpApi,
  ImageApi,
  ImageLike,
  LoginResult,
  Platform,
  PointerEventLike,
  PointerPhase,
  ShareOptions,
  SfxName,
  Size,
  StorageApi,
  Unsubscribe,
} from './types';

/** 程序化音效：无音频素材文件，用 WebAudio 合成（docs 音效清单的"咔/咚/咻/和弦"） */
class WebAudioApi implements AudioApi {
  private ctx: AudioContext | null = null;
  private muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (this.ctx) return this.ctx;
    const Ctor = (globalThis as any).AudioContext ?? (globalThis as any).webkitAudioContext;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  async load(_name: SfxName): Promise<void> {
    /* 合成音无需预热 */
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  stop(_name: SfxName): void {
    /* 短音效自然结束 */
  }

  play(name: SfxName, opts?: { loop?: boolean }): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    switch (name) {
      case 'snap': {
        // 短促"咔"：高频方波快速衰减
        this.blip(ctx, t, 880, 'square', 0.08, 0.16);
        break;
      }
      case 'blocked': {
        // 低频"咚"：暗示被挡住
        this.blip(ctx, t, 140, 'sawtooth', 0.1, 0.2);
        this.blip(ctx, t, 90, 'sine', 0.12, 0.16);
        break;
      }
      case 'undo':
        // "咻"上行
        this.sweep(ctx, t, 420, 900, 0.1, 0.14);
        break;
      case 'click':
        this.blip(ctx, t, 1200, 'square', 0.03, 0.08);
        break;
      case 'star':
        this.blip(ctx, t, 1320, 'triangle', 0.12, 0.14);
        break;
      case 'win':
        // 上行三音 + 和弦（docs: 过关上行三音+和弦 1.2s）
        this.blip(ctx, t + 0.0, 523, 'triangle', 0.22, 0.16);
        this.blip(ctx, t + 0.16, 659, 'triangle', 0.22, 0.16);
        this.blip(ctx, t + 0.32, 784, 'triangle', 0.4, 0.18);
        this.blip(ctx, t + 0.48, 1047, 'sine', 0.7, 0.14);
        this.blip(ctx, t + 0.48, 784, 'sine', 0.7, 0.1);
        this.blip(ctx, t + 0.48, 659, 'sine', 0.7, 0.08);
        break;
      case 'music': {
        // 8-bit BGM：极简琶音循环（默认开、可关）
        if (!opts?.loop) break;
        const notes = [262, 330, 392, 523, 392, 330];
        notes.forEach((f, i) => this.blip(ctx, t + i * 0.22, f, 'square', 0.2, 0.045));
        break;
      }
    }
  }

  private blip(
    ctx: AudioContext,
    at: number,
    freq: number,
    type: OscillatorType,
    dur: number,
    vol: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(vol, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private sweep(
    ctx: AudioContext,
    at: number,
    from: number,
    to: number,
    dur: number,
    vol: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + dur);
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }
}

/**
 * H5 位图加载。
 *
 * 关键点：**失败必须 resolve(null)，不能 reject**。
 *   素材缺失是可降级情形（render 层会回落为代码绘制），若 reject 会顺着
 *   Promise 链把整个屏幕初始化打断，表现为"打开游戏白屏"。
 *
 * 同时带一个超时兜底：某些浏览器在图片 404 时不触发 error（例如被 Service
 * Worker 拦截），没有超时会导致加载 Promise 永远挂起。
 */
class WebImageApi implements ImageApi {
  private cache = new Map<string, Promise<ImageLike | null>>();

  load(src: string): Promise<ImageLike | null> {
    const hit = this.cache.get(src);
    if (hit) return hit;
    const p = this.loadUncached(src);
    this.cache.set(src, p);
    return p;
  }

  private loadUncached(src: string): Promise<ImageLike | null> {
    const Ctor = (globalThis as any).Image as (new () => HTMLImageElement) | undefined;
    if (!Ctor) return Promise.resolve(null);

    return new Promise<ImageLike | null>((resolve) => {
      const img = new Ctor();
      let settled = false;
      const done = (v: ImageLike | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      };
      const timer = setTimeout(() => done(null), IMAGE_TIMEOUT_MS);

      img.onload = () => done(img);
      img.onerror = () => done(null);
      img.src = src;
    });
  }
}

const IMAGE_TIMEOUT_MS = 6000;

class WebStorageApi implements StorageApi {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* 隐私模式/配额满：静默降级，不阻塞游戏 */
    }
  }
  remove(key: string): void {
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* 同上 */
    }
  }
}

class WebAdsApi implements AdsApi {
  isRewardedAvailable(): boolean {
    return false; // H5 无广告 SDK；调用方走降级路径
  }
  async showRewarded(): Promise<{ completed: boolean }> {
    return { completed: false };
  }
  async showInterstitial(): Promise<void> {
    /* no-op */
  }
}

export interface WebPlatformOptions {
  /** 挂载 canvas 的父容器；缺省挂到 body */
  container?: HTMLElement;
}

export class WebPlatform implements Platform {
  readonly name = 'h5' as const;
  readonly storage: StorageApi = new WebStorageApi();
  readonly audio: AudioApi = new WebAudioApi();
  readonly image: ImageApi = new WebImageApi();
  readonly ads: AdsApi = new WebAdsApi();
  readonly http: HttpApi;

  private canvasEl: HTMLCanvasElement | null = null;
  private resizeCbs = new Set<(s: Size) => void>();
  private pointerCbs = new Set<(e: PointerEventLike) => void>();
  private showCbs = new Set<() => void>();
  private hideCbs = new Set<() => void>();
  private rafIds = new Map<number, number>();
  private nextRafId = 1;
  private boundHandlers: Array<[string, EventListener]> = [];
  /** canvas 对应的逻辑尺寸（与 GameScreen 的 layout 保持一致） */
  private canvasLogical = { width: 375, height: 667 };

  constructor(private opts: WebPlatformOptions = {}) {
    this.http = {
      request: async <T>(url: string, o?: any) => {
        const res = await fetch(url, {
          method: o?.method ?? 'GET',
          headers: o?.headers,
          body: o?.body,
        });
        const text = await res.text();
        let data: unknown = text;
        try {
          data = JSON.parse(text);
        } catch {
          /* 非 JSON 响应原样返回 */
        }
        return { status: res.status, data: data as T };
      },
    };
  }

  createCanvas(width: number, height: number): CanvasLike {
    if (this.canvasEl) return this.canvasEl as unknown as CanvasLike;
    const el = globalThis.document.createElement('canvas');
    el.width = width;
    el.height = height;
    el.style.display = 'block';
    el.style.touchAction = 'none';
    // ⚠️ 关键：canvas 的 CSS 尺寸必须与 screen() 的返回尺寸严格一致。
    // 若这里写 100%（受 flex 居中、滚动条影响可能不等于视口），
    // 那么 toLogical() 的"容差换算"会引入误差，导致点不中车、拖拽吞事件。
    // 因此这里显式按逻辑尺寸设置，并在 resize 时同步。
    this.applyCssSize(el);
    (this.opts.container ?? globalThis.document.body).appendChild(el);
    this.canvasEl = el;
    this.bindEvents(el);
    return el as unknown as CanvasLike;
  }

  /** 让 canvas 的 CSS 尺寸与布局尺寸严格 1:1（逻辑像素） */
  private applyCssSize(el: HTMLCanvasElement): void {
    const s = this.screen();
    this.canvasLogical = { width: s.width, height: s.height };
    el.style.width = `${s.width}px`;
    el.style.height = `${s.height}px`;
    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.top = '0';
  }

  private bindEvents(el: HTMLCanvasElement): void {
    const toLogical = (ev: MouseEvent | Touch): { x: number; y: number } => {
      const rect = el.getBoundingClientRect();
      // canvas 的 CSS 尺寸与逻辑尺寸 1:1（见 applyCssSize），
      // 但仍按 rect 实测做一次归一化，兼容浏览器缩放 / 高清屏取整误差。
      const sx = rect.width > 0 ? this.canvasLogical.width / rect.width : 1;
      const sy = rect.height > 0 ? this.canvasLogical.height / rect.height : 1;
      return {
        x: (ev.clientX - rect.left) * sx,
        y: (ev.clientY - rect.top) * sy,
      };
    };

    const emit = (phase: PointerPhase, ev: MouseEvent | Touch, id: number) => {
      const { x, y } = toLogical(ev);
      const e: PointerEventLike = { x, y, phase, pointerId: id, time: now() };
      for (const cb of this.pointerCbs) cb(e);
    };

    /**
     * ★ 触摸/鼠标去重 —— 这是真机上"按钮点不动"的根因。
     *
     * 移动端浏览器在一次 touch 手势后，会**再补发一套合成鼠标事件**
     * （mousedown → mouseup，约 300ms 内）。如果两套都转发给上层，就会出现：
     *   touchend 已派发 tap → 上层消费并关闭弹窗
     *   ↓ 紧接着合成 mousedown 又 emit('start')，开启一个"幽灵手势"
     *   ↓ 合成 mouseup 再 emit('end')，此时 downAt 已被重置
     * 结果是同一次点按被处理两次，或状态错乱导致按钮无响应。
     *
     * 处理：一旦收到 touch 事件，就进入"触摸模式"，并在随后一小段时间内
     * 忽略所有鼠标事件；反之若只收到鼠标事件（桌面），则始终走鼠标路径。
     */
    /**
     * `lastTouchAt` 必须初始化为 **null** 而不是 0。
     * `now()` 是 performance.now()，页面刚加载时数值很小（可能 < 700），
     * 若初始化成 0，则 `now() - 0 < 700` 会无条件成立，
     * 结果把所有鼠标事件都当成"合成事件"丢弃 —— 桌面端直接失去响应。
     */
    let lastTouchAt: number | null = null;
    /** 合成鼠标事件在该窗口内一律丢弃（Chrome 约 300ms，留足余量） */
    const SYNTHETIC_MOUSE_WINDOW_MS = 700;
    const isSyntheticMouse = (): boolean =>
      lastTouchAt !== null && now() - lastTouchAt < SYNTHETIC_MOUSE_WINDOW_MS;

    const onMouseDown = (ev: Event) => {
      if (isSyntheticMouse()) return;
      emit('start', ev as MouseEvent, 0);
    };
    const onMouseMove = (ev: Event) => {
      if (isSyntheticMouse()) return;
      const me = ev as MouseEvent;
      if (me.buttons === 0) return;
      emit('move', me, 0);
    };
    const onMouseUp = (ev: Event) => {
      if (isSyntheticMouse()) return;
      emit('end', ev as MouseEvent, 0);
    };

    const onTouchStart = (ev: Event) => {
      const te = ev as TouchEvent;
      lastTouchAt = now();
      // 阻止滚动/缩放，同时抑制后续合成鼠标事件
      ev.preventDefault();
      for (let i = 0; i < te.changedTouches.length; i++) {
        emit('start', te.changedTouches[i], te.changedTouches[i].identifier);
      }
    };
    const onTouchMove = (ev: Event) => {
      const te = ev as TouchEvent;
      lastTouchAt = now();
      ev.preventDefault();
      for (let i = 0; i < te.changedTouches.length; i++) {
        emit('move', te.changedTouches[i], te.changedTouches[i].identifier);
      }
    };
    const onTouchEnd = (ev: Event) => {
      const te = ev as TouchEvent;
      lastTouchAt = now();
      ev.preventDefault();
      for (let i = 0; i < te.changedTouches.length; i++) {
        emit('end', te.changedTouches[i], te.changedTouches[i].identifier);
      }
    };
    const onTouchCancel = (ev: Event) => {
      const te = ev as TouchEvent;
      lastTouchAt = now();
      for (let i = 0; i < te.changedTouches.length; i++) {
        emit('cancel', te.changedTouches[i], te.changedTouches[i].identifier);
      }
    };

    const add = (target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, opts);
      this.boundHandlers.push([type, fn]);
    };
    add(el, 'mousedown', onMouseDown);
    add(globalThis.window, 'mousemove', onMouseMove);
    add(globalThis.window, 'mouseup', onMouseUp);

    // 触摸事件绑到 window 而不是 canvas：
    // 手指滑出画布边界（或结束时落在 HUD/状态栏区域）时，
    // 事件仍会冒泡到 window，不会出现"手势悬空、永远不结束"。
    add(globalThis.window, 'touchstart', onTouchStart, { passive: false });
    add(globalThis.window, 'touchmove', onTouchMove, { passive: false });
    add(globalThis.window, 'touchend', onTouchEnd, { passive: false });
    add(globalThis.window, 'touchcancel', onTouchCancel, { passive: false });

    const onResize = () => {
      if (this.canvasEl) this.applyCssSize(this.canvasEl);
      const s = this.screen();
      for (const cb of this.resizeCbs) cb(s);
    };
    add(globalThis.window, 'resize', onResize);

    const onVis = () => {
      if (globalThis.document.hidden) for (const cb of this.hideCbs) cb();
      else for (const cb of this.showCbs) cb();
    };
    add(globalThis.document, 'visibilitychange', onVis);
  }

  screen(): Size {
    const w = globalThis.window?.innerWidth || Number(DESIGN_W);
    const h = globalThis.window?.innerHeight || Number(DESIGN_H);
    // 保持设计比例下的逻辑尺寸：以宽度为主约束，避免棋盘在小屏被压扁
    return { width: w, height: h };
  }

  devicePixelRatio(): number {
    return Math.min(3, globalThis.window?.devicePixelRatio ?? 1);
  }

  onResize(cb: (size: Size) => void): Unsubscribe {
    this.resizeCbs.add(cb);
    return () => this.resizeCbs.delete(cb);
  }

  onPointer(cb: (e: PointerEventLike) => void): Unsubscribe {
    this.pointerCbs.add(cb);
    return () => this.pointerCbs.delete(cb);
  }

  onShow(cb: () => void): Unsubscribe {
    this.showCbs.add(cb);
    return () => this.showCbs.delete(cb);
  }

  onHide(cb: () => void): Unsubscribe {
    this.hideCbs.add(cb);
    return () => this.hideCbs.delete(cb);
  }

  async login(): Promise<LoginResult> {
    // H5 无微信登录：返回本地匿名标识，P5 接后端时替换为真实 code
    return { code: 'h5-anonymous' };
  }

  share(opts: ShareOptions): void {
    const nav = globalThis.navigator as any;
    if (nav?.share) void nav.share({ title: opts.title }).catch(() => undefined);
    else console.info('[share]', opts.title);
  }

  vibrate(ms: number): void {
    const nav = globalThis.navigator as any;
    if (nav?.vibrate) nav.vibrate(ms);
  }

  requestAnimationFrame(cb: (time: number) => void): number {
    const win = globalThis.window;
    const raw = win.requestAnimationFrame((t) => {
      this.rafIds.delete(id);
      cb(t);
    });
    const id = this.nextRafId++;
    this.rafIds.set(id, raw);
    return id;
  }

  cancelAnimationFrame(handle: number): void {
    const raw = this.rafIds.get(handle);
    if (raw !== undefined) globalThis.window.cancelAnimationFrame(raw);
    this.rafIds.delete(handle);
  }
}

const DESIGN_W = 375;
const DESIGN_H = 667;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
