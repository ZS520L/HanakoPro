// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextCompressButton, ContextRing } from '../../components/input/ContextRing';
import { useStore } from '../../stores';

const mocks = vi.hoisted(() => ({
  compressForkSession: vi.fn(async () => true),
}));

vi.mock('../../stores/session-actions', () => ({
  compressForkSession: mocks.compressForkSession,
}));

describe('ContextRing', () => {
  beforeEach(() => {
    mocks.compressForkSession.mockClear();
    window.t = ((key: string, params?: Record<string, unknown>) => {
      if (key === 'input.contextWindow') return `上下文 ${params?.windowK}k`;
      if (key === 'input.tokensUsed') return `已用 ${params?.tokensK}k (${params?.pct}%)`;
      if (key === 'settings.context.compressFork') return '压缩上下文';
      if (key === 'settings.context.compressing') return '正在压缩…';
      return key;
    }) as typeof window.t;
    useStore.setState({
      agentYuan: 'hanako',
      currentSessionPath: '/session/a.jsonl',
      contextTokens: null,
      contextWindow: null,
      contextPercent: null,
      contextBySession: {},
      compactingSessions: ['/session/a.jsonl'],
      compressForkingSessions: [],
    } as never);
  });

  afterEach(() => {
    cleanup();
    useStore.setState({
      currentSessionPath: null,
      contextTokens: null,
      contextWindow: null,
      contextPercent: null,
      contextBySession: {},
      compactingSessions: [],
      compressForkingSessions: [],
    } as never);
  });

  it('stays visible while the current session is compacting before usage arrives', async () => {
    const { container } = render(<ContextRing />);

    await waitFor(() => {
      const button = container.querySelector('button');
      expect(button).toBeTruthy();
      expect((button as HTMLButtonElement).disabled).toBe(true);
    });
  });

  it('is visible for an active session but hides the token label below 100k', async () => {
    useStore.setState({
      contextBySession: {
        '/session/a.jsonl': { tokens: 12_345, window: 200_000, percent: 6 },
      },
      compactingSessions: [],
    } as never);

    const { container, queryByText } = render(<ContextRing />);

    await waitFor(() => {
      expect(container.querySelector('button')).toBeTruthy();
    });
    expect(queryByText('12k')).toBeNull();
  });

  it('shows the token label from 100k', async () => {
    useStore.setState({
      contextBySession: {
        '/session/a.jsonl': { tokens: 100_000, window: 200_000, percent: 50 },
      },
      compactingSessions: [],
    } as never);

    const { getByText } = render(<ContextRing />);

    await waitFor(() => {
      expect(getByText('100k')).toBeTruthy();
    });
  });

  it('shows sub-1k usage without rounding it down to 0k', async () => {
    useStore.setState({
      contextBySession: {
        '/session/a.jsonl': { tokens: 320, window: 32_768, percent: 0.98 },
      },
      compactingSessions: [],
    } as never);

    const { container, getByText } = render(<ContextRing />);

    await waitFor(() => {
      expect(container.querySelector('button')).toBeTruthy();
    });
    fireEvent.mouseEnter(container.querySelector('span') as HTMLElement);
    expect(getByText('已用 <1k (<1%)')).toBeTruthy();
  });

  it('does not start compress-fork when clicking the ring', async () => {
    useStore.setState({
      contextBySession: {
        '/session/a.jsonl': {
          tokens: 6_000,
          window: 8_000,
          percent: 75,
          compressionAvailable: true,
        },
      },
      compactingSessions: [],
    } as never);

    const { container } = render(<ContextRing />);
    await waitFor(() => {
      expect(container.querySelector('button')).toBeTruthy();
    });

    fireEvent.click(container.querySelector('button') as HTMLButtonElement);

    expect(mocks.compressForkSession).not.toHaveBeenCalled();
  });

  it('starts compress-fork from the standalone compress button', async () => {
    useStore.setState({
      contextBySession: {
        '/session/a.jsonl': {
          tokens: 6_000,
          window: 8_000,
          percent: 75,
          compressionAvailable: true,
        },
      },
      compactingSessions: [],
    } as never);

    const { getByRole } = render(<ContextCompressButton />);
    fireEvent.click(getByRole('button'));

    await waitFor(() => {
      expect(mocks.compressForkSession).toHaveBeenCalledWith('/session/a.jsonl');
    });
  });
});
