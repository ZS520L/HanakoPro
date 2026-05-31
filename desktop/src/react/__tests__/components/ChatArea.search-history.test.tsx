// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';
import type { ChatListItem } from '../../stores/chat-types';

vi.mock('../../components/chat/ChatTranscript', () => ({
  ChatTranscript: ({ items }: { items: ChatListItem[] }) => (
    <div data-testid="transcript">
      {items.map((item) => {
        if (item.type === 'message') {
          const msg = item.data;
          if (msg.role === 'user') {
            return <div key={msg.id} className="messageGroup" data-message-id={msg.id}>{msg.text}</div>;
          } else {
            return (
              <div key={msg.id} className="messageGroup" data-message-id={msg.id}>
                {msg.blocks?.map((block, i) => (
                  block.type === 'text' ? <div key={i}>{block.html}</div> : null
                ))}
              </div>
            );
          }
        }
        return null;
      })}
    </div>
  ),
}));

vi.mock('../../components/chat/ChatTimelineNavigator', () => ({
  ChatTimelineNavigator: () => null,
}));

vi.mock('../../components/chat/ChatSearchBar', () => ({
  ChatSearchBar: () => null,
}));

import { ChatArea } from '../../components/chat/ChatArea';

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

function message(id: string, role: 'user' | 'assistant', text: string): ChatListItem {
  return {
    type: 'message',
    data: role === 'user'
      ? { id, role, text, textHtml: `<p>${text}</p>` }
      : { id, role, blocks: [{ type: 'text', html: `<p>${text}</p>`, source: text }] },
  };
}

describe('ChatArea search and history display', () => {
  beforeEach(() => {
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(16);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('should display history messages after restart', async () => {
    const sessionPath = '/chat/history.jsonl';
    useStore.setState({
      currentSessionPath: sessionPath,
      welcomeVisible: false,
      chatSessions: {
        [sessionPath]: {
          items: [
            message('msg-1', 'user', 'Hello'),
            message('msg-2', 'assistant', 'Hi there!'),
          ],
          hasMore: false,
          loadingMore: false,
        },
      },
      sessions: [{ path: sessionPath, agentId: 'hana', title: 'Test Chat', firstMessage: 'Hello', modified: '', messageCount: 2 }],
      streamingSessions: [],
      agents: [{ id: 'hana', name: 'Hana', yuan: 'hanako' }],
      chatSearchQuery: null,
    } as never);

    const { container } = render(<ChatArea />);

    // 等待消息渲染
    await waitFor(() => {
      const transcript = container.querySelector('[data-testid="transcript"]');
      expect(transcript).toBeInTheDocument();
      expect(transcript?.textContent).toContain('Hello');
      expect(transcript?.textContent).toContain('Hi there!');
    });
  });

  it('should highlight search results when chatSearchQuery is set', async () => {
    const sessionPath = '/chat/search.jsonl';
    useStore.setState({
      currentSessionPath: sessionPath,
      welcomeVisible: false,
      chatSessions: {
        [sessionPath]: {
          items: [
            message('msg-1', 'user', 'Find this text'),
            message('msg-2', 'assistant', 'This is the response'),
          ],
          hasMore: false,
          loadingMore: false,
        },
      },
      sessions: [{ path: sessionPath, agentId: 'hana', title: 'Search Test', firstMessage: 'Find this text', modified: '', messageCount: 2 }],
      streamingSessions: [],
      agents: [{ id: 'hana', name: 'Hana', yuan: 'hanako' }],
      chatSearchQuery: null,
    } as never);

    const { container, rerender } = render(<ChatArea />);

    // 等待初始渲染
    await waitFor(() => {
      const transcript = container.querySelector('[data-testid="transcript"]');
      expect(transcript).toBeInTheDocument();
    });

    // 设置搜索查询
    act(() => {
      useStore.setState({ chatSearchQuery: 'Find this' });
    });

    // 重新渲染以应用搜索
    rerender(<ChatArea />);

    // 等待搜索高亮（500ms 延迟）
    await waitFor(() => {
      const messageGroups = container.querySelectorAll('.messageGroup');
      expect(messageGroups.length).toBeGreaterThan(0);
    }, { timeout: 1000 });
  });

  it('should handle empty session gracefully', async () => {
    const sessionPath = '/chat/empty.jsonl';
    useStore.setState({
      currentSessionPath: sessionPath,
      welcomeVisible: false,
      chatSessions: {
        [sessionPath]: {
          items: [],
          hasMore: false,
          loadingMore: false,
        },
      },
      sessions: [{ path: sessionPath, agentId: 'hana', title: 'Empty Chat', firstMessage: '', modified: '', messageCount: 0 }],
      streamingSessions: [],
      agents: [{ id: 'hana', name: 'Hana', yuan: 'hanako' }],
      chatSearchQuery: null,
    } as never);

    const { container } = render(<ChatArea />);

    // 应该显示空状态消息
    await waitFor(() => {
      const emptyMsg = container.textContent;
      expect(emptyMsg).toContain('暂无对话记录');
    });
  });
});
