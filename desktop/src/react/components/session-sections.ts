import type { Session } from '../types';

export type SessionViewMode = 'time' | 'project';
export type DateGroup = 'today' | 'thisWeek' | 'earlier';

export type DateSubSection = {
  group: DateGroup;
  titleKey: `time.${DateGroup}`;
  items: Session[];
};

export type SessionSection =
  | {
      id: 'pinned';
      kind: 'pinned';
      titleKey: 'sidebar.pinned';
      items: Session[];
    }
  | {
      id: `date:${DateGroup}`;
      kind: 'date';
      titleKey: `time.${DateGroup}`;
      group: DateGroup;
      items: Session[];
    }
  | {
      id: `project:${string}`;
      kind: 'project';
      title: string;
      cwd: string | null;
      subSections: DateSubSection[];
    };

interface BuildSessionSectionsOptions {
  mode?: SessionViewMode;
  now?: Date;
}

const DATE_GROUP_ORDER: DateGroup[] = ['today', 'thisWeek', 'earlier'];

function getSessionDateGroup(isoStr: string | null, now: Date): DateGroup {
  if (!isoStr) return 'earlier';
  const date = new Date(isoStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);

  if (date >= today) return 'today';
  if (date >= weekAgo) return 'thisWeek';
  return 'earlier';
}

function isPinnedSession(session: Session): boolean {
  return typeof session.pinnedAt === 'string' && session.pinnedAt.length > 0;
}

function pinnedTime(session: Session): number {
  return timestamp(session.pinnedAt);
}

function modifiedTime(session: Session): number {
  return timestamp(session.modified);
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function compareByPath(a: Session, b: Session): number {
  return String(a.path || '').localeCompare(String(b.path || ''));
}

export function buildSessionSections(
  sessions: Session[],
  options: BuildSessionSectionsOptions = {},
): SessionSection[] {
  const mode = options.mode ?? 'time';

  const pinned = sessions
    .filter(isPinnedSession)
    .sort((a, b) => pinnedTime(b) - pinnedTime(a) || compareByPath(a, b));
  const regular = sessions.filter(session => !isPinnedSession(session));

  const sections: SessionSection[] = [];
  sections.push({
    id: 'pinned',
    kind: 'pinned',
    titleKey: 'sidebar.pinned',
    items: pinned,
  });

  if (mode === 'project') {
    return [...sections, ...buildProjectSections(regular, options.now ?? new Date())];
  }

  if (mode === 'time') {
    return [...sections, ...buildDateSections(regular, options.now ?? new Date())];
  }

  const _exhaustive: never = mode;
  return sections;
}

// ── Project view ──

/** Extract a readable project name from a cwd path */
export function projectName(cwd: string | null): string {
  if (!cwd) return '';
  // Normalize separators
  const normalized = cwd.replace(/\\/g, '/');
  // Take the last meaningful segment
  const segments = normalized.replace(/\/+$/, '').split('/');
  return segments[segments.length - 1] || normalized;
}

function buildProjectSections(regular: Session[], now: Date): SessionSection[] {
  const sections: SessionSection[] = [];

  // Group by project name (last folder) to avoid duplicate project folders
  // caused by different path formats (e.g. D:\... vs /d/... )
  const projectMap = new Map<string, { cwd: string | null; sessions: Session[] }>();
  for (const s of regular) {
    const key = projectName(s.cwd) || '__no_cwd__';
    const group = projectMap.get(key);
    if (group) {
      group.sessions.push(s);
    } else {
      projectMap.set(key, { cwd: s.cwd || null, sessions: [s] });
    }
  }

  // For each project group, sort by most recent modified
  const entries = Array.from(projectMap.entries())
    .map(([projKey, group]) => ({
      projKey,
      cwd: group.cwd,
      sessions: group.sessions.sort((a, b) => modifiedTime(b) - modifiedTime(a) || compareByPath(a, b)),
      latestTime: Math.max(...group.sessions.map(s => modifiedTime(s))),
    }));

  // Sort projects: pinned (with cwd) first by latest activity, then null cwd last
  entries.sort((a, b) => {
    // null cwd (no project) goes last
    if (a.cwd === null && b.cwd !== null) return 1;
    if (a.cwd !== null && b.cwd === null) return -1;
    return b.latestTime - a.latestTime;
  });

  for (const entry of entries) {
    const title = entry.cwd ? projectName(entry.cwd) : 'No Project';

    // Build date sub-sections within this project
    const subSections: DateSubSection[] = [];
    const dateGroups: Record<DateGroup, Session[]> = { today: [], thisWeek: [], earlier: [] };
    for (const s of entry.sessions) {
      dateGroups[getSessionDateGroup(s.modified, now)].push(s);
    }
    for (const group of DATE_GROUP_ORDER) {
      const items = dateGroups[group];
      if (items.length === 0) continue;
      subSections.push({ group, titleKey: `time.${group}`, items });
    }

    sections.push({
      id: `project:${entry.projKey}`,
      kind: 'project',
      title,
      cwd: entry.cwd,
      subSections,
    });
  }

  return sections;
}

// ── Date view (existing) ──

function buildDateSections(regular: Session[], now: Date): SessionSection[] {
  const sections: SessionSection[] = [];

  const dateGroups: Record<DateGroup, Session[]> = {
    today: [],
    thisWeek: [],
    earlier: [],
  };
  for (const session of regular) {
    dateGroups[getSessionDateGroup(session.modified, now)].push(session);
  }

  for (const group of DATE_GROUP_ORDER) {
    dateGroups[group].sort((a, b) => modifiedTime(b) - modifiedTime(a) || compareByPath(a, b));
  }

  for (const group of DATE_GROUP_ORDER) {
    const items = dateGroups[group];
    if (items.length === 0) continue;
    sections.push({
      id: `date:${group}`,
      kind: 'date',
      titleKey: `time.${group}`,
      group,
      items,
    });
  }

  return sections;
}
