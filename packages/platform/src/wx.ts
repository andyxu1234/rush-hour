/**
 * 微信小游戏平台实现。
 *
 * ⚠️ 小游戏环境的关键差异（docs/02 §4，逐条对应）：
 *   1. 没有 DOM：canvas 只能由 wx.createCanvas() 提供，**不得**引用 document / Image；
 *   2. 触控坐标是**物理像素**，必须自行除以 dpr 才能与逻辑布局对齐；
 *   3. 音频用 wx.createInnerAudioContext()，且系统并发实例有上限 → 必须复用实例；
 *   4. wx.setStorageSync 单 key 上限约 1MB（我们的存档 <8KB，安全）；
 *   5. 没有 requestAnimationFrame → 必须用 canvas.requestAnimationFrame。
 *
 * 本文件通过 `declare const wx` 声明而非 import，避免 H5 构建时把 wx 打进包。
 */

import type {
  AdsApi,
  AudioApi,
  CanvasLike,
  HttpApi,
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

declare const wx: any;

/** 小游戏音频：复用实例 + 程序化音效不可用时的静默降级 */
class WxAudioApi implements AudioApi {
  private pools = new Map<SfxName, any[]>();
  private muted = false;

  async load(name: SfxName): Promise<void> {
    // 无素材文件：创建空实例即可，播放时若失败静默忽略
    this.acquire(name);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) for (const name of this.pools.keys()) this.stop(name);
  }

  isMuted(): boolean {
    return this.muted;
  }

  play(name: SfxName, opts?: { loop?: boolean }): void {
    if (this.muted) return;
    try {
      const inst = this.acquire(name);
      inst.loop = opts?.loop === true;
      inst.play();
    } catch {
      /* 静默降级：无音频素材时不影响玩法 */
    }
  }

  stop(name: SfxName): void {
    for (const inst of this.pools.get(name) ?? []) {
      try {
        inst.stop();
      } catch {
        /* ignore */
      }
    }
  }

  private acquire(name: SfxName): any {
    let pool = this.pools.get(name);
    if (!pool) {
      pool = [];
      this.pools.set(name, pool);
    }
    if (pool.length === 0) {
      try {
        const inst = wx.createInnerAudioContext();
        inst.src = `audio/${name}.mp3`;
        pool.push(inst);
      } catch {
        return null;
      }
    }
    return pool[0];
  }
}

class WxStorageApi implements StorageApi {
  get(key: string): string | null {
    try {
      const v = wx.getStorageSync(key);
      return typeof v === 'string' && v !== '' ? v : null;
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    try {
      wx.setStorageSync(key, value);
    } catch {
      /* 配额满：静默降级 */
    }
  }
  remove(key: string): void {
    try {
      wx.removeStorageSync(key);
    } catch {
      /* ignore */
    }
  }
}

class WxAdsApi implements AdsApi {
  private rewardedAd: any = null;
  private interstitialAd: any = null;

  isRewardedAvailable(): boolean {
    return typeof wx !== 'undefined' && typeof wx.createRewardedVideoAd === 'function';
  }

  private ensureRewarded(): any {
    if (!this.isRewardedAvailable()) return null;
    if (!this.rewardedAd) {
      this.rewardedAd = wx.createRewardedVideoAd({ adUnitId: '' });
    }
    return this.rewardedAd;
  }

  async showRewarded(): Promise<{ completed: boolean }> {
    const ad = this.ensureRewarded();
    if (!ad) return { completed: false };
    return new Promise((resolve) => {
      const onClose = (res: { isEnded?: boolean }) => {
        ad.offClose(onClose);
        resolve({ completed: res?.isEnded !== false });
      };
      ad.onClose(onClose);
      ad.show().catch(() => ad.load().then(() => ad.show()).catch(() => resolve({ completed: false })));
    });
  }

  async showInterstitial(): Promise<void> {
    if (typeof wx === 'undefined' || typeof wx.createInterstitialAd !== 'function') return;
    try {
      if (!this.interstitialAd) this.interstitialAd = wx.createInterstitialAd({ adUnitId: '' });
      await this.interstitialAd.show();
    } catch {
      /* 广告失败不得影响游戏 */
    }
  }
}

export class WxPlatform implements Platform {
  readonly name = 'wx' as const;
  readonly storage: StorageApi = new WxStorageApi();
  readonly audio: AudioApi = new WxAudioApi();
  readonly ads: AdsApi = new WxAdsApi();
  readonly http: HttpApi;

  private canvas: any = null;
  private resizeCbs = new Set<(s: Size) => void>();
  private pointerCbs = new Set<(e: PointerEventLike) => void>();
  private showCbs = new Set<() => void>();
  private hideCbs = new Set<() => void>();

  constructor() {
    this.http = {
      request: <T>(url: string, o?: any): Promise<{ status: number; data: T }> =>
        new Promise<{ status: number; data: T }>((resolve, reject) => {
          wx.request({
            url,
            method: o?.method ?? 'GET',
            header: o?.headers,
            data: o?.body,
            timeout: o?.timeoutMs ?? 10000,
            success: (res: any) => resolve({ status: res.statusCode, data: res.data as T }),
            fail: (err: any) => reject(new Error(String(err?.errMsg ?? 'request failed'))),
          });
        }),
    };
  }

  createCanvas(width: number, height: number): CanvasLike {
    this.canvas = wx.createCanvas();
    this.canvas.width = width;
    this.canvas.height = height;
    this.bindEvents();
    return this.canvas as CanvasLike;
  }

  private bindEvents(): void {
    // ⚠️ 小游戏触控坐标是物理像素 → 必须除以 dpr 换算到逻辑像素
    const dpr = () => this.devicePixelRatio();
    const translate = (t: any): PointerEventLike => ({
      x: t.clientX / dpr(),
      y: t.clientY / dpr(),
      phase: 'start' as PointerPhase,
      pointerId: t.identifier ?? 0,
      time: now(),
    });

    wx.onTouchStart((e: any) => {
      for (const t of e.touches ?? e.changedTouches ?? []) {
        const ev = translate(t);
        for (const cb of this.pointerCbs) cb({ ...ev, phase: 'start' });
      }
    });
    wx.onTouchMove((e: any) => {
      for (const t of e.touches ?? e.changedTouches ?? []) {
        const ev = translate(t);
        for (const cb of this.pointerCbs) cb({ ...ev, phase: 'move' });
      }
    });
    wx.onTouchEnd((e: any) => {
      for (const t of e.changedTouches ?? []) {
        const ev = translate(t);
        for (const cb of this.pointerCbs) cb({ ...ev, phase: 'end' });
      }
    });
    wx.onTouchCancel((e: any) => {
      for (const t of e.changedTouches ?? []) {
        const ev = translate(t);
        for (const cb of this.pointerCbs) cb({ ...ev, phase: 'cancel' });
      }
    });

    if (typeof wx.onWindowResize === 'function') {
      wx.onWindowResize(() => {
        const s = this.screen();
        for (const cb of this.resizeCbs) cb(s);
      });
    }
    wx.onShow(() => {
      for (const cb of this.showCbs) cb();
    });
    wx.onHide(() => {
      for (const cb of this.hideCbs) cb();
    });
  }

  screen(): Size {
    const info = wx.getSystemInfoSync();
    return { width: info.windowWidth, height: info.windowHeight };
  }

  devicePixelRatio(): number {
    try {
      const info = wx.getSystemInfoSync();
      return Math.min(3, info.pixelRatio || 1);
    } catch {
      return 1;
    }
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
    return new Promise((resolve) => {
      wx.login({
        success: (res: any) => resolve({ code: String(res.code ?? '') }),
        fail: () => resolve({ code: '' }),
      });
    });
  }

  share(opts: ShareOptions): void {
    try {
      wx.shareAppMessage({ title: opts.title, imageUrl: opts.imageUrl, query: opts.query });
    } catch {
      /* ignore */
    }
  }

  vibrate(ms: number): void {
    try {
      wx.vibrateShort({ type: ms > 20 ? 'medium' : 'light' });
    } catch {
      /* ignore */
    }
  }

  requestAnimationFrame(cb: (time: number) => void): number {
    // 小游戏没有 window.requestAnimationFrame，只能用 canvas 的
    return this.canvas?.requestAnimationFrame(cb) ?? 0;
  }

  cancelAnimationFrame(handle: number): void {
    this.canvas?.cancelAnimationFrame?.(handle);
  }
}

function now(): number {
  return Date.now();
}
