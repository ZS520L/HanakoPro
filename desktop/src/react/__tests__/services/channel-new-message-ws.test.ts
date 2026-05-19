// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  appendChannelMessageMock,
  loadChannelsMock,
  openChannelMock,
  upsertConversationAgentActivityMock,
} = vi.hoisted(() => ({
  appendChannelMessageMock: vi.fn(),
  loadChannelsMock: vi.fn(),
  openChannelMock: vi.fn(),
  upsertConversationAgentActivityMock: vi.fn(),
}));

vi.mock('../../hooks/use-stream-buffer', () => ({
  streamBufferManager: {
    handle: vi.fn(),
  },
}));

vi.mock('../../services/stream-key-dispatcher', () => ({
  dispatchStreamKey: vi.fn(),
}));

vi.mock('../../stores/session-actions', () => ({
  loadSessions: vi.fn(),
}));

vi.mock('../../stores/desk-actions', () => ({
  loadDeskFiles: vi.fn(),
}));

vi.mock('../../stores/channel-actions', () => ({
  appendChannelMessage: appendChannelMessageMock,
  loadChannels: loadChannelsMock,
  openChannel: openChannelMock,
  upsertConversationAgentActivity: upsertConversationAgentActivityMock,
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

import { useStore } from '../../stores';
import { handleServerMessage } from '../../services/ws-message-handler';

describe('channel_new_message websocket routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      currentTab: 'channels',
      currentChannel: 'ch_crew',
      channelMessages: [
        { sender: 'user', timestamp: '2026-05-07 17:00:00', body: 'old' },
      ],
    } as never);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('appends a complete message event for the visible channel without reopening it', () => {
    const message = {
      sender: 'hanako',
      timestamp: '2026-05-07 17:01:00',
      body: 'new reply',
    };

    handleServerMessage({
      type: 'channel_new_message',
      channelName: 'ch_crew',
      sender: 'hanako',
      message,
    });

    expect(appendChannelMessageMock).toHaveBeenCalledWith('ch_crew', message);
    expect(openChannelMock).not.toHaveBeenCalled();
    expect(loadChannelsMock).not.toHaveBeenCalled();
  });
});

describe('dm_new_message websocket routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      currentTab: 'channels',
      currentAgentId: 'alice',
      currentChannel: 'dm:bob',
      channelMessages: [],
    } as never);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  it('routes a DM event to the peer of the current agent when the current agent is the sender', () => {
    handleServerMessage({
      type: 'dm_new_message',
      from: 'alice',
      to: 'bob',
    });

    expect(openChannelMock).toHaveBeenCalledWith('dm:bob', true);
    expect(loadChannelsMock).not.toHaveBeenCalled();
  });
});

describe('conversation_agent_activity websocket routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores agent phone activity updates from the backend', () => {
    const activity = {
      conversationId: 'ch_crew',
      conversationType: 'channel',
      agentId: 'hana',
      state: 'replying',
      summary: '正在组织回复',
      timestamp: '2026-05-12T12:00:00.000Z',
    };

    handleServerMessage({
      type: 'conversation_agent_activity',
      activity,
    });

    expect(upsertConversationAgentActivityMock).toHaveBeenCalledWith(activity);
  });
});
