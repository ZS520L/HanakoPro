/**
 * @vitest-environment jsdom
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionFloatingInput, SELECTION_OPEN_DELAY_MS } from '../../components/floating-input/SelectionFloatingInput';
import { useStore } from '../../stores';

vi.mock('../../hooks/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe('SelectionFloatingInput focus behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    useStore.setState({
      connected: true,
      currentSessionPath: '/tmp/session.jsonl',
      modelSwitching: false,
      quotedSelection: null,
      streamingSessions: [],
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    useStore.setState({ quotedSelection: null } as never);
  });

  it('appears without taking focus away from the document', async () => {
    render(
      <>
        <button type="button">document focus</button>
        <SelectionFloatingInput />
      </>
    );
    const documentFocus = screen.getByRole('button', { name: 'document focus' });
    documentFocus.focus();

    act(() => {
      useStore.getState().setQuotedSelection({
        text: '选中文本',
        sourceTitle: 'doc',
        charCount: 4,
        anchorRect: { left: 300, right: 500, top: 120, bottom: 180, width: 200, height: 60 },
        updatedAt: 1,
      });
      vi.advanceTimersByTime(SELECTION_OPEN_DELAY_MS);
    });
    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText('input.floatingInput').tagName).toBe('TEXTAREA');
    expect(document.activeElement).toBe(documentFocus);
  });
});
