// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';

vi.mock('../../components/chat/ChatTranscript', () => ({
  ChatTranscript: ({ items }: { items: any[] }) => (
    <div data-testid="bridge-items">{JSON.stringify(items)}</div>
  ),
}));

import { BridgeChatTranscript } from '../../components/BridgePanel';

type ResizeCallback = ResizeObserverCallback;

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  private readonly callback: ResizeCallback;

  constructor(callback: ResizeCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe() {}
  disconnect() {}

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

let rafCallbacks: FrameRequestCallback[] = [];

function installRaf() {
  rafCallbacks = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
    rafCallbacks[id - 1] = () => {};
  });
}

function flushRaf(frameTime = 16) {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  callbacks.forEach((cb) => cb(frameTime));
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

describe('BridgeChatTranscript continuous bottom scroll', () => {
  beforeEach(() => {
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
    MockResizeObserver.instances = [];
    installRaf();
    useStore.setState({
      chatSessions: {
        '/bridge/session.jsonl': {
          items: [
            { type: 'message', data: { id: 'u-1', role: 'user', text: 'hi', textHtml: '<p>hi</p>' } },
          ],
          hasMore: false,
          loadingMore: false,
        },
      },
      streamingSessions: ['/bridge/session.jsonl'],
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('uses continuous follow when a streaming bridge session grows at bottom', () => {
    const metrics = { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 };
    const { container } = render(
      <BridgeChatTranscript
        sessionPath="/bridge/session.jsonl"
        agentId="hana"
        contactName="微信联系人"
        contactAvatarUrl={null}
        emptyLabel="empty"
      />,
    );
    const scroller = container.querySelector('#bridgeChatMessages') as HTMLElement;
    setScrollMetrics(scroller, metrics);

    act(() => {
      metrics.scrollHeight = 1060;
      MockResizeObserver.instances[0].trigger();
    });

    expect(metrics.scrollTop).toBe(700);

    act(() => {
      flushRaf(16);
    });

    expect(metrics.scrollTop).toBeGreaterThan(700);
    expect(metrics.scrollTop).toBeLessThan(760);
  });
});
