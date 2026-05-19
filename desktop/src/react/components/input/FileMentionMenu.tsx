import { memo, useEffect, useRef } from 'react';
import type { FileMentionItem } from '../../utils/file-mention-items';
import styles from './InputArea.module.css';

export const FileMentionMenu = memo(function FileMentionMenu({
  items,
  selected,
  busy,
  onSelect,
  onHover,
}: {
  items: FileMentionItem[];
  selected: number;
  busy: boolean;
  onSelect: (item: FileMentionItem) => void;
  onHover: (index: number) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div className={styles['file-mention-menu']}>
      {items.map((item, i) => (
        <button
          key={item.id}
          ref={i === selected ? selectedRef : undefined}
          className={`${styles['file-mention-item']}${i === selected ? ` ${styles.selected}` : ''}`}
          onMouseEnter={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(item);
          }}
        >
          <span className={styles['file-mention-icon']} aria-hidden="true">
            {item.isDirectory ? <FolderIcon /> : <FileIcon />}
          </span>
          <span className={styles['file-mention-main']}>
            <span className={styles['file-mention-name']}>{item.name}</span>
            <span className={styles['file-mention-detail']}>{item.detail || item.path}</span>
          </span>
        </button>
      ))}
      {items.length === 0 && busy && <div className={styles['file-mention-empty']}>...</div>}
    </div>
  );
});

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round">
      <path d="M4 1.8h5.2L12 4.7v9.5H4z M9.2 1.8v3h2.8" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round">
      <path d="M1.8 4.3h4.4l1.3 1.4h6.7v6.6a1.1 1.1 0 0 1-1.1 1.1H2.9a1.1 1.1 0 0 1-1.1-1.1z" />
    </svg>
  );
}
