// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InputArea } from '../../components/InputArea';
import { useStore } from '../../stores';

const mocks = vi.hoisted(() => ({
  clearContent: vi.fn(),
  hanaFetch: vi.fn(),
  wsSend: vi.fn(),
}));

vi.mock('@tiptap/react', () => ({
  useEditor: () => ({
    commands: {
      focus: vi.fn(),
      clearContent: mocks.clearContent,
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
    state: { tr: { setMeta: vi.fn(() => ({})) } },
    view: { dispatch: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
  }),
  EditorContent: () => React.createElement('div', { 'data-testid': 'editor' }),
}));

vi.mock('@tiptap/starter-kit', () => ({
  default: { configure: () => ({}) },
}));

vi.mock('@tiptap/extension-placeholder', () => ({
  default: { configure: () => ({}) },
}));

vi.mock('../../components/input/extensions/skill-badge', () => ({
  SkillBadge: {},
}));

vi.mock('../../hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
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
  getWebSocket: vi.fn(() => ({ send: mocks.wsSend })),
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
  InputControlBar: ({ canSend, onSend }: { canSend: boolean; onSend: () => void }) => React.createElement(
    'button',
    { type: 'button', 'data-testid': 'send', disabled: !canSend, onClick: onSend },
    'send',
  ),
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

function seedSession() {
  useStore.setState({
    currentSessionPath: '/session/media.jsonl',
    connected: true,
    pendingNewSession: false,
    streamingSessions: [],
    inlineErrors: {},
    attachedFiles: [{
      fileId: 'sf_pasted',
      path: '/tmp/hana/session-files/pasted.png',
      name: 'pasted.png',
      isDirectory: false,
    }],
    attachedFilesBySession: {
      '/session/media.jsonl': [{
        fileId: 'sf_pasted',
        path: '/tmp/hana/session-files/pasted.png',
        name: 'pasted.png',
        isDirectory: false,
      }],
    },
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
    chatSessions: {},
    serverPort: 3210,
    serverToken: null,
    modelSwitching: false,
  } as never);
  useStore.getState().clearSession('/session/media.jsonl');
  useStore.getState().initSession('/session/media.jsonl', [], false);
}

describe('InputArea media send', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    seedSession();
    mocks.hanaFetch.mockResolvedValue(new Response(JSON.stringify({
      models: {
        vision_enabled: true,
        vision: { id: 'qwen-vl', provider: 'dashscope', input: ['text', 'image'] },
      },
    }), { status: 200 }));
    window.platform = {
      readFileBase64: vi.fn(async () => 'IMAGE_BASE64'),
    } as unknown as typeof window.platform;
    delete (window as unknown as { hana?: unknown }).hana;
  });

  it('sends pasted image bytes through the platform API when window.hana is unavailable', async () => {
    render(React.createElement(InputArea));

    fireEvent.click(screen.getByTestId('send'));

    await waitFor(() => {
      expect(mocks.wsSend).toHaveBeenCalledTimes(1);
    });
    expect(window.platform.readFileBase64).toHaveBeenCalledWith('/tmp/hana/session-files/pasted.png');
    const payload = JSON.parse(String(mocks.wsSend.mock.calls[0][0]));
    expect(payload.images).toEqual([{
      type: 'image',
      data: 'IMAGE_BASE64',
      mimeType: 'image/png',
    }]);
    expect(payload.displayMessage.attachments[0]).toMatchObject({
      fileId: 'sf_pasted',
      path: '/tmp/hana/session-files/pasted.png',
      name: 'pasted.png',
      mimeType: 'image/png',
      visionAuxiliary: true,
    });
  });

  it('does not send while an agent switch session is still pending', async () => {
    useStore.setState({ pendingSessionSwitchPath: '/session/new-agent.jsonl' } as never);

    render(React.createElement(InputArea));

    const send = screen.getByTestId('send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);

    await waitFor(() => {
      expect(mocks.wsSend).not.toHaveBeenCalled();
    });
  });
});
