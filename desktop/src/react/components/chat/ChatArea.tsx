/**
 * ChatArea — 聊天消息列表（干净重写版）
 *
 * 原理：每个 session 一个原生滚动 div，visibility:hidden 保持 scrollTop。
 * 不用 Virtuoso，不用 Activity，不用快照，不用任何花活。
 */

import { memo, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useStore } from '../../stores';
import { loadMoreMessages } from '../../stores/session-actions';
import { useContinuousBottomScroll } from '../../hooks/use-continuous-bottom-scroll';

const EMPTY_ITEMS: ChatListItem[] = [];
import type { ChatListItem } from '../../stores/chat-types';
import { ChatTranscript } from './ChatTranscript';
import { ChatTimelineNavigator } from './ChatTimelineNavigator';
import { buildTimelineAnchors } from './timeline-anchors';
import styles from './Chat.module.css';

const MAX_ALIVE = 5;
const LOAD_MORE_THRESHOLD = 200; // 距顶部多少 px 触发加载

// ── 入口 ──

export function ChatArea() {
  return (
    <>
      <PanelHost />
      <ScrollToBottomBtn />
    </>
  );
}

// ── PanelHost：管理 alive 列表 ──

function PanelHost() {
  const currentPath = useStore(s => s.currentSessionPath);
  const currentHasItems = useStore(s => !!(currentPath && s.chatSessions[currentPath]?.items?.length));
  const welcomeVisible = useStore(s => s.welcomeVisible);
  const [alive, setAlive] = useState<string[]>([]);

  // 加入 alive 列表（不重排已有位置，避免 React 移动 DOM 节点导致 scrollTop 丢失）
  useEffect(() => {
    if (!currentPath || !currentHasItems) return;
    setAlive(prev => {
      if (prev.includes(currentPath)) return prev; // 已存在，不动
      if (prev.length >= MAX_ALIVE) {
        // 淘汰第一个非当前的
        const evictIdx = prev.findIndex(p => p !== currentPath);
        const next = [...prev];
        next.splice(evictIdx, 1);
        next.push(currentPath);
        return next;
      }
      return [...prev, currentPath];
    });
  }, [currentPath, currentHasItems]);

  if (welcomeVisible || !currentPath) return null;

  return (
    <>
      {alive.map(path => (
        <Panel key={path} path={path} active={path === currentPath} />
      ))}
    </>
  );
}

// ── Panel：一个 session 的原生滚动容器 ──

const SCROLL_THRESHOLD = 50;

const Panel = memo(function Panel({ path, active }: { path: string; active: boolean }) {
  const items = useStore(s => s.chatSessions[path]?.items || EMPTY_ITEMS);
  const hasMore = useStore(s => s.chatSessions[path]?.hasMore ?? false);
  const loadingMore = useStore(s => s.chatSessions[path]?.loadingMore ?? false);
  const isSessionStreaming = useStore(s => s.streamingSessions.includes(path));
  const sessionAgentId = useStore(s => s.sessions.find(se => se.path === path)?.agentId ?? null);
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const messageElementsRef = useRef(new Map<string, HTMLDivElement>());
  const bottomScroll = useContinuousBottomScroll({
    scrollRef: ref,
    contentRef,
    active,
    stickyThreshold: SCROLL_THRESHOLD,
  });
  const timelineAnchors = useMemo(() => buildTimelineAnchors(items), [items]);
  const registerMessageElement = useCallback((messageId: string, element: HTMLDivElement | null) => {
    if (element) {
      messageElementsRef.current.set(messageId, element);
    } else {
      messageElementsRef.current.delete(messageId);
    }
  }, []);

  // scroll 事件维护 sticky 标志 + 上滑加载更多 + 滚动中显现 scrollbar
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      const sticky = bottomScroll.checkSticky();
      if (active) setScrollButton(el, !sticky, () => {
        bottomScroll.scrollToBottom({ mode: 'follow', forceSticky: true });
      });
      // 触顶加载更多
      if (el.scrollTop < LOAD_MORE_THRESHOLD) {
        const session = useStore.getState().chatSessions[path];
        if (session?.hasMore && !session.loadingMore) {
          loadMoreMessages(path);
        }
      }
      // 滚动中显示 scrollbar，停下 800ms 后隐藏
      el.classList.add(styles['is-scrolling']);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        el.classList.remove(styles['is-scrolling']);
      }, 800);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    if (active) {
      setScrollButton(el, !bottomScroll.checkSticky(), () => {
        bottomScroll.scrollToBottom({ mode: 'follow', forceSticky: true });
      });
    }
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (hideTimer) clearTimeout(hideTimer);
      if (_scrollBtn.el === el) setScrollButton(null, false, null);
    };
  }, [active, bottomScroll, path]);

  // prepend 后保持滚动位置：监听 items 变化，如果头部变了就修正 scrollTop
  const prevFirstId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const firstId = items[0]?.type === 'message' ? items[0].data.id : undefined;
    const el = ref.current;
    if (el && prevFirstId.current && firstId !== prevFirstId.current) {
      // 头部 id 变了 → prepend 发生，修正 scrollTop 让原来的内容不跳
      const prevHeight = el.dataset.prevScrollHeight;
      if (prevHeight) {
        el.scrollTop += el.scrollHeight - Number(prevHeight);
      }
    }
    prevFirstId.current = firstId;
  }, [items]);

  // 在 loadingMore 变成 true 前快照 scrollHeight
  useEffect(() => {
    const el = ref.current;
    if (el && loadingMore) {
      el.dataset.prevScrollHeight = String(el.scrollHeight);
    }
  }, [loadingMore]);

  // 首次有内容 → 滚到底
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (scrolledOnce.current) return;
    if (items.length > 0) {
      bottomScroll.scrollToBottom({ mode: 'instant', forceSticky: true });
      scrolledOnce.current = true;
    }
  }, [bottomScroll, items.length]);

  // 只有用户自己发出新消息时才恢复 sticky；assistant/tool 流式追加必须尊重用户上滑。
  const prevLen = useRef(items.length);
  useEffect(() => {
    if (items.length > prevLen.current && active) {
      const last = items[items.length - 1];
      if (last?.type === 'message' && last.data.role === 'user') {
        bottomScroll.scrollToBottom({ mode: 'instant', forceSticky: true });
      } else {
        bottomScroll.followBottom();
      }
    }
    prevLen.current = items.length;
  }, [items, items.length, active, bottomScroll]);

  if (items.length === 0) return null;

  return (
    <div
      className={styles.sessionShell}
      style={{
        visibility: active ? 'visible' : 'hidden',
        zIndex: active ? 1 : 0,
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      <div ref={ref} className={styles.sessionPanel}>
        <div ref={contentRef} className={styles.sessionMessages}>
          {hasMore && (
            <div className={styles.loadMoreHint}>
              {loadingMore ? '...' : ''}
            </div>
          )}
          <ChatTranscript
            items={items}
            sessionPath={path}
            agentId={sessionAgentId}
            registerMessageElement={registerMessageElement}
          />
          {isSessionStreaming && (
            <div className={styles.typingIndicator} />
          )}
          <div className={styles.sessionFooter} />
        </div>
      </div>
      <ChatTimelineNavigator
        anchors={timelineAnchors}
        scrollRef={ref}
        contentRef={contentRef}
        messageElementsRef={messageElementsRef}
        active={active}
      />
    </div>
  );
});

// ── ScrollToBottom 按钮 ──

const _scrollBtn = {
  el: null as HTMLElement | null,
  visible: false,
  scrollToBottom: null as (() => void) | null,
  listeners: [] as (() => void)[],
};

function setScrollButton(el: HTMLElement | null, visible: boolean, scrollToBottom: (() => void) | null) {
  _scrollBtn.el = el;
  _scrollBtn.visible = visible;
  _scrollBtn.scrollToBottom = scrollToBottom;
  _scrollBtn.listeners.forEach(listener => listener());
}

function ScrollToBottomBtn() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(_scrollBtn.visible);
    _scrollBtn.listeners.push(update);
    return () => { _scrollBtn.listeners = _scrollBtn.listeners.filter(f => f !== update); };
  }, []);

  if (!visible) return null;
  return (
    <button className={styles.scrollToBottomFab} onClick={() => {
      _scrollBtn.scrollToBottom?.();
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}
