// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputArea } from '../../components/InputArea';
import { useStore } from '../../stores';

const mocks = vi.hoisted(() => ({
  editorOptions: undefined as undefined | { extensions?: Array<{ name?: string; options?: Record<string, unknown> }> },
  dispatch: vi.fn(),
  setMeta: vi.fn(),
  hanaFetch: vi.fn(),
  wsSend: vi.fn(),
}));

vi.mock('@tiptap/react', () => ({
  useEditor: (options: { extensions?: Array<{ name?: string; options?: Record<string, unknown> }> }) => {
    mocks.editorOptions = options;
    const tr = { setMeta: mocks.setMeta };
    mocks.setMeta.mockReturnValue(tr);
    return {
      commands: {
        focus: vi.fn(),
        clearContent: vi.fn(),
        scrollIntoView: vi.fn(),
        setContent: vi.fn(),
        insertContent: vi.fn(),
      },
      chain: () => ({
        clearContent: () => ({
          insertContent: () => ({
            insertContent: () => ({
              focus: () => ({ run: vi.fn() }),
            }),
          }),
        }),
      }),
      getText: () => '',
      getJSON: () => ({ type: 'doc', content: [] }),
      on: vi.fn(),
      off: vi.fn(),
      isDestroyed: false,
      state: { tr },
      view: { dispatch: mocks.dispatch },
    };
  },
  EditorContent: () => React.createElement('div', { 'data-testid': 'editor' }),
}));

vi.mock('../../components/input/extensions/skill-badge', () => ({
  SkillBadge: { name: 'skillBadge' },
}));

vi.mock('../../hooks/use-config', () => ({
  fetchConfig: vi.fn(async () => ({})),
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: (path: string, opts?: RequestInit) => mocks.hanaFetch(path, opts),
  hanaUrl: (path: string) => `http://127.0.0.1:3210${path}`,
}));

vi.mock('../../stores/session-actions', () => ({
  ensureSession: vi.fn(async () => true),
  loadSessions: vi.fn(),
}));

vi.mock('../../stores/desk-actions', () => ({
  loadDeskFiles: vi.fn(),
  searchDeskFiles: vi.fn(async () => []),
  toggleJianSidebar: vi.fn(),
}));

vi.mock('../../services/websocket', () => ({
  getWebSocket: vi.fn(() => ({ readyState: WebSocket.OPEN, send: mocks.wsSend })),
}));

vi.mock('../../MainContent', () => ({
  attachFilesFromPaths: vi.fn(),
}));

vi.mock('../../components/input/SlashCommandMenu', () => ({
  SlashCommandMenu: () => null,
}));

vi.mock('../../components/input/FileMentionMenu', () => ({
  FileMentionMenu: () => null,
}));

vi.mock('../../components/input/InputStatusBars', () => ({
  InputStatusBars: () => null,
}));

vi.mock('../../components/input/InputContextRow', () => ({
  InputContextRow: () => null,
}));

vi.mock('../../components/input/InputControlBar', () => ({
  InputControlBar: () => React.createElement('button', { type: 'button' }, 'send'),
}));

vi.mock('../../components/input/SessionConfirmationPrompt', () => ({
  SessionConfirmationPrompt: () => null,
}));

vi.mock('../../hooks/use-slash-items', () => ({
  useSkillSlashItems: () => [],
}));

vi.mock('../../utils/paste-upload-feedback', () => ({
  notifyPasteUploadFailure: vi.fn(),
}));

vi.mock('../../services/stream-resume', () => ({
  replayStreamResume: vi.fn(),
  isStreamResumeRebuilding: () => null,
  isStreamScopedMessage: () => false,
  updateSessionStreamMeta: vi.fn(),
}));

function readPlaceholder(): string {
  const placeholderExtension = mocks.editorOptions?.extensions?.find(ext => ext.name === 'placeholder');
  const placeholder = placeholderExtension?.options?.placeholder;
  if (typeof placeholder === 'function') {
    return placeholder({} as never);
  }
  return typeof placeholder === 'string' ? placeholder : '';
}

function seedInputState(overrides: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({
    currentSessionPath: null,
    connected: true,
    pendingNewSession: true,
    streamingSessions: [],
    compactingSessions: [],
    inlineErrors: {},
    attachedFiles: [],
    attachedFilesBySession: {},
    docContextAttached: false,
    quotedSelection: null,
    models: [{
      id: 'deepseek-chat',
      provider: 'deepseek',
      name: 'DeepSeek Chat',
      input: ['text'],
      isCurrent: true,
    }],
    sessionModelsByPath: {},
    previewItems: [],
    previewOpen: false,
    activeTabId: null,
    chatSessions: {},
    serverPort: 3210,
    serverToken: null,
    modelSwitching: false,
    welcomeVisible: true,
    locale: '',
    agentYuan: 'hanako',
    ...overrides,
  } as never);
}

describe('InputArea welcome placeholder', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    seedInputState();
    mocks.hanaFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    window.platform = {} as typeof window.platform;
    delete (window as unknown as { hana?: unknown }).hana;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refreshes the welcome tip when locale data becomes ready after the input mounts', async () => {
    let i18nReady = false;
    vi.spyOn(Math, 'random').mockReturnValue(0);
    window.t = ((path: string) => {
      if (path === 'welcome.placeholderTips') {
        return i18nReady ? ['Tip after i18n load', 'Other tip'] : path;
      }
      if (path === 'input.placeholder') return 'Say something...';
      return path;
    }) as typeof window.t;

    render(React.createElement(InputArea));

    await waitFor(() => {
      expect(readPlaceholder()).toBe('Say something...');
    });

    i18nReady = true;
    useStore.setState({ locale: 'zh' });

    await waitFor(() => {
      expect(readPlaceholder()).toBe('Tip after i18n load');
    });
  });

  it('uses a fresh random tip each time the welcome screen is re-entered', async () => {
    const random = vi.spyOn(Math, 'random');
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.75);
    window.t = ((path: string) => {
      if (path === 'welcome.placeholderTips') {
        return ['First welcome tip', 'Second welcome tip'];
      }
      if (path === 'input.placeholder') return 'Say something...';
      return path;
    }) as typeof window.t;
    seedInputState({ locale: 'zh' });

    render(React.createElement(InputArea));

    await waitFor(() => {
      expect(readPlaceholder()).toBe('First welcome tip');
    });

    useStore.setState({ welcomeVisible: false });

    await waitFor(() => {
      expect(readPlaceholder()).toBe('Say something...');
    });

    useStore.setState({ welcomeVisible: true });

    await waitFor(() => {
      expect(readPlaceholder()).toBe('Second welcome tip');
    });
  });
});
