/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentCardStack, calculateAgentCardGeometry } from '../../settings/tabs/agent/AgentCardStack';

vi.mock('../../settings/store', () => ({
  useSettingsStore: Object.assign(vi.fn(), { setState: vi.fn() }),
}));

vi.mock('../../settings/api', () => ({
  hanaFetch: vi.fn(),
  hanaUrl: (path: string) => path,
  yuanFallbackAvatar: (yuan?: string) => `fallback:${yuan || 'hanako'}`,
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => key,
}));

vi.mock('../../settings/actions', () => ({
  loadAgents: vi.fn(),
}));

const agents = [
  { id: 'hana', name: '小花', yuan: 'hanako', isPrimary: true, hasAvatar: false },
  { id: 'deepseek', name: 'DeepSeek', yuan: 'deepseek', isPrimary: false, hasAvatar: false },
  { id: 'maomao', name: '毛毛', yuan: 'maomao', isPrimary: false, hasAvatar: false },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AgentCardStack geometry', () => {
  it('centers a one-agent stack when it expands', () => {
    const geometry = calculateAgentCardGeometry(2);

    expect(geometry.spreadWidth).toBe(260);
    expect(geometry.positions).toEqual([63, 135]);
    expect(geometry.positions[0] + geometry.groupWidth / 2).toBe(130);
  });

  it('centers a two-agent stack when it expands', () => {
    const geometry = calculateAgentCardGeometry(3);

    expect(geometry.spreadWidth).toBe(260);
    expect(geometry.positions).toEqual([27, 99, 171]);
    expect(geometry.positions[0] + geometry.groupWidth / 2).toBe(130);
  });

  it('uses the natural group width once the expanded stack is wider than compact width', () => {
    const geometry = calculateAgentCardGeometry(5);

    expect(geometry.spreadWidth).toBe(386);
    expect(geometry.positions).toEqual([18, 90, 162, 234, 306]);
  });

  it('adds edge bleed before the expanded cards touch the scroll boundary', () => {
    const geometry = calculateAgentCardGeometry(4);

    expect(geometry.spreadWidth).toBe(314);
    expect(geometry.positions).toEqual([18, 90, 162, 234]);
  });
});

describe('AgentCardStack actions', () => {
  it('shows quiet actions below the selected non-primary agent and calls explicit targets', () => {
    const onSetActive = vi.fn();
    const onDelete = vi.fn();
    const onExport = vi.fn();

    render(React.createElement(AgentCardStack, {
      agents,
      selectedId: 'deepseek',
      currentAgentId: 'hana',
      onSelect: vi.fn(),
      onAvatarClick: vi.fn(),
      onSetActive,
      onDelete,
      onExport,
      onAdd: vi.fn(),
    }));

    fireEvent.click(screen.getByRole('button', { name: 'settings.agent.setActive' }));
    fireEvent.click(screen.getByRole('button', { name: '导出助手' }));
    fireEvent.click(screen.getByRole('button', { name: 'settings.agent.deleteBtn' }));

    expect(onSetActive).toHaveBeenCalledWith('deepseek');
    expect(onExport).toHaveBeenCalledWith('deepseek');
    expect(onDelete).toHaveBeenCalledWith('deepseek');
  });

  it('does not show set-primary or delete actions for the primary agent', () => {
    render(React.createElement(AgentCardStack, {
      agents,
      selectedId: 'hana',
      currentAgentId: 'hana',
      onSelect: vi.fn(),
      onAvatarClick: vi.fn(),
      onSetActive: vi.fn(),
      onDelete: vi.fn(),
      onExport: vi.fn(),
      onAdd: vi.fn(),
    }));

    expect(screen.queryByRole('button', { name: 'settings.agent.setActive' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出助手' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.agent.deleteBtn' })).not.toBeInTheDocument();
  });

  it('does not open agent actions from right click', () => {
    render(React.createElement(AgentCardStack, {
      agents,
      selectedId: 'hana',
      currentAgentId: 'hana',
      onSelect: vi.fn(),
      onAvatarClick: vi.fn(),
      onSetActive: vi.fn(),
      onDelete: vi.fn(),
      onExport: vi.fn(),
      onAdd: vi.fn(),
    }));

    const deepseekCard = screen.getByText('DeepSeek').closest('[data-agent-id="deepseek"]');
    expect(deepseekCard).not.toBeNull();
    fireEvent.contextMenu(deepseekCard as HTMLElement);

    expect(screen.queryByRole('button', { name: 'settings.agent.setActive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'settings.agent.deleteBtn' })).not.toBeInTheDocument();
  });
});
