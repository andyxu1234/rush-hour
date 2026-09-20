/**
 * 隐私政策 —— docs/01 §6.1。
 *
 * 规格要求（原文）：「静态文本页」，并标注 **合规必需**，提审硬性要求。
 *
 * 实现取舍：
 *   - 文案**内置在代码里**（不拉网络）：提审时审核员可能处于无网/弱网环境，
 *     政策页加载失败是高频驳回项；且 `docs/01` §6.1 明确"首屏不拉网络"。
 *   - 分页而非滚动：小游戏触屏滚动会与棋盘手势冲突，且长文本滚动实现成本高。
 *     按段落分页，每页固定行数，实现简单且必定不会截断。
 *   - 文案只陈述**事实**：本项目当前不采集设备信息、不上报数据。
 *     等 P5 接入后端/埋点上报后，必须回来同步修订（否则就是虚假陈述）。
 *
 * ⚠️ 本文件属 render 层：禁止 window / document / wx。
 */

import type { CanvasRenderingContext2DLike, Platform, PointerEventLike } from '@rush-hour/platform';
import { COLORS, FONTS } from '../theme';
import { computeLayout, hitRect, type Layout } from '../layout';
import {
  drawHeader,
  drawPageBackground,
  drawText,
  drawUiButton,
  type UiButton,
} from '../ui';
import type { Screen, ScreenId } from './screen';

export interface PrivacyScreenDeps {
  platform: Platform;
  goBack(): void;
}

/**
 * 隐私政策正文（按段落分组，每组为一页）。
 *
 * ⚠️ 修订纪律：接入后端 / 上报埋点 / 接广告 SDK 时，本文件必须同步更新。
 * 当前表述对应"纯单机、不采集、不上报"的实现状态。
 */
export const PRIVACY_SECTIONS: ReadonlyArray<{ title: string; body: string[] }> = [
  {
    title: '一、我们收集什么',
    body: [
      '本游戏当前为单机版本，不收集任何个人信息。',
      '不获取你的微信昵称、头像、手机号或地理位置。',
      '不读取你的通讯录、相册、麦克风或摄像头。',
    ],
  },
  {
    title: '二、数据存放在哪里',
    body: [
      '游戏进度（关卡星级、最佳步数、设置项）仅保存在',
      '你的设备本地。删除游戏或清除本地存档后，',
      '这些数据将被永久删除且无法恢复。',
    ],
  },
  {
    title: '三、网络与第三方',
    body: [
      '当前版本不联网，不上传任何数据，',
      '也未接入任何第三方统计或广告 SDK。',
      '后续版本若接入，我们会先更新本政策并征求同意。',
    ],
  },
  {
    title: '四、未成年人保护',
    body: [
      '本游戏不含社交、内购与充值功能，',
      '适合全年龄段玩家。',
      '若监护人发现任何问题，可通过游戏内反馈渠道联系我们。',
    ],
  },
  {
    title: '五、联系我们',
    body: ['如对本政策有疑问，请通过小程序详情页的联系方式与我们沟通。'],
  },
];

export class PrivacyScreen implements Screen {
  readonly id: ScreenId = 'privacy';
  private layout: Layout;
  private readonly ctx: CanvasRenderingContext2DLike;
  private page = 0;
  private backBtn: UiButton | null = null;
  private prevBtn: UiButton | null = null;
  private nextBtn: UiButton | null = null;

  constructor(private readonly deps: PrivacyScreenDeps) {
    const s = deps.platform.screen();
    this.layout = computeLayout(s.width, s.height);
    this.ctx = deps.platform.createCanvas(1, 1).getContext('2d') as CanvasRenderingContext2DLike;
  }

  enter(): void {
    this.page = 0;
    this.rebuild();
  }

  exit(): void {
    /* 无订阅 */
  }

  onResize(): void {
    const s = this.deps.platform.screen();
    this.layout = computeLayout(s.width, s.height);
    this.rebuild();
  }

  update(): void {
    /* 静态文本页 */
  }

  onPointer(e: PointerEventLike): void {
    if (e.phase !== 'end') return;

    if (this.backBtn && hitRect([this.backBtn], e.x, e.y)) {
      this.deps.platform.audio.play('click');
      this.deps.goBack();
      return;
    }
    if (this.prevBtn && hitRect([this.prevBtn], e.x, e.y)) {
      if (this.page > 0) {
        this.page--;
        this.deps.platform.audio.play('click');
        this.rebuild();
      }
      return;
    }
    if (this.nextBtn && hitRect([this.nextBtn], e.x, e.y)) {
      if (this.page < PRIVACY_SECTIONS.length - 1) {
        this.page++;
        this.deps.platform.audio.play('click');
        this.rebuild();
      }
    }
  }

  // ---------------------------------------------------------------- 查询（e2e）

  get currentPage(): number {
    return this.page;
  }

  get pageCount(): number {
    return PRIVACY_SECTIONS.length;
  }

  get currentSection(): { title: string; body: string[] } {
    return PRIVACY_SECTIONS[this.page];
  }

  get navRects(): { prev: UiButton | null; next: UiButton | null; back: UiButton | null } {
    return { prev: this.prevBtn, next: this.nextBtn, back: this.backBtn };
  }

  setPage(p: number): void {
    this.page = Math.max(0, Math.min(PRIVACY_SECTIONS.length - 1, p));
    this.rebuild();
  }

  private rebuild(): void {
    const box = contentBox(this.layout);
    const navH = Math.max(40, Math.round(this.layout.height * 0.06));
    const bw = Math.max(80, Math.round(box.w * 0.3));
    const navY = this.layout.height - navH - Math.round(this.layout.height * 0.055);

    this.prevBtn = {
      id: 'prev',
      label: '上一节',
      x: box.x,
      y: navY,
      w: bw,
      h: navH,
      secondary: true,
      disabled: this.page <= 0,
    };
    this.nextBtn = {
      id: 'next',
      label: '下一节',
      x: box.x + box.w - bw,
      y: navY,
      w: bw,
      h: navH,
      secondary: true,
      disabled: this.page >= PRIVACY_SECTIONS.length - 1,
    };
    this.backBtn = backGeometry(this.layout);
  }

  render(): void {
    const ctx = this.ctx;
    const layout = this.layout;
    drawPageBackground(ctx, layout);

    const header = drawHeader(ctx, layout, '隐私政策');
    this.backBtn = header.back;

    const section = PRIVACY_SECTIONS[this.page];
    const box = contentBox(layout);

    // 小标题
    drawText(ctx, section.title, box.x, box.y + Math.round(layout.height * 0.012), {
      font: FONTS.hud,
    });

    // 正文（逐行，行距按屏高比例，保证不同机型都不拥挤）
    const lineH = Math.round(layout.height * 0.032);
    let y = box.y + Math.round(layout.height * 0.055);
    for (const line of section.body) {
      drawText(ctx, line, box.x, y, { font: FONTS.small, color: COLORS.text });
      y += lineH;
    }

    if (this.prevBtn) drawUiButton(ctx, this.prevBtn);
    if (this.nextBtn) drawUiButton(ctx, this.nextBtn);

    drawText(
      ctx,
      `${this.page + 1} / ${PRIVACY_SECTIONS.length}`,
      layout.width / 2,
      this.prevBtn ? this.prevBtn.y + this.prevBtn.h / 2 : layout.height * 0.9,
      { font: FONTS.small, color: COLORS.textDim, align: 'center' },
    );
  }
}

function contentBox(layout: Layout): { x: number; y: number; w: number; h: number } {
  const pad = Math.round(layout.width * 0.06);
  const top = Math.round(layout.height * 0.2);
  return {
    x: pad,
    y: top,
    w: layout.width - pad * 2,
    h: layout.height - top - Math.round(layout.height * 0.13),
  };
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
