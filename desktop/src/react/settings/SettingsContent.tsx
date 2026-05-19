import React, { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSettingsStore } from './store';
import { hanaFetch } from './api';
import { createLocalServerConnection } from '../services/server-connection';
import { t } from './helpers';
import { loadAgents, loadAvatars, loadSettingsConfig, loadPluginSettings } from './actions';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SettingsNav } from './SettingsNav';
import { Toast } from './Toast';
import { AgentTab } from './tabs/AgentTab';
import { MeTab } from './tabs/MeTab';
import { InterfaceTab } from './tabs/InterfaceTab';
import { WorkTab } from './tabs/WorkTab';
import { ComputerUseTab } from './tabs/ComputerUseTab';
import { SkillsTab } from './tabs/SkillsTab';
import { BridgeTab } from './tabs/BridgeTab';
import { ProvidersTab } from './tabs/ProvidersTab';
import { MediaTab } from './tabs/MediaTab';
import { AboutTab } from './tabs/AboutTab';
import { PluginsTab } from './tabs/PluginsTab';
import { PluginMarketplaceTab } from './tabs/PluginMarketplaceTab';
import { SecurityTab } from './tabs/SecurityTab';
import { SharingTab } from './tabs/SharingTab';
import { getNativeSettingsTabComponent } from './native-settings-tabs';
import { CropOverlay } from './overlays/CropOverlay';
import { AgentCreateOverlay } from './overlays/AgentCreateOverlay';
import { AgentDeleteOverlay } from './overlays/AgentDeleteOverlay';
import { MemoryViewer } from './overlays/MemoryViewer';
import { CompiledMemoryViewer } from './overlays/CompiledMemoryViewer';
import { ClearMemoryConfirm } from './overlays/ClearMemoryConfirm';
import { BridgeTutorial } from './overlays/BridgeTutorial';
import { WechatQrcodeOverlay } from './overlays/WechatQrcodeOverlay';
import { InputContextMenu } from '../components/InputContextMenu';
import styles from './Settings.module.css';

const TAB_COMPONENTS: Record<string, React.ComponentType> = {
  agent: AgentTab,
  me: MeTab,
  interface: InterfaceTab,
  work: WorkTab,
  computer: ComputerUseTab,
  skills: SkillsTab,
  bridge: BridgeTab,
  providers: ProvidersTab,
  media: MediaTab,
  sharing: SharingTab,
  plugins: PluginsTab,
  'plugin-marketplace': PluginMarketplaceTab,
  security: SecurityTab,
  about: AboutTab,
};

/** Tab 顶部大标题（对应左栏导航 label），所有 tab 都会显示 */
const TAB_TITLES: Record<string, string> = {
  agent: '助手',
  me: '我',
  interface: '界面',
  work: '工作空间',
  computer: '使用电脑',
  skills: '技能',
  bridge: '社交平台',
  providers: '供应商',
  media: '多媒体',
  sharing: '分享',
  plugins: '插件',
  'plugin-marketplace': '插件市场',
  security: '安全',
  about: '关于',
};

function normalizeNativeTabForPlatform(tab: string, platformName: string | null | undefined): string {
  return platformName === 'linux' && tab === 'computer' ? 'agent' : tab;
}

function titleToLabel(title: string | Record<string, string> | undefined): string {
  if (!title) return '';
  if (typeof title === 'string') return title;
  const locale = window.i18n?.locale || 'zh-CN';
  return title[locale] || title[locale.split('-')[0]] || title.zh || title.en || Object.values(title)[0] || '';
}

interface SettingsContentProps {
  variant: 'window' | 'modal';
  onClose?: () => void;
  onActiveTabChange?: (tab: string) => void;
  listenToWindowTabSwitch?: boolean;
}

export function SettingsContent({
  variant,
  onClose,
  onActiveTabChange,
  listenToWindowTabSwitch = false,
}: SettingsContentProps) {
  const { activeTab, platformName, pluginSettingsTabs, ready } = useSettingsStore(
    useShallow(s => ({ activeTab: s.activeTab, platformName: s.platformName, pluginSettingsTabs: s.pluginSettingsTabs, ready: s.ready }))
  );
  const set = useSettingsStore(s => s.set);
  const lastReportedActiveTabRef = useRef<string | null>(null);

  useEffect(() => {
    initSettings();
  }, []);

  useEffect(() => {
    if (!listenToWindowTabSwitch) return;
    const platform = window.platform;
    if (!platform?.onSwitchTab) return;
    const unsubscribe = platform.onSwitchTab((tab: string) => {
      const nextTab = normalizeNativeTabForPlatform(tab, useSettingsStore.getState().platformName);
      set({ activeTab: nextTab });
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [listenToWindowTabSwitch, set]);

  useEffect(() => {
    const nextTab = normalizeNativeTabForPlatform(activeTab, platformName);
    if (nextTab !== activeTab) {
      set({ activeTab: nextTab });
      lastReportedActiveTabRef.current = nextTab;
      onActiveTabChange?.(nextTab);
    }
  }, [activeTab, platformName, set, onActiveTabChange]);

  // Server 重启后用新端口重新加载数据
  useEffect(() => {
    const platform = window.platform;
    if (!platform?.onServerRestarted) return;
    const unsubscribe = platform.onServerRestarted((data: { port: number }) => {
      const store = useSettingsStore.getState();
      console.log('[settings] server restarted, new port:', data.port);
      store.set({
        serverPort: data.port,
        activeServerConnection: createLocalServerConnection({
          serverPort: data.port,
          serverToken: store.serverToken,
        }),
      });
      loadAgents().catch(() => {});
      loadSettingsConfig().catch(() => {});
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, []);

  const availablePluginSettingsTabs = pluginSettingsTabs || [];
  const effectiveActiveTab = normalizeNativeTabForPlatform(activeTab, platformName);
  const dynamicTab = availablePluginSettingsTabs.find(tab => tab.id === effectiveActiveTab);
  const ActiveTab = TAB_COMPONENTS[effectiveActiveTab]
    || (dynamicTab ? getNativeSettingsTabComponent(dynamicTab.nativeComponent) : null)
    || AgentTab;
  const isModal = variant === 'modal';
  const activeTabTitle = TAB_TITLES[effectiveActiveTab] || titleToLabel(dynamicTab?.title);
  const isWideTab = effectiveActiveTab === 'plugin-marketplace';

  const reportActiveTabChange = useCallback((tab: string) => {
    const nextTab = normalizeNativeTabForPlatform(tab, platformName);
    lastReportedActiveTabRef.current = nextTab;
    onActiveTabChange?.(nextTab);
  }, [onActiveTabChange, platformName]);

  useEffect(() => {
    if (lastReportedActiveTabRef.current === null) {
      lastReportedActiveTabRef.current = effectiveActiveTab;
      return;
    }
    if (lastReportedActiveTabRef.current === effectiveActiveTab) return;
    lastReportedActiveTabRef.current = effectiveActiveTab;
    onActiveTabChange?.(effectiveActiveTab);
  }, [effectiveActiveTab, onActiveTabChange]);

  return (
    <ErrorBoundary region="settings">
      <div
        className={`settings-panel ${isModal ? styles['settings-panel-modal'] : ''}${isWideTab ? ' ' + styles['settings-panel-wide'] : ''}`}
        id="settingsPanel"
      >
        <div className={`settings-header ${isModal ? styles['settings-header-modal'] : ''}`}>
          {isModal ? (
            <>
              <div className={styles['settings-title-group']}>
                <button
                  type="button"
                  className={styles['settings-return-btn']}
                  onClick={onClose}
                  aria-label={t('settings.back')}
                  data-settings-return
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <h1 className={styles['settings-title']}>{t('settings.title')}</h1>
              </div>
              <h1 className={styles['settings-header-tab-title']}>{activeTabTitle}</h1>
            </>
          ) : (
            <h1 className={styles['settings-title']}>{t('settings.title')}</h1>
          )}
        </div>
        <div className={styles['settings-body']}>
          <SettingsNav onTabChange={reportActiveTabChange} />
          <div className={`${styles['settings-main']}${isWideTab ? ' ' + styles['settings-main-wide'] : ''}`}>
            {!isModal && (
              <h1 className={styles['settings-tab-title']}>{activeTabTitle}</h1>
            )}
            <ErrorBoundary region={effectiveActiveTab} resetKeys={[effectiveActiveTab]}>
              <ActiveTab />
            </ErrorBoundary>
          </div>
        </div>
      </div>

      <Toast />
      <CropOverlay />
      <AgentCreateOverlay />
      <AgentDeleteOverlay />
      <MemoryViewer />
      <CompiledMemoryViewer />
      <ClearMemoryConfirm />
      <BridgeTutorial />
      <WechatQrcodeOverlay />
      <InputContextMenu />

      {!ready && (
        <div className="settings-loading-mask" id="settingsLoadingMask">
          <div className={styles['settings-loading-text']}>
            loading...
          </div>
        </div>
      )}
    </ErrorBoundary>
  );
}

/** 初始化：加载 port/token → i18n → agents → 头像 → config */
async function initSettings() {
  const platform = window.platform;
  const store = useSettingsStore.getState();

  // 超时保护：15 秒后强制显示，防止无限白屏
  const timeout = setTimeout(() => {
    if (!store.ready) {
      console.warn('[settings] init timeout (15s), forcing ready');
      store.set({ ready: true });
    }
  }, 15_000);

  try {
    const serverPort = Number(await platform.getServerPort());
    const serverToken = await platform.getServerToken();
    let platformName: string | null = null;
    try {
      platformName = typeof platform.getPlatform === 'function' ? await platform.getPlatform() : null;
    } catch {
      platformName = null;
    }
    store.set({
      serverPort,
      serverToken,
      platformName,
      activeServerConnection: createLocalServerConnection({ serverPort, serverToken }),
    });

    // i18n
    const i18n = window.i18n;
    try {
      const cfgRes = await hanaFetch('/api/config');
      const cfg = await cfgRes.json();
      const locale = cfg.locale || 'zh-CN';
      await i18n.load(locale);
    } catch {
      try { await i18n.load('zh-CN'); } catch { /* i18n fallback failed, continue */ }
    }

    // agents
    await loadAgents();

    // avatars
    await loadAvatars();

    // config + plugin settings
    await Promise.all([loadSettingsConfig(), loadPluginSettings()]);

    store.set({ ready: true });
  } catch (err) {
    console.error('[settings] init failed:', err);
    store.set({ ready: true }); // 即使失败也移除 mask，让用户能操作
  } finally {
    clearTimeout(timeout);
  }
}
