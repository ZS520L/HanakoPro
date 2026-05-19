// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { InputArea } from '../../components/InputArea';
import { AssistantMessage } from '../../components/chat/AssistantMessage';
import { SessionConfirmationPrompt } from '../../components/input/SessionConfirmationPrompt';
import { handleServerMessage } from '../../services/ws-message-handler';
import { useStore } from '../../stores';

const hanaFetchMock = vi.fn<(path: string, opts?: RequestInit) => Promise<Response>>(
  async () => new Response('{}', { status: 200 }),
);

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: (path: string, opts?: RequestInit) => hanaFetchMock(path, opts),
  hanaUrl: (path: string) => `http://127.0.0.1:3210${path}`,
}));

vi.mock('@tiptap/react', () => ({
  useEditor: () => ({
    commands: {
      focus: vi.fn(),
      clearContent: vi.fn(),
      scrollIntoView: vi.fn(),
      setContent: vi.fn(),
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

vi.mock('../../stores/session-actions', () => ({
  ensureSession: vi.fn(async () => true),
  loadSessions: vi.fn(),
}));

vi.mock('../../stores/desk-actions', () => ({
  loadDeskFiles: vi.fn(),
  toggleJianSidebar: vi.fn(),
}));

vi.mock('../../services/websocket', () => ({
  getWebSocket: vi.fn(() => null),
}));

vi.mock('../../MainContent', () => ({
  attachFilesFromPaths: vi.fn(),
}));

vi.mock('../../components/input/SlashCommandMenu', () => ({
  SlashCommandMenu: () => React.createElement('div'),
}));

vi.mock('../../components/input/InputStatusBars', () => ({
  InputStatusBars: () => null,
}));

vi.mock('../../components/input/InputContextRow', () => ({
  InputContextRow: () => null,
}));

vi.mock('../../components/input/InputControlBar', () => ({
  InputControlBar: ({ planModeLocked }: { planModeLocked: boolean }) => React.createElement(
    'button',
    { type: 'button', 'data-testid': 'mode-button', disabled: planModeLocked },
    'mode',
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
    currentSessionPath: '/session/a.jsonl',
    connected: true,
    pendingNewSession: false,
    streamingSessions: [],
    inlineErrors: {},
    attachedFiles: [],
    docContextAttached: false,
    quotedSelection: null,
    models: [],
    previewItems: [],
    previewOpen: false,
    chatSessions: {},
    serverPort: 3210,
    serverToken: null,
  } as never);
  useStore.getState().clearSession('/session/a.jsonl');
  useStore.getState().initSession('/session/a.jsonl', [{
    type: 'message',
    data: {
      id: 'assistant-1',
      role: 'assistant',
      blocks: [{
        type: 'session_confirmation',
        confirmId: 'confirm-computer-1',
        kind: 'computer_app_approval',
        surface: 'input',
        status: 'pending',
        title: '允许 Hana 使用电脑',
        body: 'Hana 想控制这个应用来继续当前任务。',
        subject: { label: 'Mock Notes', detail: 'mock · app.notes' },
        severity: 'elevated',
        actions: { confirmLabel: '同意', rejectLabel: '拒绝' },
        payload: { approval: { providerId: 'mock', appId: 'app.notes' } },
      }],
    },
  }], false);
}

describe('computer app approval prompt', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    seedSession();
  });

  it('renders the current session pending input confirmation above the input box and posts confirmation', async () => {
    render(React.createElement(InputArea));

    expect(screen.getByText('是否允许 Hana 控制 Mock Notes')).toBeTruthy();
    expect(screen.queryByText('Hana 想控制这个应用来继续当前任务。')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '同意' }));

    await waitFor(() => {
      expect(hanaFetchMock).toHaveBeenCalledWith('/api/confirm/confirm-computer-1', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'confirmed' }),
      }));
    });
  });

  it('re-enables approval actions when a new pending confirmation replaces the submitted one', async () => {
    const firstBlock = {
      type: 'session_confirmation',
      confirmId: 'confirm-computer-1',
      kind: 'tool_action_approval',
      surface: 'input',
      status: 'pending',
      title: '允许 Hana 执行这次操作',
      body: '当前会话处于先问模式，这次操作会改变本地或外部状态。',
      subject: { label: 'computer', detail: 'action: list_apps' },
      severity: 'elevated',
      actions: { confirmLabel: '同意', rejectLabel: '拒绝' },
      payload: { toolName: 'computer', params: { action: 'list_apps' } },
    } as const;
    const secondBlock = {
      ...firstBlock,
      confirmId: 'confirm-computer-2',
      subject: { label: 'computer', detail: 'action: start' },
      payload: { toolName: 'computer', params: { action: 'start' } },
    } as const;

    const { rerender } = render(React.createElement(SessionConfirmationPrompt, { block: firstBlock }));

    fireEvent.click(screen.getByRole('button', { name: '同意' }));

    await waitFor(() => {
      expect(hanaFetchMock).toHaveBeenCalledWith('/api/confirm/confirm-computer-1', expect.any(Object));
    });
    expect((screen.getByRole('button', { name: '同意' }) as HTMLButtonElement).disabled).toBe(true);

    rerender(React.createElement(SessionConfirmationPrompt, { block: secondBlock }));

    expect((screen.getByRole('button', { name: '同意' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '同意' }));

    await waitFor(() => {
      expect(hanaFetchMock).toHaveBeenCalledWith('/api/confirm/confirm-computer-2', expect.any(Object));
    });
  });

  it('can switch the current ask-mode conversation to operate before confirming a tool action', async () => {
    const permissionEvents: Array<{ mode?: string; enabled?: boolean }> = [];
    const listener = (event: Event) => {
      permissionEvents.push((event as CustomEvent).detail || {});
    };
    window.addEventListener('hana-plan-mode', listener);
    hanaFetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, mode: 'operate' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));

    const block = {
      type: 'session_confirmation',
      confirmId: 'confirm-tool-1',
      kind: 'tool_action_approval',
      surface: 'input',
      status: 'pending',
      title: '允许 Hana 执行这次操作',
      body: '当前会话处于先问模式，这次操作会改变本地或外部状态。',
      subject: { label: 'write', detail: 'path: note.md' },
      severity: 'elevated',
      actions: { confirmLabel: '同意', rejectLabel: '拒绝' },
      payload: { toolName: 'write', params: { path: 'note.md' } },
    } as const;

    try {
      render(React.createElement(SessionConfirmationPrompt, { block }));

      fireEvent.click(screen.getByRole('button', { name: '更多确认选项' }));
      fireEvent.click(screen.getByRole('menuitem', { name: '本对话不再询问' }));

      await waitFor(() => {
        expect(hanaFetchMock).toHaveBeenCalledTimes(2);
      });
      expect(hanaFetchMock.mock.calls[0]).toEqual([
        '/api/session-permission-mode',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ mode: 'operate', currentSessionOnly: true }),
        }),
      ]);
      expect(hanaFetchMock.mock.calls[1]).toEqual([
        '/api/confirm/confirm-tool-1',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'confirmed' }),
        }),
      ]);
      expect(permissionEvents.at(-1)).toMatchObject({ mode: 'operate', enabled: false });
    } finally {
      window.removeEventListener('hana-plan-mode', listener);
    }
  });

  it('portals the ask-mode bypass menu outside the confirmation card', () => {
    const block = {
      type: 'session_confirmation',
      confirmId: 'confirm-tool-portal',
      kind: 'tool_action_approval',
      surface: 'input',
      status: 'pending',
      title: '允许 Hana 执行这次操作',
      body: '当前会话处于先问模式，这次操作会改变本地或外部状态。',
      subject: { label: 'write', detail: 'path: note.md' },
      severity: 'elevated',
      actions: { confirmLabel: '同意', rejectLabel: '拒绝' },
      payload: { toolName: 'write', params: { path: 'note.md' } },
    } as const;

    render(React.createElement(SessionConfirmationPrompt, { block }));

    fireEvent.click(screen.getByRole('button', { name: '更多确认选项' }));

    const menuItem = screen.getByRole('menuitem', { name: '本对话不再询问' });
    expect(menuItem.closest('[data-confirm-id="confirm-tool-portal"]')).toBeNull();
    expect(menuItem.closest('[role="menu"]')).toBeTruthy();
  });

  it('shows full tool action parameters in a tooltip outside the clipped confirmation card', async () => {
    const longCommand = 'python scripts/generate_report.py --workspace "/very/long/path/with spaces/project" --write-output --explain-every-step';
    const block = {
      type: 'session_confirmation',
      confirmId: 'confirm-tool-tooltip',
      kind: 'tool_action_approval',
      surface: 'input',
      status: 'pending',
      title: '允许 Hana 执行这次操作',
      body: '当前会话处于先问模式，这次操作会改变本地或外部状态。',
      subject: { label: 'bash', detail: 'command: python scripts/generate_report.py --workspace "/very/long/path/with spaces/project"' },
      severity: 'elevated',
      actions: { confirmLabel: '同意', rejectLabel: '拒绝' },
      payload: { toolName: 'bash', params: { command: longCommand, timeout: 120000 } },
    } as const;

    render(React.createElement(SessionConfirmationPrompt, { block }));

    fireEvent.mouseEnter(screen.getByTestId('session-confirmation-summary'));

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain(longCommand);
    expect(tooltip.textContent).toContain('"timeout": 120000');
    expect(tooltip.closest('[data-confirm-id="confirm-tool-tooltip"]')).toBeNull();
  });

  it('does not offer ask-mode bypass on computer app approval prompts', () => {
    const block = {
      type: 'session_confirmation',
      confirmId: 'confirm-computer-1',
      kind: 'computer_app_approval',
      surface: 'input',
      status: 'pending',
      title: '允许 Hana 使用电脑',
      subject: { label: 'Mock Notes', detail: 'mock · app.notes' },
      severity: 'elevated',
      actions: { confirmLabel: '同意', rejectLabel: '拒绝' },
      payload: { approval: { providerId: 'mock', appId: 'app.notes' } },
    } as const;

    render(React.createElement(SessionConfirmationPrompt, { block }));

    expect(screen.queryByRole('button', { name: '更多确认选项' })).toBeNull();
  });

  it('keeps the input confirmation as a same-width card sliding from behind the input box', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/input/InputArea.module.css'),
      'utf8',
    );
    const inputSource = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/InputArea.tsx'),
      'utf8',
    );
    const stackBlock = css.match(/\.input-stack\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';
    const promptBlock = css.match(/\.session-confirmation-prompt\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';
    const inputWrapperBlock = css.match(/\.input-wrapper\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';

    expect(inputSource).toContain("styles['input-stack']");
    expect(stackBlock).toMatch(/width:\s*100%/);
    expect(promptBlock).toMatch(/width:\s*100%/);
    expect(promptBlock).toMatch(/max-width:\s*100%/);
    expect(promptBlock).toMatch(/background:\s*var\(--bg-card\)/);
    expect(promptBlock).toMatch(/border-radius:\s*var\(--radius-chat-card\)/);
    expect(promptBlock).toMatch(/margin:\s*0 0 -2rem/);
    expect(promptBlock).toMatch(/padding:\s*1rem 1rem 2\.24rem/);
    expect(promptBlock).not.toContain('color-mix');
    expect(promptBlock).not.toContain('border-bottom-color: transparent');
    expect(inputWrapperBlock).toMatch(/position:\s*relative/);
    expect(inputWrapperBlock).toMatch(/z-index:\s*1/);
  });

  it('removes the input confirmation after the retract animation so surrounding layout can settle', async () => {
    const { container } = render(React.createElement(InputArea));

    expect(container.querySelector('[data-confirm-id="confirm-computer-1"]')).toBeTruthy();

    handleServerMessage({
      type: 'confirmation_resolved',
      confirmId: 'confirm-computer-1',
      action: 'confirmed',
    });

    await waitFor(() => {
      expect(container.querySelector('[data-confirm-id="confirm-computer-1"]')?.getAttribute('data-status')).toBe('confirmed');
    });

    await waitFor(
      () => expect(container.querySelector('[data-confirm-id="confirm-computer-1"]')).toBeNull(),
      { timeout: 700 },
    );
  });

  it('keeps the permission mode switch available after a session exists', () => {
    render(React.createElement(InputArea));

    expect(screen.getByTestId('mode-button').hasAttribute('disabled')).toBe(false);
  });

  it('updates session_confirmation status when confirmation_resolved arrives outside the last message', () => {
    useStore.getState().appendItem('/session/a.jsonl', {
      type: 'message',
      data: {
        id: 'assistant-2',
        role: 'assistant',
        blocks: [{ type: 'text', html: '<p>later</p>' }],
      },
    });

    handleServerMessage({
      type: 'confirmation_resolved',
      confirmId: 'confirm-computer-1',
      action: 'confirmed',
    });

    const first = useStore.getState().chatSessions['/session/a.jsonl']?.items[0];
    if (!first || first.type !== 'message') throw new Error('expected first message');
    expect(first.data.blocks?.[0]).toMatchObject({
      type: 'session_confirmation',
      confirmId: 'confirm-computer-1',
      status: 'confirmed',
    });
  });

  it('does not duplicate input-surface confirmations inside assistant message content', () => {
    render(React.createElement(AssistantMessage, {
      message: {
        id: 'assistant-with-confirmation',
        role: 'assistant',
        blocks: [
          {
            type: 'session_confirmation',
            confirmId: 'confirm-computer-1',
            kind: 'computer_app_approval',
            surface: 'input',
            status: 'pending',
            title: '允许 Hana 使用电脑',
          },
          { type: 'text', html: '<p>正文还在这里</p>' },
        ],
      },
      showAvatar: false,
      sessionPath: '/session/a.jsonl',
    }));

    expect(screen.queryByText('允许 Hana 使用电脑')).toBeNull();
    expect(screen.getByText('正文还在这里')).toBeTruthy();
  });
});
