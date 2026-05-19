import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import styles from './Chat.module.css';

interface FileOutputActionsProps {
  filePath: string;
  displayName: string;
}

function actionLabel(label: string, displayName: string): string {
  return `${label} ${displayName}`;
}

function OpenIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function RevealIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="14" r="2.5" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function FileOutputActions({ filePath, displayName }: FileOutputActionsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openLabel = window.t('desk.openWithDefault');
  const moreLabel = window.t('chat.fileActions.more');
  const revealLabel = window.t('chat.fileActions.revealInFinder');
  const copyLabel = window.t('chat.fileActions.copyPath');

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const handleOpen = useCallback((event: ReactMouseEvent) => {
    event.stopPropagation();
    window.platform?.openFile?.(filePath);
  }, [filePath]);

  const handleToggleMenu = useCallback((event: ReactMouseEvent) => {
    event.stopPropagation();
    setMenuOpen(open => !open);
  }, []);

  const revealFile = useCallback(() => {
    window.platform?.showInFinder?.(filePath);
  }, [filePath]);

  const copyPath = useCallback(() => {
    navigator.clipboard?.writeText?.(filePath).catch(() => {});
  }, [filePath]);

  const handleMenuItem = useCallback((event: ReactMouseEvent, action: () => void) => {
    event.stopPropagation();
    closeMenu();
    action();
  }, [closeMenu]);

  useEffect(() => {
    if (!menuOpen || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuWidth = 168;
    const left = Math.min(
      Math.max(8, rect.right - menuWidth),
      Math.max(8, window.innerWidth - menuWidth - 8),
    );
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left,
      width: menuWidth,
      zIndex: 9999,
    });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    const handleScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };

    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [closeMenu, menuOpen]);

  return (
    <div className={styles.fileOutputActions} data-file-output-actions="">
      <button
        type="button"
        className={`${styles.fileOutputActionButton} ${styles.fileOutputActionPrimary}`}
        onClick={handleOpen}
        aria-label={actionLabel(openLabel, displayName)}
        title={openLabel}
      >
        <OpenIcon />
      </button>
      <button
        type="button"
        ref={triggerRef}
        className={`${styles.fileOutputActionButton} ${styles.fileOutputActionMenuButton}`}
        onClick={handleToggleMenu}
        aria-label={actionLabel(moreLabel, displayName)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={moreLabel}
      >
        <ChevronDownIcon />
      </button>
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className={styles.fileOutputActionMenu}
          style={menuStyle}
          role="menu"
        >
          <button
            type="button"
            className={styles.fileOutputActionMenuItem}
            role="menuitem"
            onClick={(event) => handleMenuItem(event, revealFile)}
          >
            <RevealIcon />
            <span>{revealLabel}</span>
          </button>
          <button
            type="button"
            className={styles.fileOutputActionMenuItem}
            role="menuitem"
            onClick={(event) => handleMenuItem(event, copyPath)}
          >
            <CopyIcon />
            <span>{copyLabel}</span>
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
