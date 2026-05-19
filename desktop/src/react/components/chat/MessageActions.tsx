// desktop/src/react/components/chat/MessageActions.tsx
import { memo, useCallback, useMemo } from 'react';
import { useStore } from '../../stores';
import { useI18n } from '../../hooks/use-i18n';
import { selectSelectedIdsBySession } from '../../stores/session-selectors';
import styles from './Chat.module.css';

interface Props {
  messageId: string;
  sessionPath: string;
  onCopy: () => void;
  onScreenshot: () => void;
  copied: boolean;
  isStreaming: boolean;
  align?: 'left' | 'right';
  canRevert?: boolean;
  onRevert?: () => void;
  reverting?: boolean;
}

export const MessageActions = memo(function MessageActions({
  messageId, sessionPath, onCopy, onScreenshot, copied, isStreaming, align = 'right',
  canRevert = false, onRevert, reverting = false,
}: Props) {
  const { t } = useI18n();
  const selectedIds = useStore(s => selectSelectedIdsBySession(s, sessionPath));
  const sessionItems = useStore(s => s.chatSessions[sessionPath]?.items);
  const isSelected = selectedIds.includes(messageId);
  const toggle = useStore(s => s.toggleMessageSelection);
  const setSelection = useStore(s => s.setMessageSelection);
  const selectableIds = useMemo(() => (
    (sessionItems || [])
      .filter(item => item.type === 'message')
      .map(item => item.data.id)
  ), [sessionItems]);
  const allSelected = selectableIds.length > 0 && selectableIds.every(id => selectedIds.includes(id));

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggle(sessionPath, messageId);
  }, [toggle, sessionPath, messageId]);

  const handleSelectAll = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setSelection(sessionPath, allSelected ? [] : selectableIds);
  }, [allSelected, selectableIds, setSelection, sessionPath]);

  return (
    <div
      className={`${styles.msgActions}${align === 'left' ? ` ${styles.msgActionsLeft}` : ''}${isSelected ? ` ${styles.msgActionsVisible}` : ''}`}
    >
      <div className={styles.msgActionsPopover}>
        <button
          className={`${styles.msgActionBtn}${copied ? ` ${styles.msgActionBtnCopied}` : ''}`}
          onClick={onCopy}
          title={t('common.copyText')}
          disabled={isStreaming}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {copied
              ? <polyline points="20 6 9 17 4 12" />
              : <>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </>
            }
          </svg>
        </button>
        {canRevert && onRevert && (
          <button
            className={`${styles.msgActionBtn} ${styles.msgActionBtnRevert}`}
            onClick={onRevert}
            title={t('chat.revertTurn')}
            disabled={isStreaming || reverting}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6" />
              <path d="M3 13a9 9 0 0 1 2.64-6.36A9 9 0 0 1 21 12" />
            </svg>
          </button>
        )}
        <button
          className={styles.msgActionBtn}
          onClick={onScreenshot}
          title={t('common.screenshot')}
          disabled={isStreaming}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
        <button
          className={`${styles.msgActionBtn}${allSelected ? ` ${styles.msgActionBtnActive}` : ''}`}
          onClick={handleSelectAll}
          title={t('common.selectAllMessages')}
          aria-pressed={allSelected}
          disabled={isStreaming}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 6h13" />
            <path d="M8 12h13" />
            <path d="M8 18h13" />
            <path d="m3 6 1 1 2-2" />
            <path d="m3 12 1 1 2-2" />
            <path d="m3 18 1 1 2-2" />
          </svg>
        </button>
      </div>
      <button
        className={`${styles.msgActionBtn}${isSelected ? ` ${styles.msgActionBtnActive}` : ''}`}
        onClick={handleToggle}
        title={t('common.selectMessage')}
        disabled={isStreaming}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {isSelected
            ? <>
                <rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor" opacity="0.15" />
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <polyline points="9 12 11.5 14.5 16 9" />
              </>
            : <rect x="3" y="3" width="18" height="18" rx="2" />
          }
        </svg>
      </button>
    </div>
  );
});
