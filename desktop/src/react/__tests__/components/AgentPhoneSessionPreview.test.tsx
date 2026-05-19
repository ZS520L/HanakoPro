// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';

let streamSubscriber: ((event: any) => void) | null = null;

vi.mock('../../components/chat/ChatTranscript', () => ({
  ChatTranscript: ({ items }: { items: any[] }) => (
    <pre data-testid="phone-items">{JSON.stringify(items)}</pre>
  ),
}));

vi.mock('../../stores/session-actions', () => ({
  loadMessages: vi.fn(async () => {}),
}));

vi.mock('../../services/stream-key-dispatcher', () => ({
  subscribeStreamKey: vi.fn((_key: string, cb: (event: any) => void) => {
    streamSubscriber = cb;
    return () => { streamSubscriber = null; };
  }),
}));

import { AgentPhoneSessionPreview } from '../../components/ChannelsPanel';

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

describe('AgentPhoneSessionPreview', () => {
  beforeEach(() => {
    streamSubscriber = null;
    window.t = ((key: string) => key) as typeof window.t;
    window.ResizeObserver = class {
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      cb(16);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
    useStore.setState({
      locale: 'zh',
      chatSessions: {},
      streamingSessions: [],
      selectedMessageIdsBySession: {},
      agents: [
        { id: 'butter-agent', name: 'butter', yuan: 'butter', hasAvatar: false },
      ],
      agentName: 'Hanako',
      agentYuan: 'hanako',
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('uses the agent yuan as the mood block owner instead of the agent id', () => {
    render(
      <AgentPhoneSessionPreview
        sessionPath="/tmp/butter-phone.jsonl"
        agentId="butter-agent"
        agentYuan="butter"
      />,
    );

    act(() => {
      streamSubscriber?.({ type: 'mood_start' });
      streamSubscriber?.({ type: 'mood_text', delta: 'PULSE text' });
    });

    const items = JSON.parse(screen.getByTestId('phone-items').textContent || '[]');
    const mood = items[0].data.blocks.find((block: any) => block.type === 'mood');
    expect(mood).toMatchObject({
      yuan: 'butter',
      text: 'PULSE text',
    });
  });

  it('does not force bottom after the user scrolls up during a phone stream', () => {
    const { container } = render(
      <AgentPhoneSessionPreview
        sessionPath="/tmp/butter-phone.jsonl"
        agentId="butter-agent"
        agentYuan="butter"
      />,
    );
    const scroller = container.querySelector('[class*="agentActivityTranscriptScroll"]') as HTMLElement;
    const metrics = { scrollHeight: 1000, clientHeight: 300, scrollTop: 180 };
    setScrollMetrics(scroller, metrics);

    act(() => {
      fireEvent.scroll(scroller);
      streamSubscriber?.({ type: 'text_delta', delta: '工具前的文字' });
    });

    expect(metrics.scrollTop).toBe(180);
  });
});
