import { useStore } from './index';

const DEFAULT_SETTINGS_TAB = 'agent';

export function openSettingsModal(tab?: string): void {
  const current = useStore.getState().settingsModal;
  const activeTab = tab || current?.activeTab || DEFAULT_SETTINGS_TAB;
  useStore.setState({
    settingsModal: {
      open: true,
      activeTab,
    },
  });
}

export function closeSettingsModal(): void {
  const current = useStore.getState().settingsModal;
  useStore.setState({
    settingsModal: {
      open: false,
      activeTab: current?.activeTab || DEFAULT_SETTINGS_TAB,
    },
  });
}

export function setSettingsModalActiveTab(tab: string): void {
  const current = useStore.getState().settingsModal;
  useStore.setState({
    settingsModal: {
      open: current?.open ?? false,
      activeTab: tab || current?.activeTab || DEFAULT_SETTINGS_TAB,
    },
  });
}
