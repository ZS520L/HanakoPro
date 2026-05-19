/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../settings/store';

type MockResponse = { json: () => Promise<any> };

const hanaFetchMock = vi.fn(async (_url: string, _opts?: RequestInit): Promise<MockResponse> => ({
  json: async () => ({ models: [] }),
}));
const showInFinderMock = vi.fn();

vi.mock('../../settings/api', () => ({
  hanaFetch: (url: string, opts?: RequestInit) => hanaFetchMock(url, opts),
  hanaUrl: (path: string) => path,
  yuanFallbackAvatar: (yuan: string) => `/fallback-${yuan}.png`,
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => key,
  autoSaveConfig: vi.fn(async () => true),
}));

vi.mock('../../settings/actions', () => ({
  browseAgent: vi.fn(),
  switchToAgent: vi.fn(),
  loadSettingsConfig: vi.fn(async () => {}),
  loadAgents: vi.fn(async () => {}),
}));

vi.mock('@/ui', () => ({
  SelectWidget: ({ value }: { value?: string }) => (
    <div data-testid="model-select">{value || ''}</div>
  ),
}));

vi.mock('../../settings/tabs/agent/AgentCardStack', () => ({
  AgentCardStack: ({
    selectedId,
    onExport,
  }: {
    selectedId: string | null;
    onExport?: (id: string) => void;
  }) => (
    <div>
      <div data-testid="selected-agent">{selectedId || ''}</div>
      {selectedId && onExport ? (
        <button data-testid="export-agent" onClick={() => onExport(selectedId)}>
          export
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('../../settings/tabs/agent/YuanSelector', () => ({
  YuanSelector: () => <div data-testid="yuan-selector" />,
}));

vi.mock('../../settings/tabs/agent/AgentMemory', () => ({
  MemorySection: ({ isViewingOther }: { isViewingOther: boolean }) => (
    <div data-testid="is-viewing-other">{String(isViewingOther)}</div>
  ),
}));

vi.mock('../../settings/tabs/agent/AgentToolsSection', () => ({
  AgentToolsSection: () => <div data-testid="agent-tools" />,
}));

vi.mock('../../settings/tabs/agent/AgentExperience', () => ({
  parseExperience: () => [],
  ExperienceBlock: () => null,
  putExperience: vi.fn(),
}));

describe('AgentTab settings agent selection', () => {
  beforeEach(() => {
    hanaFetchMock.mockImplementation(async (_url: string, _opts?: RequestInit): Promise<MockResponse> => ({
      json: async () => ({ models: [] }),
    }));
    showInFinderMock.mockReset();
    (window as unknown as { platform: unknown }).platform = { showInFinder: showInFinderMock };
    useSettingsStore.setState({
      agents: [
        { id: 'hana', name: 'Hana', yuan: 'hanako', isPrimary: true },
        { id: 'deepseek', name: 'DeepSeek', yuan: 'deepseek', isPrimary: false },
      ],
      currentAgentId: 'hana',
      settingsAgentId: null,
      settingsConfig: {
        agent: { name: 'Hana', yuan: 'hanako' },
        memory: { enabled: true },
      },
      currentPins: [],
      globalModelsConfig: {
        models: { utility: { id: 'u' }, utility_large: { id: 'ul' } },
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as unknown as { platform?: unknown }).platform;
  });

  it('rerenders when browsing a different settings agent', async () => {
    const { AgentTab } = await import('../../settings/tabs/AgentTab');
    render(<AgentTab />);

    expect(screen.getByTestId('selected-agent')).toHaveTextContent('hana');
    expect(screen.getByTestId('is-viewing-other')).toHaveTextContent('false');

    act(() => {
      useSettingsStore.setState({ settingsAgentId: 'deepseek' });
    });

    expect(screen.getByTestId('selected-agent')).toHaveTextContent('deepseek');
    expect(screen.getByTestId('is-viewing-other')).toHaveTextContent('true');
  });

  it('confirms character-card export from the live preview overlay', async () => {
    hanaFetchMock.mockImplementation(async (url: string, opts?: RequestInit): Promise<MockResponse> => {
      if (url === '/api/models') return { json: async () => ({ models: [] }) };
      if (url === '/api/character-cards/export/preview') {
        return {
          json: async () => ({
            ok: true,
            plan: {
              mode: 'export',
              agentId: 'hana',
              packageName: 'hana-charactercard.zip',
              agent: { name: 'Hana', yuan: 'hanako', description: '花名册描述' },
              prompts: { identity: 'identity', ishiki: 'ishiki', publicIshiki: 'public' },
              memory: {
                available: true,
                count: 1,
                preview: '重要事实前二十字',
                compiled: { facts: '重要事实前二十字', today: '', week: '', longterm: '' },
              },
              skills: { count: 0, bundles: [] },
              assets: {},
            },
          }),
        };
      }
      if (url === '/api/character-cards/export') {
        return {
          json: async () => ({
            ok: true,
            filePath: '/tmp/hana-charactercard.zip',
            fileName: 'hana-charactercard.zip',
          }),
        };
      }
      return { json: async () => ({ ok: true }) };
    });

    const { AgentTab } = await import('../../settings/tabs/AgentTab');
    render(<AgentTab />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('export-agent'));
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(await screen.findByText('确定'));
      await Promise.resolve();
    });

    const exportCall = hanaFetchMock.mock.calls.find((call) => {
      const [url, opts] = call as [string, RequestInit | undefined];
      return url === '/api/character-cards/export' && opts?.method === 'POST';
    }) as [string, RequestInit | undefined] | undefined;
    expect(JSON.parse(String(exportCall?.[1]?.body))).toEqual({
      agentId: 'hana',
      exportMemory: false,
    });
    expect(showInFinderMock).toHaveBeenCalledWith('/tmp/hana-charactercard.zip');
  });
});
