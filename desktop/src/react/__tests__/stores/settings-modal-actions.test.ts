import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../stores';
import {
  closeSettingsModal,
  openSettingsModal,
  setSettingsModalActiveTab,
} from '../../stores/settings-modal-actions';

describe('settings modal actions', () => {
  beforeEach(() => {
    useStore.setState({
      settingsModal: { open: false, activeTab: 'agent' },
    } as never);
  });

  it('opens the settings modal on the agent tab by default', () => {
    openSettingsModal();

    expect(useStore.getState().settingsModal).toEqual({
      open: true,
      activeTab: 'agent',
    });
  });

  it('opens the settings modal on the requested tab', () => {
    openSettingsModal('work');

    expect(useStore.getState().settingsModal).toEqual({
      open: true,
      activeTab: 'work',
    });
  });

  it('closes the settings modal while preserving the last tab', () => {
    openSettingsModal('bridge');
    closeSettingsModal();

    expect(useStore.getState().settingsModal).toEqual({
      open: false,
      activeTab: 'bridge',
    });
  });

  it('reopens on the last tab during the same runtime when no tab is requested', () => {
    openSettingsModal('computer');
    closeSettingsModal();
    openSettingsModal();

    expect(useStore.getState().settingsModal).toEqual({
      open: true,
      activeTab: 'computer',
    });
  });

  it('updates the remembered modal tab while it remains open', () => {
    openSettingsModal('agent');
    setSettingsModalActiveTab('security');

    expect(useStore.getState().settingsModal).toEqual({
      open: true,
      activeTab: 'security',
    });
  });
});
