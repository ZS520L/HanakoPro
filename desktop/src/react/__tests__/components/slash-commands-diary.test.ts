import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

import { hanaFetch } from '../../hooks/use-hana-fetch';

const t = (key: string) => key;

let executeDiary: typeof import('../../components/input/slash-commands').executeDiary;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('window', { i18n: { locale: 'zh' } });
  ({ executeDiary } = await import('../../components/input/slash-commands'));
});

describe('executeDiary', () => {
  it('runs diary writing in the background and reports progress through toast', async () => {
    vi.mocked(hanaFetch).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);
    const addToast = vi.fn().mockReturnValue(42);
    const removeToast = vi.fn();
    const setInput = vi.fn();
    const setMenuOpen = vi.fn();

    const result = executeDiary(t, addToast, removeToast, setInput, setMenuOpen)();

    expect(result).toBeUndefined();
    expect(setInput).toHaveBeenCalledWith('');
    expect(setMenuOpen).toHaveBeenCalledWith(false);
    expect(addToast).toHaveBeenCalledWith('slash.diaryBusy', 'info', 0, {
      persistent: true,
      dedupeKey: 'slash-diary-progress',
    });

    await vi.waitFor(() => expect(hanaFetch).toHaveBeenCalledWith('/api/diary/write', {
      method: 'POST',
      timeout: 150_000,
    }));
    await vi.waitFor(() => expect(removeToast).toHaveBeenCalledWith(42));
    expect(addToast).toHaveBeenLastCalledWith('slash.diaryDone', 'success', 5000);
  });

  it('keeps the progress toast cleanup and failure toast when diary writing fails', async () => {
    vi.mocked(hanaFetch).mockRejectedValue(new Error('request aborted'));
    const addToast = vi.fn().mockReturnValue(42);
    const removeToast = vi.fn();
    const setInput = vi.fn();
    const setMenuOpen = vi.fn();

    executeDiary(t, addToast, removeToast, setInput, setMenuOpen)();

    await vi.waitFor(() => expect(hanaFetch).toHaveBeenCalledWith('/api/diary/write', {
      method: 'POST',
      timeout: 150_000,
    }));
    await vi.waitFor(() => expect(removeToast).toHaveBeenCalledWith(42));
    expect(addToast).toHaveBeenLastCalledWith('slash.diaryFailed', 'error', 6000);
  });
});
