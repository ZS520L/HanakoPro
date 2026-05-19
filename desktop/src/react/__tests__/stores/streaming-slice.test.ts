import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createStreamingSlice, type StreamingSlice } from '../../stores/streaming-slice';

function makeSlice(): StreamingSlice {
  let state: StreamingSlice;
  const set = (partial: Partial<StreamingSlice> | ((s: StreamingSlice) => Partial<StreamingSlice>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  const get = () => state;
  state = createStreamingSlice(set, get);
  return new Proxy({} as StreamingSlice, {
    get: (_, key: string) => (state as unknown as Record<string, unknown>)[key],
  });
}

describe('streaming-slice', () => {
  let slice: StreamingSlice;

  beforeEach(() => {
    slice = makeSlice();
  });

  it('初始状态', () => {
    expect(slice.streamingSessions).toEqual([]);
    expect(slice.inlineErrors).toEqual({});
  });

  it('addStreamingSession 添加 path', () => {
    slice.addStreamingSession('/s1');
    expect(slice.streamingSessions).toEqual(['/s1']);
  });

  it('addStreamingSession 去重', () => {
    slice.addStreamingSession('/s1');
    slice.addStreamingSession('/s1');
    expect(slice.streamingSessions).toEqual(['/s1']);
  });

  it('addStreamingSession 多个不同 path', () => {
    slice.addStreamingSession('/s1');
    slice.addStreamingSession('/s2');
    expect(slice.streamingSessions).toEqual(['/s1', '/s2']);
  });

  it('removeStreamingSession 移除指定 path', () => {
    slice.addStreamingSession('/s1');
    slice.addStreamingSession('/s2');
    slice.removeStreamingSession('/s1');
    expect(slice.streamingSessions).toEqual(['/s2']);
  });

  it('removeStreamingSession 对不存在的 path 无影响', () => {
    slice.addStreamingSession('/s1');
    slice.removeStreamingSession('/x');
    expect(slice.streamingSessions).toEqual(['/s1']);
  });
});

describe('streaming-slice · inlineError TTL', () => {
  let slice: StreamingSlice;

  beforeEach(() => {
    vi.useFakeTimers();
    slice = makeSlice();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('setInlineError 写入文本', () => {
    slice.setInlineError('/s1', 'boom');
    expect(slice.inlineErrors['/s1']).toBe('boom');
  });

  it('默认 5s 后自动清除', () => {
    slice.setInlineError('/s1', 'boom');
    expect(slice.inlineErrors['/s1']).toBe('boom');
    vi.advanceTimersByTime(4999);
    expect(slice.inlineErrors['/s1']).toBe('boom');
    vi.advanceTimersByTime(1);
    expect(slice.inlineErrors['/s1']).toBeNull();
  });

  it('自定义 ttl 生效', () => {
    slice.setInlineError('/s1', 'boom', 1000);
    vi.advanceTimersByTime(999);
    expect(slice.inlineErrors['/s1']).toBe('boom');
    vi.advanceTimersByTime(1);
    expect(slice.inlineErrors['/s1']).toBeNull();
  });

  it('ttl=0 时不自动清除（永久 error）', () => {
    slice.setInlineError('/s1', 'critical', 0);
    vi.advanceTimersByTime(60000);
    expect(slice.inlineErrors['/s1']).toBe('critical');
  });

  it('新 error 覆盖旧 error 时取消旧定时器，不会误清新 error', () => {
    slice.setInlineError('/s1', 'old', 5000);
    vi.advanceTimersByTime(3000);
    slice.setInlineError('/s1', 'new', 5000);
    // 原旧定时器到期时间点到了，新 error 不应该被清
    vi.advanceTimersByTime(2000);
    expect(slice.inlineErrors['/s1']).toBe('new');
    // 从新 error 写入算起 5s 后，才清除
    vi.advanceTimersByTime(3000);
    expect(slice.inlineErrors['/s1']).toBeNull();
  });

  it('clearInlineError 立刻清除并取消定时器', () => {
    slice.setInlineError('/s1', 'boom');
    slice.clearInlineError('/s1');
    expect(slice.inlineErrors['/s1']).toBeNull();
    // 确认定时器已取消，后续推进也不会误写
    slice.setInlineError('/s1', 'fresh', 0); // 防 timer 污染
    vi.advanceTimersByTime(10000);
    expect(slice.inlineErrors['/s1']).toBe('fresh');
  });

  it('多 session 独立管理', () => {
    slice.setInlineError('/s1', 'e1', 3000);
    slice.setInlineError('/s2', 'e2', 5000);
    vi.advanceTimersByTime(3000);
    expect(slice.inlineErrors['/s1']).toBeNull();
    expect(slice.inlineErrors['/s2']).toBe('e2');
    vi.advanceTimersByTime(2000);
    expect(slice.inlineErrors['/s2']).toBeNull();
  });
});
