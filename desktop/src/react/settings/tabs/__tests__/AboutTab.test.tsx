/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const getAutoLaunchStatus = vi.fn();
const setAutoLaunchEnabled = vi.fn();
const autoSaveConfig = vi.fn();
const loadSettingsConfig = vi.fn();

vi.mock('../../helpers', () => ({
  t: (key: string) => key,
  autoSaveConfig: (...args: unknown[]) => autoSaveConfig(...args),
}));

vi.mock('../../actions', () => ({
  loadSettingsConfig: (...args: unknown[]) => loadSettingsConfig(...args),
}));

vi.mock('../../../hooks/use-auto-update-state', () => ({
  useAutoUpdateState: () => ({ status: 'idle' }),
}));

vi.mock('../../widgets/Toggle', () => ({
  Toggle: ({
    on,
    onChange,
    label,
    disabled,
  }: {
    on: boolean;
    onChange: (next: boolean) => void;
    label?: string;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      aria-label={label}
      data-testid={`${label}-${on ? 'on' : 'off'}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      toggle
    </button>
  ),
}));

import { AboutTab } from '../AboutTab';
import { useSettingsStore } from '../../store';

afterEach(() => {
  cleanup();
  getAutoLaunchStatus.mockReset();
  setAutoLaunchEnabled.mockReset();
  autoSaveConfig.mockReset();
  loadSettingsConfig.mockReset();
  useSettingsStore.setState({ settingsConfig: null });
  vi.unstubAllGlobals();
});

function installHana(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('window', Object.assign(window, {
    hana: {
      getAppVersion: vi.fn().mockResolvedValue('0.160.2'),
      autoUpdateCheck: vi.fn(),
      autoUpdateInstall: vi.fn(),
      autoUpdateSetChannel: vi.fn(),
      openExternal: vi.fn(),
      getAutoLaunchStatus,
      setAutoLaunchEnabled,
      ...overrides,
    },
  }));
}

describe('AboutTab auto launch setting', () => {
  it('renders launch-at-login above automatic update settings when supported', async () => {
    installHana();
    useSettingsStore.setState({ settingsConfig: { auto_check_updates: true, update_channel: 'stable' } });
    getAutoLaunchStatus.mockResolvedValue({
      supported: true,
      openAtLogin: false,
      openedAtLogin: false,
      status: null,
    });

    render(<AboutTab />);

    const launchRow = await screen.findByText('settings.about.launchAtLogin');
    const autoUpdateRow = screen.getByText('settings.about.autoCheckUpdates');

    expect(launchRow.compareDocumentPosition(autoUpdateRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('settings.about.launchAtLogin-off')).toBeTruthy();
  });

  it('updates the launch-at-login row from the main-process result', async () => {
    installHana();
    useSettingsStore.setState({ settingsConfig: { auto_check_updates: true, update_channel: 'stable' } });
    getAutoLaunchStatus.mockResolvedValue({
      supported: true,
      openAtLogin: false,
      openedAtLogin: false,
      status: null,
    });
    setAutoLaunchEnabled.mockResolvedValue({
      supported: true,
      openAtLogin: true,
      openedAtLogin: false,
      status: null,
    });

    render(<AboutTab />);

    fireEvent.click(await screen.findByTestId('settings.about.launchAtLogin-off'));

    await waitFor(() => expect(setAutoLaunchEnabled).toHaveBeenCalledWith(true));
    await screen.findByTestId('settings.about.launchAtLogin-on');
  });

  it('does not render launch-at-login on unsupported platforms', async () => {
    installHana();
    useSettingsStore.setState({ settingsConfig: { auto_check_updates: true, update_channel: 'stable' } });
    getAutoLaunchStatus.mockResolvedValue({
      supported: false,
      openAtLogin: false,
      openedAtLogin: false,
      status: 'unsupported',
    });

    render(<AboutTab />);

    await waitFor(() => expect(getAutoLaunchStatus).toHaveBeenCalled());
    expect(screen.queryByText('settings.about.launchAtLogin')).toBeNull();
  });
});
