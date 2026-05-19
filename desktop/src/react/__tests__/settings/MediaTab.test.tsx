/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mocks = vi.hoisted(() => ({
  hanaFetch: vi.fn(),
}));

vi.mock('../../settings/api', () => ({
  hanaFetch: (...args: unknown[]) => mocks.hanaFetch(...args),
}));

vi.mock('../../settings/helpers', () => ({
  t: (key: string) => key,
}));

vi.mock('../../settings/components/SettingsSection', () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

vi.mock('../../settings/components/SettingsRow', () => ({
  SettingsRow: ({ label, control }: { label: string; control: React.ReactNode }) => (
    <label>
      <span>{label}</span>
      {control}
    </label>
  ),
}));

vi.mock('../../settings/tabs/media/MediaProviderDetail', () => ({
  MediaProviderDetail: ({ providerId }: { providerId: string }) => (
    <div data-testid="media-provider-detail">{providerId}</div>
  ),
}));

vi.mock('@/ui', () => ({
  SelectWidget: ({ value, onChange, options }: {
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select
      aria-label="settings.media.defaultModel"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map(option => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

import { MediaTab } from '../../settings/tabs/MediaTab';

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

describe('MediaTab image-gen config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hanaFetch.mockImplementation((path: string) => {
      if (path === '/api/plugins/image-gen/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            volcengine: {
              providerId: 'volcengine',
              displayName: 'Volcengine',
              hasCredentials: true,
              models: [{ id: 'seedream-5', name: 'Seedream 5.0' }],
              availableModels: [],
            },
          },
          config: {},
        }));
      }
      return Promise.resolve(jsonResponse({ values: { defaultImageModel: { provider: 'volcengine', id: 'seedream-5' } } }));
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('loads global image-gen config without agent scope and saves through the generic config envelope', async () => {
    render(<MediaTab />);

    const select = await screen.findByLabelText('settings.media.defaultModel');
    await waitFor(() => {
      expect(mocks.hanaFetch).toHaveBeenCalledWith('/api/plugins/image-gen/providers');
    });

    fireEvent.change(select, { target: { value: 'volcengine/seedream-5' } });

    await waitFor(() => {
      expect(mocks.hanaFetch.mock.calls.some(([path]) => path === '/api/plugins/image-gen/config')).toBe(true);
    });
    const saveCall = mocks.hanaFetch.mock.calls.find(([path]) => path === '/api/plugins/image-gen/config');
    expect(saveCall?.[1]).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(String((saveCall?.[1] as RequestInit).body))).toEqual({
      values: {
        defaultImageModel: { provider: 'volcengine', id: 'seedream-5' },
      },
    });
    expect(mocks.hanaFetch.mock.calls.map(call => String(call[0])).join('\n')).not.toContain('agentId=');
  });

  it('sends null to clear the global default model over HTTP', async () => {
    mocks.hanaFetch.mockImplementation((path: string) => {
      if (path === '/api/plugins/image-gen/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            volcengine: {
              providerId: 'volcengine',
              displayName: 'Volcengine',
              hasCredentials: true,
              models: [{ id: 'seedream-5', name: 'Seedream 5.0' }],
              availableModels: [],
            },
          },
          config: { defaultImageModel: { provider: 'volcengine', id: 'seedream-5' } },
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    const select = await screen.findByLabelText('settings.media.defaultModel');
    fireEvent.change(select, { target: { value: '' } });

    await waitFor(() => {
      expect(mocks.hanaFetch).toHaveBeenCalledWith('/api/plugins/image-gen/config', expect.objectContaining({
        body: JSON.stringify({ values: { defaultImageModel: null } }),
      }));
    });
  });

  it('auto-selects the first credentialed image provider instead of the first provider in transport order', async () => {
    mocks.hanaFetch.mockImplementation((path: string) => {
      if (path === '/api/plugins/image-gen/providers') {
        return Promise.resolve(jsonResponse({
          providers: {
            openai: {
              providerId: 'openai',
              displayName: 'OpenAI',
              hasCredentials: false,
              models: [{ id: 'gpt-image-2', name: 'GPT Image 2' }],
              availableModels: [],
            },
            volcengine: {
              providerId: 'volcengine',
              displayName: 'Volcengine',
              hasCredentials: true,
              models: [{ id: 'seedream-5', name: 'Seedream 5.0' }],
              availableModels: [],
            },
          },
          config: {},
        }));
      }
      return Promise.resolve(jsonResponse({ values: {} }));
    });

    render(<MediaTab />);

    expect(await screen.findByTestId('media-provider-detail')).toHaveTextContent('volcengine');
  });
});
