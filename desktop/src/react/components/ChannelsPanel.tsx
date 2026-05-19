/** ChannelsPanel — 频道系统入口 + 保留组件（子组件在 ./channels/） */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../stores';
import { fetchConfig } from '../hooks/use-config';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { useI18n } from '../hooks/use-i18n';
import { renderMarkdown } from '../utils/markdown';
import { MarkdownContent } from './chat/MarkdownContent';
import {
  addChannelMember,
  loadChannels,
  removeChannelMember,
  saveConversationAgentPhoneSettings,
  sendChannelMessage,
} from '../stores/channel-actions';
import { loadMessages } from '../stores/session-actions';
import { subscribeStreamKey } from '../services/stream-key-dispatcher';
import { useContinuousBottomScroll } from '../hooks/use-continuous-bottom-scroll';
import { resolveChannelMember, buildAgentMap, formatChannelTime, MemberAvatar } from './channels/ChannelList';
import type { MemberInfo } from './channels/ChannelList';
import { ChatTranscript } from './chat/ChatTranscript';
import { ContextMenu, type ContextMenuItem } from '../ui';
import type { ChatListItem, ChatMessage, ContentBlock } from '../stores/chat-types';
import type { AgentPhoneActivity, Model } from '../types';
import styles from './channels/Channels.module.css';
import chatStyles from './chat/Chat.module.css';

/* eslint-disable @typescript-eslint/no-explicit-any -- isComposing 等 nativeEvent 字段需 as any */

const CHANNEL_SCROLL_THRESHOLD = 80;
const EMPTY_CHAT_ITEMS: ChatListItem[] = [];
const PHONE_STREAM_MESSAGE_PREFIX = 'agent-phone-stream';

export function ChannelsPanel() {
  const channelsEnabled = useStore(s => s.channelsEnabled);
  const activeServerConnection = useStore(s => s.activeServerConnection);

  // 启动时从后端读频道开关状态；开启时加载频道列表
  useEffect(() => {
    if (!activeServerConnection) return;
    fetchConfig().then(cfg => {
      // 默认关：只有显式 true 才算启用
      const enabled = cfg?.channels?.enabled === true;
      useStore.getState().setChannelsEnabled(enabled);
      if (enabled) loadChannels();
    }).catch(err => console.warn('[channels] init failed:', err));
  }, [activeServerConnection]);

  // 开关变化后加载频道列表
  useEffect(() => {
    if (channelsEnabled && activeServerConnection) loadChannels();
  }, [channelsEnabled, activeServerConnection]);

  return null;
}

// ── ChannelMessages — 消息列表

export function ChannelMessages() {
  const { t } = useI18n();
  const messages = useStore(s => s.channelMessages);
  const currentChannel = useStore(s => s.currentChannel);
  const channels = useStore(s => s.channels);
  const agents = useStore(s => s.agents);
  const userName = useStore(s => s.userName);
  const userAvatarUrl = useStore(s => s.userAvatarUrl);
  const currentAgentId = useStore(s => s.currentAgentId);
  const agentMap = useMemo(() => buildAgentMap(agents), [agents]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const previousChannelRef = useRef<string | null>(null);
  const previousLengthRef = useRef(0);
  const [showNewMessages, setShowNewMessages] = useState(false);

  const getScrollContainer = useCallback(() => (
    wrapperRef.current?.closest('.channel-messages') as HTMLElement | null
  ), []);

  const checkNearBottom = useCallback(() => {
    const el = getScrollContainer();
    if (!el) return true;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= CHANNEL_SCROLL_THRESHOLD;
    isNearBottomRef.current = near;
    if (near) setShowNewMessages(false);
    return near;
  }, [getScrollContainer]);

  const scrollToBottom = useCallback(() => {
    const el = getScrollContainer();
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    isNearBottomRef.current = true;
    setShowNewMessages(false);
  }, [getScrollContainer]);

  useEffect(() => {
    isNearBottomRef.current = true;
    previousChannelRef.current = null;
    previousLengthRef.current = 0;
    setShowNewMessages(false);
  }, [currentChannel]);

  useEffect(() => {
    const el = getScrollContainer();
    if (!el) return;
    const onScroll = () => { checkNearBottom(); };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [checkNearBottom, getScrollContainer, messages.length]);

  useEffect(() => {
    const el = getScrollContainer();
    const channelChanged = previousChannelRef.current !== currentChannel;
    const previousLength = previousLengthRef.current;
    const grew = messages.length > previousLength;

    if (el && messages.length > 0) {
      if (channelChanged || previousLength === 0) {
        scrollToBottom();
      } else if (grew) {
        const nearNow = el.scrollHeight - el.scrollTop - el.clientHeight <= CHANNEL_SCROLL_THRESHOLD;
        if (isNearBottomRef.current || nearNow) {
          scrollToBottom();
        } else {
          setShowNewMessages(true);
        }
      }
    }

    previousChannelRef.current = currentChannel;
    previousLengthRef.current = messages.length;
  }, [currentChannel, getScrollContainer, messages.length, scrollToBottom]);

  if (!currentChannel || messages.length === 0) {
    return <div className={styles.channelWelcome}>{t('channel.noMessages')}</div>;
  }

  const ch = channels.find((c) => c.id === currentChannel);
  const isDM = ch?.isDM ?? false;
  let lastSender: string | null = null;

  return (
    <>
      <div ref={wrapperRef}>
        {messages.map((msg, idx) => {
          const isContinuation = msg.sender === lastSender;
          const senderInfo = resolveChannelMember(msg.sender, userName, userAvatarUrl, agents, currentAgentId, agentMap);
          const isSelf = senderInfo.isUser || (isDM && msg.sender === (currentAgentId || ''));
          const el = (
            <div
              key={`${msg.timestamp}-${msg.sender}-${idx}`}
              className={
                styles.channelMsg
                + (isContinuation ? ` ${styles.channelMsgContinuation}` : '')
                + (isSelf ? ` ${styles.channelMsgSelf}` : '')
              }
            >
              <div className={styles.channelMsgAvatar}>
                <MemberAvatar info={senderInfo} className={styles.channelMsgAvatarImg} />
              </div>
              <div className={styles.channelMsgBody}>
                {!isContinuation && (
                  <div className={styles.channelMsgHeader}>
                    <span className={styles.channelMsgSender}>{senderInfo.displayName}</span>
                    <span className={styles.channelMsgTime}>{formatChannelTime(msg.timestamp)}</span>
                  </div>
                )}
                <MarkdownContent
                  className={styles.channelMsgText}
                  html={renderMarkdown(msg.body || '')}
                />
              </div>
            </div>
          );
          lastSender = msg.sender;
          return el;
        })}
      </div>
      {showNewMessages && (
        <button
          type="button"
          className={styles.channelNewMessagesBtn}
          onClick={scrollToBottom}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14" />
            <path d="m19 12-7 7-7-7" />
          </svg>
          <span>{t('channel.newMessages')}</span>
        </button>
      )}
    </>
  );
}

// ── ChannelMembers — 右侧面板成员列表

function MemberItem({ info, memberId, onRemove, removeDisabled, removeTitle }: {
  info: MemberInfo;
  memberId?: string;
  onRemove?: (memberId: string, info: MemberInfo) => void;
  removeDisabled?: boolean;
  removeTitle?: string;
}) {
  return (
    <div className={styles.channelMemberItem}>
      <div className={styles.channelMemberAvatar}>
        <MemberAvatar info={info} className={styles.channelMemberAvatarImg} />
      </div>
      <div className={styles.channelMemberName}>{info.displayName}</div>
      {onRemove && (
        <button
          type="button"
          className={styles.channelMemberRemoveButton}
          title={removeTitle}
          disabled={removeDisabled}
          onClick={() => onRemove(memberId || info.id, info)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ChannelMembers() {
  const { t } = useI18n();
  const currentChannel = useStore(s => s.currentChannel);
  const channelMembers = useStore(s => s.channelMembers);
  const isDM = useStore(s => s.channelIsDM);
  const agents = useStore(s => s.agents);
  const userName = useStore(s => s.userName);
  const userAvatarUrl = useStore(s => s.userAvatarUrl);
  const currentAgentId = useStore(s => s.currentAgentId);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);

  const agentMap = useMemo(() => buildAgentMap(agents), [agents]);

  if (!currentChannel) return null;

  const resolve = (id: string) => resolveChannelMember(id, userName, userAvatarUrl, agents, currentAgentId, agentMap);

  if (isDM) {
    const peerInfo = resolve(channelMembers[0] || '');
    const selfInfo = resolve(currentAgentId || '');
    return <>{[peerInfo, selfInfo].map(i => <MemberItem key={i.id} info={i} />)}</>;
  }

  const availableAgents = agents.filter((agent) => !channelMembers.includes(agent.id));
  const canRemoveMembers = channelMembers.length > 2;

  const handleAddClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPos({ x: rect.left, y: rect.bottom + 4 });
  };

  const handleRemove = (memberId: string, info: MemberInfo) => {
    if (!currentChannel || !canRemoveMembers) return;
    const confirmed = confirm(t('channel.removeMemberConfirm', { name: info.displayName }));
    if (!confirmed) return;
    setBusyMemberId(memberId);
    removeChannelMember(currentChannel, memberId)
      .catch((err) => alert(err?.message || t('channel.removeMemberFailed')))
      .finally(() => setBusyMemberId(null));
  };

  const userInfo = resolve('user');
  const menuItems: ContextMenuItem[] = availableAgents.length > 0
    ? availableAgents.map((agent): ContextMenuItem => ({
      label: agent.name || agent.id,
      action: () => {
        if (!currentChannel) return;
        setBusyMemberId(agent.id);
        addChannelMember(currentChannel, agent.id)
          .catch((err) => alert(err?.message || t('channel.addMemberFailed')))
          .finally(() => setBusyMemberId(null));
      },
    }))
    : [{ label: t('channel.noAvailableMembers'), disabled: true }];

  return (
    <>
      <MemberItem info={userInfo} />
      {channelMembers.map((memberId) => (
        <MemberItem
          key={memberId}
          memberId={memberId}
          info={resolve(memberId)}
          onRemove={handleRemove}
          removeDisabled={!canRemoveMembers || busyMemberId === memberId}
          removeTitle={canRemoveMembers ? t('channel.removeMember') : t('channel.minMembers')}
        />
      ))}
      <button
        type="button"
        className={styles.channelMemberAddButton}
        onClick={handleAddClick}
        disabled={!!busyMemberId}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
        <span>{t('channel.addMember')}</span>
      </button>
      {menuPos && (
        <ContextMenu
          items={menuItems}
          position={menuPos}
          onClose={() => setMenuPos(null)}
        />
      )}
    </>
  );
}

function activitySessionPath(activity: AgentPhoneActivity | undefined): string | null {
  const value = activity?.details?.sessionPath;
  return typeof value === 'string' && value ? value : null;
}

function createPhoneStreamMessage(agentId: string, turnToken: number): ChatMessage {
  return {
    id: `${PHONE_STREAM_MESSAGE_PREFIX}-${agentId}-${turnToken}`,
    role: 'assistant',
    blocks: [],
  };
}

function upsertPhoneBlock(
  blocks: ContentBlock[],
  match: (block: ContentBlock) => boolean,
  nextBlock: ContentBlock,
  insertAtStart = false,
): ContentBlock[] {
  const idx = blocks.findIndex(match);
  if (idx >= 0) {
    const next = [...blocks];
    next[idx] = nextBlock;
    return next;
  }
  return insertAtStart ? [nextBlock, ...blocks] : [...blocks, nextBlock];
}

export function AgentPhoneSessionPreview({ sessionPath, agentId, agentYuan }: {
  sessionPath: string | null;
  agentId: string;
  agentYuan?: string | null;
}) {
  const { t } = useI18n();
  const session = useStore(s => (sessionPath ? s.chatSessions[sessionPath] ?? null : null));
  const items = session?.items ?? EMPTY_CHAT_ITEMS;
  const [loading, setLoading] = useState(false);
  const [streamMessage, setStreamMessage] = useState<ChatMessage | null>(null);
  const [streamRevision, setStreamRevision] = useState(0);
  const streamTurnRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const bottomScroll = useContinuousBottomScroll({
    scrollRef,
    contentRef,
    active: !!sessionPath,
    stickyThreshold: 32,
  });
  const moodYuan = agentYuan || 'hanako';

  useEffect(() => {
    bottomScroll.scrollToBottom({ mode: 'instant', forceSticky: true });
    streamTurnRef.current = 0;
    setStreamMessage(null);
    setStreamRevision(0);
  }, [bottomScroll, sessionPath]);

  useEffect(() => {
    if (!sessionPath || items.length > 0 || loading) return;
    let cancelled = false;
    setLoading(true);
    void loadMessages(sessionPath)
      .catch((err: unknown) => console.warn('[channels] load phone session failed:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [items.length, loading, sessionPath]);

  useEffect(() => {
    bottomScroll.followBottom();
  }, [bottomScroll, items.length, loading, streamRevision]);

  useEffect(() => {
    if (!sessionPath) return;

    const updateStreamMessage = (updater: (message: ChatMessage) => ChatMessage) => {
      setStreamMessage((prev) => {
        const base = prev || createPhoneStreamMessage(agentId, ++streamTurnRef.current);
        return updater(base);
      });
      setStreamRevision((value) => value + 1);
    };

    const unsubscribe = subscribeStreamKey(sessionPath, (event: any) => {
      switch (event.type) {
        case 'thinking_start':
          updateStreamMessage((message) => ({
            ...message,
            blocks: upsertPhoneBlock(
              message.blocks || [],
              (block) => block.type === 'thinking',
              { type: 'thinking', content: '', sealed: false },
              true,
            ),
          }));
          break;
        case 'thinking_delta':
          updateStreamMessage((message) => {
            const blocks = message.blocks || [];
            const thinking = blocks.find((block) => block.type === 'thinking') as Extract<ContentBlock, { type: 'thinking' }> | undefined;
            return {
              ...message,
              blocks: upsertPhoneBlock(
                blocks,
                (block) => block.type === 'thinking',
                { type: 'thinking', content: `${thinking?.content || ''}${event.delta || ''}`, sealed: false },
                true,
              ),
            };
          });
          break;
        case 'thinking_end':
          updateStreamMessage((message) => {
            const blocks = message.blocks || [];
            const thinking = blocks.find((block) => block.type === 'thinking') as Extract<ContentBlock, { type: 'thinking' }> | undefined;
            return {
              ...message,
              blocks: upsertPhoneBlock(
                blocks,
                (block) => block.type === 'thinking',
                { type: 'thinking', content: thinking?.content || '', sealed: true },
                true,
              ),
            };
          });
          break;
        case 'mood_start':
          updateStreamMessage((message) => ({
            ...message,
            blocks: upsertPhoneBlock(
              message.blocks || [],
              (block) => block.type === 'mood',
              { type: 'mood', yuan: moodYuan, text: '' },
            ),
          }));
          break;
        case 'mood_text':
          updateStreamMessage((message) => {
            const blocks = message.blocks || [];
            const mood = blocks.find((block) => block.type === 'mood') as Extract<ContentBlock, { type: 'mood' }> | undefined;
            return {
              ...message,
              blocks: upsertPhoneBlock(
                blocks,
                (block) => block.type === 'mood',
                { type: 'mood', yuan: moodYuan, text: `${mood?.text || ''}${event.delta || ''}` },
              ),
            };
          });
          break;
        case 'mood_end':
          break;
        case 'text_delta':
          updateStreamMessage((message) => {
            const blocks = message.blocks || [];
            const textBlock = blocks.find((block) => block.type === 'text') as (Extract<ContentBlock, { type: 'text' }> & { _raw?: string }) | undefined;
            const prevText = textBlock?.source ?? textBlock?._raw ?? '';
            const nextText = `${prevText}${event.delta || ''}`;
            return {
              ...message,
              blocks: upsertPhoneBlock(
                blocks,
                (block) => block.type === 'text',
                { type: 'text', html: renderMarkdown(nextText), source: nextText },
              ),
            };
          });
          break;
        case 'tool_start':
          updateStreamMessage((message) => ({
            ...message,
            blocks: [
              ...(message.blocks || []),
              {
                type: 'tool_group',
                tools: [{ name: event.name, args: event.args, done: false, success: false }],
                collapsed: false,
              },
            ],
          }));
          break;
        case 'tool_end':
          updateStreamMessage((message) => {
            const blocks = [...(message.blocks || [])];
            for (let i = blocks.length - 1; i >= 0; i -= 1) {
              const block = blocks[i];
              if (block.type !== 'tool_group') continue;
              const toolIndex = block.tools.findIndex((tool) => tool.name === event.name && !tool.done);
              if (toolIndex < 0) continue;
              const tools = [...block.tools];
              tools[toolIndex] = {
                ...tools[toolIndex],
                done: true,
                success: !!event.success,
                details: event.details,
              };
              blocks[i] = { ...block, tools, collapsed: tools.length > 1 && tools.every((tool) => tool.done) };
              break;
            }
            return { ...message, blocks };
          });
          break;
        case 'content_block':
          if (event.block) {
            updateStreamMessage((message) => ({
              ...message,
              blocks: [...(message.blocks || []), event.block],
            }));
          }
          break;
        case 'turn_end':
          void loadMessages(sessionPath).then(() => setStreamMessage(null)).catch(() => {});
          break;
        default:
          break;
      }
    });

    return unsubscribe;
  }, [agentId, moodYuan, sessionPath]);

  const phoneNotice = t('channel.phoneReceivedNewMessages') || '收到新的群聊消息';
  const displayItems = useMemo(() => {
    const mergedItems = streamMessage
      ? [...items, { type: 'message' as const, data: streamMessage }]
      : items;
    return mergedItems.map((item) => {
      if (item.type !== 'message' || item.data.role !== 'user') return item;
      return {
        ...item,
        data: {
          ...item.data,
          text: phoneNotice,
          textHtml: renderMarkdown(phoneNotice),
          attachments: [],
          deskContext: null,
          skills: [],
        },
      };
    });
  }, [items, phoneNotice, streamMessage]);

  return (
    <div ref={scrollRef} className={`${styles.agentActivityTranscriptScroll} ${chatStyles.subagentPreviewTranscript}`}>
      <div ref={contentRef}>
        {!sessionPath ? (
          <div className={styles.agentActivityEmpty}>{t('channel.agentIdle')}</div>
        ) : loading && displayItems.length === 0 ? (
          <div className={styles.agentActivityEmpty}>{t('common.loading')}</div>
        ) : displayItems.length === 0 ? (
          <div className={styles.agentActivityEmpty}>{t('channel.agentIdle')}</div>
        ) : (
          <ChatTranscript
            items={displayItems}
            sessionPath={sessionPath}
            agentId={agentId}
            readOnly
            hideUserIdentity
          />
        )}
      </div>
    </div>
  );
}

// ── ChannelAgentActivityPanel — 右侧面板 Agent 动态

export function ChannelAgentActivityPanel() {
  const { t } = useI18n();
  const currentChannel = useStore(s => s.currentChannel);
  const channelMembers = useStore(s => s.channelMembers);
  const isDM = useStore(s => s.channelIsDM);
  const agents = useStore(s => s.agents);
  const userName = useStore(s => s.userName);
  const userAvatarUrl = useStore(s => s.userAvatarUrl);
  const currentAgentId = useStore(s => s.currentAgentId);
  const allActivities = useStore(s => s.channelAgentActivities);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const agentMap = useMemo(() => buildAgentMap(agents), [agents]);

  if (!currentChannel) return null;

  const ids = isDM
    ? [currentAgentId, channelMembers[0]].filter((id): id is string => !!id)
    : channelMembers;
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return null;

  const byAgent = allActivities?.[currentChannel] || {};
  const resolve = (id: string) => resolveChannelMember(id, userName, userAvatarUrl, agents, currentAgentId, agentMap);

  return (
    <div className="jian-card">
      <div className="channel-info-section">
        <div className={styles.agentActivityHeader}>
          <div className="channel-info-label">{t('channel.agentActivity')}</div>
        </div>
        <div className={styles.agentActivityList}>
          {uniqueIds.map((agentId) => {
            const info = resolve(agentId);
            const history = byAgent[agentId] || [];
            const latest = history[0];
            const open = expanded[agentId] === true;
            const sessionPath = history.map(activitySessionPath).find((path): path is string => !!path) || null;
            return (
              <div key={agentId} className={styles.agentActivityItem}>
                <button
                  type="button"
                  className={styles.agentActivityRow}
                  onClick={() => setExpanded(prev => ({ ...prev, [agentId]: !prev[agentId] }))}
                  aria-expanded={open}
                >
                  <span className={styles.agentActivityAvatar}>
                    <MemberAvatar info={info} className={styles.agentActivityAvatarImg} />
                  </span>
                  <span className={styles.agentActivityName}>{info.displayName}</span>
                  <span className={styles.agentActivitySummary}>{latest?.summary || t('channel.agentIdle')}</span>
                </button>
                {open && (
                  <div className={styles.agentActivityDetails}>
                    <AgentPhoneSessionPreview
                      sessionPath={sessionPath}
                      agentId={agentId}
                      agentYuan={info.yuan}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function parseOptionalIntInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.floor(num);
}

function modelKey(model: { id: string; provider: string } | null | undefined): string {
  return model ? `${model.provider}/${model.id}` : '';
}

export function ChannelAgentSettingsPanel() {
  const { t } = useI18n();
  const currentChannel = useStore(s => s.currentChannel);
  const isDM = useStore(s => s.channelIsDM);
  const models = useStore(s => s.models);
  const toolMode = useStore(s => s.channelAgentPhoneToolMode);
  const replyMinChars = useStore(s => s.channelAgentReplyMinChars);
  const replyMaxChars = useStore(s => s.channelAgentReplyMaxChars);
  const proactiveEnabled = useStore(s => s.channelAgentProactiveEnabled);
  const reminderIntervalMinutes = useStore(s => s.channelAgentReminderIntervalMinutes);
  const guardLimit = useStore(s => s.channelAgentGuardLimit);
  const modelOverrideEnabled = useStore(s => s.channelAgentModelOverrideEnabled);
  const modelOverrideModel = useStore(s => s.channelAgentModelOverrideModel);
  const [saving, setSaving] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [draftMin, setDraftMin] = useState(replyMinChars ? String(replyMinChars) : '');
  const [draftMax, setDraftMax] = useState(replyMaxChars ? String(replyMaxChars) : '');
  const [draftReminder, setDraftReminder] = useState(String(reminderIntervalMinutes || 31));
  const [draftGuardLimit, setDraftGuardLimit] = useState(String(guardLimit || 36));
  const modelSelectRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setDraftMin(replyMinChars ? String(replyMinChars) : '');
    setDraftMax(replyMaxChars ? String(replyMaxChars) : '');
    setDraftReminder(String(reminderIntervalMinutes || 31));
    setDraftGuardLimit(String(guardLimit || 36));
  }, [currentChannel, replyMinChars, replyMaxChars, reminderIntervalMinutes, guardLimit]);

  useEffect(() => {
    if (models.length > 0) return;
    void hanaFetch('/api/models')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.models) useStore.setState({ models: data.models });
      })
      .catch((err: unknown) => console.warn('[channels] load models failed:', err));
  }, [models.length]);

  useEffect(() => {
    if (!modelOpen) return;
    const handler = (event: MouseEvent) => {
      if (modelSelectRef.current && !modelSelectRef.current.contains(event.target as Node)) {
        setModelOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelOpen]);

  if (!currentChannel) return null;

  const saveSettings = async (patch: Parameters<typeof saveConversationAgentPhoneSettings>[0]) => {
    setSaving(true);
    try {
      await saveConversationAgentPhoneSettings(patch);
    } catch (err: any) {
      console.error('[channels] save phone settings failed:', err);
      alert(err?.message || t('channel.settingsSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const commitTextSettings = () => {
    const min = parseOptionalIntInput(draftMin);
    const max = parseOptionalIntInput(draftMax);
    const reminder = parseOptionalIntInput(draftReminder) || 31;
    const guard = parseOptionalIntInput(draftGuardLimit) || 36;
    if (min && max && min > max) {
      alert(t('channel.replyRangeInvalid'));
      return;
    }
    void saveSettings({
      replyMinChars: min,
      replyMaxChars: max,
      ...(!isDM ? { reminderIntervalMinutes: reminder, guardLimit: guard } : {}),
    });
  };

  const changeMode = (mode: 'read_only' | 'write') => {
    if (mode === toolMode || saving) return;
    void saveSettings({ mode });
  };

  const changeProactiveEnabled = (enabled: boolean) => {
    if (saving || enabled === proactiveEnabled) return;
    void saveSettings({ proactiveEnabled: enabled });
  };

  const changeModelOverrideEnabled = (enabled: boolean) => {
    if (saving || enabled === modelOverrideEnabled) return;
    if (!enabled) {
      void saveSettings({ modelOverrideEnabled: false, modelOverrideModel: modelOverrideModel });
      return;
    }
    const selected = modelOverrideModel || models[0] || null;
    if (!selected) {
      alert(t('channel.noModelsAvailable'));
      return;
    }
    void saveSettings({
      modelOverrideEnabled: true,
      modelOverrideModel: { id: selected.id, provider: selected.provider },
    });
  };

  const selectOverrideModel = (model: Model) => {
    setModelOpen(false);
    void saveSettings({
      modelOverrideEnabled: true,
      modelOverrideModel: { id: model.id, provider: model.provider },
    });
  };

  const selectedModel = modelOverrideModel
    ? models.find(m => m.id === modelOverrideModel.id && m.provider === modelOverrideModel.provider)
    : null;
  const modelLabel = selectedModel?.name || modelOverrideModel?.id || t('channel.selectModel');
  const groupedModels = models.reduce<Record<string, Model[]>>((acc, model) => {
    const key = model.provider || '';
    if (!acc[key]) acc[key] = [];
    acc[key].push(model);
    return acc;
  }, {});
  const providerKeys = Object.keys(groupedModels);
  const hasMultipleProviders = providerKeys.length > 1 || (providerKeys.length === 1 && providerKeys[0] !== '');

  return (
    <div className={`jian-card ${styles.agentSettingsCard}`}>
      <div className="channel-info-section">
        <div className={styles.agentSettingsHeader}>
          <div className="channel-info-label">{t('channel.agentSettings')}</div>
        </div>
        <div className={!isDM ? styles.agentSettingsInlineGrid : undefined}>
          <div className={styles.agentSettingsField}>
            <div className={styles.agentSettingsLabel}>{t('channel.toolPermission')}</div>
            <div className={`${styles.agentToolModeToggle}${!isDM ? ` ${styles.agentToolModeToggleFill}` : ''}`}>
              <button
                type="button"
                className={`${styles.agentToolModeButton}${toolMode === 'read_only' ? ` ${styles.agentToolModeButtonActive}` : ''}`}
                disabled={saving}
                onClick={() => changeMode('read_only')}
              >
                {t('channel.toolReadOnly')}
              </button>
              <button
                type="button"
                className={`${styles.agentToolModeButton}${toolMode === 'write' ? ` ${styles.agentToolModeButtonActive}` : ''}`}
                disabled={saving}
                onClick={() => changeMode('write')}
              >
                {t('channel.toolWrite')}
              </button>
            </div>
          </div>
          {!isDM && (
            <div className={styles.agentSettingsField}>
              <div className={styles.agentSettingsLabel}>{t('channel.guardLimit')}</div>
              <input
                className={styles.agentReplyRangeInput}
                inputMode="numeric"
                placeholder="36"
                value={draftGuardLimit}
                onChange={(event) => setDraftGuardLimit(event.target.value.replace(/[^\d]/g, ''))}
                onBlur={commitTextSettings}
                disabled={saving}
              />
            </div>
          )}
        </div>
        {!isDM && (
          <div className={`${styles.agentSettingsInlineGrid} ${styles.agentSettingsInlineGridSpaced}`}>
            <div className={styles.agentSettingsField}>
              <div className={styles.agentSettingsLabel}>{t('channel.proactiveInitiation')}</div>
              <div className={`${styles.agentToolModeToggle} ${styles.agentToolModeToggleFill}`}>
                <button
                  type="button"
                  className={`${styles.agentToolModeButton}${!proactiveEnabled ? ` ${styles.agentToolModeButtonActive}` : ''}`}
                  disabled={saving}
                  onClick={() => changeProactiveEnabled(false)}
                >
                  {t('channel.proactiveOff')}
                </button>
                <button
                  type="button"
                  className={`${styles.agentToolModeButton}${proactiveEnabled ? ` ${styles.agentToolModeButtonActive}` : ''}`}
                  disabled={saving}
                  onClick={() => changeProactiveEnabled(true)}
                >
                  {t('channel.proactiveOn')}
                </button>
              </div>
            </div>
            <div className={styles.agentSettingsField}>
              <div className={styles.agentSettingsLabel}>{t('channel.proactiveInterval')}</div>
              <input
                className={styles.agentReplyRangeInput}
                inputMode="numeric"
                placeholder="31"
                value={draftReminder}
                onChange={(event) => setDraftReminder(event.target.value.replace(/[^\d]/g, ''))}
                onBlur={commitTextSettings}
                disabled={saving || !proactiveEnabled}
              />
            </div>
          </div>
        )}
        <div className={styles.agentSettingsField}>
          <div className={styles.agentSettingsLabel}>{t('channel.replyRange')}</div>
          <div className={styles.agentReplyRangeRow}>
            <input
              className={styles.agentReplyRangeInput}
              inputMode="numeric"
              placeholder={t('channel.replyMinPlaceholder')}
              value={draftMin}
              onChange={(event) => setDraftMin(event.target.value.replace(/[^\d]/g, ''))}
              onBlur={commitTextSettings}
              disabled={saving}
            />
            <span className={styles.agentReplyRangeSep}>-</span>
            <input
              className={styles.agentReplyRangeInput}
              inputMode="numeric"
              placeholder={t('channel.replyMaxPlaceholder')}
              value={draftMax}
              onChange={(event) => setDraftMax(event.target.value.replace(/[^\d]/g, ''))}
              onBlur={commitTextSettings}
              disabled={saving}
            />
          </div>
        </div>
        {!isDM && (
          <div className={styles.agentSettingsField}>
            <div className={styles.agentSettingsLabel}>{t('channel.modelOverride')}</div>
            <div className={styles.agentModelOverrideRow}>
              <div className={styles.agentToolModeToggle}>
                <button
                  type="button"
                  className={`${styles.agentToolModeButton}${!modelOverrideEnabled ? ` ${styles.agentToolModeButtonActive}` : ''}`}
                  disabled={saving}
                  onClick={() => changeModelOverrideEnabled(false)}
                >
                  {t('channel.modelDefault')}
                </button>
                <button
                  type="button"
                  className={`${styles.agentToolModeButton}${modelOverrideEnabled ? ` ${styles.agentToolModeButtonActive}` : ''}`}
                  disabled={saving}
                  onClick={() => changeModelOverrideEnabled(true)}
                >
                  {t('channel.modelOverrideOn')}
                </button>
              </div>
              <div className={styles.agentModelSelect} ref={modelSelectRef}>
                <button
                  type="button"
                  className={styles.agentModelSelectButton}
                  disabled={!modelOverrideEnabled || saving}
                  onClick={() => setModelOpen(open => !open)}
                >
                  <span>{modelLabel}</span>
                  <span className={styles.agentModelSelectArrow}>▾</span>
                </button>
                {modelOpen && modelOverrideEnabled && (
                  <div className={styles.agentModelDropdown}>
                    {providerKeys.map(provider => (
                      <div key={provider || '__none'}>
                        {hasMultipleProviders && (
                          <div className={styles.agentModelGroupHeader}>{provider || '-'}</div>
                        )}
                        {groupedModels[provider].map(model => (
                          <button
                            key={modelKey(model)}
                            type="button"
                            className={`${styles.agentModelOption}${modelKey(modelOverrideModel) === modelKey(model) ? ` ${styles.agentModelOptionActive}` : ''}`}
                            onClick={() => selectOverrideModel(model)}
                          >
                            {model.name || model.id}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ChannelInput — 输入区域 + @mention

export function ChannelInput() {
  const currentChannel = useStore(s => s.currentChannel);
  const isDM = useStore(s => s.channelIsDM);
  const channelMembers = useStore(s => s.channelMembers);
  const agents = useStore(s => s.agents);
  const userName = useStore(s => s.userName);
  const userAvatarUrl = useStore(s => s.userAvatarUrl);
  const currentAgentId = useStore(s => s.currentAgentId);

  const agentMap = useMemo(() => buildAgentMap(agents), [agents]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionItems, setMentionItems] = useState<MemberInfo[]>([]);
  const [mentionSelectedIdx, setMentionSelectedIdx] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(-1);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    if (sending || !inputValue.trim()) return;
    setSending(true);
    try { await sendChannelMessage(inputValue.trim()); setInputValue(''); }
    finally { setSending(false); }
  }, [sending, inputValue]);

  const checkMention = useCallback(() => {
    if (!inputRef.current) return;
    const val = inputRef.current.value;
    const pos = inputRef.current.selectionStart ?? 0;
    const before = val.slice(0, pos);
    const atIdx = before.lastIndexOf('@');
    if (atIdx < 0 || (atIdx > 0 && /\S/.test(before[atIdx - 1]))) { setMentionActive(false); return; }
    const keyword = before.slice(atIdx + 1).toLowerCase();
    setMentionStartPos(atIdx);
    const members = (channelMembers || [])
      .map(id => resolveChannelMember(id, userName, userAvatarUrl, agents, currentAgentId, agentMap))
      .filter(m => !m.isUser);
    const filtered = keyword
      ? members.filter(m => m.displayName.toLowerCase().includes(keyword) || (m.yuan || '').toLowerCase().includes(keyword))
      : members;
    if (filtered.length === 0) { setMentionActive(false); return; }
    setMentionItems(filtered);
    setMentionSelectedIdx(0);
    setMentionActive(true);
  }, [channelMembers, agents, agentMap, userName, userAvatarUrl, currentAgentId]);

  const insertMention = useCallback((name: string) => {
    if (!inputRef.current || mentionStartPos < 0) return;
    const val = inputRef.current.value;
    const pos = inputRef.current.selectionStart ?? 0;
    const before = val.slice(0, mentionStartPos);
    const inserted = `@${name} `;
    setInputValue(before + inserted + val.slice(pos));
    setMentionActive(false);
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      const c = before.length + inserted.length;
      inputRef.current.setSelectionRange(c, c);
      inputRef.current.focus();
    });
  }, [mentionStartPos]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as any).isComposing) {
      e.preventDefault();
      if (mentionActive) { const s = mentionItems[mentionSelectedIdx]; if (s) insertMention(s.displayName); }
      else handleSend();
      return;
    }
    if (!mentionActive) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionSelectedIdx(i => (i + 1) % mentionItems.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setMentionSelectedIdx(i => (i - 1 + mentionItems.length) % mentionItems.length); }
    if (e.key === 'Escape') { e.preventDefault(); setMentionActive(false); }
  }, [mentionActive, mentionItems, mentionSelectedIdx, insertMention, handleSend]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    requestAnimationFrame(() => checkMention());
  }, [checkMention]);

  if (isDM || !currentChannel) return null;

  return (
    <div className={styles.channelInputWrapper}>
      {mentionActive && mentionItems.length > 0 && (
        <div className={styles.channelMentionDropdown}>
          {mentionItems.map((m) => (
            <div
              key={m.id}
              className={`${styles.channelMentionItem}${mentionItems.indexOf(m) === mentionSelectedIdx ? ` ${styles.channelMentionItemActive}` : ''}`}
              data-name={m.displayName}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(m.displayName);
              }}
            >
              <div className={styles.channelMentionAvatar}>
                <MemberAvatar info={m} />
              </div>
              <span>{m.displayName}</span>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        className={styles.channelInputBox}
        placeholder={window.t?.('channel.inputPlaceholder') || 'Send a message...'}
        rows={1}
        spellCheck={false}
        value={inputValue}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
      />
      <button
        className={styles.channelSendBtn}
        disabled={!inputValue.trim() || sending}
        onClick={handleSend}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
      </button>
    </div>
  );
}

// ── ChannelReadonly

export function ChannelReadonly() {
  const isDM = useStore(s => s.channelIsDM);
  const currentChannel = useStore(s => s.currentChannel);

  if (!isDM || !currentChannel) return null;

  return (
    <span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: 4 }}>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
      {window.t?.('channel.readOnly') || '这是 Agent 之间的私信，仅可查看'}
    </span>
  );
}
