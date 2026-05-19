import { describe, expect, it } from 'vitest';
import {
  SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT,
  readScreenshotSegmentVisibleCharLimit,
  splitScreenshotMessages,
} from '../../utils/screenshot-segments';
import type { ChatMessage } from '../../stores/chat-types';

function user(id: string, text: string): ChatMessage {
  return { id, role: 'user', text };
}

function assistant(id: string, html: string): ChatMessage {
  return { id, role: 'assistant', blocks: [{ type: 'text', html }] };
}

describe('splitScreenshotMessages', () => {
  it('defaults to 10000 visible characters per screenshot page', () => {
    expect(SCREENSHOT_SEGMENT_VISIBLE_CHAR_LIMIT).toBe(10_000);
    expect(readScreenshotSegmentVisibleCharLimit({
      getItem: () => null,
    } as unknown as Storage)).toBe(10_000);
  });

  it('splits by visible character budget while keeping full conversation rounds together', () => {
    const messages = [
      user('u1', '一'.repeat(4)),
      assistant('a1', '<p>二二二</p>'),
      user('u2', '三'.repeat(4)),
      assistant('a2', '<p>四四四</p>'),
      user('u3', '五'.repeat(4)),
      assistant('a3', '<p>六六六</p>'),
    ];

    const chunks = splitScreenshotMessages(messages, 12);

    expect(chunks.map(chunk => chunk.map(message => message.id))).toEqual([
      ['u1', 'a1'],
      ['u2', 'a2'],
      ['u3', 'a3'],
    ]);
  });

  it('keeps an oversized single round intact instead of cutting through a reply', () => {
    const messages = [
      user('u1', '问'),
      assistant('a1', `<p>${'长'.repeat(40)}</p>`),
      user('u2', '下一个问题'),
      assistant('a2', '<p>短答</p>'),
    ];

    const chunks = splitScreenshotMessages(messages, 20);

    expect(chunks.map(chunk => chunk.map(message => message.id))).toEqual([
      ['u1', 'a1'],
      ['u2', 'a2'],
    ]);
  });
});
