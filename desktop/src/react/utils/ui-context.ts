/**
 * UI Context 收集器
 *
 * 每次发 WS prompt 前调用一次，把用户当下视野（浏览目录 / 预览焦点 /
 * 派生 viewer 钉住的文件）拼成后端约定的 uiContext payload。
 *
 * 后端保存这份 payload，供 current_status 工具的 ui_context key 按需查询。
 *
 * 所有字段都空时返回 null，节省 WS 传输；后端收到 null 会清空旧值。
 */

import type { StoreState } from '../stores';
import type { PreviewItem } from '../types';

export interface UiContextPayload {
  currentViewed: string | null;
  activeFile: string | null;
  activePreview: string | null;
  pinnedFiles: string[];
}

export function collectUiContext(state: StoreState): UiContextPayload | null {
  const currentViewed = state.deskCurrentPath || null;

  const activeTab: PreviewItem | undefined = state.previewItems.find(
    (a: PreviewItem) => a.id === state.activeTabId,
  );
  const activeFile = activeTab?.filePath ?? null;
  const activePreview =
    activeTab && !activeTab.filePath ? activeTab.title : null;

  const pinnedFiles = state.pinnedViewers.map((v) => v.filePath);

  if (
    !currentViewed &&
    !activeFile &&
    !activePreview &&
    pinnedFiles.length === 0
  ) {
    return null;
  }

  return { currentViewed, activeFile, activePreview, pinnedFiles };
}
