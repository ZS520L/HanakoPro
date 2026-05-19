// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTypewriterText } from '../../hooks/use-typewriter-text';

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

function flushRaf(frameTime: number) {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  callbacks.forEach((cb) => cb(frameTime));
}

function Harness({
  target,
  active = true,
  displayFps = 30,
}: {
  target: string;
  active?: boolean;
  displayFps?: number;
}) {
  const visible = useTypewriterText(target, { active, displayFps });
  return <div data-testid="visible">{visible}</div>;
}

describe('useTypewriterText', () => {
  beforeEach(() => {
    installRaf();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('throttles display advances by display fps instead of monitor refresh rate', () => {
    const { getByTestId, rerender } = render(<Harness target="你好" />);
    expect(getByTestId('visible').textContent).toBe('你好');

    rerender(<Harness target="你好世界abc" />);

    act(() => {
      flushRaf(0);
    });
    const afterFirstAdvance = getByTestId('visible').textContent || '';
    expect(afterFirstAdvance.length).toBeGreaterThan('你好'.length);
    expect(afterFirstAdvance.length).toBeLessThan('你好世界abc'.length);

    act(() => {
      for (const frame of [4, 8, 12, 16, 20, 24, 28]) flushRaf(frame);
    });

    expect(getByTestId('visible').textContent).toBe(afterFirstAdvance);
  });

  it('uses a larger batch when backlog is large so display speed can catch up', () => {
    const { getByTestId, rerender } = render(<Harness target="开头" />);
    const largeDelta = '一'.repeat(96);

    rerender(<Harness target={`开头${largeDelta}`} />);

    act(() => {
      flushRaf(0);
    });

    const advanced = (getByTestId('visible').textContent || '').length - '开头'.length;
    expect(advanced).toBeGreaterThan(1);
  });

  it('advances by grapheme clusters and does not split emoji sequences', () => {
    const family = '👨‍👩‍👧‍👦';
    const { getByTestId, rerender } = render(<Harness target="A" />);

    rerender(<Harness target={`A${family}B`} />);

    act(() => {
      flushRaf(0);
    });

    expect(getByTestId('visible').textContent).toBe(`A${family}`);
  });

  it('shows the full target when reduced motion is requested', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
    const { getByTestId, rerender } = render(<Harness target="旧正文" />);

    rerender(<Harness target="旧正文新正文" />);

    expect(getByTestId('visible').textContent).toBe('旧正文新正文');
  });
});
