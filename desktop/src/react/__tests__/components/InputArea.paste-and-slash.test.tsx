// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InputArea } from '../../components/InputArea';
import { useStore } from '../../stores';

const mocks = vi.hoisted(() => ({
  editorOptions: undefined as undefined | Record<string, unknown>,
  editorText: '',
  updateHandler: undefined as undefined | (() => void),
  insertContent: vi.fn(),
  setContent: vi.fn(),
  chainInserted: [] as unknown[],
  ensureSession: vi.fn(async () => true),
  loadSessions: vi.fn(),
  hanaFetch: vi.fn(),
  wsSend: vi.fn(),
}));

function editorJsonForText(text: string) {
  return {
    type: 'doc',
    content: text
      ? [{ type: 'paragraph', content: [{ type: 'text', text }] }]
      : [],
  };
}

vi.mock('@tiptap/react', () => ({
  useEditor: (options: Record<string, unknown>) => {
    mocks.editorOptions = options;
    const chain = {
      clearContent: vi.fn(() => chain),
      insertContent: vi.fn((content: unknown) => {
        mocks.chainInserted.push(content);
        return chain;
      }),
      focus: vi.fn(() => chain),
      run: vi.fn(),
    };
    return {
      commands: {
        focus: vi.fn(),
        clearContent: vi.fn(),
        scrollIntoView: vi.fn(),
        setContent: mocks.setContent,
        insertContent: mocks.insertContent,
      },
      chain: () => chain,
      getText: () => mocks.editorText,
      getJSON: () => editorJsonForText(mocks.editorText),
      isDestroyed: false,
      state: { tr: { setMeta: vi.fn(() => ({})) } },
      view: { dispatch: vi.fn() },
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'update') mocks.updateHandler = handler;
      }),
      off: vi.fn(),
    };
  },
  EditorContent: () => React.createElement('div', { 'data-testid': 'editor' }),
}));

vi.mock('@tiptap/starter-kit', () => ({
  default: { configure: () => ({}) },
}));

vi.mock('@tiptap/extension-bold', () => ({
  Bold: { extend: () => ({}) },
}));

vi.mock('@tiptap/extension-placeholder', () => ({
  default: { configure: () => ({ name: 'placeholder' }) },
}));

vi.mock('../../components/input/extensions/skill-badge', () => ({
  SkillBadge: { name: 'skillBadge' },
}));

vi.mock('../../components/input/extensions/file-badge', () => ({
  FileBadge: { name: 'fileBadge' },
}));

vi.mock('../../hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'zh-CN' }),
}));

vi.mock('../../hooks/use-config', () => ({
  fetchConfig: vi.fn(async () => ({})),
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: (path: string, opts?: RequestInit) => mocks.hanaFetch(path, opts),
  hanaUrl: (path: string) => `http://127.0.0.1:3210${path}`,
}));

vi.mock('../../stores/session-actions', () => ({
  ensureSession: mocks.ensureSession,
  loadSessions: mocks.loadSessions,
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
  SlashCommandMenu: ({ selected }: { selected: number }) => React.createElement(
    'div',
    { 'data-testid': 'slash-menu', 'data-selected': String(selected) },
  ),
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
  useSkillSlashItems: () => [
    {
      name: 'zz-first',
      label: '/zz-first',
      description: 'first',
      busyLabel: '',
      icon: '',
      type: 'skill',
      execute: vi.fn(),
    },
    {
      name: 'zz-second',
      label: '/zz-second',
      description: 'second',
      busyLabel: '',
      icon: '',
      type: 'skill',
      execute: vi.fn(),
    },
  ],
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

function seedInputState(overrides: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({
    currentSessionPath: '/session/input.jsonl',
    connected: true,
    pendingNewSession: false,
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
    welcomeVisible: false,
    agentYuan: 'hanako',
    ...overrides,
  } as never);
}

function tiptapPasteHandler(): ((view: unknown, event: ClipboardEvent) => boolean | void) | undefined {
  const editorProps = mocks.editorOptions?.editorProps as Record<string, unknown> | undefined;
  return editorProps?.handlePaste as ((view: unknown, event: ClipboardEvent) => boolean | void) | undefined;
}

function tiptapKeyDownHandler(): ((view: unknown, event: KeyboardEvent) => boolean | void) | undefined {
  const editorProps = mocks.editorOptions?.editorProps as Record<string, unknown> | undefined;
  return editorProps?.handleKeyDown as ((view: unknown, event: KeyboardEvent) => boolean | void) | undefined;
}

describe('InputArea paste and slash menu behavior', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.editorOptions = undefined;
    mocks.editorText = '';
    mocks.updateHandler = undefined;
    mocks.chainInserted = [];
    seedInputState();
    mocks.hanaFetch.mockResolvedValue(new Response('{}', { status: 200 }));
    window.platform = {} as typeof window.platform;
  });

  it('consumes a rich URL paste through the TipTap paste hook before the default editor paste runs', () => {
    render(React.createElement(InputArea));

    const preventDefault = vi.fn();
    const result = tiptapPasteHandler()?.(null, {
      preventDefault,
      clipboardData: {
        items: [],
        getData: (type: string) => ({
          'text/plain': 'Example Article',
          'text/html': '<a href="https://example.com/article">Example Article</a>',
          'text/uri-list': '',
        }[type] ?? ''),
      },
    } as unknown as ClipboardEvent);

    expect(result).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.insertContent).toHaveBeenCalledWith('https://example.com/article');
  });

  it('selects the highlighted slash command on Enter without falling through to message send', async () => {
    render(React.createElement(InputArea));

    await waitFor(() => {
      expect(mocks.updateHandler).toBeTypeOf('function');
    });

    mocks.editorText = '/zz';
    act(() => {
      mocks.updateHandler?.();
    });

    await screen.findByTestId('slash-menu');
    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'ArrowDown' });

    await waitFor(() => {
      expect(screen.getByTestId('slash-menu').getAttribute('data-selected')).toBe('1');
    });

    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'Enter' });

    expect(mocks.chainInserted).toContainEqual({
      type: 'skillBadge',
      attrs: { name: 'zz-second' },
    });
    expect(mocks.wsSend).not.toHaveBeenCalled();
  });

  it('handles welcome Enter inside TipTap before the editor inserts a newline', async () => {
    seedInputState({
      currentSessionPath: null,
      pendingNewSession: true,
      welcomeVisible: true,
    });
    mocks.editorText = '你好 Hana';
    render(React.createElement(InputArea));

    const preventDefault = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(event, 'preventDefault', { value: preventDefault });

    const handled = tiptapKeyDownHandler()?.(null, event);

    expect(handled).toBe(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mocks.ensureSession).toHaveBeenCalledTimes(1);
      expect(mocks.loadSessions).toHaveBeenCalledTimes(1);
      expect(mocks.wsSend).toHaveBeenCalledTimes(1);
    });
  });
});
