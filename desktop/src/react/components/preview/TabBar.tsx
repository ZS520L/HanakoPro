import { useState } from 'react';
import { useStore } from '../../stores';
import { selectPreviewItems, selectOpenTabs, selectActiveTabId } from '../../stores/preview-slice';
import { closeTab, closePreview, setActiveTab, canSpawnViewer, spawnViewer } from '../../stores/preview-actions';
import type { PreviewItem } from '../../types';
import { ContextMenu, type ContextMenuItem } from '../../ui';
import styles from './TabBar.module.css';

interface TabContextMenuState {
  id: string;
  x: number;
  y: number;
}

export function TabBar() {
  const openTabs = useStore(selectOpenTabs);
  const activeTabId = useStore(selectActiveTabId);
  const previewItems = useStore(selectPreviewItems);
  const [ctxMenu, setCtxMenu] = useState<TabContextMenuState | null>(null);

  const getPreviewItem = (id: string): PreviewItem | undefined =>
    previewItems.find((item: PreviewItem) => item.id === id);

  const getTitle = (id: string): string => {
    const a = getPreviewItem(id);
    return a?.title ?? id;
  };

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    closeTab(id);
    const { openTabs: after } = useStore.getState();
    if (after.length === 0) closePreview();
  };

  const handleSetActive = (id: string) => {
    setActiveTab(id);
  };

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ id, x: e.clientX, y: e.clientY });
  };

  const ctxItems: ContextMenuItem[] = (() => {
    if (!ctxMenu) return [];
    const previewItem = getPreviewItem(ctxMenu.id);
    const supported = canSpawnViewer(previewItem ?? null);
    const t = window.t ?? ((p: string) => p);
    return [
      {
        label: supported
          ? t('preview.openInNewWindow')
          : t('preview.openInNewWindowUnsupported'),
        action: supported && previewItem ? () => spawnViewer(previewItem) : undefined,
      },
    ];
  })();

  return (
    <div className={styles.tabBar}>
      <div className={styles.tabList}>
        {openTabs.map(id => (
          <div
            key={id}
            className={`${styles.tab}${id === activeTabId ? ` ${styles.tabActive}` : ''}`}
            onClick={() => handleSetActive(id)}
            onContextMenu={(e) => handleContextMenu(e, id)}
          >
            <span className={styles.tabTitle}>{getTitle(id)}</span>
            <span className={styles.tabClose} onClick={e => handleCloseTab(e, id)}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </span>
          </div>
        ))}
      </div>
      <button className={styles.closePanel} title="Collapse" onClick={closePreview}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      {ctxMenu && (
        <ContextMenu
          items={ctxItems}
          position={{ x: ctxMenu.x, y: ctxMenu.y }}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </div>
  );
}
