import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockState = Record<string, unknown>;

const mockState: MockState = {};

const mockHanaFetch = vi.fn();
const mockApplyAgentIdentity = vi.fn(async () => {});
const mockLoadAgents = vi.fn(async () => {});
const mockLoadAvatars = vi.fn();
const mockLoadSessions = vi.fn(async () => {});
const mockSwitchSession = vi.fn(async () => {});
const mockConnectWebSocket = vi.fn();
const mockGetWebSocket = vi.fn<() => WebSocket | null>(() => null);
const mockSetStatus = vi.fn();
const mockLoadModels = vi.fn(async () => {});
const mockInitJian = vi.fn();
const mockActivateWorkspaceDesk = vi.fn(async (root: string | null) => {
  mockState.deskBasePath = root || '';
  mockState.deskCurrentPath = '';
  mockState.deskFiles = [];
  mockState.deskJianContent = null;
});
const mockLoadChannels = vi.fn();
const mockInitViewerEvents = vi.fn();
const mockUpdateLayout = vi.fn();
const mockInitErrorBusBridge = vi.fn();
const mockRefreshPluginUI = vi.fn();

vi.mock('../stores', () => ({
  useStore: {
    getState: () => mockState,
    setState: (patch: MockState | ((s: MockState) => MockState)) => {
      const next = typeof patch === 'function' ? patch(mockState) : patch;
      Object.assign(mockState, next);
    },
  },
}));

vi.mock('../hooks/use-hana-fetch', () => ({
  hanaFetch: mockHanaFetch,
}));

vi.mock('../stores/agent-actions', () => ({
  applyAgentIdentity: mockApplyAgentIdentity,
  loadAgents: mockLoadAgents,
  loadAvatars: mockLoadAvatars,
}));

vi.mock('../stores/session-actions', () => ({
  loadSessions: mockLoadSessions,
  switchSession: mockSwitchSession,
}));

vi.mock('../services/websocket', () => ({
  connectWebSocket: mockConnectWebSocket,
  getWebSocket: mockGetWebSocket,
}));

vi.mock('../utils/ui-helpers', () => ({
  setStatus: mockSetStatus,
  loadModels: mockLoadModels,
}));

vi.mock('../stores/desk-actions', () => ({
  initJian: mockInitJian,
  activateWorkspaceDesk: mockActivateWorkspaceDesk,
}));

vi.mock('../stores/channel-actions', () => ({
  loadChannels: mockLoadChannels,
}));

vi.mock('../stores/preview-actions', () => ({
  initViewerEvents: mockInitViewerEvents,
}));

vi.mock('../components/SidebarLayout', () => ({
  updateLayout: mockUpdateLayout,
}));

vi.mock('../errors/error-bus-bridge', () => ({
  initErrorBusBridge: mockInitErrorBusBridge,
}));

vi.mock('../stores/plugin-ui-actions', () => ({
  refreshPluginUI: mockRefreshPluginUI,
}));

vi.mock('../../../../shared/error-bus.js', () => ({
  errorBus: { report: vi.fn() },
}));

vi.mock('../../../../shared/errors.js', () => ({
  AppError: { wrap: (x: unknown) => x },
}));

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

function serverIdentityResponse(partial: Record<string, unknown> = {}): Response {
  return jsonResponse({
    serverId: 'server_test',
    userId: 'user_test',
    spaceId: 'space_test',
    label: 'Test Server',
    userLabel: 'Test User',
    spaceLabel: 'Test Space',
    trustState: 'local',
    authState: 'paired',
    capabilities: ['chat', 'resources', 'tools'],
    version: '0.test',
    ...partial,
  });
}

describe('initApp bridge indicator', () => {
  beforeEach(() => {
    Object.keys(mockState).forEach(k => delete mockState[k]);
    mockHanaFetch.mockReset();
    mockApplyAgentIdentity.mockReset();
    mockLoadAgents.mockReset();
    mockLoadAvatars.mockReset();
    mockLoadSessions.mockReset();
    mockSwitchSession.mockReset();
    mockConnectWebSocket.mockReset();
    mockGetWebSocket.mockReset();
    mockSetStatus.mockReset();
    mockLoadModels.mockReset();
    mockInitJian.mockReset();
    mockActivateWorkspaceDesk.mockReset();
    mockActivateWorkspaceDesk.mockImplementation(async (root: string | null) => {
      mockState.deskBasePath = root || '';
      mockState.deskCurrentPath = '';
      mockState.deskFiles = [];
      mockState.deskJianContent = null;
    });
    mockLoadChannels.mockReset();
    mockInitViewerEvents.mockReset();
    mockUpdateLayout.mockReset();
    mockInitErrorBusBridge.mockReset();
    mockRefreshPluginUI.mockReset();
    vi.resetModules();
  });

  it('treats wechat as a connected bridge when bootstrapping the sidebar dot', async () => {
    const listeners: Record<string, Array<(data?: unknown) => void>> = {};
    (globalThis as Record<string, unknown>).window = {
      addEventListener: vi.fn((type: string, cb: (data?: unknown) => void) => {
        listeners[type] ||= [];
        listeners[type].push(cb);
      }),
      platform: {
        getServerPort: vi.fn(async () => 62950),
        getServerToken: vi.fn(async () => 'token'),
        appReady: vi.fn(),
        onSettingsChanged: vi.fn(),
        openSettings: vi.fn(),
      },
      dispatchEvent: vi.fn(),
    };
    (globalThis as Record<string, unknown>).document = {
      addEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).i18n = {
      locale: 'zh-CN',
      defaultName: 'Hanako',
      load: vi.fn(async () => {}),
    };
    (globalThis as Record<string, unknown>).t = vi.fn((key: string) => key);

    mockHanaFetch
      .mockResolvedValueOnce(serverIdentityResponse())
      .mockResolvedValueOnce(jsonResponse({ agent: 'Hanako', user: 'User', avatars: {} }))
      .mockResolvedValueOnce(jsonResponse({ locale: 'zh-CN', desk: { home_folder: null }, cwd_history: [] }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }))
      .mockResolvedValueOnce(jsonResponse({
        telegram: { status: 'disconnected' },
        feishu: { status: 'disconnected' },
        qq: { status: 'disconnected' },
        wechat: { status: 'connected' },
      }));

    const { initApp } = await import('../app-init');
    await initApp();

    expect(mockState.activeServerConnection).toEqual({
      serverId: 'server_test',
      userId: 'user_test',
      spaceId: 'space_test',
      label: 'Test Server',
      userLabel: 'Test User',
      spaceLabel: 'Test Space',
      serverVersion: '0.test',
      baseUrl: 'http://127.0.0.1:62950',
      wsUrl: 'ws://127.0.0.1:62950',
      token: 'token',
      authState: 'paired',
      trustState: 'local',
      capabilities: ['chat', 'resources', 'tools'],
    });
    expect(mockState.bridgeDotConnected).toBe(true);
  });

  it('stops startup explicitly when server identity cannot be loaded', async () => {
    (globalThis as Record<string, unknown>).window = {
      addEventListener: vi.fn(),
      platform: {
        getServerPort: vi.fn(async () => 62950),
        getServerToken: vi.fn(async () => 'token'),
        appReady: vi.fn(),
        onSettingsChanged: vi.fn(),
        openSettings: vi.fn(),
      },
      dispatchEvent: vi.fn(),
    };
    (globalThis as Record<string, unknown>).document = {
      addEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).i18n = {
      locale: 'zh-CN',
      defaultName: 'Hanako',
      load: vi.fn(async () => {}),
    };
    (globalThis as Record<string, unknown>).t = vi.fn((key: string) => key);

    mockHanaFetch.mockRejectedValueOnce(new Error('identity unavailable'));

    const { initApp } = await import('../app-init');
    await initApp();

    expect(mockHanaFetch).toHaveBeenCalledWith('/api/server/identity');
    expect(mockSetStatus).toHaveBeenCalledWith('status.serverNotReady', false);
    expect(mockLoadModels).not.toHaveBeenCalled();
    expect(mockConnectWebSocket).not.toHaveBeenCalled();
    expect((window.platform.appReady as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('initializes the pending workspace from agent home even when cwd history points elsewhere', async () => {
    (globalThis as Record<string, unknown>).window = {
      addEventListener: vi.fn(),
      platform: {
        getServerPort: vi.fn(async () => 62950),
        getServerToken: vi.fn(async () => 'token'),
        appReady: vi.fn(),
        onSettingsChanged: vi.fn(),
        openSettings: vi.fn(),
      },
      dispatchEvent: vi.fn(),
    };
    (globalThis as Record<string, unknown>).document = {
      addEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).i18n = {
      locale: 'zh-CN',
      defaultName: 'Hanako',
      load: vi.fn(async () => {}),
    };
    (globalThis as Record<string, unknown>).t = vi.fn((key: string) => key);

    mockHanaFetch
      .mockResolvedValueOnce(serverIdentityResponse())
      .mockResolvedValueOnce(jsonResponse({ agent: 'Hanako', user: 'User', avatars: {} }))
      .mockResolvedValueOnce(jsonResponse({
        locale: 'zh-CN',
        desk: { home_folder: '/agent-home' },
        cwd_history: ['/desktop'],
      }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }))
      .mockResolvedValueOnce(jsonResponse({
        telegram: { status: 'disconnected' },
        feishu: { status: 'disconnected' },
        qq: { status: 'disconnected' },
        wechat: { status: 'disconnected' },
      }));

    const { initApp } = await import('../app-init');
    await initApp();

    expect(mockState.homeFolder).toBe('/agent-home');
    expect(mockState.selectedFolder).toBe('/agent-home');
    expect(mockState.cwdHistory).toEqual(['/desktop']);
    expect(mockState.workspaceFolders).toEqual([]);
    expect(mockInitJian).toHaveBeenCalledTimes(1);
  });

  it('refreshes the desk default workspace when settings change the current agent workspace', async () => {
    let settingsHandler: ((type: string, data: any) => void) | null = null;
    (globalThis as Record<string, unknown>).window = {
      addEventListener: vi.fn(),
      platform: {
        getServerPort: vi.fn(async () => 62950),
        getServerToken: vi.fn(async () => 'token'),
        appReady: vi.fn(),
        onSettingsChanged: vi.fn((cb: (type: string, data: any) => void) => {
          settingsHandler = cb;
        }),
        openSettings: vi.fn(),
      },
      dispatchEvent: vi.fn(),
    };
    (globalThis as Record<string, unknown>).document = {
      addEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).i18n = {
      locale: 'zh-CN',
      defaultName: 'Hanako',
      load: vi.fn(async () => {}),
    };
    (globalThis as Record<string, unknown>).t = vi.fn((key: string) => key);

    mockHanaFetch
      .mockResolvedValueOnce(serverIdentityResponse())
      .mockResolvedValueOnce(jsonResponse({ agent: 'Hanako', user: 'User', avatars: {} }))
      .mockResolvedValueOnce(jsonResponse({ locale: 'zh-CN', desk: { home_folder: '/old-home' }, cwd_history: [] }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }))
      .mockResolvedValueOnce(jsonResponse({
        telegram: { status: 'disconnected' },
        feishu: { status: 'disconnected' },
        qq: { status: 'disconnected' },
        wechat: { status: 'disconnected' },
      }));

    const { initApp } = await import('../app-init');
    await initApp();

    Object.assign(mockState, {
      currentAgentId: 'agent-a',
      homeFolder: '/old-home',
      selectedFolder: '/old-home',
      deskBasePath: '/old-home',
      pendingNewSession: true,
      currentSessionPath: null,
    });
    mockActivateWorkspaceDesk.mockClear();

    (settingsHandler as unknown as (type: string, data: any) => void)('agent-workspace-changed', {
      agentId: 'agent-a',
      homeFolder: '/new-home',
    });

    expect(mockState.homeFolder).toBe('/new-home');
    expect(mockState.selectedFolder).toBe('/new-home');
    expect(mockActivateWorkspaceDesk).toHaveBeenCalledWith('/new-home');
  });

  it('ignores workspace changes for non-current agents', async () => {
    let settingsHandler: ((type: string, data: any) => void) | null = null;
    (globalThis as Record<string, unknown>).window = {
      addEventListener: vi.fn(),
      platform: {
        getServerPort: vi.fn(async () => 62950),
        getServerToken: vi.fn(async () => 'token'),
        appReady: vi.fn(),
        onSettingsChanged: vi.fn((cb: (type: string, data: any) => void) => {
          settingsHandler = cb;
        }),
        openSettings: vi.fn(),
      },
      dispatchEvent: vi.fn(),
    };
    (globalThis as Record<string, unknown>).document = {
      addEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).i18n = {
      locale: 'zh-CN',
      defaultName: 'Hanako',
      load: vi.fn(async () => {}),
    };
    (globalThis as Record<string, unknown>).t = vi.fn((key: string) => key);

    mockHanaFetch
      .mockResolvedValueOnce(serverIdentityResponse())
      .mockResolvedValueOnce(jsonResponse({ agent: 'Hanako', user: 'User', avatars: {} }))
      .mockResolvedValueOnce(jsonResponse({ locale: 'zh-CN', desk: { home_folder: '/old-home' }, cwd_history: [] }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }))
      .mockResolvedValueOnce(jsonResponse({
        telegram: { status: 'disconnected' },
        feishu: { status: 'disconnected' },
        qq: { status: 'disconnected' },
        wechat: { status: 'disconnected' },
      }));

    const { initApp } = await import('../app-init');
    await initApp();

    Object.assign(mockState, {
      currentAgentId: 'agent-a',
      homeFolder: '/old-home',
      selectedFolder: '/old-home',
      deskBasePath: '/old-home',
      pendingNewSession: true,
      currentSessionPath: null,
    });
    mockActivateWorkspaceDesk.mockClear();

    (settingsHandler as unknown as (type: string, data: any) => void)('agent-workspace-changed', {
      agentId: 'agent-b',
      homeFolder: '/other-home',
    });

    expect(mockState.homeFolder).toBe('/old-home');
    expect(mockState.selectedFolder).toBe('/old-home');
    expect(mockActivateWorkspaceDesk).not.toHaveBeenCalled();
  });

  it('clears the previous default desk root when settings clear the current agent workspace', async () => {
    let settingsHandler: ((type: string, data: any) => void) | null = null;
    (globalThis as Record<string, unknown>).window = {
      addEventListener: vi.fn(),
      platform: {
        getServerPort: vi.fn(async () => 62950),
        getServerToken: vi.fn(async () => 'token'),
        appReady: vi.fn(),
        onSettingsChanged: vi.fn((cb: (type: string, data: any) => void) => {
          settingsHandler = cb;
        }),
        openSettings: vi.fn(),
      },
      dispatchEvent: vi.fn(),
    };
    (globalThis as Record<string, unknown>).document = {
      addEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).i18n = {
      locale: 'zh-CN',
      defaultName: 'Hanako',
      load: vi.fn(async () => {}),
    };
    (globalThis as Record<string, unknown>).t = vi.fn((key: string) => key);

    mockHanaFetch
      .mockResolvedValueOnce(serverIdentityResponse())
      .mockResolvedValueOnce(jsonResponse({ agent: 'Hanako', user: 'User', avatars: {} }))
      .mockResolvedValueOnce(jsonResponse({ locale: 'zh-CN', desk: { home_folder: '/old-home' }, cwd_history: [] }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }))
      .mockResolvedValueOnce(jsonResponse({
        telegram: { status: 'disconnected' },
        feishu: { status: 'disconnected' },
        qq: { status: 'disconnected' },
        wechat: { status: 'disconnected' },
      }));

    const { initApp } = await import('../app-init');
    await initApp();

    Object.assign(mockState, {
      currentAgentId: 'agent-a',
      homeFolder: '/old-home',
      selectedFolder: '/old-home',
      deskBasePath: '/old-home',
      pendingNewSession: true,
      currentSessionPath: null,
    });
    mockActivateWorkspaceDesk.mockClear();

    (settingsHandler as unknown as (type: string, data: any) => void)('agent-workspace-changed', {
      agentId: 'agent-a',
      homeFolder: null,
    });

    expect(mockState.homeFolder).toBeNull();
    expect(mockState.selectedFolder).toBeNull();
    expect(mockState.deskBasePath).toBe('');
    expect(mockActivateWorkspaceDesk).toHaveBeenCalledWith(null);
  });

  it('configures context usage requests before settings and websocket handlers dispatch app events', async () => {
    let settingsHandler: ((type: string, data: any) => void) | null = null;
    const send = vi.fn();
    (globalThis as Record<string, unknown>).window = {
      addEventListener: vi.fn(),
      platform: {
        getServerPort: vi.fn(async () => 62950),
        getServerToken: vi.fn(async () => 'token'),
        appReady: vi.fn(),
        onSettingsChanged: vi.fn((cb: (type: string, data: any) => void) => {
          settingsHandler = cb;
        }),
        openSettings: vi.fn(),
      },
      dispatchEvent: vi.fn(),
    };
    (globalThis as Record<string, unknown>).document = {
      addEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).i18n = {
      locale: 'zh-CN',
      defaultName: 'Hanako',
      load: vi.fn(async () => {}),
    };
    (globalThis as Record<string, unknown>).t = vi.fn((key: string) => key);
    (globalThis as Record<string, unknown>).WebSocket = { OPEN: 1 };

    mockGetWebSocket.mockReturnValue({ readyState: 1, send } as unknown as WebSocket);
    mockHanaFetch
      .mockResolvedValueOnce(serverIdentityResponse())
      .mockResolvedValueOnce(jsonResponse({ agent: 'Hanako', user: 'User', avatars: {} }))
      .mockResolvedValueOnce(jsonResponse({ locale: 'zh-CN', desk: { home_folder: null }, cwd_history: [] }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }))
      .mockResolvedValueOnce(jsonResponse({
        telegram: { status: 'disconnected' },
        feishu: { status: 'disconnected' },
        qq: { status: 'disconnected' },
        wechat: { status: 'disconnected' },
      }));

    const { initApp } = await import('../app-init');
    await initApp();

    Object.assign(mockState, {
      currentSessionPath: '/session/a.jsonl',
      chatSessions: {},
    });
    (settingsHandler as unknown as (type: string, data: any) => void)('models-changed', {});

    expect(send).toHaveBeenCalledWith(JSON.stringify({
      type: 'context_usage',
      sessionPath: '/session/a.jsonl',
    }));

    send.mockClear();
    const { handleServerMessage } = await import('../services/ws-message-handler');
    handleServerMessage({
      type: 'turn_end',
      sessionPath: '/session/a.jsonl',
    });

    expect(send).toHaveBeenCalledWith(JSON.stringify({
      type: 'context_usage',
      sessionPath: '/session/a.jsonl',
    }));
  });

  it('opens the in-window settings modal when main process requests settings', async () => {
    let openSettingsHandler: ((tab?: string) => void) | null = null;
    (globalThis as Record<string, unknown>).window = {
      addEventListener: vi.fn(),
      platform: {
        getServerPort: vi.fn(async () => 62950),
        getServerToken: vi.fn(async () => 'token'),
        appReady: vi.fn(),
        onSettingsChanged: vi.fn(),
        onOpenSettingsModal: vi.fn((cb: (tab?: string) => void) => {
          openSettingsHandler = cb;
        }),
        openSettings: vi.fn(),
      },
      dispatchEvent: vi.fn(),
    };
    (globalThis as Record<string, unknown>).document = {
      addEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).i18n = {
      locale: 'zh-CN',
      defaultName: 'Hanako',
      load: vi.fn(async () => {}),
    };
    (globalThis as Record<string, unknown>).t = vi.fn((key: string) => key);

    mockHanaFetch
      .mockResolvedValueOnce(serverIdentityResponse())
      .mockResolvedValueOnce(jsonResponse({ agent: 'Hanako', user: 'User', avatars: {} }))
      .mockResolvedValueOnce(jsonResponse({ locale: 'zh-CN', desk: { home_folder: null }, cwd_history: [] }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }))
      .mockResolvedValueOnce(jsonResponse({
        telegram: { status: 'disconnected' },
        feishu: { status: 'disconnected' },
        qq: { status: 'disconnected' },
        wechat: { status: 'disconnected' },
      }));

    const { initApp } = await import('../app-init');
    await initApp();

    expect(openSettingsHandler).toBeTypeOf('function');
    (openSettingsHandler as unknown as (tab?: string) => void)('bridge');

    expect(mockState.settingsModal).toEqual({
      open: true,
      activeTab: 'bridge',
    });
  });
});
