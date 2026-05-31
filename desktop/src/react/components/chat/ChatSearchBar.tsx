/**
 * ChatSearchBar — 聊天消息搜索栏
 * 
 * 搜索策略：
 * 1. 遍历所有文本节点，找到包含搜索词的节点
 * 2. 将匹配的文本节点向上查找到最近的消息容器（messageGroup）
 * 3. 高亮整个消息容器，并滚动到视图
 */

import { memo, useRef, useEffect, useState, useCallback } from 'react';
import styles from './Chat.module.css';

interface Props {
  containerRef: React.RefObject<HTMLDivElement>;
  visible: boolean;
  onClose: () => void;
}

interface Match {
  element: HTMLElement;
  text: string;
}

export const ChatSearchBar = memo(function ChatSearchBar({
  containerRef,
  visible,
  onClose,
}: Props) {
  const [query, setQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matches, setMatches] = useState<Match[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastHighlightedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!visible) return;
    inputRef.current?.focus();
  }, [visible]);

  const findMessageGroup = useCallback((element: HTMLElement): HTMLElement | null => {
    let current: HTMLElement | null = element;
    while (current) {
      // 查找最近的 messageGroup 容器（支持多种 CSS 类名格式）
      const className = current.className;
      if (className) {
        // 支持 string 和 object 格式的 className
        const classStr = typeof className === 'string' ? className : Object.keys(className).join(' ');
        if (classStr.includes('messageGroup')) {
          return current;
        }
      }
      // 如果没找到 messageGroup，尝试找到 message 容器作为备选
      if (className && typeof className === 'string' && className.includes('message')) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }, []);

  const updateMatches = useCallback((searchQuery: string) => {
    if (!containerRef.current || !searchQuery.trim()) {
      setMatches([]);
      setCurrentIndex(0);
      return;
    }

    const container = containerRef.current;
    const query = searchQuery.toLowerCase();
    const foundMatches = new Map<HTMLElement, string>();

    // 获取容器的完整文本内容用于搜索
    const containerText = container.innerText.toLowerCase();
    
    // 如果容器文本中不包含搜索词，直接返回
    if (!containerText.includes(query)) {
      setMatches([]);
      setCurrentIndex(0);
      return;
    }

    // 策略 1：遍历所有文本节点
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      null
    );

    let node;
    const processedNodes = new Set<Node>();
    
    while (node = walker.nextNode()) {
      if (processedNodes.has(node)) continue;
      
      const text = node.textContent;
      if (!text || text.trim().length === 0) continue;

      const lowerText = text.toLowerCase();
      if (lowerText.includes(query)) {
        // 找到包含搜索词的最近的消息容器
        const messageGroup = findMessageGroup(node.parentElement!);
        if (messageGroup && !foundMatches.has(messageGroup)) {
          foundMatches.set(messageGroup, text);
          processedNodes.add(node);
        }
      }
    }

    // 策略 2：如果文本节点遍历没有找到，尝试直接搜索所有元素
    if (foundMatches.size === 0) {
      const allElements = container.querySelectorAll('*');
      for (const element of allElements) {
        if (element.textContent && element.textContent.toLowerCase().includes(query)) {
          const messageGroup = findMessageGroup(element as HTMLElement);
          if (messageGroup && !foundMatches.has(messageGroup)) {
            foundMatches.set(messageGroup, element.textContent);
          }
        }
      }
    }

    // 转换为数组，保持顺序（按 DOM 顺序）
    const matchArray: Match[] = Array.from(foundMatches.entries()).map(([element, text]) => ({
      element,
      text,
    }));

    setMatches(matchArray);
    setCurrentIndex(0);
  }, [containerRef, findMessageGroup]);

  useEffect(() => {
    updateMatches(query);
  }, [query, updateMatches]);

  useEffect(() => {
    if (matches.length === 0) {
      if (lastHighlightedRef.current) {
        lastHighlightedRef.current.classList.remove(styles.chatSearchActive);
        lastHighlightedRef.current = null;
      }
      return;
    }

    // 清除之前的高亮
    if (lastHighlightedRef.current) {
      lastHighlightedRef.current.classList.remove(styles.chatSearchActive);
    }

    // 高亮当前匹配
    if (currentIndex < matches.length) {
      const currentMatch = matches[currentIndex].element;
      currentMatch.classList.add(styles.chatSearchActive);
      lastHighlightedRef.current = currentMatch;
      
      // 滚动到视图中心
      currentMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentIndex, matches]);

  const handleNext = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  const handlePrev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  if (!visible) return null;

  return (
    <div className={styles.chatSearchBar}>
      <div className={styles.chatSearchInputWrap}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className={styles.chatSearchInput}
          placeholder="搜索消息..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.shiftKey) handlePrev();
              else handleNext();
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
        />
        {matches.length > 0 && (
          <span className={styles.chatSearchCount}>
            {currentIndex + 1} / {matches.length}
          </span>
        )}
      </div>
      <button
        className={styles.chatSearchBtn}
        onClick={handlePrev}
        disabled={matches.length === 0}
        title="上一个"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
      <button
        className={styles.chatSearchBtn}
        onClick={handleNext}
        disabled={matches.length === 0}
        title="下一个"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      <button
        className={styles.chatSearchBtn}
        onClick={onClose}
        title="关闭"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
});
