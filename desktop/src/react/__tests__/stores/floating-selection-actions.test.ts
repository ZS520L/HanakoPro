/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendFloatingSelectionPrompt } from '../../stores/floating-selection-actions';
import { useStore } from '../../stores';
import { getWebSocket } from '../../services/websocket';

vi.mock('../../services/websocket', () => ({
  getWebSocket: vi.fn(),
}));

vi.mock('../../stores/session-actions', () => ({
  ensureSession: vi.fn(async () => true),
  loadSessions: vi.fn(),
}));

describe('sendFloatingSelectionPrompt', () => {
  const send = vi.fn();

  beforeEach(() => {
    send.mockClear();
    vi.mocked(getWebSocket).mockReturnValue({ readyState: 1, send } as unknown as WebSocket);
    useStore.setState({
      currentSessionPath: '/sessions/a.jsonl',
      pendingNewSession: false,
      streamingSessions: [],
      deskCurrentPath: '',
      previewItems: [],
      activeTabId: null,
      pinnedViewers: [],
    } as never);
  });

  it('sends the visible input as display text and the selected original text only inside the prompt payload', async () => {
    const sent = await sendFloatingSelectionPrompt('  继续解释  ', {
      text: '原文第一行\n原文第二行',
      sourceTitle: 'note.md',
      sourceFilePath: '/notes/note.md',
      lineStart: 3,
      lineEnd: 4,
      charCount: 11,
    });

    expect(sent).toBe(true);
    const payload = JSON.parse(send.mock.calls[0][0]);
    expect(payload.text).toBe([
      '继续解释',
      '',
      '[引用片段] note.md（第3-4行，共11字）路径: /notes/note.md',
      '[引用原文]',
      '原文第一行\n原文第二行',
      '[/引用原文]',
    ].join('\n'));
    expect(payload.displayMessage).toEqual({
      text: '继续解释',
      quotedText: '原文第一行\n原文第二行',
    });
  });
});
