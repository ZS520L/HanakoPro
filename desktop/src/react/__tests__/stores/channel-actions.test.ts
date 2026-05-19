/**
 * channel-actions 基线测试
 *
 * 测试纯逻辑部分（不涉及网络请求的函数），
 * 以及 store 状态变化的正确性。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock store
const mockState: Record<string, unknown> = {
  serverPort: '3210',
  channels: [],
  currentChannel: null,
  channelMessages: [],
  channelTotalUnread: 0,
  channelsEnabled: true,
  userName: 'testuser',
  channelMembers: [],
  channelHeaderName: '',
  channelHeaderMembersText: '',
  channelIsDM: false,
  channelInfoName: '',
  channelAgentActivities: {},
  channelAgentPhoneToolMode: 'read_only',
  channelAgentReplyMinChars: null,
  channelAgentReplyMaxChars: null,
  channelAgentProactiveEnabled: true,
  channelAgentReminderIntervalMinutes: 31,
  channelAgentGuardLimit: 36,
  channelAgentModelOverrideEnabled: false,
  channelAgentModelOverrideModel: null,
};

const setStateCalls: Array<Record<string, unknown>> = [];

vi.mock('../../stores', () => ({
  useStore: {
    getState: () => ({ ...mockState }),
    setState: (patch: Record<string, unknown>) => {
      setStateCalls.push(patch);
      Object.assign(mockState, patch);
    },
  },
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

import { hanaFetch } from '../../hooks/use-hana-fetch';

const mockFetch = vi.mocked(hanaFetch);

describe('channel-actions', () => {
  beforeEach(() => {
    setStateCalls.length = 0;
    mockState.channels = [];
    mockState.currentChannel = null;
    mockState.channelMessages = [];
    mockState.channelTotalUnread = 0;
    mockState.channelsEnabled = true;
    mockState.channelAgentPhoneToolMode = 'read_only';
    mockState.channelAgentReplyMinChars = null;
    mockState.channelAgentReplyMaxChars = null;
    mockState.channelAgentProactiveEnabled = true;
    mockState.channelAgentReminderIntervalMinutes = 31;
    mockState.channelAgentGuardLimit = 36;
    mockState.channelAgentModelOverrideEnabled = false;
    mockState.channelAgentModelOverrideModel = null;
    mockFetch.mockReset();
  });

  describe('loadChannels', () => {
    it('加载频道和 DM 列表', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ channels: [{ id: 'ch1', name: 'general', newMessageCount: 2 }] }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ dms: [{ peerId: 'agent1', peerName: 'Agent 1', messageCount: 5 }] }),
        } as Response);

      const { loadChannels } = await import('../../stores/channel-actions');
      await loadChannels();

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // 检查 setState 被调用，包含合并的 channels
      const lastPatch = setStateCalls[setStateCalls.length - 1];
      expect(lastPatch.channels).toBeDefined();
      const channels = lastPatch.channels as Array<{ id: string; isDM: boolean }>;
      expect(channels.length).toBe(2);
      expect(channels[0].isDM).toBe(false);
      expect(channels[1].isDM).toBe(true);
      expect(channels[1].id).toBe('dm:agent1');
    });

    it('serverPort 为空时不请求', async () => {
      mockState.serverPort = '';
      const { loadChannels } = await import('../../stores/channel-actions');
      await loadChannels();
      expect(mockFetch).not.toHaveBeenCalled();
      mockState.serverPort = '3210';
    });
  });

  describe('loadConversationAgentActivities', () => {
    it('loads and keys agent phone activities by conversation and agent', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          activities: [{
            conversationId: 'ch1',
            conversationType: 'channel',
            agentId: 'hana',
            state: 'idle',
            summary: '已回复',
            timestamp: '2026-05-12T12:00:00.000Z',
          }],
        }),
      } as Response);

      const { loadConversationAgentActivities } = await import('../../stores/channel-actions');
      await loadConversationAgentActivities('ch1');

      expect(mockFetch).toHaveBeenCalledWith('/api/conversations/ch1/agent-activities');
      expect((mockState.channelAgentActivities as any).ch1.hana[0]).toMatchObject({
        state: 'idle',
        summary: '已回复',
      });
    });
  });

  describe('setConversationAgentPhoneToolMode', () => {
    it('persists and updates the current conversation phone tool mode', async () => {
      mockState.currentChannel = 'ch1';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, mode: 'write' }),
      } as Response);

      const { setConversationAgentPhoneToolMode } = await import('../../stores/channel-actions');
      await setConversationAgentPhoneToolMode('write');

      expect(mockFetch).toHaveBeenCalledWith('/api/conversations/ch1/agent-phone-settings', expect.objectContaining({
        method: 'POST',
      }));
      expect(mockState.channelAgentPhoneToolMode).toBe('write');
    });

    it('persists reply range settings without changing API output budget', async () => {
      mockState.currentChannel = 'ch1';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          mode: 'read_only',
          replyMinChars: 20,
          replyMaxChars: 80,
          proactiveEnabled: false,
          reminderIntervalMinutes: 45,
          guardLimit: 9,
          modelOverrideEnabled: true,
          modelOverrideModel: { id: 'deepseek-v4-flash', provider: 'deepseek' },
        }),
      } as Response);

      const { saveConversationAgentPhoneSettings } = await import('../../stores/channel-actions');
      await saveConversationAgentPhoneSettings({
        replyMinChars: 20,
        replyMaxChars: 80,
        proactiveEnabled: false,
        reminderIntervalMinutes: 45,
        guardLimit: 9,
        modelOverrideEnabled: true,
        modelOverrideModel: { id: 'deepseek-v4-flash', provider: 'deepseek' },
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(mockFetch.mock.calls[0][0]).toBe('/api/conversations/ch1/agent-phone-settings');
      const body = JSON.parse(String((init as RequestInit).body));
      expect(body).toMatchObject({
        replyMinChars: 20,
        replyMaxChars: 80,
        proactiveEnabled: false,
        reminderIntervalMinutes: 45,
        guardLimit: 9,
        modelOverrideEnabled: true,
        modelOverrideModel: { id: 'deepseek-v4-flash', provider: 'deepseek' },
      });
      expect(body).not.toHaveProperty('replyInstructions');
      expect(body).not.toHaveProperty('maxTokens');
      expect(mockState.channelAgentReplyMinChars).toBe(20);
      expect(mockState.channelAgentReplyMaxChars).toBe(80);
      expect(mockState.channelAgentProactiveEnabled).toBe(false);
      expect(mockState.channelAgentReminderIntervalMinutes).toBe(45);
      expect(mockState.channelAgentGuardLimit).toBe(9);
      expect(mockState.channelAgentModelOverrideEnabled).toBe(true);
      expect(mockState.channelAgentModelOverrideModel).toEqual({ id: 'deepseek-v4-flash', provider: 'deepseek' });
    });
  });

  describe('channel member management', () => {
    it('adds a member and updates the current channel projection', async () => {
      mockState.currentChannel = 'ch1';
      mockState.userName = 'testuser';
      mockState.channelMembers = ['hana', 'butter'];
      mockState.channels = [{
        id: 'ch1',
        name: 'general',
        members: ['hana', 'butter'],
        lastMessage: '',
        lastSender: '',
        lastTimestamp: '',
        newMessageCount: 0,
      }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, members: ['hana', 'butter', 'ming'] }),
      } as Response);

      const { addChannelMember } = await import('../../stores/channel-actions');
      await addChannelMember('ch1', 'ming');

      expect(mockFetch).toHaveBeenCalledWith('/api/channels/ch1/members', expect.objectContaining({
        method: 'POST',
      }));
      expect(mockState.channelMembers).toEqual(['hana', 'butter', 'ming']);
      expect((mockState.channels as any[])[0].members).toEqual(['hana', 'butter', 'ming']);
      expect(mockState.channelHeaderMembersText).toBe('4 channel.membersCount');
    });

    it('surfaces backend member removal errors without mutating local members', async () => {
      mockState.currentChannel = 'ch1';
      mockState.channelMembers = ['hana', 'butter'];
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'channel requires at least 2 agent members' }),
      } as Response);

      const { removeChannelMember } = await import('../../stores/channel-actions');
      await expect(removeChannelMember('ch1', 'butter')).rejects.toThrow(/at least 2/i);
      expect(mockState.channelMembers).toEqual(['hana', 'butter']);
    });
  });

  describe('sendChannelMessage', () => {
    it('空消息不发送', async () => {
      mockState.currentChannel = 'ch1';
      const { sendChannelMessage } = await import('../../stores/channel-actions');
      await sendChannelMessage('   ');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('无当前频道不发送', async () => {
      mockState.currentChannel = null;
      const { sendChannelMessage } = await import('../../stores/channel-actions');
      await sendChannelMessage('hello');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('发送成功后追加消息到 store', async () => {
      mockState.currentChannel = 'ch1';
      mockState.channelMessages = [];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, timestamp: '2026-03-22T00:00:00Z' }),
      } as Response);

      const { sendChannelMessage } = await import('../../stores/channel-actions');
      await sendChannelMessage('hello world');

      const msgPatch = setStateCalls.find(p => p.channelMessages);
      expect(msgPatch).toBeDefined();
      const msgs = msgPatch!.channelMessages as Array<{ sender: string; body: string }>;
      expect(msgs[msgs.length - 1].body).toBe('hello world');
      expect(msgs[msgs.length - 1].sender).toBe('testuser');
    });
  });

  describe('appendChannelMessage', () => {
    it('追加当前频道的新消息并刷新频道预览，不清空已有消息', async () => {
      mockState.currentChannel = 'ch1';
      mockState.channelMessages = [
        { sender: 'testuser', timestamp: '2026-05-07 17:00:00', body: 'old' },
      ];
      mockState.channels = [{
        id: 'ch1',
        name: 'general',
        members: [],
        lastMessage: 'old',
        lastSender: 'testuser',
        lastTimestamp: '2026-05-07 17:00:00',
        newMessageCount: 3,
        isDM: false,
      }];
      mockState.channelTotalUnread = 3;

      const { appendChannelMessage } = await import('../../stores/channel-actions');
      appendChannelMessage('ch1', {
        sender: 'hanako',
        timestamp: '2026-05-07 17:01:00',
        body: 'new reply',
      });

      expect(mockState.channelMessages).toEqual([
        { sender: 'testuser', timestamp: '2026-05-07 17:00:00', body: 'old' },
        { sender: 'hanako', timestamp: '2026-05-07 17:01:00', body: 'new reply' },
      ]);
      expect((mockState.channels as Array<{ lastMessage: string; newMessageCount: number }>)[0]).toMatchObject({
        lastMessage: 'new reply',
        newMessageCount: 0,
      });
      expect(mockState.channelTotalUnread).toBe(0);
    });
  });

  describe('toggleChannelsEnabled', () => {
    it('切换开关状态', async () => {
      mockState.channelsEnabled = true;

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ channels: [] }),
      } as Response);

      const { toggleChannelsEnabled } = await import('../../stores/channel-actions');
      const result = await toggleChannelsEnabled();

      expect(result).toBe(false); // toggled from true to false
      // 状态通过后端 /api/channels/toggle 持久化，不再用 localStorage
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/channels/toggle'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });
});
