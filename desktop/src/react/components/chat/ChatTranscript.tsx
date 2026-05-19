import { memo, useCallback, useMemo } from 'react';
import type { ChatListItem } from '../../stores/chat-types';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';

interface Props {
  items: ChatListItem[];
  sessionPath: string;
  agentId?: string | null;
  readOnly?: boolean;
  hideUserIdentity?: boolean;
  userIdentity?: { name?: string | null; avatarUrl?: string | null };
  registerMessageElement?: (messageId: string, element: HTMLDivElement | null) => void;
}

export const ChatTranscript = memo(function ChatTranscript({
  items,
  sessionPath,
  agentId,
  readOnly = false,
  hideUserIdentity = false,
  userIdentity,
  registerMessageElement,
}: Props) {
  const latestUserIndex = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item.type === 'message' && item.data.role === 'user') return i;
    }
    return -1;
  }, [items]);

  const latestAssistantIndex = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item.type === 'message' && item.data.role === 'assistant') return i;
    }
    return -1;
  }, [items]);

  const latestAssistantPrecedingUserTimestamp = useMemo(() => {
    if (latestAssistantIndex < 0) return undefined;
    for (let i = latestAssistantIndex - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item.type === 'message' && item.data.role === 'user') return item.data.timestamp;
    }
    return undefined;
  }, [items, latestAssistantIndex]);

  return (
    <>
      {items.map((item, index) => (
        <TranscriptItemView
          key={item.type === 'message' ? item.data.id : `c-${index}`}
          item={item}
          prevItem={index > 0 ? items[index - 1] : undefined}
          sessionPath={sessionPath}
          agentId={agentId}
          readOnly={readOnly}
          hideUserIdentity={hideUserIdentity}
          userIdentity={userIdentity}
          isLatestUserMessage={index === latestUserIndex}
          isLatestAssistantMessage={index === latestAssistantIndex}
          precedingUserTimestamp={index === latestAssistantIndex ? latestAssistantPrecedingUserTimestamp : undefined}
          registerMessageElement={registerMessageElement}
        />
      ))}
    </>
  );
});

const TranscriptItemView = memo(function TranscriptItemView({
  item,
  prevItem,
  sessionPath,
  agentId,
  readOnly,
  hideUserIdentity,
  userIdentity,
  isLatestUserMessage,
  isLatestAssistantMessage,
  precedingUserTimestamp,
  registerMessageElement,
}: {
  item: ChatListItem;
  prevItem?: ChatListItem;
  sessionPath: string;
  agentId?: string | null;
  readOnly: boolean;
  hideUserIdentity: boolean;
  userIdentity?: { name?: string | null; avatarUrl?: string | null };
  isLatestUserMessage: boolean;
  isLatestAssistantMessage: boolean;
  precedingUserTimestamp?: number | string;
  registerMessageElement?: (messageId: string, element: HTMLDivElement | null) => void;
}) {
  const messageId = item.type === 'message' ? item.data.id : null;
  const messageRef = useCallback((element: HTMLDivElement | null) => {
    if (messageId) registerMessageElement?.(messageId, element);
  }, [messageId, registerMessageElement]);

  if (item.type === 'compaction') return null;

  const msg = item.data;
  const prevRole = prevItem?.type === 'message' ? prevItem.data.role : null;
  const showAvatar = msg.role !== prevRole;

  if (msg.role === 'user') {
    return (
      <UserMessage
        message={msg}
        showAvatar={showAvatar}
        sessionPath={sessionPath}
        readOnly={readOnly}
        hideIdentity={hideUserIdentity}
        userIdentity={userIdentity}
        isLatestUserMessage={isLatestUserMessage}
        messageRef={messageRef}
      />
    );
  }

  return (
    <AssistantMessage
      message={msg}
      showAvatar={showAvatar}
      sessionPath={sessionPath}
      agentId={agentId}
      readOnly={readOnly}
      messageRef={messageRef}
      isLatestAssistantMessage={isLatestAssistantMessage}
      precedingUserTimestamp={precedingUserTimestamp}
    />
  );
});
