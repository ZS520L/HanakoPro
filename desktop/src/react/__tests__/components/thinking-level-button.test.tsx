// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { ThinkingLevelButton } from '../../components/input/ThinkingLevelButton';
import { useStore } from '../../stores';

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../hooks/use-config', () => ({
  invalidateConfigCache: vi.fn(),
}));

vi.mock('../../hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

describe('ThinkingLevelButton', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    useStore.setState({
      currentSessionPath: null,
      pendingNewSession: true,
    } as never);
  });

  it('saves thinking changes to the current session when a session is active', async () => {
    vi.mocked(hanaFetch).mockResolvedValueOnce(jsonResponse({ thinkingLevel: 'high' }));
    useStore.setState({
      currentSessionPath: '/session/a.jsonl',
      pendingNewSession: false,
    } as never);
    const onChange = vi.fn();

    const { container } = render(<ThinkingLevelButton level="auto" onChange={onChange} modelXhigh />);
    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: 'high' }));

    await waitFor(() => {
      expect(hanaFetch).toHaveBeenCalledWith('/api/session-thinking-level', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sessionPath: '/session/a.jsonl', level: 'high' }),
      }));
    });
    expect(onChange).toHaveBeenCalledWith('high');
  });

  it('keeps pending new-session thinking changes on the global default path', async () => {
    vi.mocked(hanaFetch).mockResolvedValueOnce(jsonResponse({ ok: true }));
    const onChange = vi.fn();

    const { container } = render(<ThinkingLevelButton level="auto" onChange={onChange} modelXhigh={false} />);
    fireEvent.click(container.querySelector('button') as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: 'high' }));

    await waitFor(() => {
      expect(hanaFetch).toHaveBeenCalledWith('/api/config', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ thinking_level: 'high' }),
      }));
    });
    expect(onChange).toHaveBeenCalledWith('high');
  });
});
