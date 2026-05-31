// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesktopPetTab } from '../DesktopPetTab';
import { useSettingsStore } from '../../store';
import type { DesktopPetState } from '../../../types';

const enabledState: DesktopPetState = {
  enabled: true,
  visible: true,
  backgroundOnly: false,
  alwaysOnTop: true,
  clickThrough: false,
  scale: 1,
  mood: 'idle',
  message: '',
  customImages: {},
};

const disabledState: DesktopPetState = {
  ...enabledState,
  enabled: false,
  visible: false,
};

beforeEach(() => {
  window.t = ((key: string) => key) as typeof window.t;
  useSettingsStore.setState({
    toastMessage: '',
    toastType: '',
    toastVisible: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.platform = undefined as unknown as typeof window.platform;
});

describe('DesktopPetTab', () => {
  it('toggles desktop pet visibility from settings', async () => {
    const desktopPetSetState = vi.fn().mockResolvedValue(disabledState);
    window.platform = {
      desktopPetGetState: vi.fn().mockResolvedValue(enabledState),
      desktopPetSetState,
      onDesktopPetState: vi.fn(),
    } as unknown as typeof window.platform;

    render(<DesktopPetTab />);

    const toggle = await screen.findByRole('switch', { name: '关闭桌宠' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(desktopPetSetState).toHaveBeenCalledWith({ enabled: false, visible: false });
    });
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: '开启桌宠' }).getAttribute('aria-checked')).toBe('false');
    });
  });
});
