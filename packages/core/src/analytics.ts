/**
 * 埋点 —— docs/05 P4「埋点体系」。
 *
 * 设计取舍（重要）：
 *   - 本轮（P4）**没有后端**，因此这里只做"采集 + 本地环形缓冲"，绝不发网络。
 *     P5 接入时在宿主层增加一次 drain() 上报即可，core 零改动。
 *   - 采样与上报策略（批量、失败重试、去重）属宿主职责，不在本层。
 *   - 事件名用**闭集联合类型**而非 string：拼错事件名会在编译期暴露，
 *     这比运行时发现"某事件从未上报"便宜得多。
 *
 * 体积约束：环形缓冲固定容量，超出后丢弃最旧事件 —— 埋点绝不能导致内存增长。
 */

/** 全部允许上报的事件名（闭集） */
export type AnalyticsEventName =
  // 屏幕
  | 'screen_view'
  // 通用交互
  | 'button_click'
  // 对局（GameScreen 的六类内核事件直接映射）
  | 'level_start'
  | 'level_quit'
  | 'move'
  | 'blocked'
  | 'undo'
  | 'redo'
  | 'reset'
  | 'hint_used'
  // 结算
  | 'level_clear'
  | 'share_click'
  // 留存类入口
  | 'daily_open'
  | 'leaderboard_open'
  | 'settings_open'
  | 'privacy_open';

export interface AnalyticsEvent {
  name: AnalyticsEventName;
  /** 事件属性（保持扁平，避免深层对象导致的序列化成本） */
  props: Record<string, string | number | boolean>;
  /** 时间戳（ms）。由调用方注入，便于测试确定性 */
  at: number;
}

export interface AnalyticsOptions {
  /** 环形缓冲容量。默认 200 —— 够覆盖一次会话的排查需求 */
  capacity?: number;
  /** 时间源注入（测试用）；默认 Date.now */
  now?: () => number;
}

/**
 * 事件收集器。
 *
 * 刻意不做"自动上报"与"全局单例"：
 *   - 自动上报会让 GUI 卡顿与网络耦合，且测试不可控；
 *   - 全局单例会破坏 core 的纯函数定位（且 H5/小游戏双端共享时会串数据）。
 * 由宿主持有实例并显式传入各屏幕。
 */
export class Analytics {
  private readonly capacity: number;
  private readonly nowFn: () => number;
  private buf: AnalyticsEvent[] = [];
  /** 因容量溢出而被丢弃的事件总数（用于发现"容量估小了"） */
  private dropped = 0;

  constructor(opts: AnalyticsOptions = {}) {
    this.capacity = Math.max(1, Math.floor(opts.capacity ?? 200));
    this.nowFn = opts.now ?? (() => Date.now());
  }

  /** 记录一个事件。容量满时丢弃**最旧**的一条（保留最近行为更有排查价值） */
  track(name: AnalyticsEventName, props: Record<string, string | number | boolean> = {}): void {
    this.buf.push({ name, props, at: this.nowFn() });
    while (this.buf.length > this.capacity) {
      this.buf.shift();
      this.dropped++;
    }
  }

  /** 取出全部事件（不清空）。用于 e2e 断言与调试台 */
  peek(): readonly AnalyticsEvent[] {
    return this.buf;
  }

  /** 取出并清空（宿主上报时调用） */
  drain(): AnalyticsEvent[] {
    const out = this.buf;
    this.buf = [];
    return out;
  }

  get size(): number {
    return this.buf.length;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  clear(): void {
    this.buf = [];
    this.dropped = 0;
  }

  /** 某个事件出现次数（e2e 断言常用） */
  countOf(name: AnalyticsEventName): number {
    let n = 0;
    for (const e of this.buf) if (e.name === name) n++;
    return n;
  }
}
