/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const hanaFetchMock = vi.fn();

vi.mock('../../api', () => ({
  hanaFetch: (...args: unknown[]) => hanaFetchMock(...args),
}));

vi.mock('../../helpers', () => ({
  t: (key: string) => {
    if (key === 'settings.computerUse.experimentalWarning') {
      return 'Computer use 功能属于测试阶段，而且对模型性能要求较高，请在知晓所有风险后开启，目前已验证某些软件下不按预期工作，建议只是尝鲜。';
    }
    return key;
  },
}));

vi.mock('../../widgets/Toggle', () => ({
  Toggle: ({ on }: { on: boolean }) => (
    <button type="button" data-testid={`computer-toggle-${on ? 'on' : 'off'}`}>
      toggle
    </button>
  ),
}));

import { ComputerUseTab } from '../ComputerUseTab';
import { useSettingsStore } from '../../store';

afterEach(() => {
  cleanup();
  hanaFetchMock.mockReset();
  useSettingsStore.setState({ toastMessage: '', toastType: '', toastVisible: false });
});

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('ComputerUseTab', () => {
  it('renders the experimental risk warning near the top of the Computer Use page', async () => {
    hanaFetchMock.mockResolvedValue(jsonResponse({
      selectedProviderId: 'macos:cua',
      settings: { enabled: false, app_approvals: [] },
      status: {
        providers: [{ providerId: 'macos:cua', status: { available: true, permissions: [] } }],
        activeLease: null,
      },
    }));

    render(<ComputerUseTab />);

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/computer-use'));
    const warning = screen.getByTestId('computer-use-experimental-warning');

    expect(warning.textContent || '').toContain('Computer use 功能属于测试阶段');
    expect(warning.textContent || '').toContain('建议只是尝鲜');
  });

  it('shows a toast when requesting permissions fails', async () => {
    hanaFetchMock
      .mockResolvedValueOnce(jsonResponse({
        selectedProviderId: 'macos:cua',
        settings: { enabled: false, app_approvals: [] },
        status: {
          providers: [{ providerId: 'macos:cua', status: { available: false, reason: 'binary-not-found', permissions: [] } }],
          activeLease: null,
        },
      }))
      .mockRejectedValueOnce(new Error('hanaFetch /api/preferences/computer-use/request-permissions: 400 Bad Request'));

    render(<ComputerUseTab />);

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalledWith('/api/preferences/computer-use'));
    fireEvent.click(screen.getByText('settings.computerUse.requestPermissions'));

    await waitFor(() => {
      expect(useSettingsStore.getState().toastType).toBe('error');
      expect(useSettingsStore.getState().toastMessage).toContain('400 Bad Request');
    });
  });
});
