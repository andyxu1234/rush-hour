import { describe, expect, it } from 'vitest';
import { Analytics } from '../src/analytics';

/**
 * 埋点是"采集层"，没有业务逻辑，但有两个容易被忽略的约束必须守住：
 *   1. 容量上限：埋点绝不能导致内存无限增长；
 *   2. 时间戳可注入：否则测试只能断言"存在"，无法断言顺序与时机。
 */
describe('Analytics 事件采集', () => {
  it('记录事件并保留传入的属性', () => {
    const a = new Analytics({ now: () => 1000 });
    a.track('move', { piece: 'a', cells: 2 });
    expect(a.size).toBe(1);
    expect(a.peek()[0]).toEqual({
      name: 'move',
      props: { piece: 'a', cells: 2 },
      at: 1000,
    });
  });

  it('不传属性时默认为空对象（避免下游 undefined 判空）', () => {
    const a = new Analytics();
    a.track('screen_view');
    expect(a.peek()[0].props).toEqual({});
  });

  it('环形缓冲：超出容量时丢弃最旧事件，并计数丢弃量', () => {
    const a = new Analytics({ capacity: 3 });
    for (let i = 0; i < 5; i++) a.track('move', { i });
    expect(a.size).toBe(3);
    // 保留的是最近 3 条
    expect(a.peek().map((e) => e.props.i)).toEqual([2, 3, 4]);
    expect(a.droppedCount).toBe(2);
  });

  it('capacity 为 0 或负数时至少保留 1 条（防止把埋点写成彻底失效）', () => {
    const a = new Analytics({ capacity: 0 });
    a.track('move');
    expect(a.size).toBe(1);
  });

  it('peek 不消费事件；drain 取出并清空', () => {
    const a = new Analytics();
    a.track('move');
    a.track('undo');

    const peeked = a.peek();
    expect(peeked).toHaveLength(2);
    expect(a.size).toBe(2);

    const drained = a.drain();
    expect(drained).toHaveLength(2);
    expect(a.size).toBe(0);
    // drain 返回的是同一个数组引用（零拷贝）；再次 drain 应为空
    expect(a.drain()).toHaveLength(0);
  });

  it('countOf 统计指定事件出现次数', () => {
    const a = new Analytics();
    a.track('move');
    a.track('move');
    a.track('undo');
    expect(a.countOf('move')).toBe(2);
    expect(a.countOf('undo')).toBe(1);
    expect(a.countOf('blocked')).toBe(0);
  });

  it('clear 同时清空事件与丢弃计数', () => {
    const a = new Analytics({ capacity: 1 });
    a.track('move');
    a.track('move');
    expect(a.droppedCount).toBe(1);
    a.clear();
    expect(a.size).toBe(0);
    expect(a.droppedCount).toBe(0);
  });

  it('时间戳按事件顺序递增（由注入的时钟决定，便于断言时序）', () => {
    let t = 100;
    const a = new Analytics({ now: () => (t += 10) });
    a.track('move');
    a.track('undo');
    expect(a.peek().map((e) => e.at)).toEqual([110, 120]);
  });
});
