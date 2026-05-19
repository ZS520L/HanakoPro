/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockState extends Record<string, unknown> {
  activeTab?: string;
  ready?: boolean;
  set?: (patch: Record<string, unknown>) => void;
}

const mockState: MockState = {};
const mockHanaFetch = vi.fn();

vi.mock('../../settings/store', () => {
  const hook: any = (selector?: (s: MockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  hook.getState = () => mockState;
  hook.setState = (partial: Partial<MockState>) => Object.assign(mockState, partial);
  return { useSettingsStore: hook };
});

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => mockHanaFetch(...args),
}));

vi.mock('../../settings/actions', () => ({
  loadAgents: vi.fn(async () => {}),
  loadAvatars: vi.fn(async () => {}),
  loadSettingsConfig: vi.fn(async () => {}),
  loadPluginSettings: vi.fn(async () => {}),
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => {
    if (key === 'settings.title') return '设置';
    if (key === 'settings.back') return '返回';
    return key;
  },
}));

vi.mock('../../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../settings/Toast', () => ({
  Toast: () => null,
}));

vi.mock('../../settings/overlays/CropOverlay', () => ({ CropOverlay: () => null }));
vi.mock('../../settings/overlays/AgentCreateOverlay', () => ({ AgentCreateOverlay: () => null }));
vi.mock('../../settings/overlays/AgentDeleteOverlay', () => ({ AgentDeleteOverlay: () => null }));
vi.mock('../../settings/overlays/MemoryViewer', () => ({ MemoryViewer: () => null }));
vi.mock('../../settings/overlays/CompiledMemoryViewer', () => ({ CompiledMemoryViewer: () => null }));
vi.mock('../../settings/overlays/ClearMemoryConfirm', () => ({ ClearMemoryConfirm: () => null }));
vi.mock('../../settings/overlays/BridgeTutorial', () => ({ BridgeTutorial: () => null }));
vi.mock('../../settings/overlays/WechatQrcodeOverlay', () => ({ WechatQrcodeOverlay: () => null }));
vi.mock('../../components/InputContextMenu', () => ({ InputContextMenu: () => null }));

vi.mock('../../settings/tabs/AgentTab', () => ({ AgentTab: () => <div data-testid="active-tab">agent tab</div> }));
vi.mock('../../settings/tabs/MeTab', () => ({ MeTab: () => <div data-testid="active-tab">me tab</div> }));
vi.mock('../../settings/tabs/InterfaceTab', () => ({ InterfaceTab: () => <div data-testid="active-tab">interface tab</div> }));
vi.mock('../../settings/tabs/WorkTab', () => ({ WorkTab: () => <div data-testid="active-tab">work tab</div> }));
vi.mock('../../settings/tabs/ComputerUseTab', () => ({ ComputerUseTab: () => <div data-testid="active-tab">computer tab</div> }));
vi.mock('../../settings/tabs/SkillsTab', () => ({ SkillsTab: () => <div data-testid="active-tab">skills tab</div> }));
vi.mock('../../settings/tabs/BridgeTab', () => ({ BridgeTab: () => <div data-testid="active-tab">bridge tab</div> }));
vi.mock('../../settings/tabs/ProvidersTab', () => ({ ProvidersTab: () => <div data-testid="active-tab">providers tab</div> }));
vi.mock('../../settings/tabs/MediaTab', () => ({ MediaTab: () => <div data-testid="active-tab">media tab</div> }));
vi.mock('../../settings/tabs/AboutTab', () => ({ AboutTab: () => <div data-testid="active-tab">about tab</div> }));
vi.mock('../../settings/tabs/PluginsTab', () => ({ PluginsTab: () => <div data-testid="active-tab">plugins tab</div> }));
vi.mock('../../settings/tabs/SecurityTab', () => ({ SecurityTab: () => <div data-testid="active-tab">security tab</div> }));
vi.mock('../../settings/tabs/SharingTab', () => ({ SharingTab: () => <div data-testid="active-tab">sharing tab</div> }));

function resetState() {
  Object.keys(mockState).forEach(key => delete mockState[key]);
  Object.assign(mockState, {
    activeTab: 'agent',
    ready: true,
    set: vi.fn((patch: Record<string, unknown>) => Object.assign(mockState, patch)),
  });
}

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe('SettingsContent title placement', () => {
  beforeEach(() => {
    resetState();
    mockHanaFetch.mockReset();
    mockHanaFetch.mockResolvedValue(jsonResponse({ locale: 'zh-CN' }));
    window.platform = {
      getServerPort: vi.fn(async () => 62950),
      getServerToken: vi.fn(async () => 'token'),
    } as unknown as typeof window.platform;
    window.i18n = {
      load: vi.fn(async () => {}),
      t: (key: string) => key,
    } as unknown as typeof window.i18n;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
  });

  it('pins the active tab title beside the settings title in the modal header', async () => {
    const { SettingsContent } = await import('../../settings/SettingsContent');
    const { container } = render(<SettingsContent variant="modal" onClose={() => {}} />);

    const header = container.querySelector('.settings-header');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(within(header as HTMLElement).getByRole('heading', { name: '助手' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: '助手' })).toHaveLength(1);
  });

  it('keeps the tab title in the content area for the standalone settings window', async () => {
    const { SettingsContent } = await import('../../settings/SettingsContent');
    const { container } = render(<SettingsContent variant="window" listenToWindowTabSwitch />);

    const header = container.querySelector('.settings-header');
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).queryByRole('heading', { name: '助手' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '助手' })).toBeInTheDocument();
  });

  it('notifies the modal shell when the active settings tab changes', async () => {
    const onActiveTabChange = vi.fn();
    const { SettingsContent } = await import('../../settings/SettingsContent');
    render(<SettingsContent variant="modal" onClose={() => {}} onActiveTabChange={onActiveTabChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'settings.tabs.computer' }));

    expect(onActiveTabChange).toHaveBeenCalledTimes(1);
    expect(onActiveTabChange).toHaveBeenCalledWith('computer');
  });

  it('does not echo the initially rendered tab back to the modal shell', async () => {
    const onActiveTabChange = vi.fn();
    const { SettingsContent } = await import('../../settings/SettingsContent');
    render(<SettingsContent variant="modal" onClose={() => {}} onActiveTabChange={onActiveTabChange} />);

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/config');
    });
    expect(onActiveTabChange).not.toHaveBeenCalled();
  });

  it('renders the plugin marketplace as a full settings subpage', async () => {
    mockState.activeTab = 'plugin-marketplace';
    const { SettingsContent } = await import('../../settings/SettingsContent');
    render(<SettingsContent variant="window" />);

    expect(screen.getByRole('heading', { name: '插件市场' })).toBeInTheDocument();
    expect(screen.queryByText('agent tab')).not.toBeInTheDocument();
  });

  it('notifies the modal shell when content navigates to a hidden settings subpage after mount', async () => {
    const onActiveTabChange = vi.fn();
    const { SettingsContent } = await import('../../settings/SettingsContent');
    const { rerender } = render(<SettingsContent variant="modal" onClose={() => {}} onActiveTabChange={onActiveTabChange} />);

    onActiveTabChange.mockClear();
    mockState.activeTab = 'plugin-marketplace';
    rerender(<SettingsContent variant="modal" onClose={() => {}} onActiveTabChange={onActiveTabChange} />);

    await waitFor(() => {
      expect(onActiveTabChange).toHaveBeenCalledWith('plugin-marketplace');
    });
  });

  it('hides the Computer Use tab on Linux and redirects stale computer tabs', async () => {
    mockState.activeTab = 'computer';
    mockState.platformName = 'linux';
    const { SettingsContent } = await import('../../settings/SettingsContent');
    render(<SettingsContent variant="modal" onClose={() => {}} />);

    expect(screen.queryByRole('button', { name: 'settings.tabs.computer' })).not.toBeInTheDocument();
    expect(mockState.set).toHaveBeenCalledWith({ activeTab: 'agent' });
  });

  it('keeps activeServerConnection in sync when the settings window hears server restart', async () => {
    let restartHandler: ((data: { port: number }) => void) | null = null;
    window.platform = {
      getServerPort: vi.fn(async () => 62950),
      getServerToken: vi.fn(async () => 'token'),
      onServerRestarted: vi.fn((handler: (data: { port: number }) => void) => {
        restartHandler = handler;
        return vi.fn();
      }),
    } as unknown as typeof window.platform;

    const { SettingsContent } = await import('../../settings/SettingsContent');
    render(<SettingsContent variant="window" listenToWindowTabSwitch />);

    await waitFor(() => {
      expect(mockState.activeServerConnection).toEqual(expect.objectContaining({
        baseUrl: 'http://127.0.0.1:62950',
        token: 'token',
      }));
    });

    const handler = restartHandler;
    expect(handler).toBeTypeOf('function');
    if (!handler) throw new Error('server restart handler was not registered');
    (handler as unknown as (data: { port: number }) => void)({ port: 63000 });

    expect(mockState.serverPort).toBe(63000);
    expect(mockState.activeServerConnection).toEqual(expect.objectContaining({
      baseUrl: 'http://127.0.0.1:63000',
      wsUrl: 'ws://127.0.0.1:63000',
      token: 'token',
    }));
  });
});
