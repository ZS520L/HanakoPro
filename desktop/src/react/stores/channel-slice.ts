import type { AgentPhoneToolMode, Channel, ChannelAgentActivities, ChannelMessage } from '../types';

export interface ChannelSlice {
  channels: Channel[];
  currentChannel: string | null;
  channelMessages: ChannelMessage[];
  channelMembers: string[];
  channelTotalUnread: number;
  channelsEnabled: boolean;
  channelHeaderName: string;
  channelHeaderMembersText: string;
  channelInfoName: string;
  channelIsDM: boolean;
  channelAgentActivities: ChannelAgentActivities;
  channelAgentPhoneToolMode: AgentPhoneToolMode;
  channelAgentReplyMinChars: number | null;
  channelAgentReplyMaxChars: number | null;
  channelAgentProactiveEnabled: boolean;
  channelAgentReminderIntervalMinutes: number;
  channelAgentGuardLimit: number;
  channelAgentModelOverrideEnabled: boolean;
  channelAgentModelOverrideModel: { id: string; provider: string } | null;
  setChannels: (channels: Channel[]) => void;
  setCurrentChannel: (channel: string | null) => void;
  setChannelMessages: (messages: ChannelMessage[]) => void;
  setChannelTotalUnread: (count: number) => void;
  setChannelsEnabled: (enabled: boolean) => void;
}

export const createChannelSlice = (
  set: (partial: Partial<ChannelSlice>) => void,
): ChannelSlice => ({
  channels: [],
  currentChannel: null,
  channelMessages: [],
  channelMembers: [],
  channelTotalUnread: 0,
  channelsEnabled: false,
  channelHeaderName: '',
  channelHeaderMembersText: '',
  channelInfoName: '',
  channelIsDM: false,
  channelAgentActivities: {},
  channelAgentPhoneToolMode: 'read_only',
  channelAgentReplyMinChars: null,
  channelAgentReplyMaxChars: null,
  channelAgentProactiveEnabled: true,
  channelAgentReminderIntervalMinutes: 31,
  channelAgentGuardLimit: 36,
  channelAgentModelOverrideEnabled: false,
  channelAgentModelOverrideModel: null,
  setChannels: (channels) => set({ channels }),
  setCurrentChannel: (channel) => set({ currentChannel: channel }),
  setChannelMessages: (messages) => set({ channelMessages: messages }),
  setChannelTotalUnread: (count) => set({ channelTotalUnread: count }),
  setChannelsEnabled: (enabled) => set({ channelsEnabled: enabled }),
});
