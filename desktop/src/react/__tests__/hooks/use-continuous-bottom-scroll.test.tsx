// @vitest-environment jsdom

import React, { useEffect, useRef } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useContinuousBottomScroll, type ContinuousBottomScrollController } from '../../hooks/use-continuous-bottom-scroll';

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

function Harness({ onController }: { onController: (controller: ContinuousBottomScrollController) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const controller = useContinuousBottomScroll({
    scrollRef,
    contentRef,
    active: true,
    stickyThreshold: 40,
    largeJumpPx: 400,
  });

  useEffect(() => {
    onController(controller);
  }, [controller, onController]);

  return (
    <div data-testid="scroll" ref={scrollRef}>
      <div data-testid="content" ref={contentRef} />
    </div>
  );
}

describe('useContinuousBottomScroll', () => {
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let originalMatchMedia: typeof window.matchMedia | undefined;

  beforeEach(() => {
    originalResizeObserver = window.ResizeObserver;
    originalMatchMedia = window.matchMedia;
    window.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
    MockResizeObserver.instances = [];
    installRaf();
  });

  afterEach(() => {
    cleanup();
    window.ResizeObserver = originalResizeObserver as typeof ResizeObserver;
    window.matchMedia = originalMatchMedia as typeof window.matchMedia;
    vi.restoreAllMocks();
  });

  it('follows new bottom continuously instead of jumping on content growth', () => {
    const metrics = { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 };
    render(<Harness onController={() => {}} />);
    const scrollEl = document.querySelector('[data-testid="scroll"]') as HTMLElement;
    setScrollMetrics(scrollEl, metrics);

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

  it('does not follow content growth after the user scrolls away from bottom', () => {
    const metrics = { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 };
    render(<Harness onController={() => {}} />);
    const scrollEl = document.querySelector('[data-testid="scroll"]') as HTMLElement;
    setScrollMetrics(scrollEl, metrics);

    act(() => {
      metrics.scrollTop = 420;
      fireEvent.scroll(scrollEl);
      metrics.scrollHeight = 1060;
      MockResizeObserver.instances[0].trigger();
      flushRaf(16);
    });

    expect(metrics.scrollTop).toBe(420);
  });

  it('can be explicitly marked sticky again and jump to bottom', () => {
    let controller: ContinuousBottomScrollController | null = null;
    const metrics = { scrollHeight: 1000, clientHeight: 300, scrollTop: 120 };
    render(<Harness onController={(next) => { controller = next; }} />);
    const scrollEl = document.querySelector('[data-testid="scroll"]') as HTMLElement;
    setScrollMetrics(scrollEl, metrics);

    act(() => {
      fireEvent.scroll(scrollEl);
      controller?.scrollToBottom({ mode: 'instant', forceSticky: true });
    });

    expect(metrics.scrollTop).toBe(700);

    act(() => {
      metrics.scrollHeight = 1040;
      MockResizeObserver.instances[0].trigger();
      flushRaf(16);
    });

    expect(metrics.scrollTop).toBeGreaterThan(700);
  });
});
