/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockState = Record<string, any>;

const mockState: MockState = {};
const mockHanaFetch = vi.fn();

vi.mock('../../settings/store', () => {
  const hook: any = (selector?: (s: MockState) => unknown) =>
    selector ? selector(mockState) : mockState;
  hook.getState = () => mockState;
  hook.setState = (partial: Partial<MockState>) => Object.assign(mockState, partial);
  return { useSettingsStore: hook };
});

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => mockHanaFetch(...args),
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => key,
  autoSaveConfig: vi.fn(async () => {}),
}));

vi.mock('../../settings/tabs/bridge/AgentSelect', () => ({
  AgentSelect: ({ value }: { value: string | null }) => (
    <div data-testid="agent-select">{value}</div>
  ),
}));

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

describe('WorkTab workspace persistence', () => {
  beforeEach(() => {
    Object.keys(mockState).forEach(key => delete mockState[key]);
    Object.assign(mockState, {
      settingsConfig: { desk: {} },
      currentAgentId: 'agent-a',
      showToast: vi.fn(),
    });
    mockHanaFetch.mockReset();
    mockHanaFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/agents/agent-a/config' && !options?.method) {
        return Promise.resolve(jsonResponse({
          desk: {
            home_folder: '/old-home',
            heartbeat_enabled: true,
            heartbeat_interval: 17,
          },
        }));
      }
      if (url === '/api/agents/agent-a/config' && options?.method === 'PUT') {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      throw new Error(`unexpected request: ${url}`);
    });
    window.platform = {
      selectFolder: vi.fn(async () => '/new-home'),
      settingsChanged: vi.fn(),
    } as unknown as typeof window.platform;
  });

  afterEach(() => {
    cleanup();
  });

  it('saves the selected agent workspace without sending frontend business IPC', async () => {
    const { WorkTab } = await import('../../settings/tabs/WorkTab');

    render(<WorkTab />);

    fireEvent.click(await screen.findByDisplayValue('/old-home'));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/agents/agent-a/config', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ desk: { home_folder: '/new-home' } }),
      }));
    });
    expect(window.platform.settingsChanged).not.toHaveBeenCalled();
  });

  it('clears the selected agent workspace without sending frontend business IPC', async () => {
    const { WorkTab } = await import('../../settings/tabs/WorkTab');

    render(<WorkTab />);

    fireEvent.click(await screen.findByTitle('settings.work.homeFolderClear'));

    await waitFor(() => {
      expect(mockHanaFetch).toHaveBeenCalledWith('/api/agents/agent-a/config', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ desk: { home_folder: '' } }),
      }));
    });
    expect(window.platform.settingsChanged).not.toHaveBeenCalled();
  });

  it('shows 31 minutes when the agent config omits the patrol interval', async () => {
    mockHanaFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/agents/agent-a/config' && !options?.method) {
        return Promise.resolve(jsonResponse({
          desk: {
            home_folder: '/old-home',
            heartbeat_enabled: false,
          },
        }));
      }
      if (url === '/api/agents/agent-a/config' && options?.method === 'PUT') {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const { WorkTab } = await import('../../settings/tabs/WorkTab');

    render(<WorkTab />);

    expect(await screen.findByDisplayValue('31')).toBeTruthy();
  });
});
