/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';

vi.mock('../../settings/SettingsContent', () => ({
  SettingsContent: ({
    variant,
    onClose,
    onActiveTabChange,
  }: {
    variant: string;
    onClose?: () => void;
    onActiveTabChange?: (tab: string) => void;
  }) => (
    <>
      {variant === 'modal' && (
        <button type="button" aria-label="返回" onClick={onClose}>
          返回
        </button>
      )}
      <button type="button" aria-label="切到使用电脑" onClick={() => onActiveTabChange?.('computer')}>
        切到使用电脑
      </button>
      <div data-testid="settings-content" data-variant={variant}>
        settings content
      </div>
    </>
  ),
}));

describe('SettingsModalShell', () => {
  beforeEach(() => {
    vi.stubGlobal('t', (key: string) => {
      if (key === 'settings.title') return '设置';
      if (key === 'settings.back') return '返回';
      return key;
    });
    window.t = globalThis.t as typeof window.t;
    useStore.setState({
      settingsModal: { open: false, activeTab: 'agent' },
    } as never);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => (
      window.setTimeout(() => cb(performance.now()), 0)
    ) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      window.clearTimeout(id);
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders the settings content inside a modal dialog when open', async () => {
    const { SettingsModalShell } = await import('../../components/SettingsModalShell');
    useStore.setState({
      settingsModal: { open: true, activeTab: 'work' },
    } as never);

    render(<SettingsModalShell />);

    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByTestId('settings-content')).toHaveAttribute('data-variant', 'modal');
  });

  it('widens the settings dialog for the plugin marketplace subpage', async () => {
    const { SettingsModalShell } = await import('../../components/SettingsModalShell');
    useStore.setState({
      settingsModal: { open: true, activeTab: 'plugin-marketplace' },
    } as never);

    render(<SettingsModalShell />);

    expect(screen.getByRole('dialog', { name: '设置' })).toHaveAttribute('data-wide', 'true');
  });

  it('animates from opening to open on the next frame', async () => {
    const { SettingsModalShell } = await import('../../components/SettingsModalShell');
    vi.useFakeTimers();
    useStore.setState({
      settingsModal: { open: true, activeTab: 'work' },
    } as never);

    render(<SettingsModalShell />);

    expect(screen.getByTestId('settings-modal-overlay')).toHaveAttribute('data-state', 'opening');

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.getByTestId('settings-modal-overlay')).toHaveAttribute('data-state', 'open');
  });

  it('closes from the large return button after the close animation', async () => {
    const { SettingsModalShell } = await import('../../components/SettingsModalShell');
    vi.useFakeTimers();
    useStore.setState({
      settingsModal: { open: true, activeTab: 'work' },
    } as never);

    render(<SettingsModalShell />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));

    // 新实现：点击后 store 立即变 open=false，但卡片仍渲染并播退场动画
    expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByTestId('settings-modal-overlay')).toHaveAttribute('data-state', 'closing');
    expect(useStore.getState().settingsModal).toEqual({
      open: false,
      activeTab: 'work',
    });

    // 退场动画结束后卡片应从 DOM 移除
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(screen.queryByTestId('settings-modal-overlay')).not.toBeInTheDocument();
  });

  it('closes on Escape after the close animation', async () => {
    const { SettingsModalShell } = await import('../../components/SettingsModalShell');
    vi.useFakeTimers();
    useStore.setState({
      settingsModal: { open: true, activeTab: 'bridge' },
    } as never);

    render(<SettingsModalShell />);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.getByTestId('settings-modal-overlay')).toHaveAttribute('data-state', 'closing');

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(useStore.getState().settingsModal).toEqual({
      open: false,
      activeTab: 'bridge',
    });
  });

  it('closes when clicking the blurred overlay outside the settings card after the close animation', async () => {
    const { SettingsModalShell } = await import('../../components/SettingsModalShell');
    vi.useFakeTimers();
    useStore.setState({
      settingsModal: { open: true, activeTab: 'work' },
    } as never);

    render(<SettingsModalShell />);
    fireEvent.mouseDown(screen.getByTestId('settings-modal-overlay'));

    expect(screen.getByTestId('settings-modal-overlay')).toHaveAttribute('data-state', 'closing');

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(useStore.getState().settingsModal).toEqual({
      open: false,
      activeTab: 'work',
    });
  });

  it('does not close when clicking inside the settings card', async () => {
    const { SettingsModalShell } = await import('../../components/SettingsModalShell');
    useStore.setState({
      settingsModal: { open: true, activeTab: 'work' },
    } as never);

    render(<SettingsModalShell />);
    fireEvent.mouseDown(screen.getByRole('dialog', { name: '设置' }));

    expect(useStore.getState().settingsModal).toEqual({
      open: true,
      activeTab: 'work',
    });
  });

  it('remembers the active settings tab after switching inside the modal', async () => {
    const { SettingsModalShell } = await import('../../components/SettingsModalShell');
    useStore.setState({
      settingsModal: { open: true, activeTab: 'agent' },
    } as never);

    render(<SettingsModalShell />);
    fireEvent.click(screen.getByRole('button', { name: '切到使用电脑' }));

    expect(useStore.getState().settingsModal).toEqual({
      open: true,
      activeTab: 'computer',
    });
  });
});
