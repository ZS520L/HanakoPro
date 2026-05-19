/**
 * app-init.ts — 应用初始化逻辑（纯函数，非 React 组件）
 *
 * 从 App.tsx 提取。包含：
 * - __hanaLog 日志上报
 * - 全局错误 / unhandled rejection 监听
 * - initApp() 主初始化流程
 */

import { useStore } from './stores';
import { hanaFetch } from './hooks/use-hana-fetch';
import { applyAgentIdentity, loadAgents, loadAvatars } from './stores/agent-actions';
import { loadSessions } from './stores/session-actions';
import { connectWebSocket, getWebSocket } from './services/websocket';
import { setStatus, loadModels } from './utils/ui-helpers';
import { initJian } from './stores/desk-actions';
import { initViewerEvents } from './stores/preview-actions';
import { updateLayout } from './components/SidebarLayout';
import { initErrorBusBridge } from './errors/error-bus-bridge';
import { refreshPluginUI } from './stores/plugin-ui-actions';
import { openSettingsModal } from './stores/settings-modal-actions';
import { configureAppEventActions, handleAppEvent, readConfigCwdHistory, readConfigHomeFolder, readConfigMemoryMasterEnabled } from './services/app-event-actions';
import { configureWsMessageHandler } from './services/ws-message-handler';
import { applyEditorTypography } from './editor/typography';
import { createLocalServerConnection, hasServerConnection, mergeServerIdentity } from './services/server-connection';
// @ts-expect-error — shared JS module
import { errorBus as _errorBus } from '../../../shared/error-bus.js';
// @ts-expect-error — shared JS module
import { AppError as _AppError } from '../../../shared/errors.js';

declare const i18n: {
  locale: string;
  defaultName: string;
  load(locale: string): Promise<void>;
};
declare function t(key: string, vars?: Record<string, string | number>): string;

/* eslint-disable @typescript-eslint/no-explicit-any -- 全局 bootstrap：platform/IPC callback 签名含 any */

// ── __hanaLog：前端日志上报 ──
window.__hanaLog = function (level: string, module: string, message: string) {
  if (!hasServerConnection(useStore.getState())) return;
  hanaFetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, module, message }),
  }).catch(err => console.warn('[hanaLog] log upload failed:', err));
};

// ── 全局错误捕获 ──
window.addEventListener('error', (e) => {
  _errorBus.report(_AppError.wrap(e.error || e.message), {
    context: { filename: e.filename, line: e.lineno },
  });
});
window.addEventListener('unhandledrejection', (e) => {
  _errorBus.report(_AppError.wrap(e.reason));
});

// ── 主初始化流程 ──

export async function initApp(): Promise<void> {
  const platform = window.platform;

  const requestContextUsage = (sessionPath: string) => {
    const ws = getWebSocket();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'context_usage', sessionPath }));
    }
  };
  configureAppEventActions({ requestContextUsage });
  configureWsMessageHandler({ requestContextUsage });

  // 1. 获取 server 连接信息并存入 Zustand
  const serverPort = await platform.getServerPort();
  const serverToken = await platform.getServerToken();
  const activeServerConnection = createLocalServerConnection({ serverPort, serverToken });
  useStore.setState({ serverPort, serverToken, activeServerConnection });

  if (!activeServerConnection) {
    setStatus('status.serverNotReady', false);
    platform.appReady();
    return;
  }

  try {
    const identityRes = await hanaFetch('/api/server/identity');
    const identityData = await identityRes.json();
    useStore.setState({
      activeServerConnection: mergeServerIdentity(activeServerConnection, identityData),
    });
  } catch (err) {
    console.error('[init] server identity failed:', err);
    setStatus('status.serverNotReady', false);
    platform.appReady();
    return;
  }

  // 2. 并行获取 health + config
  try {
    const [healthRes, configRes] = await Promise.all([
      hanaFetch('/api/health'),
      hanaFetch('/api/config'),
    ]);
    const healthData = await healthRes.json();
    const configData = await configRes.json();
    applyEditorTypography(configData.editor);

    // 3. 加载 i18n
    await i18n.load(configData.locale || 'zh-CN');
    useStore.setState({ locale: i18n.locale });

    // 4. 应用 agent 身份
    await applyAgentIdentity({
      agentName: healthData.agent || 'Hanako',
      userName: healthData.user || t('common.user'),
      ui: { avatars: false, agents: false, welcome: true },
    });

    // 5. 设置 desk 相关状态
    const homeFolder = readConfigHomeFolder(configData);
    useStore.setState({
      homeFolder,
      selectedFolder: homeFolder,
      workspaceFolders: [],
      memoryMasterEnabled: readConfigMemoryMasterEnabled(configData),
    });
    useStore.setState({ cwdHistory: readConfigCwdHistory(configData) });

    // 6. 加载头像
    loadAvatars(healthData.avatars);
  } catch (err) {
    console.error('[init] i18n/health/config failed:', err);
  }

  // 8. 连接 WebSocket
  connectWebSocket();
  initErrorBusBridge();

  // 9. 加载模型
  await loadModels();

  // 10. 加载 agents + sessions
  useStore.setState({ pendingNewSession: true });
  await loadAgents();
  await loadSessions();

  // 11. 初始化书桌
  initJian();

  // 12. 注册派生 viewer 窗口关闭事件（清 pinnedViewers store）
  initViewerEvents();

  // 13. 初始 layout 计算
  updateLayout();

  // 14. 任务计划 badge 初始值
  try {
    const res = await hanaFetch('/api/desk/cron');
    const data = await res.json();
    const count = (data.jobs || []).length;
    useStore.setState({ automationCount: count });
  } catch { /* ignore */ }

  // 15. Bridge 状态指示点（启动时就查一次，不等用户打开面板）
  try {
    const res = await hanaFetch('/api/bridge/status');
    const data = await res.json();
    const anyConnected = data.telegram?.status === 'connected' || data.feishu?.status === 'connected' || data.qq?.status === 'connected' || data.wechat?.status === 'connected' || data.whatsapp?.status === 'connected';
    useStore.setState({ bridgeDotConnected: anyConnected });
  } catch { /* ignore */ }

  // 16. 加载插件 UI（pages / widgets）
  refreshPluginUI();

  // 18. 设置快捷键
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === ',') {
      e.preventDefault();
      openSettingsModal();
    }
  });

  // 19. 设置变更监听
  platform.onSettingsChanged((type: string, data: any) => {
    handleAppEvent(type, data);
  });

  // 20. 主进程请求打开设置：托盘 / 外部 IPC 统一落到主窗口 modal
  platform.onOpenSettingsModal?.((tab?: string) => {
    openSettingsModal(tab);
  });

  // 21. Skill Viewer overlay（主进程 / 设置窗口 → 渲染进程）
  window.hana?.onShowSkillViewer?.((data: any) => {
    useStore.setState({ skillViewerData: data });
  });

  // 22. 通知 app ready
  platform.appReady();
}
