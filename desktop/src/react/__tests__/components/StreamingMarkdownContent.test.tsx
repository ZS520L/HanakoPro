// @vitest-environment jsdom

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StreamingMarkdownContent,
  isTypewriterEligibleMarkdownSource,
} from '../../components/chat/StreamingMarkdownContent';

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

describe('StreamingMarkdownContent', () => {
  beforeEach(() => {
    installRaf();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders streaming prose progressively and marks only the visible tail for fade', () => {
    const { container, rerender } = render(
      <StreamingMarkdownContent source="旧正文" html="<p>旧正文</p>" active />,
    );

    rerender(
      <StreamingMarkdownContent source="旧正文新正文继续出现" html="<p>旧正文新正文继续出现</p>" active />,
    );

    act(() => {
      flushRaf(0);
    });

    const text = container.textContent || '';
    expect(text.length).toBeGreaterThan('旧正文'.length);
    expect(text.length).toBeLessThan('旧正文新正文继续出现'.length);
    expect(container.querySelectorAll('[data-stream-tail-char="true"]').length).toBe(1);
  });

  it('does not replay the tail fade when the stream target advances before visible text does', () => {
    const source = '这是一段足够长的普通正文';
    const { container, rerender } = render(
      <StreamingMarkdownContent source={source} html={`<p>${source}</p>`} active />,
    );

    expect(container.querySelectorAll('[data-stream-tail-char="true"]').length).toBe(6);

    rerender(
      <StreamingMarkdownContent source={`${source}追加`} html={`<p>${source}追加</p>`} active />,
    );

    expect(container.textContent?.trim()).toBe(source);
    expect(container.querySelector('[data-stream-tail-char="true"]')).toBeNull();
  });

  it('marks six visible tail graphemes for fade when prose is long enough', () => {
    const { container } = render(
      <StreamingMarkdownContent source="这是一段足够长的普通正文" html="<p>这是一段足够长的普通正文</p>" active />,
    );

    expect(container.querySelectorAll('[data-stream-tail-char="true"]').length).toBe(6);
  });

  it('does not typewriter complex markdown blocks', () => {
    const source = '```ts\nconst x = 1;\n```';
    const html = '<pre><code>const x = 1;</code></pre>';

    const { container } = render(
      <StreamingMarkdownContent source={source} html={html} active />,
    );

    expect(container.textContent).toContain('const x = 1;');
    expect(container.querySelector('[data-stream-tail-char="true"]')).toBeNull();
  });

  it('does not typewriter backtick-sensitive inline markdown while streaming', () => {
    const source = '这里有 `inline code`，后续文字也要稳定显示。';
    const html = '<p>这里有 <code>inline code</code>，后续文字也要稳定显示。</p>';

    expect(isTypewriterEligibleMarkdownSource(source)).toBe(false);

    const { container } = render(
      <StreamingMarkdownContent source={source} html={html} active />,
    );

    expect(container.textContent).toContain('后续文字也要稳定显示。');
    expect(container.querySelector('[data-stream-tail-char="true"]')).toBeNull();
  });

  it('keeps tail fade characters on the text baseline without transform offsets', () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), 'desktop/src/react/components/chat/Chat.module.css'),
      'utf8',
    );
    const fadeBlock = css.match(/\.streamTailChar\s*\{(?<body>[^}]*)\}/)?.groups?.body || '';
    const fadeKeyframes = css.slice(
      css.indexOf('@keyframes stream-tail-fade'),
      css.indexOf('@media (prefers-reduced-motion: reduce)'),
    );

    expect(css).toContain('stream-tail-fade');
    expect(fadeBlock).not.toMatch(/inline-block/);
    expect(fadeKeyframes).not.toMatch(/translateY/);
  });
});
