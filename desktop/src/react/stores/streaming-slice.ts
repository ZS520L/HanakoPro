export interface StreamingSlice {
  /** 所有正在 streaming 的 session path 集合（单一事实源） */
  streamingSessions: string[];
  addStreamingSession: (path: string) => void;
  removeStreamingSession: (path: string) => void;
  /** 按 session path 存储的内联错误（权威源）。text 为 null 表示无 error。 */
  inlineErrors: Record<string, string | null>;
  /** 写入某个 session 的 inline error；ttl>0 时 ttl 毫秒后自动清除（默认 5s）。新 error 覆盖旧 error 会取消旧定时器。 */
  setInlineError: (path: string, text: string, ttlMs?: number) => void;
  /** 清除某个 session 的 inline error（同时取消其定时器）。 */
  clearInlineError: (path: string) => void;
  /** 模型切换进行中（阻止发送） */
  modelSwitching: boolean;
  setModelSwitching: (v: boolean) => void;
}

// 定时器按 sessionPath 存在模块闭包里，不污染 store 的可见状态。
// 生命周期规则：
//   - setInlineError 覆盖写入时，先 clear 旧 timer 再起新的，避免"旧 timer 误清新 text"竞态
//   - clearInlineError 清状态时同步 clear timer，防 timer 在 null 写入后继续 fire
//   - timer 回调内部用 get() 取最新 text：若已被新 error 覆盖，get().inlineErrors[sp] 不等于本次写入的 text，不动它
const inlineErrorTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelTimer(path: string): void {
  const t = inlineErrorTimers.get(path);
  if (t) {
    clearTimeout(t);
    inlineErrorTimers.delete(path);
  }
}

export const createStreamingSlice = (
  set: (partial: Partial<StreamingSlice> | ((s: StreamingSlice) => Partial<StreamingSlice>)) => void,
  get?: () => StreamingSlice,
): StreamingSlice => ({
  streamingSessions: [],
  addStreamingSession: (path) => set((s) => ({
    streamingSessions: s.streamingSessions.includes(path)
      ? s.streamingSessions
      : [...s.streamingSessions, path],
  })),
  removeStreamingSession: (path) => set((s) => ({
    streamingSessions: s.streamingSessions.filter(p => p !== path),
  })),
  inlineErrors: {},
  setInlineError: (path, text, ttlMs = 5000) => {
    cancelTimer(path);
    set((s) => ({ inlineErrors: { ...s.inlineErrors, [path]: text } }));
    if (ttlMs > 0) {
      const timer = setTimeout(() => {
        inlineErrorTimers.delete(path);
        const current = get?.().inlineErrors[path];
        if (current !== text) return;
        set((s) => ({ inlineErrors: { ...s.inlineErrors, [path]: null } }));
      }, ttlMs);
      inlineErrorTimers.set(path, timer);
    }
  },
  clearInlineError: (path) => {
    cancelTimer(path);
    set((s) => ({ inlineErrors: { ...s.inlineErrors, [path]: null } }));
  },
  modelSwitching: false,
  setModelSwitching: (v) => set({ modelSwitching: v }),
});
