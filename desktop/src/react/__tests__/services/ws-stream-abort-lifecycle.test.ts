import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../stores/session-actions', () => ({
  loadSessions: vi.fn(),
}));

vi.mock('../../stores/desk-actions', () => ({
  loadDeskFiles: vi.fn(),
}));

vi.mock('../../stores/channel-actions', () => ({
  loadChannels: vi.fn(),
  openChannel: vi.fn(),
  appendChannelMessage: vi.fn(),
}));

vi.mock('../../stores/preview-actions', () => ({
  handleLegacyArtifactBlock: vi.fn(),
}));

vi.mock('../../services/app-event-actions', () => ({
  handleAppEvent: vi.fn(),
}));

vi.mock('../../services/stream-resume', () => ({
  replayStreamResume: vi.fn(),
  isStreamResumeRebuilding: () => null,
  isStreamScopedMessage: () => false,
  updateSessionStreamMeta: vi.fn(),
}));

vi.mock('../../services/stream-key-dispatcher', () => ({
  dispatchStreamKey: vi.fn(),
}));

import { streamBufferManager } from '../../hooks/use-stream-buffer';
import { handleServerMessage } from '../../services/ws-message-handler';
import { useStore } from '../../stores';
import type { ChatListItem, ChatMessage } from '../../stores/chat-types';

const PATH = '/session/abort-turn.jsonl';

function userItem(id: string, text: string): ChatListItem {
  return {
    type: 'message',
    data: {
      id,
      role: 'user',
      text,
      textHtml: text,
      timestamp: Date.now(),
    },
  };
}

function messageItems() {
  const messages: ChatMessage[] = [];
  for (const item of useStore.getState().chatSessions[PATH]?.items ?? []) {
    if (item.type === 'message') messages.push(item.data);
  }
  return messages;
}

function textBlockHtml(message: ChatMessage): string {
  return message.blocks?.find((block) => block.type === 'text')?.html ?? '';
}

function firstTool(message: ChatMessage) {
  const group = message.blocks?.find((block) => block.type === 'tool_group');
  return group?.type === 'tool_group' ? group.tools[0] : null;
}

describe('ws stream lifecycle after abort', () => {
  beforeEach(() => {
    streamBufferManager.clearAll();
    useStore.getState().clearSession(PATH);
    useStore.setState({
      currentSessionPath: PATH,
      pendingNewSession: false,
      sessions: [{
        path: PATH,
        title: null,
        firstMessage: '',
        modified: '2026-05-08T00:00:00.000Z',
        messageCount: 0,
        agentId: 'hana',
        agentName: 'Hana',
        cwd: null,
      }],
      streamingSessions: [PATH],
      inlineErrors: {},
      chatSessions: {},
    } as never);
    useStore.getState().initSession(PATH, [userItem('u1', 'start project')], false);
  });

  it('aborted status=false ends the local turn binding so the next reply lands after the new user message', () => {
    handleServerMessage({
      type: 'text_delta',
      sessionPath: PATH,
      delta: 'old partial',
    });

    handleServerMessage({
      type: 'status',
      sessionPath: PATH,
      isStreaming: false,
      aborted: true,
    });

    handleServerMessage({
      type: 'session_user_message',
      sessionPath: PATH,
      message: { id: 'u2', text: 'new prompt', timestamp: Date.now() },
    });

    handleServerMessage({
      type: 'status',
      sessionPath: PATH,
      isStreaming: true,
    });
    handleServerMessage({
      type: 'text_delta',
      sessionPath: PATH,
      delta: 'new answer',
    });
    handleServerMessage({
      type: 'turn_end',
      sessionPath: PATH,
    });

    const items = messageItems();
    expect(items.map((item) => item.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(textBlockHtml(items[1])).toContain('old partial');
    expect(textBlockHtml(items[3])).toContain('new answer');
  });

  it('plain status=false does not end the local turn before late deltas arrive', () => {
    handleServerMessage({
      type: 'text_delta',
      sessionPath: PATH,
      delta: 'old partial',
    });

    handleServerMessage({
      type: 'status',
      sessionPath: PATH,
      isStreaming: false,
    });

    handleServerMessage({
      type: 'text_delta',
      sessionPath: PATH,
      delta: ' late tail',
    });
    handleServerMessage({
      type: 'turn_end',
      sessionPath: PATH,
    });

    const items = messageItems();
    expect(items.map((item) => item.role)).toEqual(['user', 'assistant']);
    expect(textBlockHtml(items[1])).toContain('old partial late tail');
  });

  it('aborted status=false marks unfinished tools as failed instead of leaving them running', () => {
    handleServerMessage({
      type: 'tool_start',
      sessionPath: PATH,
      name: 'read',
      args: { file_path: 'C:\\Users\\hana\\Desktop\\plan.docx' },
    });

    let items = messageItems();
    expect(firstTool(items[1])).toMatchObject({ name: 'read', done: false });

    handleServerMessage({
      type: 'status',
      sessionPath: PATH,
      isStreaming: false,
      aborted: true,
    });

    items = messageItems();
    expect(firstTool(items[1])).toMatchObject({ name: 'read', done: true, success: false });
  });
});
