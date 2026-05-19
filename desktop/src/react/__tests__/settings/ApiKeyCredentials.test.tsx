/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ProviderSummary } from '../../settings/store';

const mocks = vi.hoisted(() => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => mocks.hanaFetch(...args),
}));

vi.mock('../../hooks/use-config', () => ({
  invalidateConfigCache: vi.fn(),
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => key,
  API_FORMAT_OPTIONS: [
    { value: 'openai-completions', label: 'OpenAI Compatible' },
  ],
}));

import { ApiKeyCredentials } from '../../settings/tabs/providers/ApiKeyCredentials';

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

function providerSummary(overrides: Partial<ProviderSummary>): ProviderSummary {
  return {
    type: 'api-key',
    auth_type: 'api-key',
    display_name: 'DeepSeek',
    base_url: 'https://api.deepseek.com',
    api: 'openai-completions',
    api_key: '',
    models: [],
    custom_models: [],
    has_credentials: false,
    supports_oauth: false,
    can_delete: false,
    ...overrides,
  };
}

describe('ApiKeyCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hanaFetch.mockResolvedValue(jsonResponse({ ok: true }));
  });

  afterEach(() => {
    cleanup();
  });

  it('syncs an empty saved api key into the input when the provider summary is refreshed', async () => {
    const onRefresh = vi.fn(async () => {});
    const { container, rerender } = render(
      <ApiKeyCredentials
        providerId="deepseek"
        summary={providerSummary({ api_key: 'saved-deepseek-key', has_credentials: true })}
        onRefresh={onRefresh}
      />,
    );

    const keyInput = () => container.querySelector('input[type="password"]');
    await waitFor(() => expect(keyInput()).toHaveValue('saved-deepseek-key'));

    rerender(
      <ApiKeyCredentials
        providerId="deepseek"
        summary={providerSummary({ api_key: '', has_credentials: false })}
        onRefresh={onRefresh}
      />,
    );

    await waitFor(() => expect(keyInput()).toHaveValue(''));
  });

  it('sends the provider id when verifying saved credentials', async () => {
    const onRefresh = vi.fn(async () => {});
    const { container } = render(
      <ApiKeyCredentials
        providerId="groq"
        summary={providerSummary({
          display_name: 'Groq',
          base_url: 'https://api.groq.com/openai/v1',
          api_key: 'saved-groq-key',
          has_credentials: true,
        })}
        onRefresh={onRefresh}
      />,
    );
    await waitFor(() => expect(container.querySelector('input[type="password"]')).toHaveValue('saved-groq-key'));

    const verifyButton = container.querySelector('button[title="settings.providers.verifyConnection"]');
    expect(verifyButton).not.toBeNull();
    fireEvent.click(verifyButton as HTMLButtonElement);

    await waitFor(() => expect(mocks.hanaFetch).toHaveBeenCalledWith(
      '/api/providers/test',
      expect.objectContaining({ method: 'POST' }),
    ));
    const [, options] = mocks.hanaFetch.mock.calls[0];
    expect(JSON.parse(String((options as RequestInit).body))).toMatchObject({
      name: 'groq',
      base_url: 'https://api.groq.com/openai/v1',
      api: 'openai-completions',
      api_key: 'saved-groq-key',
    });
  });
});
