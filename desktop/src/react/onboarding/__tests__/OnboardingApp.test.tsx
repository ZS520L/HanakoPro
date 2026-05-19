/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingApp } from '../OnboardingApp';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const TRANSLATIONS: Record<string, Record<string, string>> = {
  zh: {
    'onboarding.welcome.title': '欢迎',
    'onboarding.welcome.subtitle': '开始设置',
    'onboarding.welcome.next': '下一步',
  },
  en: {
    'onboarding.welcome.title': 'Welcome',
    'onboarding.welcome.subtitle': 'Start setup',
    'onboarding.welcome.next': 'Next',
  },
};

function resolveLocaleKey(locale: string): string {
  if (locale.startsWith('en')) return 'en';
  return 'zh';
}

describe('OnboardingApp locale switching', () => {
  let enLoad: Deferred<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    enLoad = createDeferred<void>();
    let loadedLocale = 'zh';

    const i18nMock = {
      locale: 'zh',
      defaultName: 'Hanako',
      _data: {},
      _agentOverrides: {},
      load: vi.fn(async (locale: string) => {
        const key = resolveLocaleKey(locale);
        i18nMock.locale = key;
        if (key === 'en') {
          await enLoad.promise;
        }
        loadedLocale = key;
      }),
      setAgentOverrides: vi.fn(),
      t: vi.fn((key: string, _vars?: Record<string, string | number>) => TRANSLATIONS[loadedLocale]?.[key] ?? key),
    };

    vi.stubGlobal('i18n', i18nMock);
    vi.stubGlobal('t', (key: string, vars?: Record<string, string | number>) => i18nMock.t(key, vars));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('hana', {
      getServerPort: vi.fn(async () => '62950'),
      getServerToken: vi.fn(async () => 'token'),
      getSplashInfo: vi.fn(async () => ({ locale: 'zh-CN', agentName: 'Hanako' })),
      getAvatarPath: vi.fn(async () => null),
    });
    vi.stubGlobal('platform', {
      getFileUrl: vi.fn((path: string) => `file://${path}`),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the newly selected locale only after that locale has loaded', async () => {
    render(<OnboardingApp preview skipToTutorial={false} />);

    expect(await screen.findByRole('heading', { name: '欢迎' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'English' }));

    await act(async () => {
      enLoad.resolve();
      await enLoad.promise;
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    });
  });
});
