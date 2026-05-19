/**
 * Tests for SkillsTab — Stage 11 safety net for the Stage 4 state migration.
 *
 * Two behaviors are protected here:
 *
 *   1. Sticky `skillsViewAgentId`: once initialized from `currentAgentId`, it
 *      must NOT auto-sync when the chat focus agent changes externally. The
 *      only sync mechanism is the user's manual AgentSelect interaction. The
 *      early return at line `if (skillsViewAgentId) return;` is what makes
 *      this work — if a future refactor removes it, Test 2 fails.
 *
 *   2. Race guard in `toggleSkill`: if the user switches the selector while a
 *      PUT is in flight, the stale `snapshotAgentId` mismatch must skip the
 *      actual PUT. If a future refactor removes the guard, Test 4 fails.
 *
 * Both behaviors are the #419-class UX bug surface. Without these tests they
 * regress silently.
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────

// `hanaFetch` is the single I/O seam for SkillsTab. Spy on it per test.
const fetchMock = vi.fn();
vi.mock('../../api', () => ({
  hanaFetch: (...args: unknown[]) => fetchMock(...args),
}));

// `helpers.ts` reads `window.platform` at module eval time (line 8). Full mock
// to avoid the jsdom bootstrap crash that AgentToolsSection.test.tsx also hit.
vi.mock('../../helpers', () => ({
  t: (key: string) => key,
  autoSaveConfig: vi.fn(),
}));

// AgentSelect: minimal <select> stub that forwards user-driven changes. The
// exposed options are the three agents the tests use below.
vi.mock('../bridge/AgentSelect', () => ({
  AgentSelect: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (id: string) => void;
  }) => (
    <select
      data-testid="agent-select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">(none)</option>
      <option value="agent-a">Agent A</option>
      <option value="agent-b">Agent B</option>
      <option value="agent-c">Agent C</option>
    </select>
  ),
}));

// SkillRow: tiny stub that exposes the skill's name/enabled as data-* attrs
// and a toggle button the tests can click.
// SkillRow mock: mirrors production's conditional rendering — toggle/delete
// are only rendered when their respective callbacks are provided. This is
// critical post-refactor because the same skill can appear in two sections
// (Section 1 with onDelete only, Section 3 with onToggle only); an
// unconditional render would produce duplicate testids.
vi.mock('../skills/SkillRow', () => ({
  SkillRow: ({
    skill,
    draggable,
    extraActions,
    onToggle,
    onDelete,
    onDragStart,
    onDragOver,
    onDrop,
  }: {
    skill: { name: string; enabled: boolean };
    draggable?: boolean;
    extraActions?: React.ReactNode;
    onToggle?: (name: string, enabled: boolean) => void;
    onDelete?: (name: string) => void;
    onDragStart?: (event: React.DragEvent<HTMLDivElement>, name: string) => void;
    onDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
  }) => (
    <div
      data-testid={`skill-row-${skill.name}`}
      data-skill-name={skill.name}
      data-enabled={String(skill.enabled)}
      draggable={draggable}
      onDragStart={(event) => onDragStart?.(event, skill.name)}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {extraActions}
      {onToggle && (
        <button
          data-testid={`skill-toggle-${skill.name}`}
          onClick={() => onToggle(skill.name, !skill.enabled)}
        >
          toggle
        </button>
      )}
      {onDelete && (
        <button
          data-testid={`skill-delete-${skill.name}`}
          onClick={() => onDelete(skill.name)}
        >
          delete
        </button>
      )}
    </div>
  ),
}));

// Noop stubs for the other skill sub-components — they don't participate in
// the behaviors under test.
vi.mock('../skills/SkillCapabilities', () => ({
  SkillCapabilities: () => <div data-testid="skill-capabilities" />,
}));
vi.mock('../skills/CompatPathDrawer', () => ({
  CompatPathDrawer: () => <div data-testid="compat-path-drawer" />,
}));
vi.mock('../skills/LearnedSkillsBlock', () => ({
  LearnedSkillsBlock: ({
    learnedSkills,
  }: {
    learnedSkills: Array<{ name: string }>;
  }) => (
    <div data-testid="learned-skills-block" data-count={learnedSkills.length} />
  ),
}));

// ─── Real imports (after mocks so the mocked modules win) ─────────────────────

import { SkillsTab } from '../SkillsTab';
import { useSettingsStore, type SettingsState } from '../../store';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Controllable async promise for simulating fetch-in-flight races. */
function defer<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve: resolve! };
}

/** Minimal Response-like object so `await res.json()` works in mocks. */
function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

/** Seed a clean store state, matching the real SettingsState shape. */
function seedStore(partial: Partial<SettingsState> = {}) {
  const base: Partial<SettingsState> = {
    serverPort: null,
    serverToken: null,
    agents: [],
    currentAgentId: null,
    settingsAgentId: null,
    agentName: 'Hanako',
    userName: 'User',
    agentYuan: 'hanako',
    agentAvatarUrl: null,
    userAvatarUrl: null,
    settingsConfig: { capabilities: { learn_skills: {} } },
    globalModelsConfig: null,
    homeFolder: null,
    activeTab: 'skills',
    ready: true,
    currentPins: [],
    providersSummary: {},
    selectedProviderId: null,
    pluginAllowFullAccess: false,
    pluginUserDir: '',
    toastMessage: '',
    toastType: '',
    toastVisible: false,
  };
  useSettingsStore.setState({ ...base, ...partial });
}

/** Flush queued microtasks so chained promise .then() callbacks settle. */
async function flushMicrotasks(ticks = 3) {
  await act(async () => {
    for (let i = 0; i < ticks; i++) {
      await Promise.resolve();
    }
  });
}

function createDragData() {
  const data = new Map<string, string>();
  return {
    effectAllowed: '',
    setData: (type: string, value: string) => { data.set(type, value); },
    getData: (type: string) => data.get(type) || '',
  } as unknown as DataTransfer;
}

/** Default fetch routing for tests that don't need agent-specific responses. */
function defaultFetchMock() {
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/api/skills/external-paths')) {
      return Promise.resolve(jsonResponse({ configured: [], discovered: [] }));
    }
    if (url.includes('/api/skills/bundles')) {
      return Promise.resolve(jsonResponse({ bundles: [] }));
    }
    if (url.includes('/api/skills')) {
      return Promise.resolve(jsonResponse({ skills: [] }));
    }
    return Promise.resolve(jsonResponse({}));
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  fetchMock.mockReset();
  // Force locale=en so the nameHints translate effect is skipped and no spurious
  // POST /api/skills/translate appears in fetchMock call log.
  (window as unknown as { i18n: { locale: string } }).i18n = { locale: 'en' };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { i18n?: unknown }).i18n;
  delete (window as unknown as { platform?: unknown }).platform;
});

describe('SkillsTab — sticky skillsViewAgentId & toggleSkill race guard', () => {
  // ── Test 1: initial mount syncs from currentAgentId ─────────────────────────
  it('initial mount sets skillsViewAgentId from currentAgentId and loads that agent', async () => {
    seedStore({ currentAgentId: 'agent-a' });

    // Default mock: resolve any GET with an empty skill list.
    defaultFetchMock();

    render(<SkillsTab />);
    await flushMicrotasks();

    // Selector reflects the store's currentAgentId.
    const sel = screen.getByTestId('agent-select') as HTMLSelectElement;
    expect(sel.value).toBe('agent-a');

    // hanaFetch was called with agentId=agent-a for the initial skills load.
    const skillsCalls = fetchMock.mock.calls.filter((c) =>
      typeof c[0] === 'string' && c[0].includes('/api/skills?agentId='),
    );
    expect(skillsCalls.length).toBeGreaterThanOrEqual(1);
    expect(skillsCalls[0][0]).toContain('agentId=agent-a');
  });

  // ── Test 2: sticky — external currentAgentId change does NOT resync ─────────
  it('external currentAgentId change does NOT resync skillsViewAgentId (sticky)', async () => {
    seedStore({ currentAgentId: 'agent-a' });

    defaultFetchMock();

    render(<SkillsTab />);
    await flushMicrotasks();

    // Baseline: selector is on agent-a, and agent-a's GET happened once.
    expect((screen.getByTestId('agent-select') as HTMLSelectElement).value).toBe('agent-a');
    const callsBefore = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('agentId='),
    ).length;
    const agentBCallsBefore = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('agentId=agent-b'),
    ).length;
    expect(agentBCallsBefore).toBe(0);

    // Simulate the chat focus agent changing externally (NOT via the selector).
    act(() => {
      seedStore({ currentAgentId: 'agent-b' });
    });
    await flushMicrotasks();

    // Selector MUST stay on agent-a — this is the sticky guarantee.
    expect((screen.getByTestId('agent-select') as HTMLSelectElement).value).toBe('agent-a');

    // And crucially: no new skills GET fired for agent-b, because
    // skillsViewAgentId didn't change, so the loadSkills effect didn't re-run.
    const agentBCallsAfter = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('agentId=agent-b'),
    ).length;
    expect(agentBCallsAfter).toBe(0);

    // Overall agentId-param call count should be stable (no extra loads).
    const callsAfter = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('agentId='),
    ).length;
    expect(callsAfter).toBe(callsBefore);
  });

  // ── Test 3: user-driven selector change DOES re-fire loadSkills ─────────────
  it('user changing AgentSelect re-fires loadSkills with the new agentId', async () => {
    seedStore({ currentAgentId: 'agent-a' });

    defaultFetchMock();

    render(<SkillsTab />);
    await flushMicrotasks();

    // Simulate the user selecting agent-c via the mocked <select>.
    await act(async () => {
      fireEvent.change(screen.getByTestId('agent-select'), {
        target: { value: 'agent-c' },
      });
    });
    await flushMicrotasks();

    // Selector now shows agent-c.
    expect((screen.getByTestId('agent-select') as HTMLSelectElement).value).toBe('agent-c');

    // And loadSkills re-fired with agentId=agent-c.
    const callsForAgentC = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('agentId=agent-c'),
    );
    expect(callsForAgentC.length).toBeGreaterThanOrEqual(1);
  });

  it('requests backend skill-name translation with the current agentId and visible names', async () => {
    (window as unknown as { i18n: { locale: string } }).i18n = { locale: 'zh' };
    seedStore({ currentAgentId: 'agent-a' });

    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('/api/skills/translate')) {
        return Promise.resolve(jsonResponse({
          received: JSON.parse(String(opts?.body || '{}')),
        }));
      }
      if (url.includes('/api/skills/external-paths')) {
        return Promise.resolve(jsonResponse({ configured: [], discovered: [] }));
      }
      if (url.includes('/api/skills/bundles')) {
        return Promise.resolve(jsonResponse({ bundles: [] }));
      }
      if (url.includes('/api/skills?agentId=agent-a')) {
        return Promise.resolve(jsonResponse({
          skills: [
            { name: 'literary-craft', enabled: true, source: 'user' },
            { name: 'quiet-musing', enabled: true, source: 'user' },
            { name: 'hidden-skill', enabled: true, source: 'user', hidden: true },
          ],
        }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(<SkillsTab />);
    await flushMicrotasks(6);

    const translateCall = fetchMock.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('/api/skills/translate'),
    );
    expect(translateCall).toBeTruthy();
    expect(JSON.parse(String((translateCall?.[1] as RequestInit)?.body))).toEqual({
      agentId: 'agent-a',
      names: ['literary-craft', 'quiet-musing'],
      lang: 'zh',
    });
  });

  // ── Test 4: toggleSkill race guard — stale GET must not trigger PUT ─────────
  it('toggleSkill race guard: switching selector mid-flight skips the PUT', async () => {
    seedStore({ currentAgentId: 'agent-a' });

    // Initial load: agent-a has one skill; external-paths empty.
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/skills/external-paths')) {
        return Promise.resolve(jsonResponse({ configured: [], discovered: [] }));
      }
      if (url.includes('/api/skills/bundles')) {
        return Promise.resolve(jsonResponse({ bundles: [] }));
      }
      if (url.includes('/api/skills?agentId=agent-a')) {
        return Promise.resolve(
          jsonResponse({
            skills: [
              { name: 'test-skill', enabled: false, source: 'user' },
            ],
          }),
        );
      }
      if (url.includes('/api/skills?agentId=agent-b')) {
        return Promise.resolve(jsonResponse({ skills: [] }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(<SkillsTab />);
    await flushMicrotasks();

    // Confirm the skill rendered (SkillRow stub exposes data-skill-name).
    expect(
      document.querySelector('[data-skill-name="test-skill"]'),
    ).toBeTruthy();

    // ── Arm the race ──────────────────────────────────────────────────────────
    // From here on, the first GET to /api/skills?agentId=agent-a (the "fresh
    // read" inside toggleSkill) is DEFERRED — we control when it resolves.
    const pendingFreshGet = defer<Response>();
    let freshGetConsumed = false;

    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('/api/skills/external-paths')) {
        return Promise.resolve(jsonResponse({ configured: [], discovered: [] }));
      }
      if (url.includes('/api/skills/bundles')) {
        return Promise.resolve(jsonResponse({ bundles: [] }));
      }
      // The PUT that the race guard should prevent.
      if (
        url.includes('/api/agents/agent-a/skills') &&
        opts?.method === 'PUT'
      ) {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      if (url.includes('/api/skills?agentId=agent-a')) {
        if (!freshGetConsumed) {
          freshGetConsumed = true;
          return pendingFreshGet.promise;
        }
        return Promise.resolve(
          jsonResponse({
            skills: [{ name: 'test-skill', enabled: false, source: 'user' }],
          }),
        );
      }
      if (url.includes('/api/skills?agentId=agent-b')) {
        return Promise.resolve(jsonResponse({ skills: [] }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    // Click the toggle — starts toggleSkill('test-skill', true).
    // This kicks off the deferred GET; the function is now parked awaiting it.
    await act(async () => {
      fireEvent.click(screen.getByTestId('skill-toggle-test-skill'));
    });

    // Before resolving the deferred GET, switch the selector to agent-b.
    // This synchronously updates skillsViewAgentId → ref updates on re-render →
    // when the GET finally resolves inside toggleSkill,
    // skillsViewAgentIdRef.current !== snapshotAgentId ('agent-a'), and the
    // race guard MUST early-return before the PUT.
    await act(async () => {
      fireEvent.change(screen.getByTestId('agent-select'), {
        target: { value: 'agent-b' },
      });
    });
    await flushMicrotasks();

    // Now resolve the stale GET from agent-a.
    await act(async () => {
      pendingFreshGet.resolve(
        jsonResponse({
          skills: [{ name: 'test-skill', enabled: false, source: 'user' }],
        }),
      );
    });
    // toggleSkill's await chain is 3 deep (await hanaFetch → await res.json →
    // race-guard check → potential PUT → await res.json). Flush 6 ticks so the
    // entire chain settles before we assert the PUT never fired.
    await flushMicrotasks(6);

    // ── Assertion ────────────────────────────────────────────────────────────
    // The race guard must have prevented the PUT to /api/agents/agent-a/skills.
    const putCallsToAgentA = fetchMock.mock.calls.filter(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('/api/agents/agent-a/skills') &&
        (c[1] as RequestInit | undefined)?.method === 'PUT',
    );
    expect(putCallsToAgentA.length).toBe(0);

    // Sanity: toast state remained at the seed baseline, proving the guard
    // skipped past the showToast branch.
    expect(useSettingsStore.getState().toastMessage).toBe('');
  });

  // ── Test 5: null → value transition DOES sync (initial seed semantics) ──────
  // Substitute for the spec's "agent-created event" test: the current code
  // doesn't subscribe to such an event. Instead we verify the effect-based
  // initial sync still works when currentAgentId arrives AFTER mount.
  it('null → value transition syncs skillsViewAgentId (first-agent-created flow)', async () => {
    // Mount with no agent selected yet.
    seedStore({ currentAgentId: null });

    defaultFetchMock();

    render(<SkillsTab />);
    await flushMicrotasks();

    // Selector starts empty and no agent-keyed GET happened yet.
    expect((screen.getByTestId('agent-select') as HTMLSelectElement).value).toBe('');
    const agentCallsBefore = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('agentId='),
    );
    expect(agentCallsBefore.length).toBe(0);

    // Simulate "first agent created" → currentAgentId flips from null to 'agent-a'.
    act(() => {
      seedStore({ currentAgentId: 'agent-a' });
    });
    await flushMicrotasks();

    // Because skillsViewAgentId was null, the early return doesn't fire, and
    // the effect syncs it to 'agent-a'.
    expect((screen.getByTestId('agent-select') as HTMLSelectElement).value).toBe('agent-a');

    // And loadSkills DID fire for agent-a after the sync.
    const agentCallsAfter = fetchMock.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes('agentId=agent-a'),
    );
    expect(agentCallsAfter.length).toBeGreaterThanOrEqual(1);
  });

  it('renders skill bundles and toggles all bundled skills for the selected agent', async () => {
    seedStore({ currentAgentId: 'agent-a' });

    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('/api/skills/external-paths')) {
        return Promise.resolve(jsonResponse({ configured: [], discovered: [] }));
      }
      if (url.includes('/api/skills/bundles')) {
        return Promise.resolve(jsonResponse({
          bundles: [
            {
              id: 'writing-bundle',
              name: 'Writing Bundle',
              skillNames: ['writer', 'reader'],
              source: 'user',
              agentId: null,
              sourcePackage: null,
              skills: [
                { name: 'writer', enabled: false, source: 'user', missing: false },
                { name: 'reader', enabled: true, source: 'user', missing: false },
              ],
            },
          ],
        }));
      }
      if (url.includes('/api/skills?agentId=agent-a')) {
        return Promise.resolve(jsonResponse({
          skills: [
            { name: 'writer', enabled: false, source: 'user' },
            { name: 'reader', enabled: true, source: 'user' },
            { name: 'loose-skill', enabled: false, source: 'user' },
          ],
        }));
      }
      if (url.includes('/api/agents/agent-a/skills') && opts?.method === 'PUT') {
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(<SkillsTab />);
    await flushMicrotasks(6);

    expect(screen.getAllByText('Writing Bundle').length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      fireEvent.click(screen.getByTestId('skill-bundle-toggle-writing-bundle'));
    });
    await flushMicrotasks(6);

    const putCall = fetchMock.mock.calls.find(
      (c) =>
        typeof c[0] === 'string' &&
        c[0].includes('/api/agents/agent-a/skills') &&
        (c[1] as RequestInit | undefined)?.method === 'PUT',
    );
    expect(JSON.parse(String((putCall?.[1] as RequestInit)?.body))).toEqual({
      enabled: ['writer', 'reader'],
    });
  });

  it('manages bundles through in-panel dialogs instead of browser prompts', async () => {
    seedStore({ currentAgentId: 'agent-a' });
    const promptSpy = vi.spyOn(window, 'prompt');
    const confirmSpy = vi.spyOn(window, 'confirm');

    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/skills/external-paths')) {
        return Promise.resolve(jsonResponse({ configured: [], discovered: [] }));
      }
      if (url.includes('/api/skills/bundles')) {
        return Promise.resolve(jsonResponse({
          bundles: [
            {
              id: 'writing-bundle',
              name: 'Writing Bundle',
              skillNames: ['writer'],
              source: 'user',
              agentId: null,
              sourcePackage: null,
              skills: [{ name: 'writer', enabled: false, source: 'user', missing: false }],
            },
          ],
        }));
      }
      if (url.includes('/api/skills?agentId=agent-a')) {
        return Promise.resolve(jsonResponse({
          skills: [{ name: 'writer', enabled: false, source: 'user' }],
        }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    render(<SkillsTab />);
    await flushMicrotasks(6);

    fireEvent.click(screen.getByRole('button', { name: '新建 Skill Bundle' }));
    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '新建 Bundle' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Bundle 名字'), { target: { value: 'Research Bundle' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await flushMicrotasks(6);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/skills/bundles?agentId=agent-a'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Research Bundle', skillNames: [] }),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '重命名 Writing Bundle' }));
    expect(screen.getByRole('dialog', { name: '重命名 Bundle' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Bundle 名字'), { target: { value: 'Writing Pack' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await flushMicrotasks(6);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/skills/bundles/writing-bundle?agentId=agent-a'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ name: 'Writing Pack' }),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: '打散 Writing Bundle' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: '打散 Bundle' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打散' }));
    await flushMicrotasks(6);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/skills/bundles/writing-bundle'),
      expect.objectContaining({ method: 'DELETE' }),
    );

    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it('exports a skill bundle from the manage tree', async () => {
    seedStore({ currentAgentId: 'agent-a' });
    const showInFinder = vi.fn();
    (window as unknown as { platform: unknown }).platform = { showInFinder };

    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes('/api/skills/external-paths')) {
        return Promise.resolve(jsonResponse({ configured: [], discovered: [] }));
      }
      if (url.includes('/api/skills/bundles/writing-bundle/export')) {
        expect(opts).toMatchObject({ method: 'POST' });
        return Promise.resolve(jsonResponse({
          ok: true,
          filePath: '/tmp/Writing Bundle-skillbundle.zip',
          fileName: 'Writing Bundle-skillbundle.zip',
          warnings: [],
        }));
      }
      if (url.includes('/api/skills/bundles')) {
        return Promise.resolve(jsonResponse({
          bundles: [
            {
              id: 'writing-bundle',
              name: 'Writing Bundle',
              skillNames: ['writer'],
              source: 'user',
              agentId: null,
              sourcePackage: null,
              skills: [{ name: 'writer', enabled: false, source: 'user', missing: false }],
            },
          ],
        }));
      }
      if (url.includes('/api/skills?agentId=agent-a')) {
        return Promise.resolve(jsonResponse({
          skills: [{ name: 'writer', enabled: false, source: 'user' }],
        }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    render(<SkillsTab />);
    await flushMicrotasks(6);

    fireEvent.click(screen.getByRole('button', { name: '导出 Writing Bundle' }));
    await flushMicrotasks(6);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/skills/bundles/writing-bundle/export'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(showInFinder).toHaveBeenCalledWith('/tmp/Writing Bundle-skillbundle.zip');
    expect(useSettingsStore.getState().toastMessage).toContain('Writing Bundle-skillbundle.zip');
  });

  it('persists bundle and bundled-skill order after drag and drop', async () => {
    seedStore({ currentAgentId: 'agent-a' });

    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/skills/external-paths')) {
        return Promise.resolve(jsonResponse({ configured: [], discovered: [] }));
      }
      if (url.includes('/api/skills/bundles')) {
        return Promise.resolve(jsonResponse({
          bundles: [
            {
              id: 'first-bundle',
              name: 'First Bundle',
              skillNames: ['writer', 'reader'],
              source: 'user',
              agentId: null,
              sourcePackage: null,
              skills: [
                { name: 'writer', enabled: false, source: 'user', missing: false },
                { name: 'reader', enabled: false, source: 'user', missing: false },
              ],
            },
            {
              id: 'second-bundle',
              name: 'Second Bundle',
              skillNames: ['debugger'],
              source: 'user',
              agentId: null,
              sourcePackage: null,
              skills: [{ name: 'debugger', enabled: false, source: 'user', missing: false }],
            },
          ],
        }));
      }
      if (url.includes('/api/skills?agentId=agent-a')) {
        return Promise.resolve(jsonResponse({
          skills: [
            { name: 'writer', enabled: false, source: 'user' },
            { name: 'reader', enabled: false, source: 'user' },
            { name: 'debugger', enabled: false, source: 'user' },
          ],
        }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });

    render(<SkillsTab />);
    await flushMicrotasks(6);

    const bundleDrag = createDragData();
    fireEvent.dragStart(screen.getAllByTestId('skill-bundle-header-second-bundle')[0], {
      dataTransfer: bundleDrag,
    });
    fireEvent.drop(screen.getAllByTestId('skill-bundle-header-first-bundle')[0], {
      dataTransfer: bundleDrag,
    });
    await flushMicrotasks(6);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/skills/bundles/order?agentId=agent-a'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ bundleIds: ['second-bundle', 'first-bundle'] }),
      }),
    );

    const skillDrag = createDragData();
    fireEvent.dragStart(screen.getAllByTestId('skill-row-reader')[0], { dataTransfer: skillDrag });
    fireEvent.drop(screen.getAllByTestId('skill-row-writer')[0], { dataTransfer: skillDrag });
    await flushMicrotasks(6);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/skills/bundles/first-bundle?agentId=agent-a'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ skillNames: ['reader', 'writer'] }),
      }),
    );
  });
});
