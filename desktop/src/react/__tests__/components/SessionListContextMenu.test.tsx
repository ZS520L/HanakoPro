/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const hanaFetchMock = vi.fn();
const switchSessionMock = vi.fn();
const archiveSessionMock = vi.fn();
const renameSessionMock = vi.fn();
const pinSessionMock = vi.fn();

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetchMock(...args),
  hanaUrl: (p: string) => p,
}));

vi.mock('../../stores/session-actions', () => ({
  switchSession: (...args: unknown[]) => switchSessionMock(...args),
  archiveSession: (...args: unknown[]) => archiveSessionMock(...args),
  renameSession: (...args: unknown[]) => renameSessionMock(...args),
  pinSession: (...args: unknown[]) => pinSessionMock(...args),
}));

vi.mock('../../hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key === 'session.summary.open' ? '摘要' : key,
  }),
}));

import { SessionList } from '../../components/SessionList';
import { useStore } from '../../stores';

function jsonResponse(data: unknown) {
  return {
    json: async () => data,
  };
}

function seedSessions() {
  useStore.setState({
    sessions: [
      {
        path: '/tmp/agents/hana/sessions/with-summary.jsonl',
        title: 'Has summary',
        firstMessage: 'hello',
        modified: '2026-04-29T08:00:00.000Z',
        messageCount: 2,
        agentId: 'hana',
        agentName: 'Hana',
        cwd: '/tmp/project',
        pinnedAt: null,
        hasSummary: true,
      },
      {
        path: '/tmp/agents/hana/sessions/no-summary.jsonl',
        title: 'No summary',
        firstMessage: 'hello',
        modified: '2026-04-29T07:00:00.000Z',
        messageCount: 1,
        agentId: 'hana',
        agentName: 'Hana',
        cwd: '/tmp/project',
        pinnedAt: null,
        hasSummary: false,
      },
    ],
    currentSessionPath: null,
    pendingSessionSwitchPath: null,
    pendingNewSession: false,
    agents: [],
    streamingSessions: [],
    browserBySession: {},
    locale: 'zh',
  });
}

function sessionButton(title: string) {
  const button = screen.getByText(title).closest('button');
  if (!button) throw new Error(`Missing session button: ${title}`);
  return button;
}

describe('SessionList context menu', () => {
  beforeEach(() => {
    globalThis.t = ((key: string) => {
      if (key === 'yuan.types') return {};
      return key;
    }) as typeof globalThis.t;
    hanaFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/browser/session-states') return jsonResponse({});
      if (url === '/api/browser/sessions') return jsonResponse({});
      if (url.startsWith('/api/sessions/summary')) {
        return jsonResponse({
          hasSummary: true,
          summary: '### 重要事实\n- 用户在做记忆系统。\n\n### 事情经过\n- 10:00 用户讨论 session 摘要。',
          createdAt: '2026-04-29T07:00:00.000Z',
          updatedAt: '2026-04-29T08:00:00.000Z',
        });
      }
      return jsonResponse({});
    });
    switchSessionMock.mockReset();
    archiveSessionMock.mockReset();
    renameSessionMock.mockReset();
    pinSessionMock.mockReset();
    seedSessions();
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps summaryless session rows readable and disables only the summary menu item', () => {
    render(<SessionList />);

    expect(sessionButton('No summary').className).not.toContain('sessionItemSummaryEmpty');

    fireEvent.contextMenu(sessionButton('No summary'), { clientX: 24, clientY: 32 });
    const summaryItem = screen.getByText('摘要').closest('.context-menu-item');
    expect(summaryItem).toHaveClass('disabled');

    fireEvent.click(screen.getByText('摘要'));
    expect(screen.queryByTestId('session-summary-card')).not.toBeInTheDocument();
    expect(hanaFetchMock).not.toHaveBeenCalledWith(
      '/api/sessions/summary?path=%2Ftmp%2Fagents%2Fhana%2Fsessions%2Fno-summary.jsonl',
    );
  });

  it('keeps the right-click menu as a shared narrow menu and opens summary as a click-through preview card', async () => {
    render(<SessionList />);

    fireEvent.contextMenu(sessionButton('Has summary'), { clientX: 24, clientY: 32 });

    const menu = document.querySelector('.context-menu');
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveClass('context-menu');
    expect(menu?.className).toBe('context-menu');
    expect(screen.getByText('摘要')).toBeInTheDocument();
    expect(menu?.querySelector('.context-menu-divider')).toBeNull();
    expect(screen.queryByTestId('session-summary-card')).not.toBeInTheDocument();
    expect(hanaFetchMock).not.toHaveBeenCalledWith(
      '/api/sessions/summary?path=%2Ftmp%2Fagents%2Fhana%2Fsessions%2Fwith-summary.jsonl',
    );

    fireEvent.click(screen.getByText('摘要'));

    expect(await screen.findByTestId('session-summary-card')).toHaveAttribute('data-scrollable', 'true');
    expect(await screen.findByText(/用户在做记忆系统/)).toBeInTheDocument();
    expect(hanaFetchMock).toHaveBeenCalledWith(
      '/api/sessions/summary?path=%2Ftmp%2Fagents%2Fhana%2Fsessions%2Fwith-summary.jsonl',
    );
  });

  it('routes context menu actions through the existing session operations', async () => {
    render(<SessionList />);

    fireEvent.contextMenu(sessionButton('Has summary'), { clientX: 24, clientY: 32 });
    fireEvent.click(await screen.findByText('session.pin'));
    expect(pinSessionMock).toHaveBeenCalledWith('/tmp/agents/hana/sessions/with-summary.jsonl', true);

    fireEvent.contextMenu(sessionButton('No summary'), { clientX: 24, clientY: 32 });
    fireEvent.click(await screen.findByText('session.rename'));
    const input = screen.getByDisplayValue('No summary');
    fireEvent.change(input, { target: { value: 'Renamed summaryless session' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameSessionMock).toHaveBeenCalledWith(
      '/tmp/agents/hana/sessions/no-summary.jsonl',
      'Renamed summaryless session',
    );

    fireEvent.contextMenu(sessionButton('Has summary'), { clientX: 24, clientY: 32 });
    fireEvent.click(await screen.findByText('session.archive'));
    expect(archiveSessionMock).toHaveBeenCalledWith('/tmp/agents/hana/sessions/with-summary.jsonl');
  });

  it('closes a sidebar browser badge without switching the session row', async () => {
    const browserStates = {
      '/tmp/agents/hana/sessions/with-summary.jsonl': {
        url: 'https://example.com',
        running: false,
        resumable: true,
        unavailableReason: null,
      },
    };
    let closed = false;
    hanaFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/browser/session-states') return jsonResponse(closed ? {} : browserStates);
      if (url === '/api/browser/close-session') {
        closed = true;
        return jsonResponse({ ok: true, sessions: {} });
      }
      return jsonResponse({});
    });

    render(<SessionList />);

    const closeBadge = await screen.findByRole('button', { name: 'browser.close' });
    fireEvent.click(closeBadge);

    await waitFor(() => {
      expect(hanaFetchMock).toHaveBeenCalledWith('/api/browser/close-session', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ sessionPath: '/tmp/agents/hana/sessions/with-summary.jsonl' }),
      }));
    });
    expect(switchSessionMock).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'browser.close' })).not.toBeInTheDocument();
    });
  });

  it('uses the session meta font size for the summary body', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '../../components/SessionList.module.css'),
      'utf-8',
    );

    expect(css).toMatch(/\.sessionSummaryBody\s*\{[\s\S]*font-size:\s*0\.66rem/);
    expect(css).not.toMatch(/\.sessionContextMenu/);
    expect(css).not.toMatch(/sessionItemSummaryEmpty/);
  });
});
