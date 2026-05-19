import { NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import styles from './FileBadgeView.module.css';

export function FileBadgeView({ node }: NodeViewProps) {
  const name = (node.attrs.name || node.attrs.path || '') as string;
  const isDirectory = node.attrs.isDirectory === true;

  return (
    <NodeViewWrapper as="span" className={styles.badge}>
      <svg className={styles.icon} width="13" height="13" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round">
        {isDirectory ? (
          <path d="M1.8 4.3h4.4l1.3 1.4h6.7v6.6a1.1 1.1 0 0 1-1.1 1.1H2.9a1.1 1.1 0 0 1-1.1-1.1z" />
        ) : (
          <path d="M4 1.8h5.2L12 4.7v9.5H4z M9.2 1.8v3h2.8" />
        )}
      </svg>
      <span className={styles.name}>{name}</span>
    </NodeViewWrapper>
  );
}
