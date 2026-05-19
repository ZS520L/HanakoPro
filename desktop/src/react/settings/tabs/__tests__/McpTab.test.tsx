/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiMocks = vi.hoisted(() => ({
  loadMcpState: vi.fn(),
  setMcpEnabled: vi.fn(),
  addMcpConnector: vi.fn(),
  removeMcpConnector: vi.fn(),
  runMcpConnectorAction: vi.fn(),
  setAgentMcpConnector: vi.fn(),
  setAgentMcpTool: vi.fn(),
  startMcpOAuth: vi.fn(),
  pollMcpOAuth: vi.fn(),
  logoutMcpOAuth: vi.fn(),
}));

vi.mock('../../helpers', () => ({
  t: (key: string) => key,
}));

vi.mock('../mcp/mcp-api', () => ({
  EMPTY_MCP_STATE: {
    enabled: false,
    connectors: [],
    agentConfig: { connectors: {} },
  },
  ...apiMocks,
}));

import { McpTab } from '../McpTab';
import { useSettingsStore } from '../../store';

function state(enabled: boolean) {
  return {
    enabled,
    connectors: [],
    agentConfig: { connectors: {} },
  };
}

afterEach(() => {
  cleanup();
  Object.values(apiMocks).forEach(mock => mock.mockReset());
  useSettingsStore.setState({
    currentAgentId: null,
    agents: [],
    toastMessage: '',
    toastType: '',
    toastVisible: false,
  });
});

describe('McpTab', () => {
  it('toggles the global connector switch when the master row text is clicked', async () => {
    apiMocks.loadMcpState
      .mockResolvedValueOnce(state(false))
      .mockResolvedValueOnce(state(true));
    apiMocks.setMcpEnabled.mockResolvedValue(undefined);
    useSettingsStore.setState({
      currentAgentId: 'hanako',
      agents: [{ id: 'hanako', name: 'Hanako', yuan: 'hanako', isPrimary: true }],
    });

    render(<McpTab />);

    await waitFor(() => expect(apiMocks.loadMcpState).toHaveBeenCalledWith('hanako'));
    fireEvent.click(screen.getByText('settings.mcp.masterName'));

    await waitFor(() => expect(apiMocks.setMcpEnabled).toHaveBeenCalledWith(true));
  });

  it('does not send duplicate global toggle requests when the small switch is clicked', async () => {
    apiMocks.loadMcpState
      .mockResolvedValueOnce(state(false))
      .mockResolvedValueOnce(state(true));
    apiMocks.setMcpEnabled.mockResolvedValue(undefined);
    useSettingsStore.setState({
      currentAgentId: 'hanako',
      agents: [{ id: 'hanako', name: 'Hanako', yuan: 'hanako', isPrimary: true }],
    });

    render(<McpTab />);

    await waitFor(() => expect(apiMocks.loadMcpState).toHaveBeenCalledWith('hanako'));
    fireEvent.click(screen.getByRole('switch', { name: 'common.off' }));

    await waitFor(() => expect(apiMocks.setMcpEnabled).toHaveBeenCalledTimes(1));
    expect(apiMocks.setMcpEnabled).toHaveBeenCalledWith(true);
  });
});
