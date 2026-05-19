/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mocks = vi.hoisted(() => ({
  testConnection: vi.fn(),
  saveProvider: vi.fn(),
}));

vi.mock('../../onboarding-actions', () => ({
  testConnection: (...args: unknown[]) => mocks.testConnection(...args),
  saveProvider: (...args: unknown[]) => mocks.saveProvider(...args),
}));

import { ProviderStep } from '../ProviderStep';

describe('ProviderStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('t', (key: string) => key);
    vi.stubGlobal('i18n', { locale: 'en' });
    mocks.testConnection.mockResolvedValue({ ok: true, text: 'ok' });
    mocks.saveProvider.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses a dropdown with the model settings provider presets and saves the selected provider', async () => {
    const goToStep = vi.fn();
    const onProviderReady = vi.fn();

    render(
      <ProviderStep
        preview={false}
        hanaFetch={vi.fn()}
        goToStep={goToStep}
        showError={vi.fn()}
        onProviderReady={onProviderReady}
      />,
    );

    expect(screen.queryByText('OpenRouter')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.provider.selectPlaceholder' }));

    expect(screen.getByRole('button', { name: 'Kimi Coding Plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OpenRouter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Xiaomi (MiMo)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Kimi Coding Plan' }));
    fireEvent.change(screen.getByPlaceholderText('onboarding.provider.keyPlaceholder'), {
      target: { value: 'sk-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'onboarding.provider.test' }));

    await waitFor(() => {
      expect(mocks.testConnection).toHaveBeenCalledWith(expect.objectContaining({
        providerUrl: 'https://api.kimi.com/coding/',
        providerApi: 'anthropic-messages',
        apiKey: 'sk-test',
      }));
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'onboarding.provider.next' })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole('button', { name: 'onboarding.provider.next' }));

    await waitFor(() => {
      expect(mocks.saveProvider).toHaveBeenCalledWith(expect.objectContaining({
        providerName: 'kimi-coding',
        providerUrl: 'https://api.kimi.com/coding/',
        providerApi: 'anthropic-messages',
        apiKey: 'sk-test',
      }));
    });
    expect(onProviderReady).toHaveBeenCalledWith('kimi-coding', 'https://api.kimi.com/coding/', 'anthropic-messages', 'sk-test');
    expect(goToStep).toHaveBeenCalledWith(3);
  });
});
