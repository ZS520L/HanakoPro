// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';
import type { ChatListItem } from '../../stores/chat-types';

vi.mock('../../components/chat/ChatTranscript', () => ({
  ChatTranscript: ({ items }: { items: ChatListItem[] }) => (
    <div data-testid="transcript">{items.map((item) => item.type === 'message' ? item.data.id : 'c').join(',')}</div>
  ),
}));

vi.mock('../../components/chat/ChatTimelineNavigator', () => ({
  ChatTimelineNavigator: () => null,
}));

import { ChatArea } from '../../components/chat/ChatArea';

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

function setScrollMetrics(
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => metrics.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => metrics.clientHeight });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => metrics.scrollTop,
    set: (value) => { metrics.scrollTop = value; },
  });
}

function message(id: string, role: 'user' | 'assistant'): ChatListItem {
  return {
    type: 'message',
    data: role === 'user'
      ? { id, role, text: id, textHtml: `<p>${id}</p>` }
      : { id, role, blocks: [{ type: 'text', html: `<p>${id}</p>` }] },
  };
}

describe('ChatArea continuous bottom scroll', () => {
  beforeEach(() => {
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(16);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
    useStore.setState({
      currentSessionPath: '/chat/scroll.jsonl',
      welcomeVisible: false,
      chatSessions: {
        '/chat/scroll.jsonl': {
          items: [message('u-1', 'user')],
          hasMore: false,
          loadingMore: false,
        },
      },
      sessions: [{ path: '/chat/scroll.jsonl', agentId: 'hana', title: null, firstMessage: '', modified: '', messageCount: 1 }],
      streamingSessions: ['/chat/scroll.jsonl'],
      agents: [{ id: 'hana', name: 'Hana', yuan: 'hanako' }],
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('does not force sticky when an assistant/tool message is appended after the user scrolled up', async () => {
    const metrics = { scrollHeight: 1000, clientHeight: 300, scrollTop: 500 };
    const { container } = render(<ChatArea />);

    await waitFor(() => {
      expect(container.querySelector('[class*="sessionPanel"]')).toBeTruthy();
    });

    const panel = container.querySelector('[class*="sessionPanel"]') as HTMLElement;
    setScrollMetrics(panel, metrics);

    act(() => {
      metrics.scrollTop = 500;
      fireEvent.scroll(panel);
    });

    act(() => {
      useStore.setState((state) => ({
        chatSessions: {
          ...state.chatSessions,
          '/chat/scroll.jsonl': {
            ...state.chatSessions['/chat/scroll.jsonl'],
            items: [
              ...state.chatSessions['/chat/scroll.jsonl'].items,
              {
                type: 'message',
                data: {
                  id: 'a-tool',
                  role: 'assistant',
                  blocks: [{ type: 'tool_group', tools: [{ name: 'test.tool', done: false, success: false }], collapsed: false }],
                },
              },
            ],
          },
        },
      } as never));
    });

    expect(metrics.scrollTop).toBe(500);
  });
});
