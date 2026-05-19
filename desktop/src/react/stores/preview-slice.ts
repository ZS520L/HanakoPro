import type { PreviewItem } from '../types';

// ── Types ──

/**
 * 派生 viewer 窗口（"在新窗口查看"）的元信息。
 *
 * 每个 viewer 是主面板当前 tab 的只读副本，派生后两侧互不通信（viewer 自己
 * watchFile 做 live reload，但不与主面板 preview 互通、不回写文件）。
 */
export interface PinnedViewer {
  /** Electron BrowserWindow.id，唯一稳定标识 */
  windowId: number;
  filePath: string;
  title: string;
}

// ── Slice ──

export interface PreviewSlice {
  /** 全局 preview item 池（user-level），所有 session 共享 */
  previewItems: PreviewItem[];
  /** 当前可见 workspace 打开的 tab id 列表 */
  openTabs: string[];
  /** 当前可见 workspace 激活的 tab id */
  activeTabId: string | null;
  /** 当前派生出的只读 viewer 窗口（按 windowId keyed） */
  pinnedViewers: PinnedViewer[];
  /** 临时 Markdown 阅读预览状态，按 preview item id keyed */
  markdownPreviewIds: string[];
  addPinnedViewer: (viewer: PinnedViewer) => void;
  removePinnedViewer: (windowId: number) => void;
  clearPinnedViewers: () => void;
  setMarkdownPreviewActive: (id: string, active: boolean) => void;
}

export const createPreviewSlice = (
  set: (partial: Partial<PreviewSlice> | ((s: PreviewSlice) => Partial<PreviewSlice>)) => void
): PreviewSlice => ({
  previewItems: [],
  openTabs: [],
  activeTabId: null,
  pinnedViewers: [],
  markdownPreviewIds: [],
  addPinnedViewer: (viewer) =>
    set((s) => {
      // 防重：同 windowId 存在则跳过（理论上 Electron 不会复用 id）
      if (s.pinnedViewers.some((v) => v.windowId === viewer.windowId)) return {};
      return { pinnedViewers: [...s.pinnedViewers, viewer] };
    }),
  removePinnedViewer: (windowId) =>
    set((s) => ({ pinnedViewers: s.pinnedViewers.filter((v) => v.windowId !== windowId) })),
  clearPinnedViewers: () => set({ pinnedViewers: [] }),
  setMarkdownPreviewActive: (id, active) =>
    set((s) => {
      const current = new Set(s.markdownPreviewIds);
      if (active) current.add(id);
      else current.delete(id);
      return { markdownPreviewIds: [...current] };
    }),
});

// ── Selectors ──

export const selectPreviewItems = (s: PreviewSlice): PreviewItem[] => s.previewItems;
export const selectOpenTabs = (s: PreviewSlice): string[] => s.openTabs;
export const selectActiveTabId = (s: PreviewSlice): string | null => s.activeTabId;
export const selectPinnedViewers = (s: PreviewSlice): PinnedViewer[] => s.pinnedViewers;
export const selectMarkdownPreviewIds = (s: PreviewSlice): string[] => s.markdownPreviewIds;
