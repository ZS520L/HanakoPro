import { describe, expect, it } from 'vitest';
import type { Session } from '../../types';
import { buildSessionSections } from '../../components/session-sections';

function makeSession(overrides: Partial<Session>): Session {
  return {
    path: '/sessions/default.jsonl',
    title: null,
    firstMessage: '',
    modified: '2026-04-29T01:00:00.000Z',
    messageCount: 1,
    agentId: 'hana',
    agentName: 'Hana',
    cwd: null,
    ...overrides,
  };
}

describe('buildSessionSections', () => {
  it('places pinned sessions first and excludes them from date sections', () => {
    const sections = buildSessionSections([
      makeSession({
        path: '/sessions/today.jsonl',
        firstMessage: 'today',
        modified: '2026-04-29T07:00:00.000Z',
      }),
      makeSession({
        path: '/sessions/old-pin.jsonl',
        firstMessage: 'old pin',
        modified: '2026-04-20T07:00:00.000Z',
        pinnedAt: '2026-04-29T07:00:00.000Z',
      }),
      makeSession({
        path: '/sessions/new-pin.jsonl',
        firstMessage: 'new pin',
        modified: '2026-04-28T07:00:00.000Z',
        pinnedAt: '2026-04-29T08:00:00.000Z',
      }),
    ], {
      mode: 'time',
      now: new Date('2026-04-29T12:00:00.000Z'),
    });

    expect(sections.map(section => section.kind)).toEqual(['pinned', 'date']);
    expect(sections[0]).toMatchObject({
      kind: 'pinned',
      titleKey: 'sidebar.pinned',
    });
    expect(sections[0].items.map(item => item.path)).toEqual([
      '/sessions/new-pin.jsonl',
      '/sessions/old-pin.jsonl',
    ]);
    expect(sections[1]).toMatchObject({
      kind: 'date',
      titleKey: 'time.today',
    });
    expect(sections[1].items.map(item => item.path)).toEqual(['/sessions/today.jsonl']);
  });

  it('keeps the pinned section visible when no sessions are pinned and rolls yesterday into this week', () => {
    const sections = buildSessionSections([
      makeSession({
        path: '/sessions/yesterday.jsonl',
        modified: '2026-04-28T07:00:00.000Z',
      }),
    ], {
      mode: 'time',
      now: new Date('2026-04-29T12:00:00.000Z'),
    });

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({
      kind: 'pinned',
      titleKey: 'sidebar.pinned',
      items: [],
    });
    expect(sections[1]).toMatchObject({
      kind: 'date',
      titleKey: 'time.thisWeek',
    });
  });

  it('sorts sessions within a date group by modified descending', () => {
    const sections = buildSessionSections([
      makeSession({
        path: '/sessions/older.jsonl',
        firstMessage: 'older',
        modified: '2026-04-29T02:00:00.000Z',
      }),
      makeSession({
        path: '/sessions/newer.jsonl',
        firstMessage: 'newer',
        modified: '2026-04-29T09:00:00.000Z',
      }),
      makeSession({
        path: '/sessions/middle.jsonl',
        firstMessage: 'middle',
        modified: '2026-04-29T05:00:00.000Z',
      }),
    ], {
      mode: 'time',
      now: new Date('2026-04-29T12:00:00.000Z'),
    });

    const todaySection = sections.find(s => s.kind === 'date' && s.group === 'today');
    expect(todaySection).toBeDefined();
    expect(todaySection!.items.map(i => i.path)).toEqual([
      '/sessions/newer.jsonl',
      '/sessions/middle.jsonl',
      '/sessions/older.jsonl',
    ]);
  });

  it('uses a deterministic path tie-breaker and sinks malformed dates', () => {
    const sections = buildSessionSections([
      makeSession({
        path: '/sessions/z-same-time.jsonl',
        modified: '2026-04-29T09:00:00.000Z',
      }),
      makeSession({
        path: '/sessions/bad-date.jsonl',
        modified: 'not-a-date',
      }),
      makeSession({
        path: '/sessions/a-same-time.jsonl',
        modified: '2026-04-29T09:00:00.000Z',
      }),
    ], {
      mode: 'time',
      now: new Date('2026-04-29T12:00:00.000Z'),
    });

    const todaySection = sections.find(s => s.kind === 'date' && s.group === 'today');
    const earlierSection = sections.find(s => s.kind === 'date' && s.group === 'earlier');
    expect(todaySection!.items.map(i => i.path)).toEqual([
      '/sessions/a-same-time.jsonl',
      '/sessions/z-same-time.jsonl',
    ]);
    expect(earlierSection!.items.map(i => i.path)).toEqual(['/sessions/bad-date.jsonl']);
  });
});
