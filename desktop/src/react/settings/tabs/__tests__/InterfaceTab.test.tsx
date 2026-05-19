// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InterfaceTab } from '../InterfaceTab';
import { useSettingsStore } from '../../store';
import registry from '../../../../shared/theme-registry';

type AppearanceGlobals = typeof globalThis & {
  setTheme?: (theme: string) => void;
  setSerifFont?: (enabled: boolean) => void;
  setPaperTexture?: (enabled: boolean) => void;
};

function setAppearanceGlobals() {
  (globalThis as AppearanceGlobals).setTheme = vi.fn((theme: string) => {
    localStorage.setItem('hana-theme', theme);
    document.documentElement.setAttribute('data-theme', theme === 'auto' ? registry.DEFAULT_THEME : theme);
  });
  (globalThis as AppearanceGlobals).setSerifFont = vi.fn((enabled: boolean) => {
    localStorage.setItem('hana-font-serif', enabled ? '1' : '0');
    document.body.classList.toggle('font-sans', !enabled);
  });
  (globalThis as AppearanceGlobals).setPaperTexture = vi.fn((enabled: boolean) => {
    localStorage.setItem('hana-paper-texture', enabled ? '1' : '0');
  });
}

function seedSettings() {
  useSettingsStore.setState({
    settingsConfig: {
      locale: 'zh-CN',
      timezone: 'Asia/Shanghai',
      editor: {},
    },
    currentAgentId: 'agent-1',
    settingsAgentId: 'agent-1',
  } as never);
}

describe('InterfaceTab appearance state', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    document.body.className = '';
    document.documentElement.setAttribute('data-theme', registry.DEFAULT_THEME);
    window.t = ((key: string) => key) as typeof window.t;
    window.platform = {
      settingsChanged: vi.fn(),
    } as unknown as typeof window.platform;
    setAppearanceGlobals();
    seedSettings();
  });

  it('updates the serif font toggle from component state after the preference changes', () => {
    localStorage.setItem('hana-font-serif', '1');

    render(React.createElement(InterfaceTab));

    expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getAllByRole('switch')[0]);

    expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('false');
  });

  it('recomputes paper texture availability when the selected theme changes', () => {
    localStorage.setItem('hana-theme', registry.DEFAULT_THEME);
    localStorage.setItem('hana-paper-texture', '1');

    render(React.createElement(InterfaceTab));

    const paperSwitch = () => screen.getAllByRole('switch')[1] as HTMLButtonElement;
    expect(paperSwitch().getAttribute('aria-checked')).toBe('true');
    expect(paperSwitch().disabled).toBe(false);

    const midnightTheme = screen.getByText('settings.appearance.midnight').closest('button');
    expect(midnightTheme).toBeTruthy();
    fireEvent.click(midnightTheme!);

    expect(paperSwitch().getAttribute('aria-checked')).toBe('false');
    expect(paperSwitch().disabled).toBe(true);
  });
});
