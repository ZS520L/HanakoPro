/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState: Record<string, any> = {};

vi.mock('../../settings/store', () => ({
  useSettingsStore: Object.assign((selector?: (state: Record<string, any>) => unknown) => (
    selector ? selector(mockState) : mockState
  ), {
    setState: vi.fn((patch: Record<string, unknown>) => Object.assign(mockState, patch)),
  }),
}));

vi.mock('../../settings/api', () => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../settings/actions', () => ({
  switchToAgent: vi.fn(),
  loadSettingsConfig: vi.fn(),
  loadAgents: vi.fn(),
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string, params?: Record<string, string>) => (
    params?.name ? `${key}:${params.name}` : key
  ),
}));

describe('AgentDeleteOverlay', () => {
  beforeEach(() => {
    Object.keys(mockState).forEach(key => delete mockState[key]);
    Object.assign(mockState, {
      agents: [
        { id: 'hana', name: '小花', yuan: 'hanako', isPrimary: true },
        { id: 'deepseek', name: 'DeepSeek', yuan: 'deepseek', isPrimary: false },
      ],
      currentAgentId: 'hana',
      settingsAgentId: 'hana',
      showToast: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('uses the explicit event target instead of the selected settings agent', async () => {
    const { AgentDeleteOverlay } = await import('../../settings/overlays/AgentDeleteOverlay');
    render(<AgentDeleteOverlay />);

    act(() => {
      window.dispatchEvent(new CustomEvent('hana-show-agent-delete', {
        detail: { agentId: 'deepseek' },
      }));
    });

    expect(screen.getByRole('heading', { name: 'settings.agent.deleteTitle1:DeepSeek' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'settings.agent.deleteTitle1:小花' })).not.toBeInTheDocument();
  });
});
