/**
 * PreviewPanel — PreviewItem 预览/编辑面板
 *
 * 从 Zustand store 读取 previewItem 内容池，以及当前 workspace 恢复出的 activeTabId / previewOpen 状态。
 * 可编辑类型（有 filePath 的 markdown/code/csv）使用 CodeMirror 编辑器。
 *
 * 架构原则：
 * - 文件系统是 source of truth，编辑器直接对接文件
 * - PreviewItem content 仅作为前端视图快照，给复制/临时渲染预览使用
 * - 独立窗口由下阶段的 viewer spawn 机制负责（单向只读副本），本面板不做 detach/dock
 */

import { useCallback, useEffect } from 'react';
import { useStore } from '../stores';
import { selectPreviewItems, selectActiveTabId, selectMarkdownPreviewIds } from '../stores/preview-slice';
import { setMarkdownPreviewActive, upsertPreviewItem } from '../stores/preview-actions';
import { PreviewEditor } from './PreviewEditor';
import { PreviewRenderer } from './preview/PreviewRenderer';
import { TabBar } from './preview/TabBar';
import { FloatingActions } from './preview/FloatingActions';
import { captureSelection, clearSelection } from '../stores/selection-actions';
import type { PreviewItem } from '../types';
import previewStyles from './Preview.module.css';

const EDITABLE_TYPES = new Set(['markdown', 'code', 'csv']);

function isEditable(previewItem: PreviewItem | null): boolean {
  if (!previewItem) return false;
  return !!previewItem.filePath && EDITABLE_TYPES.has(previewItem.type);
}

function isMarkdownFile(previewItem: PreviewItem | null): boolean {
  return !!previewItem?.filePath && previewItem.type === 'markdown';
}

function getEditorMode(previewItem: PreviewItem): 'markdown' | 'code' | 'csv' | 'text' {
  if (previewItem.type === 'markdown') return 'markdown';
  if (previewItem.type === 'csv') return 'csv';
  return 'code';
}

export function PreviewPanel() {
  const previewOpen = useStore(s => s.previewOpen);
  const activeTabId = useStore(selectActiveTabId);
  const previewItems = useStore(selectPreviewItems);
  const markdownPreviewIds = useStore(selectMarkdownPreviewIds);

  const previewItem = previewItems.find(a => a.id === activeTabId) ?? null;
  const markdownPreviewActive = !!previewItem && markdownPreviewIds.includes(previewItem.id);
  const editable = isEditable(previewItem) && !markdownPreviewActive;

  const handleToggleMarkdownPreview = useCallback(() => {
    if (!previewItem || !isMarkdownFile(previewItem)) return;
    setMarkdownPreviewActive(previewItem.id, !markdownPreviewActive);
  }, [previewItem, markdownPreviewActive]);

  const handleEditorContentChange = useCallback((content: string, fileVersion?: PreviewItem['fileVersion']) => {
    if (!previewItem) return;
    upsertPreviewItem({
      ...previewItem,
      content,
      fileVersion: fileVersion === undefined ? previewItem.fileVersion : fileVersion,
    });
  }, [previewItem]);

  // DOM 模式选区捕获（非编辑模式下 mouseup 时检测选中文本）
  const handleMouseUp = useCallback(() => {
    if (!previewItem || editable) return;
    captureSelection(previewItem);
  }, [previewItem, editable]);

  // 切换 tab 时清除选区
  useEffect(() => {
    clearSelection();
  }, [activeTabId]);

  return (
    <div className={`${previewStyles.previewPanel}${previewOpen ? '' : ` ${previewStyles.previewPanelCollapsed}`}`} id="previewPanel">
      <div className="resize-handle resize-handle-left" id="previewResizeHandle"></div>
      <div className={previewStyles.previewPanelInner}>
        <TabBar />
        <div className={previewStyles.previewBodyShell}>
          {previewOpen && previewItem && (
            <FloatingActions
              content={previewItem.content}
              showMarkdownPreviewToggle={isMarkdownFile(previewItem)}
              markdownPreviewActive={markdownPreviewActive}
              onToggleMarkdownPreview={handleToggleMarkdownPreview}
            />
          )}
          <div className={previewStyles.previewPanelBody} id="previewBody" onMouseUp={handleMouseUp}>
            {previewOpen && previewItem && !editable && (
              <PreviewRenderer previewItem={previewItem} />
            )}
            {previewOpen && previewItem && editable && (
              <PreviewEditor
                content={previewItem.content}
                filePath={previewItem.filePath}
                fileVersion={previewItem.fileVersion}
                mode={getEditorMode(previewItem)}
                language={previewItem.language}
                onSelectionChange={(view) => {
                  if (previewItem) captureSelection(previewItem, view);
                }}
                onContentChange={handleEditorContentChange}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
