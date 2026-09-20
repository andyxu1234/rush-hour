/**
 * 设置页 —— docs/01 §6.1。
 *
 * 规格要求（原文）：
 *   「音效、震动、计步显示口径（步/格）、语言、清除本地存档」
 *   边界：「清档需二次确认」
 *   另有：「跳过引导的入口放设置页」（§9）
 *
 * 实现取舍：
 *   - **语言**本轮不做：当前只有中文文案，放一个点不动的语言项比没有更糟。
 *     在渲染时明确标注"敬请期待"而不是假装可切换。
 *   - 音效/音乐开关**立即作用于 platform.audio**（`setMuted`），不是只写存档 ——
 *     否则玩家关了音效却还听见"咔"，会被当成 bug。
 *   - 清档是危险操作：点击后进入"确认态"（按钮文案变为"确认清除？"），
 *     再次点击才真正执行；任一其它操作（或 4 秒无操作）会退出确认态。
 *     不用系统弹窗（小游戏无 DOM，且 modal 会打断音频/动画）。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx。
 */

import type { CanvasRenderingContext2DLike, Platform, PointerEventLike } from '@rush-hour/platform';
import type { LevelRepository, SaveV1 } from '@rush-hour/core';
import { SAVE_KEY } from '@rush-hour/core';
import { COLORS, FONTS } from '../theme';
import { computeLayout, hitRect, settingsLayout, type Layout } from '../layout';
import {
  drawHeader,
  drawPageBackground,
  drawText,
  roundRectPath,
  type UiButton,
} from '../ui';
import type { Screen, ScreenId } from './screen';

/** 设置项语义 */
export type SettingId = 'sfx' | 'music' | 'vibrate' | 'metric' | 'tutorial' | 'wipe' | 'language';

export interface SettingItem {
  id: SettingId;
  label: string;
  kind: 'toggle' | 'action';
  danger?: boolean;
  disabled?: boolean;
}

export interface SettingsScreenDeps {
  platform: Platform;
  repo: LevelRepository;
  save: SaveV1;
  /** 存档持久化 */
  persist(): void;
  /** 清档后的回调（宿主负责清 localStorage / 重置内存态） */
  onWipe(): void;
  goBack(): void;
  /** 重看新手引导 */
  onReplayTutorial(): void;
}

/** 二次确认的超时（ms）。超时后自动退出确认态，避免"误触后一直处于危险状态" */
const CONFIRM_TIMEOUT_MS = 4000;

export class SettingsScreen implements Screen {
  readonly id: ScreenId = 'settings';
  private layout: Layout;
  private readonly ctx: CanvasRenderingContext2DLike;
  private items: SettingItem[] = [];
  private rows: Array<{ rect: UiButton; toggle: { x: number; y: number; w: number; h: number } | null }> = [];
  private backBtn: UiButton | null = null;
  /** 处于二次确认的设置项 id */
  private confirming: SettingId | null = null;
  private confirmStartedAt = 0;

  constructor(private readonly deps: SettingsScreenDeps) {
    const s = deps.platform.screen();
    this.layout = computeLayout(s.width, s.height);
    this.ctx = deps.platform.createCanvas(1, 1).getContext('2d') as CanvasRenderingContext2DLike;
  }

  enter(): void {
    this.confirming = null;
    this.items = this.buildItems();
    this.rebuild();
    // 进入设置页时同步一次静音状态：存档可能被外部（云端合并）改动过
    this.syncAudio();
  }

  exit(): void {
    this.confirming = null;
  }

  onResize(): void {
    const s = this.deps.platform.screen();
    this.layout = computeLayout(s.width, s.height);
    this.rebuild();
  }

  update(_dt: number, now: number): void {
    if (this.confirming && now - this.confirmStartedAt > CONFIRM_TIMEOUT_MS) {
      this.confirming = null;
      this.rebuild();
    }
  }

  onPointer(e: PointerEventLike): void {
    if (e.phase !== 'end') return;

    if (this.backBtn && hitRect([this.backBtn], e.x, e.y)) {
      this.deps.platform.audio.play('click');
      this.confirming = null;
      this.deps.goBack();
      return;
    }

    const hitRow = hitRect(
      this.rows.map((r) => r.rect),
      e.x,
      e.y,
    );
    if (!hitRow) return;
    const row = this.rows.find((r) => r.rect.id === hitRow.id);
    if (!row) return;
    const item = this.items.find((i) => i.id === row.rect.id);
    if (!item || item.disabled) return;

    // 未处于确认态时，点任意其它项都会取消确认态（避免危险操作被"挂着"）
    if (this.confirming && this.confirming !== item.id) {
      this.confirming = null;
      this.rebuild();
    }

    this.deps.platform.audio.play('click');
    this.activate(item);
  }

  // ---------------------------------------------------------------- 查询（e2e）

  get settingItems(): readonly SettingItem[] {
    return this.items;
  }

  get confirmingId(): SettingId | null {
    return this.confirming;
  }

  /** 行的屏幕矩形（供 e2e 像素点击，验证绘制与命中的几何一致性） */
  get rowRects(): Array<{ id: string; x: number; y: number; w: number; h: number }> {
    return this.rows.map((r) => ({
      id: r.rect.id,
      x: r.rect.x,
      y: r.rect.y,
      w: r.rect.w,
      h: r.rect.h,
    }));
  }

  get backRect(): UiButton | null {
    return this.backBtn;
  }

  /** 直接触发某个设置项（e2e 用） */
  trigger(id: SettingId): void {
    const item = this.items.find((i) => i.id === id);
    if (item && !item.disabled) {
      // 复用与点击完全相同的路径，避免"测试专用旁路"掩盖真实缺陷
      this.activate(item);
    }
  }

  // ---------------------------------------------------------------- 行为

  private buildItems(): SettingItem[] {
    return [
      { id: 'sfx', label: '音效', kind: 'toggle' },
      { id: 'music', label: '背景音乐', kind: 'toggle' },
      { id: 'vibrate', label: '震动反馈', kind: 'toggle' },
      { id: 'metric', label: '步数口径', kind: 'toggle' },
      { id: 'tutorial', label: '重看新手引导', kind: 'action' },
      { id: 'language', label: '语言', kind: 'action', disabled: true },
      { id: 'wipe', label: '清除本地存档', kind: 'action', danger: true },
    ];
  }

  private activate(item: SettingItem): void {
    const s = this.deps.save.settings;
    switch (item.id) {
      case 'sfx':
        s.sfx = !s.sfx;
        this.syncAudio();
        this.persistAndRefresh();
        return;
      case 'music':
        s.music = !s.music;
        this.syncMusic();
        this.persistAndRefresh();
        return;
      case 'vibrate':
        s.vibrate = !s.vibrate;
        this.persistAndRefresh();
        return;
      case 'metric':
        s.moveMetric = s.moveMetric === 'moves' ? 'cells' : 'moves';
        this.persistAndRefresh();
        return;
      case 'tutorial':
        this.deps.save.tutorialDone = false;
        this.deps.persist();
        this.deps.onReplayTutorial();
        return;
      case 'wipe':
        this.handleWipe();
        return;
      case 'language':
        // 已标记 disabled，正常路径不会到这里
        return;
    }
  }

  private handleWipe(): void {
    if (this.confirming !== 'wipe') {
      this.confirming = 'wipe';
      this.confirmStartedAt = Date.now();
      this.rebuild();
      return;
    }
    this.confirming = null;
    this.deps.onWipe();
    this.deps.persist();
    this.rebuild();
  }

  private persistAndRefresh(): void {
    this.deps.save.dirty = true;
    this.deps.persist();
    this.rebuild();
  }

  /** 音效开关 → 实际静音状态。总开关（sfx）控制全部音效 */
  private syncAudio(): void {
    this.deps.platform.audio.setMuted(!this.deps.save.settings.sfx);
  }

  private syncMusic(): void {
    const on = this.deps.save.settings.music && this.deps.save.settings.sfx;
    if (on) this.deps.platform.audio.play('music', { loop: true });
    else this.deps.platform.audio.stop('music');
  }

  private rebuild(): void {
    const geo = settingsLayout(this.layout, this.items.length);
    this.rows = this.items.map((item, i) => {
      const g = geo[i];
      return {
        rect: { id: item.id, x: g.x, y: g.y, w: g.w, h: g.h, label: item.label },
        toggle: item.kind === 'toggle' ? g.toggle ?? null : null,
      };
    });
    this.backBtn = backGeometry(this.layout);
  }

  render(): void {
    const ctx = this.ctx;
    const layout = this.layout;
    drawPageBackground(ctx, layout);

    const header = drawHeader(ctx, layout, '设置');
    this.backBtn = header.back;

    for (const item of this.items) {
      const row = this.rows.find((r) => r.rect.id === item.id);
      if (!row) continue;
      this.drawRow(ctx, item, row);
    }
  }

  private drawRow(
    ctx: CanvasRenderingContext2DLike,
    item: SettingItem,
    row: { rect: UiButton; toggle: { x: number; y: number; w: number; h: number } | null },
  ): void {
    const r = row.rect;
    const s = this.deps.save.settings;

    ctx.save();
    if (item.disabled) ctx.globalAlpha = 0.45;
    ctx.fillStyle = COLORS.panel;
    ctx.strokeStyle = COLORS.panelStroke;
    ctx.lineWidth = 1;
    roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 标签（危险操作红色 + 确认态改文案）
    let label = item.label;
    if (item.id === 'wipe' && this.confirming === 'wipe') label = '确认清除？再点一次';
    if (item.id === 'language') label = '语言（敬请期待）';

    ctx.save();
    if (item.disabled) ctx.globalAlpha = 0.45;
    drawText(ctx, label, r.x + Math.round(r.h * 0.42), r.y + r.h / 2, {
      font: FONTS.hud,
      color: item.danger ? COLORS.redCar : COLORS.text,
    });
    ctx.restore();

    if (item.kind === 'toggle' && row.toggle) {
      const on = this.toggleValueOf(item.id, s);
      this.drawToggle(ctx, row.toggle, on, item.id === 'metric');
      // 步数口径用文字说明当前值，开关的"开/关"语义对它是无意义的
      if (item.id === 'metric') {
        drawText(
          ctx,
          s.moveMetric === 'moves' ? '按滑动次数' : '按滑动格数',
          row.toggle.x - Math.round(r.h * 0.3),
          r.y + r.h / 2,
          { font: FONTS.small, color: COLORS.textDim, align: 'right' },
        );
      }
    }

    if (item.danger && this.confirming === 'wipe') {
      // 确认态：整行描红，让"危险状态"一眼可见
      ctx.save();
      ctx.strokeStyle = COLORS.redCar;
      ctx.lineWidth = 2;
      roundRectPath(ctx, r.x, r.y, r.w, r.h, 12);
      ctx.stroke();
      ctx.restore();
    }
  }

  private toggleValueOf(id: SettingId, s: SaveV1['settings']): boolean {
    switch (id) {
      case 'sfx':
        return s.sfx;
      case 'music':
        return s.music;
      case 'vibrate':
        return s.vibrate;
      case 'metric':
        return s.moveMetric === 'cells';
      default:
        return false;
    }
  }

  /** 胶囊开关。label 为右侧短文字（如 步/格），避免只看颜色分不清 */
  private drawToggle(
    ctx: CanvasRenderingContext2DLike,
    t: { x: number; y: number; w: number; h: number },
    on: boolean,
    showLabel: boolean,
  ): void {
    ctx.save();
    ctx.fillStyle = on ? COLORS.primary : COLORS.starEmpty;
    roundRectPath(ctx, t.x, t.y, t.w, t.h, t.h / 2);
    ctx.fill();

    const knobR = t.h * 0.4;
    const cx = on ? t.x + t.w - t.h / 2 : t.x + t.h / 2;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(cx, t.y + t.h / 2, knobR, 0, Math.PI * 2);
    ctx.fill();

    if (showLabel) {
      ctx.fillStyle = on ? COLORS.primaryText : COLORS.textDim;
      ctx.font = FONTS.small;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(on ? '格' : '步', on ? t.x + t.w * 0.28 : t.x + t.w * 0.72, t.y + t.h / 2);
    }
    ctx.restore();
  }
}

function backGeometry(layout: Layout): UiButton {
  const pad = Math.round(layout.width * 0.05);
  const size = Math.round(Math.min(40, Math.max(32, layout.width * 0.095)));
  return {
    id: 'back',
    label: '返回',
    x: pad,
    y: pad,
    w: Math.max(64, size * 1.7),
    h: size,
    secondary: true,
  };
}

/** 供宿主/测试引用：设置页清除的是这个 key */
export { SAVE_KEY };
