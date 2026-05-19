// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { ModelSelector } from '../../components/input/ModelSelector';

const addToast = vi.fn();

const storeState = {
  currentSessionPath: null as string | null,
  pendingNewSession: true,
  chatSessions: {} as Record<string, unknown>,
  sessionModelsByPath: {} as Record<string, unknown>,
  setModelSwitching: vi.fn(),
  updateSessionModel: vi.fn(),
  addToast,
};

vi.mock('../../stores', () => ({
  useStore: {
    getState: () => storeState,
    setState: vi.fn(),
  },
}));

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const models = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek' },
  { id: 'mimo-v2-omni', name: 'MiMo V2 Omni', provider: 'mimo' },
];

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response;
}

describe('ModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.currentSessionPath = null;
    storeState.pendingNewSession = true;
    storeState.chatSessions = {};
    storeState.sessionModelsByPath = {};
  });

  afterEach(() => {
    cleanup();
  });

  it('shows an explicit unselected state when models exist but none is current', () => {
    render(<ModelSelector models={models} />);

    expect(screen.getByRole('button', { name: /model.notSelected/ })).toBeTruthy();
  });

  it('does not open the model menu while the session is streaming', () => {
    render(<ModelSelector models={[{ ...models[0], isCurrent: true }]} isStreaming />);

    fireEvent.click(screen.getByRole('button', { name: /DeepSeek V4 Flash/ }));

    expect(addToast).toHaveBeenCalledWith('model.switchWhileStreaming', 'warning', 4000, {
      dedupeKey: 'model-switch-streaming',
    });
    expect(screen.queryByText('mimo')).toBeNull();
    expect(hanaFetch).not.toHaveBeenCalled();
  });

  it('marks the session model unavailable when its provider/id is no longer in the model list', () => {
    render(
      <ModelSelector
        models={models}
        sessionModel={{
          id: 'removed-model',
          name: 'Removed Model',
          provider: 'deepseek',
        }}
      />,
    );

    expect(screen.getByRole('button', { name: /model.unavailable/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Removed Model/ })).toBeNull();
  });

  it('maps a server streaming-switch rejection to the same explicit warning', async () => {
    storeState.currentSessionPath = '/sessions/a.jsonl';
    storeState.pendingNewSession = false;
    storeState.chatSessions = {
      '/sessions/a.jsonl': { items: [{ type: 'message' }] },
    };
    storeState.sessionModelsByPath = {
      '/sessions/a.jsonl': {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        provider: 'deepseek',
      },
    };
    vi.mocked(hanaFetch).mockResolvedValueOnce(jsonResponse({
      error: 'cannot switch model while streaming',
    }, false));

    render(<ModelSelector models={models} sessionModel={storeState.sessionModelsByPath['/sessions/a.jsonl'] as any} />);
    fireEvent.click(screen.getByRole('button', { name: /DeepSeek V4 Flash/ }));
    fireEvent.click(screen.getByRole('button', { name: /MiMo V2 Omni/ }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('model.switchWhileStreaming', 'warning', 4000, {
        dedupeKey: 'model-switch-streaming',
      });
    });
  });
});
