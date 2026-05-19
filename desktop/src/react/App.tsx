/**
 * App.tsx — React 根组件（纯布局编排）
 *
 * 初始化逻辑在 app-init.ts，拖拽/主内容区在 MainContent.tsx。
 * 此文件只负责 titlebar + sidebar + 主区域 + overlays 的组装。
 */

import { useEffect, useRef, lazy, Suspense } from 'react';
import { useStore } from './stores';
import type { ActivePanel } from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RegionalErrorBoundary } from './components/RegionalErrorBoundary';

const SkillViewerOverlay = lazy(() => import('./components/SkillViewerOverlay').then(m => ({ default: m.SkillViewerOverlay })));
import { SessionList } from './components/SessionList';
import { ArchivedChatsButton } from './components/ArchivedChatsButton';
import { ChannelsPanel } from './components/ChannelsPanel';
import { ChannelTabBar } from './components/channels/ChannelTabBar';
import { WidgetButtons } from './components/plugin/WidgetButtons';
import { ChannelListSidebar } from './components/channels/ChannelList';
import { ChannelCreateOverlay } from './components/channels/ChannelCreateOverlay';
import { SidebarLayout, toggleSidebar } from './components/SidebarLayout';
import { FloatPreviewCard, useFloatCard } from './components/FloatPreviewCard';
import { useSidebarResize } from './hooks/use-sidebar-resize';
import { createNewSession } from './stores/session-actions';
import { toggleJianSidebar } from './stores/desk-actions';
import { WindowControls } from './components/WindowControls';
import { ToastContainer } from './components/ToastContainer';
import { InputContextMenu } from './components/InputContextMenu';
import { StatusBar } from './components/StatusBar';
import { LeavesOverlay } from './components/LeavesOverlay';
import { MediaViewer } from './components/shared/MediaViewer/MediaViewer';
import { SelectionFloatingInput } from './components/floating-input/SelectionFloatingInput';
import { SettingsModalShell } from './components/SettingsModalShell';
import { initTheme, initDragPrevention } from './bootstrap';
import { initApp } from './app-init';
import { useAnyBrowserRunning } from './stores/browser-slice';
import { openSettingsModal } from './stores/settings-modal-actions';
import { AppPages } from './components/app/AppPages';

declare function t(key: string, vars?: Record<string, string | number>): string;

// ── 主题 + drag 阻止（import 时立即执行） ──
initTheme();
initDragPrevention();

// ── 面板切换 ──

function togglePanel(panel: ActivePanel) {
  const s = useStore.getState();
  s.setActivePanel(s.activePanel === panel ? null : panel);
}

// ── 内联子组件 ──

function AutomationBadge() {
  const count = useStore(s => s.automationCount);
  return <span className="automation-count-badge">{count > 0 ? String(count) : ''}</span>;
}

function BridgeDot() {
  const connected = useStore(s => s.bridgeDotConnected);
  return <span className={`sidebar-bridge-dot${connected ? ' connected' : ''}`}></span>;
}

function ConnectionStatus() {
  const connected = useStore(s => s.connected);
  const statusKey = useStore(s => s.statusKey);
  const statusVars = useStore(s => s.statusVars);
  return (
    <div className={`connection-status${connected ? ' connected' : ''}`}>
      <span className="status-dot"></span>
      <span className="status-text">{statusKey ? t(statusKey, statusVars) : ''}</span>
    </div>
  );
}

// ── App 根组件 ──

function App() {
  useSidebarResize();
  // 订阅 locale 变化，驱动整棵树重渲染
  useStore(s => s.locale);
  const sidebarOpen = useStore(s => s.sidebarOpen);
  const jianOpen = useStore(s => s.jianOpen);
  const currentTab = useStore(s => s.currentTab);
  const browserRunning = useAnyBrowserRunning();
  const currentAgentId = useStore(s => s.currentAgentId);
  const isPluginTab = typeof currentTab === 'string' && currentTab.startsWith('plugin:');
  const { floatCard, show: showFloat, scheduleHide: scheduleFloatHide, cancelHide: cancelFloatHide, hide: hideFloat } = useFloatCard();

  useEffect(() => {
    initApp().catch((err: unknown) => {
      console.error('[init] 初始化异常:', err);
      window.platform?.appReady?.();
    });
  }, []);

  // 只测量稳定的输入卡片本体；附件/提示条等浮动状态不参与 chat panel 切点，避免把正文顶上去。
  const inputCardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = inputCardRef.current;
    if (!el) return;
    const parent = el.closest('.main-content') as HTMLElement | null;
    if (!parent) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
      parent.style.setProperty('--input-card-h', `${h}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <ErrorBoundary>
      {/* Headless behavior components */}
      <SidebarLayout />
      <ChannelsPanel />

      {/* ── Titlebar ── */}
      <div className="titlebar">
        <button
          className={`tb-toggle tb-toggle-left${sidebarOpen ? ' active' : ''}`}
          id="tbToggleLeft"
          title={t('sidebar.toggle')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { hideFloat(); toggleSidebar(); }}
          onMouseEnter={(e) => showFloat('left', e.currentTarget)}
          onMouseLeave={scheduleFloatHide}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </button>
        <ChannelTabBar />
        <div className="tb-right-group">
          <button
            className="tb-toggle"
            id="tbOpenTerminal"
            title="打开终端"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const s = useStore.getState();
              const cwd = (s.deskBasePath || '').trim();
              window.platform?.openTerminal?.(cwd || undefined);
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" ry="2"></rect>
              <polyline points="7 9 10 12 7 15"></polyline>
              <line x1="13" y1="15" x2="17" y2="15"></line>
            </svg>
          </button>
          <WidgetButtons />
          <button
              className={`tb-toggle tb-toggle-right${jianOpen ? ' active' : ''}`}
              id="tbToggleRight"
              title={t('sidebar.jian')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { hideFloat(); toggleJianSidebar(); }}
              onMouseEnter={(e) => showFloat('right', e.currentTarget)}
              onMouseLeave={scheduleFloatHide}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="15" y1="3" x2="15" y2="21"></line>
              </svg>
            </button>
        </div>
        <WindowControls />
      </div>

      {/* ── App body ── */}
      <div className="app">
        {/* Left sidebar */}
        <aside className={`sidebar${sidebarOpen && !isPluginTab ? '' : ' collapsed'}`} id="sidebar">
          <div className="sidebar-inner">
            <div className={`sidebar-chat-content${currentTab === 'chat' ? '' : ' hidden'}`}>
              <div className="sidebar-header">
                <span className="sidebar-title">{t('sidebar.title')}</span>
                <div className="sidebar-header-actions">
                  <button className="sidebar-action-btn" id="newSessionBtn" title={t('sidebar.newChat')} onClick={createNewSession}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                  </button>
                  <button className="sidebar-action-btn" id="settingsBtn" title={t('settings.title')} onClick={() => openSettingsModal()}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                  </button>
                  <button className="sidebar-action-btn" id="sidebarCollapseBtn" title={t('sidebar.collapse')} onClick={() => toggleSidebar()}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 6 9 12 15 18"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
              <button className="sidebar-activity-bar sidebar-bridge-card" id="bridgeBar" onClick={() => togglePanel('bridge')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
                <span>{t('sidebar.bridgeShort')}</span>
                <BridgeDot />
              </button>
              <button className="sidebar-activity-bar" id="activityBar" onClick={() => togglePanel('activity')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
                <span>{t('sidebar.activity')}</span>
              </button>
              <button className="sidebar-activity-bar" id="automationBar" onClick={() => togglePanel('automation')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                <span>{t('automation.title')}</span>
                <AutomationBadge />
              </button>
              <button className={`sidebar-activity-bar browser-bg-bar${browserRunning ? '' : ' hidden'}`} id="browserBgBar" title={t('browser.backgroundHint')} onClick={() => window.platform?.openBrowserViewer?.()}>
                <svg className="browser-bg-globe" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="2" y1="12" x2="22" y2="12"></line>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                </svg>
                <span>{t('browser.background')}</span>
              </button>
              <div className="session-list" id="sessionList">
                <RegionalErrorBoundary region="sidebar" resetKeys={[currentAgentId]}>
                  <SessionList />
                </RegionalErrorBoundary>
              </div>
              <div className="sidebar-footer">
                <ArchivedChatsButton />
              </div>
            </div>

            {/* 频道 tab 内容 */}
            <div className={`sidebar-channel-content${currentTab === 'channels' ? '' : ' hidden'}`}>
              <ChannelListSidebar />
            </div>
          </div>
          <div className="resize-handle resize-handle-right" id="sidebarResizeHandle"></div>
        </aside>

        <RegionalErrorBoundary region="app-pages" resetKeys={[currentTab]}>
          <AppPages inputCardRef={inputCardRef} />
        </RegionalErrorBoundary>
      </div>

      {/* Connection status */}
      <ConnectionStatus />

      {/* Channel create overlay */}
      <ChannelCreateOverlay />

      {/* Skill viewer overlay */}
      <Suspense fallback={null}><SkillViewerOverlay /></Suspense>

      {/* Float preview card */}
      {floatCard && (
        <FloatPreviewCard
          state={floatCard}
          onMouseEnter={cancelFloatHide}
          onMouseLeave={scheduleFloatHide}
          onAction={hideFloat}
        />
      )}

      {/* Connection status bar */}
      <StatusBar />

      {/* Leaves shadow overlay */}
      <LeavesOverlay />

      {/* Media viewer overlay */}
      <MediaViewer />

      {/* Selection floating input */}
      <SelectionFloatingInput />

      {/* In-window settings overlay */}
      <SettingsModalShell />

      {/* Input context menu (cut/copy/paste) */}
      <InputContextMenu />

      {/* Toast notifications */}
      <ToastContainer />
    </ErrorBoundary>
  );
}

export default App;
