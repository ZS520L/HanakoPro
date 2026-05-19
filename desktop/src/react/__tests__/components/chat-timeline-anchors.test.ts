import { describe, expect, it } from 'vitest';
import type { ChatListItem } from '../../stores/chat-types';
import {
  buildTimelineAnchors,
  formatTimelineAnchorLabel,
  measureTimelineMarkerWidthEm,
} from '../../components/chat/timeline-anchors';

function message(id: string, role: 'user' | 'assistant', timestamp?: number, text = ''): ChatListItem {
  return {
    type: 'message',
    data: {
      id,
      role,
      timestamp,
      text,
      textHtml: text,
      blocks: role === 'assistant' ? [{ type: 'text', html: text }] : undefined,
    },
  };
}

describe('chat timeline anchors', () => {
  it('uses user prompt previews as lightweight navigation anchors', () => {
    const items: ChatListItem[] = [
      message('u1', 'user', Date.parse('2026-05-07T05:42:00.000Z'), 'first prompt'),
      message('a1', 'assistant', Date.parse('2026-05-07T05:42:30.000Z'), 'reply'),
      message('u2', 'user', Date.parse('2026-05-07T05:50:00.000Z'), '0123456789abcdef'),
    ];

    const anchors = buildTimelineAnchors(items);

    expect(anchors.map(anchor => anchor.messageId)).toEqual(['u1', 'u2']);
    expect(anchors.map(anchor => anchor.label)).toEqual(['first prom...', '0123456789...']);
  });

  it('keeps user turns even when legacy messages have no timestamp', () => {
    const items: ChatListItem[] = [
      message('u1', 'user', undefined, 'legacy user'),
      message('a1', 'assistant', Date.parse('2026-05-07T06:10:00.000Z'), 'reply'),
    ];

    const anchors = buildTimelineAnchors(items);

    expect(anchors.map(anchor => anchor.messageId)).toEqual(['u1']);
    expect(anchors[0].label).toBe('legacy use...');
  });

  it('formats older anchors with compact date context', () => {
    expect(formatTimelineAnchorLabel(
      Date.parse('2026-05-06T23:30:00.000Z'),
      {
        now: new Date('2026-05-07T08:00:00.000Z'),
        locale: 'zh-CN',
        timeZone: 'UTC',
      },
    )).toBe('5月6日 23:30');
  });

  it('maps prompt length to short non-linear marker widths', () => {
    expect(measureTimelineMarkerWidthEm(0)).toBe(0.5);
    expect(measureTimelineMarkerWidthEm(2)).toBe(0.5);

    const midWidth = measureTimelineMarkerWidthEm(24);
    expect(midWidth).toBeGreaterThan(0.5);
    expect(midWidth).toBeLessThan(1);

    expect(measureTimelineMarkerWidthEm(400)).toBe(1);
  });

  it('stores marker width on each anchor from the prompt length', () => {
    const anchors = buildTimelineAnchors([
      message('u1', 'user', undefined, 'hi'),
      message('u2', 'user', undefined, '这是一段明显更长的用户提示词，用来拉长导航短线'),
    ]);

    expect(anchors[0].markerWidthEm).toBe(0.5);
    expect(anchors[1].markerWidthEm).toBeGreaterThan(anchors[0].markerWidthEm);
    expect(anchors[1].markerWidthEm).toBeLessThanOrEqual(1);
  });

  it('keeps previews within ten visible characters before the ellipsis', () => {
    const anchors = buildTimelineAnchors([
      message('u1', 'user', undefined, '1234567890'),
      message('u2', 'user', undefined, '12345678901'),
    ]);

    expect(anchors.map(anchor => anchor.label)).toEqual(['1234567890', '1234567890...']);
  });
});
