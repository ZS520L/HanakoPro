/**
 * SessionList — 侧边栏 session 列表 React 组件
 *
 * Phase 6B: 替代 sidebar-shim.ts 中的 renderSessionList / createSessionItem。
 * 通过 portal 渲染到 #sessionList，从 Zustand sessions 状态驱动。
 */

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../stores';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { useI18n } from '../hooks/use-i18n';
import { formatSessionDate } from '../utils/format';
import { switchSession, archiveSession, renameSession, pinSession } from '../stores/session-actions';
import { updateKeyed } from '../stores/create-keyed-slice';
import type { Session, Agent } from '../types';
import { AgentAvatar, resolveAgentDisplayInfo } from '../utils/agent-display';
import { buildSessionSections, type SessionViewMode } from './session-sections';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { renderMarkdown } from '../utils/markdown';
import styles from './SessionList.module.css';

interface BrowserSessionState {
  url: string | null;
  running: boolean;
  resumable: boolean;
  unavailableReason: string | null;
}

function normalizeBrowserSessionStates(data: unknown): Record<string, BrowserSessionState> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const result: Record<string, BrowserSessionState> = {};
  for (const [sessionPath, rawState] of Object.entries(data as Record<string, unknown>)) {
    if (typeof rawState === 'string') {
      result[sessionPath] = {
        url: rawState,
        running: false,
        resumable: true,
        unavailableReason: null,
      };
      continue;
    }
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) continue;
    const state = rawState as Partial<BrowserSessionState>;
    result[sessionPath] = {
      url: typeof state.url === 'string' ? state.url : null,
      running: state.running === true,
      resumable: state.resumable !== false,
      unavailableReason: typeof state.unavailableReason === 'string' ? state.unavailableReason : null,
    };
  }
  return result;
}


// ── 主组件 ──

export function SessionList() {
  return <SessionListInner />;
}interface SessionSearchResult {
  path: string;
  title: string | null;
  firstMessage: string;
  modified: string | null;
  messageCount: number;
  agentId: string | null;
  agentName: string | null;
  pinnedAt: string | null;
  matchType: 'title' | 'content';
  snippet: string | null;
}


// ── 内部组件 ──

function SessionListInner() {
  const { t } = useI18n();
  const sessions = useStore(s => s.sessions);
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const pendingSessionSwitchPath = useStore(s => s.pendingSessionSwitchPath);
  const pendingNewSession = useStore(s => s.pendingNewSession);
  const agents = useStore(s => s.agents);
  const streamingSessions = useStore(s => s.streamingSessions);
  const browserBySession = useStore(s => s.browserBySession);

  const [browserSessions, setBrowserSessions] = useState<Record<string, BrowserSessionState>>({});
  const closingBrowserSessionsRef = useRef(new Set<string>());
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const setVisibleBrowserSessions = useCallback((data: unknown) => {
    const states = normalizeBrowserSessionStates(data);
    for (const sessionPath of closingBrowserSessionsRef.current) {
      delete states[sessionPath];
    }
    setBrowserSessions(states);
  }, []);

  // Fetch browser sessions (re-fetch when browser state changes)
  useEffect(() => {
    let cancelled = false;
    if (sessions.length === 0) {
      setBrowserSessions({});
      return;
    }
    hanaFetch('/api/browser/session-states')
      .then(r => r.json())
      .then(data => {
        if (!cancelled) setVisibleBrowserSessions(data);
      })
      .catch(err => console.warn('[sessions] fetch browser sessions failed:', err));
    return () => {
      cancelled = true;
    };
  }, [sessions, browserBySession, setVisibleBrowserSessions]);

  const handleCloseBrowserSession = useCallback(async (sessionPath: string) => {
    closingBrowserSessionsRef.current.add(sessionPath);
    setBrowserSessions(prev => {
      const next = { ...prev };
      delete next[sessionPath];
      return next;
    });
    try {
      const res = await hanaFetch('/api/browser/close-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionPath }),
      });
      const data = await res.json();
      updateKeyed('browserBySession', sessionPath, { running: false, url: null, thumbnail: null });
      closingBrowserSessionsRef.current.delete(sessionPath);
      if (data?.sessions) {
        setBrowserSessions(normalizeBrowserSessionStates(data.sessions));
      }
    } catch (err) {
      closingBrowserSessionsRef.current.delete(sessionPath);
      console.warn('[sessions] close browser session failed:', err);
    }
  }, []);

  // 搜索过滤：标题或首条消息包含关键词（即时）
  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(s => {
      if (s.title && s.title.toLowerCase().includes(q)) return true;
      if (s.firstMessage && s.firstMessage.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [sessions, searchQuery]);

  // 后端全文搜索结果
  const [deepResults, setDeepResults] = useState<SessionSearchResult[]>([]);
  const [deepSearching, setDeepSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setDeepResults([]);
      setDeepSearching(false);
      return;
    }
    // 防抖 300ms 后触发后端搜索
    setDeepSearching(true);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      hanaFetch(`/api/sessions/search?q=${encodeURIComponent(q)}`)
        .then(r => r.json())
        .then((data: { results: SessionSearchResult[]; error?: string }) => {
          if (data.error) throw new Error(data.error);
          setDeepResults(data.results || []);
          setDeepSearching(false);
        })
        .catch(() => {
          setDeepResults([]);
          setDeepSearching(false);
        });
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // 合并客户端和后端结果（按 path 去重，客户端优先）
  const mergedSearchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return null;
    const seen = new Set<string>();
    const merged: Array<Session & { _matchType?: string; _snippet?: string | null }> = [];
    // 客户端结果优先
    for (const s of filteredSessions) {
      seen.add(s.path);
      merged.push({ ...s, _matchType: 'title', _snippet: null });
    }
    // 后端全文匹配（不重复）
    for (const r of deepResults) {
      if (seen.has(r.path)) continue;
      seen.add(r.path);
      merged.push({
        path: r.path,
        title: r.title,
        firstMessage: r.firstMessage || '',
        modified: r.modified || '',
        messageCount: r.messageCount || 0,
        agentId: r.agentId || null,
        agentName: r.agentName || null,
        pinnedAt: r.pinnedAt || null,
        _matchType: r.matchType,
        _snippet: r.snippet,
      });
    }
    return merged;
  }, [filteredSessions, deepResults, searchQuery]);

  // Ctrl+F / Cmd+F 聚焦搜索框
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (sessions.length === 0) {
    return <div className={styles.sessionEmpty}>{t('sidebar.empty')}</div>;
  }

  const [viewMode, setViewMode] = useState<SessionViewMode>(() => {
    const saved = localStorage.getItem('hana-session-view-mode');
    return saved === 'project' ? 'project' : 'time';
  });

  const toggleViewMode = useCallback(() => {
    setViewMode(prev => {
      const next = prev === 'time' ? 'project' : 'time';
      localStorage.setItem('hana-session-view-mode', next);
      return next;
    });
  }, []);

  const displaySessions = searchQuery.trim() ? (mergedSearchResults || []) : sessions;
  const sections = buildSessionSections(displaySessions, { mode: viewMode });
  const activeSessionPath = pendingSessionSwitchPath || currentSessionPath;
  const hasSearchResults = sections.length > 0;

  // 当左侧搜索词改变时，更新 store 中的搜索查询
  useEffect(() => {
    if (searchQuery.trim()) {
      const { setChatSearchQuery } = useStore.getState();
      setChatSearchQuery(searchQuery.trim());
    }
  }, [searchQuery]);

  return (
    <>
      <div className={styles.sessionSearchBar}>
        <svg className={styles.sessionSearchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={searchInputRef}
          className={styles.sessionSearchInput}
          type="text"
          placeholder={t('session.search.placeholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button
            className={styles.sessionSearchClear}
            onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
            title={t('session.search.clear')}
          >
            ✕
          </button>
        )}
      </div>
      {!hasSearchResults && searchQuery && (
        <div className={styles.sessionEmpty}>{t('session.search.noResults')}</div>
      )}
      <div className={styles.sessionViewModeToggle}>
        <button
          className={`${styles.sessionViewModeBtn} ${viewMode === 'time' ? styles.sessionViewModeBtnActive : ''}`}
          onClick={() => { if (viewMode !== 'time') toggleViewMode(); }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>{t('sidebar.byTime')}</span>
        </button>
        <button
          className={`${styles.sessionViewModeBtn} ${viewMode === 'project' ? styles.sessionViewModeBtnActive : ''}`}
          onClick={() => { if (viewMode !== 'project') toggleViewMode(); }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <span>{t('sidebar.byProject')}</span>
        </button>
      </div>
      {sections.map(section => {
        if (section.kind === 'project') {
          return (
            <ProjectSection
              key={section.id}
              section={section}
              activeSessionPath={activeSessionPath}
              pendingNewSession={pendingNewSession}
              streamingSessions={streamingSessions}
              agents={agents}
              browserSessions={browserSessions}
              onCloseBrowser={handleCloseBrowserSession}
            />
          );
        }

        const items = section.items.map(s => (
          <SessionItem
            key={s.path}
            session={s}
            isActive={!pendingNewSession && s.path === activeSessionPath}
            isStreaming={streamingSessions.includes(s.path)}
            isPinned={!!s.pinnedAt}
            agents={agents}
            browserState={browserSessions[s.path] || null}
            onCloseBrowser={handleCloseBrowserSession}
            searchSnippet={(s as any)._snippet || null}
          />
        ));

        if (section.kind === 'pinned') {
          return (
            <section key={section.id} className={styles.pinnedSection}>
              <div className={`${styles.sessionSectionTitle} ${styles.pinnedSectionTitle}`}>
                <span>{t(section.titleKey)}</span>
                <svg className={styles.pinnedTitleIcon} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 17v5" />
                  <path d="M5 17h14" />
                  <path d="M7 3h10l-2 9H9L7 3z" />
                  <path d="M9 12l-2 5h10l-2-5" />
                </svg>
              </div>
              {items}
            </section>
          );
        }

        return (
          <Fragment key={section.id}>
            <div className={styles.sessionSectionTitle}>{t(section.titleKey)}</div>
            {items}
          </Fragment>
        );
      })}
    </>
  );
}

// ── Session Item ──

const SessionItem = memo(function SessionItem({ session: s, isActive, isStreaming, isPinned, agents, browserState, onCloseBrowser, searchSnippet }: {
  session: Session;
  isActive: boolean;
  isStreaming: boolean;
  isPinned: boolean;
  agents: Agent[];
  browserState: BrowserSessionState | null;
  onCloseBrowser: (sessionPath: string) => void;
  searchSnippet?: string | null;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [summaryPreviewPosition, setSummaryPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(() => {
    if (editing) return;
    // 获取当前搜索查询
    const currentSearchQuery = useStore.getState().chatSearchQuery;
    switchSession(s.path);
    // 如果有搜索查询，传递给右侧
    if (currentSearchQuery) {
      const { setChatSearchQuery } = useStore.getState();
      setChatSearchQuery(currentSearchQuery);
    }
  }, [s.path, editing]);

  const handleArchive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    archiveSession(s.path);
  }, [s.path]);

  const handlePin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    pinSession(s.path, !isPinned);
  }, [s.path, isPinned]);

  const beginRename = useCallback(() => {
    setEditValue(s.title || s.firstMessage || '');
    setEditing(true);
  }, [s.title, s.firstMessage]);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    beginRename();
  }, [beginRename]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    setEditing(false);
    if (trimmed && trimmed !== (s.title || s.firstMessage || '')) {
      renameSession(s.path, trimmed);
    }
  }, [editValue, s.path, s.title, s.firstMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
    }
  }, [commitRename]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSummaryPreviewPosition(null);
    setMenuPosition({ x: e.clientX, y: e.clientY });
  }, []);

  // Auto-focus input when editing starts
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Meta line
  const parts: string[] = [];
  if (s.agentName || s.agentId) parts.push(s.agentName || s.agentId!);
  if (s.cwd) {
    const dirName = s.cwd.split(/[/\\]/).filter(Boolean).pop();
    if (dirName) parts.push(dirName);
  }
  if (s.modified) parts.push(formatSessionDate(s.modified));
  const rcLabel = s.rcAttachment ? `${formatRcPlatform(s.rcAttachment.platform)} 接管中` : null;
  const browserUrl = browserState?.url || null;
  const browserTitle = [
    browserUrl,
    browserState?.unavailableReason,
    t('browser.close'),
  ].filter(Boolean).join('\n');

  const handleBrowserClose = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onCloseBrowser(s.path);
  }, [onCloseBrowser, s.path]);

  const handleBrowserKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    handleBrowserClose(e);
  }, [handleBrowserClose]);

  return (
    <>
      <button
        className={`${styles.sessionItem}${isActive ? ` ${styles.sessionItemActive}` : ''}`}
        data-session-path={s.path}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <div className={styles.sessionItemHeader}>
          {s.agentId && (
            <AgentBadge agentId={s.agentId} agentName={s.agentName} agents={agents} />
          )}
          {isStreaming && <span className={styles.sessionStreamingDot} />}
          {editing ? (
            <input
              ref={inputRef}
              className={styles.sessionRenameInput}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commitRename}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <div className={styles.sessionItemTitle}>
              {s.title || s.firstMessage || t('session.untitled')}
            </div>
          )}
          {!editing && searchSnippet && (
            <div className={styles.sessionItemSnippet}>{searchSnippet}</div>
          )}
        </div>

        {!editing && (
          <div className={styles.sessionPinBtn} title={t(isPinned ? 'session.unpin' : 'session.pin')} onClick={handlePin}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17v5" />
              <path d="M5 17h14" />
              <path d="M7 3h10l-2 9H9L7 3z" />
              <path d="M9 12l-2 5h10l-2-5" />
            </svg>
          </div>
        )}

        {!editing && (
          <div className={styles.sessionRenameBtn} title={t('session.rename')} onClick={startRename}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </div>
        )}

        <div className={styles.sessionArchiveBtn} title={t('session.archive')} onClick={handleArchive}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        </div>

        <div className={styles.sessionItemMeta}>
          {parts.join(' · ')}
        </div>

        {rcLabel && (
          <div className={styles.sessionRcBadge}>
            {rcLabel}
          </div>
        )}

        {browserUrl && (
          <span
            className={styles.sessionBrowserBadge}
            title={browserTitle}
            role="button"
            tabIndex={0}
            aria-label={t('browser.close')}
            data-running={browserState?.running ? 'true' : 'false'}
            data-resumable={browserState?.resumable ? 'true' : 'false'}
            onClick={handleBrowserClose}
            onKeyDown={handleBrowserKeyDown}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </span>
        )}
      </button>
      {menuPosition && (
        <SessionContextMenu
          session={s}
          isPinned={isPinned}
          position={menuPosition}
          onClose={() => setMenuPosition(null)}
          onRename={beginRename}
          onShowSummary={(position) => setSummaryPreviewPosition(position)}
          onShowDetails={() => setShowDetails(true)}
        />
      )}
      {summaryPreviewPosition && (
        <SessionSummaryPreviewCard
          session={s}
          position={summaryPreviewPosition}
          onClose={() => setSummaryPreviewPosition(null)}
        />
      )}
      {showDetails && (
        <SessionDetailsModal
          session={s}
          onClose={() => setShowDetails(false)}
        />
      )}
    </>
  );
});

interface SessionSummaryResponse {
  hasSummary?: boolean;
  summary?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

type SummaryState =
  | { status: 'loading'; text: null }
  | { status: 'ready'; text: string }
  | { status: 'empty'; text: null }
  | { status: 'error'; text: null };

const SessionContextMenu = memo(function SessionContextMenu({
  session,
  isPinned,
  position,
  onClose,
  onRename,
  onShowSummary,
  onShowDetails,
}: {
  session: Session;
  isPinned: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
  onShowSummary: (position: { x: number; y: number }) => void;
  onShowDetails: () => void;
}) {
  const { t } = useI18n();
  const items = useMemo<ContextMenuItem[]>(() => [
    {
      label: t('session.summary.open'),
      disabled: session.hasSummary !== true,
      action: () => onShowSummary(position),
    },
    {
      label: t('session.details.open'),
      action: onShowDetails,
    },
    {
      label: t(isPinned ? 'session.unpin' : 'session.pin'),
      action: () => pinSession(session.path, !isPinned),
    },
    {
      label: t('session.rename'),
      action: onRename,
    },
    {
      label: t('session.archive'),
      danger: true,
      action: () => archiveSession(session.path),
    },
  ], [isPinned, onRename, onShowSummary, onShowDetails, position, session.path, t]);

  return (
    <ContextMenu
      items={items}
      position={position}
      onClose={onClose}
    />
  );
});

const SessionSummaryPreviewCard = memo(function SessionSummaryPreviewCard({
  session,
  position,
  onClose,
}: {
  session: Session;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const [summaryState, setSummaryState] = useState<SummaryState>(
    session.hasSummary === true
      ? { status: 'loading', text: null }
      : { status: 'empty', text: null },
  );

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    let { x, y } = position;
    if (x + rect.width > window.innerWidth) x = Math.max(4, window.innerWidth - rect.width - 4);
    if (y + rect.height > window.innerHeight) y = Math.max(4, window.innerHeight - rect.height - 4);
    card.style.left = x + 'px';
    card.style.top = y + 'px';
  }, [position, summaryState]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const handleContextMenu = (e: MouseEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true);
      document.addEventListener('contextmenu', handleContextMenu, true);
      document.addEventListener('keydown', handleKeyDown);
    });
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (session.hasSummary !== true) {
      setSummaryState({ status: 'empty', text: null });
      return;
    }

    let cancelled = false;
    setSummaryState({ status: 'loading', text: null });
    hanaFetch(`/api/sessions/summary?path=${encodeURIComponent(session.path)}`)
      .then(res => res.json())
      .then((data: SessionSummaryResponse) => {
        if (cancelled) return;
        const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
        if (data.hasSummary && summary) {
          setSummaryState({ status: 'ready', text: summary });
        } else {
          setSummaryState({ status: 'empty', text: null });
        }
      })
      .catch(() => {
        if (!cancelled) setSummaryState({ status: 'error', text: null });
      });

    return () => {
      cancelled = true;
    };
  }, [session.path, session.hasSummary]);

  const summaryHtml = useMemo(() => (
    summaryState.status === 'ready' ? renderMarkdown(summaryState.text) : ''
  ), [summaryState]);

  return createPortal(
    <div
      ref={cardRef}
      className={styles.sessionSummaryCard}
      style={{ left: position.x, top: position.y }}
      data-testid="session-summary-card"
      data-scrollable="true"
    >
      <div className={styles.sessionSummaryTitle}>{t('session.summary.title')}</div>
      <div className={styles.sessionSummaryBody}>
        {summaryState.status === 'ready' ? (
          <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
        ) : (
          <span className={styles.sessionSummaryPlaceholder}>
            {summaryState.status === 'loading'
              ? t('session.summary.loading')
              : summaryState.status === 'error'
                ? t('session.summary.loadFailed')
                : t('session.summary.empty')}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
});

interface SessionDetails {
  path: string;
  model?: { id: string; provider: string; name: string } | null;
  thinkingLevel?: string | null;
  permissionMode?: string | null;
  memoryEnabled?: boolean;
  experienceEnabled?: boolean;
  systemPrompt?: string | null;
  toolNames?: string[] | null;
  workspaceFolders?: string[];
}

const SessionDetailsModal = memo(function SessionDetailsModal({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<SessionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    hanaFetch(`/api/sessions/details?path=${encodeURIComponent(session.path)}`)
      .then(res => res.json())
      .then((data: SessionDetails & { error?: string }) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setDetails(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [session.path]);

  // 关闭：点击背景或按 Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const tLabel = (key: string, fallback: string) => {
    const v = t(key);
    return v !== key ? v : fallback;
  };

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.sessionDetailsOverlay}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className={styles.sessionDetailsDialog}>
        <div className={styles.sessionDetailsHeader}>
          <h3>{tLabel('session.details.title', '会话详情')}</h3>
          <button className={styles.sessionDetailsClose} onClick={onClose}>✕</button>
        </div>
        <div className={styles.sessionDetailsBody}>
          {loading && <p className={styles.sessionDetailsLoading}>{tLabel('session.details.loading', '加载中…')}</p>}
          {error && <p className={styles.sessionDetailsError}>{error}</p>}
          {details && (
            <>
              <div className={styles.sessionDetailsGrid}>
                <div className={styles.sessionDetailsField}>
                  <span className={styles.sessionDetailsLabel}>{tLabel('session.details.model', '模型')}</span>
                  <span className={styles.sessionDetailsValue}>{details.model?.name || details.model?.id || '—'}</span>
                </div>
                <div className={styles.sessionDetailsField}>
                  <span className={styles.sessionDetailsLabel}>{tLabel('session.details.thinking', '思考强度')}</span>
                  <span className={styles.sessionDetailsValue}>{details.thinkingLevel || '—'}</span>
                </div>
                <div className={styles.sessionDetailsField}>
                  <span className={styles.sessionDetailsLabel}>{tLabel('session.details.permission', '权限模式')}</span>
                  <span className={styles.sessionDetailsValue}>{details.permissionMode || '—'}</span>
                </div>
                <div className={styles.sessionDetailsField}>
                  <span className={styles.sessionDetailsLabel}>{tLabel('session.details.memory', '记忆')}</span>
                  <span className={styles.sessionDetailsValue}>{details.memoryEnabled ? tLabel('session.details.on', '开') : tLabel('session.details.off', '关')}</span>
                </div>
              </div>

              {details.systemPrompt && (
                <div className={styles.sessionDetailsSection}>
                  <h4>{tLabel('session.details.systemPrompt', '系统提示词')}</h4>
                  <pre className={styles.sessionDetailsPrompt}>{details.systemPrompt}</pre>
                </div>
              )}

              {details.toolNames && details.toolNames.length > 0 && (
                <div className={styles.sessionDetailsSection}>
                  <h4>{tLabel('session.details.tools', `工具列表 (${details.toolNames.length})`)}</h4>
                  <div className={styles.sessionDetailsToolList}>
                    {details.toolNames.map(name => (
                      <span key={name} className={styles.sessionDetailsToolChip}>{name}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
});

function formatRcPlatform(platform: string) {
  const lower = (platform || '').toLowerCase();
  if (lower === 'tg' || lower === 'telegram') return 'Telegram';
  if (lower === 'feishu' || lower === 'fs') return '飞书';
  if (lower === 'wechat' || lower === 'wx') return '微信';
  if (lower === 'qq') return 'QQ';
  return platform || 'Bridge';
}

// ── Project Section (collapsible, with date sub-sections) ──

const ProjectSection = memo(function ProjectSection({ section, activeSessionPath, pendingNewSession, streamingSessions, agents, browserSessions, onCloseBrowser }: {
  section: { id: string; title: string; cwd: string | null; subSections: { group: string; titleKey: string; items: Session[] }[] };
  activeSessionPath: string | null;
  pendingNewSession: boolean;
  streamingSessions: string[];
  agents: Agent[];
  browserSessions: Record<string, BrowserSessionState>;
  onCloseBrowser: (sessionPath: string) => void;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  // Sub-section collapse state
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());

  const toggleSub = useCallback((group: string) => {
    setCollapsedSubs(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }, []);

  const totalCount = section.subSections.reduce((sum, sub) => sum + sub.items.length, 0);

  return (
    <section className={styles.projectSection}>
      <button
        className={styles.projectSectionHeader}
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
      >
        <svg
          className={`${styles.projectSectionChevron} ${collapsed ? styles.chevronCollapsed : ''}`}
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <svg className={styles.projectSectionIcon} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span className={styles.projectSectionTitle}>{section.title}</span>
        <span className={styles.projectSectionCount}>{totalCount}</span>
      </button>
      {!collapsed && (
        <div className={styles.projectSectionBody}>
          {section.subSections.map(sub => (
            <div key={sub.group} className={styles.projectSubSection}>
              <button
                className={styles.projectSubHeader}
                onClick={() => toggleSub(sub.group)}
                title={collapsedSubs.has(sub.group) ? t('sidebar.expand') : t('sidebar.collapse')}
              >
                <svg
                  className={`${styles.projectSubChevron} ${collapsedSubs.has(sub.group) ? styles.chevronCollapsed : ''}`}
                  width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span className={styles.projectSubTitle}>{t(sub.titleKey)}</span>
                <span className={styles.projectSubCount}>{sub.items.length}</span>
              </button>
              {!collapsedSubs.has(sub.group) && (
                <div className={styles.projectSubBody}>
                  {sub.items.map(s => (
                    <SessionItem
                      key={s.path}
                      session={s}
                      isActive={!pendingNewSession && s.path === activeSessionPath}
                      isStreaming={streamingSessions.includes(s.path)}
                      isPinned={!!s.pinnedAt}
                      agents={agents}
                      browserState={browserSessions[s.path] || null}
                      onCloseBrowser={onCloseBrowser}
                      searchSnippet={(s as any)._snippet || null}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
});

// ── Agent Avatar Badge ──

const AgentBadge = memo(function AgentBadge({ agentId, agentName, agents }: {
  agentId: string;
  agentName: string | null;
  agents: Agent[];
}) {
  const info = resolveAgentDisplayInfo({
    id: agentId,
    agents,
    fallbackAgentName: agentName || agentId,
  });

  return (
    <AgentAvatar
      info={info}
      className={styles.sessionAgentBadge}
      title={agentName || agentId}
    />
  );
});
