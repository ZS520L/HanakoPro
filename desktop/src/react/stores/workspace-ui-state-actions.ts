import { hanaFetch } from '../hooks/use-hana-fetch';
import { hasServerConnection } from '../services/server-connection';
import type { RightWorkspaceTab } from '../types';
import { useStore } from './index';
// @ts-expect-error — shared JS module
import { normalizeWorkspacePath } from '../../../../shared/workspace-history.js';

export interface PersistedWorkspaceUiState {
  updatedAt?: number;
  deskCurrentPath?: string;
  deskExpandedPaths?: string[];
  deskSelectedPath?: string;
  rightWorkspaceTab?: RightWorkspaceTab;
  jianView?: string;
  jianDrawerOpen?: boolean;
  previewTabs?: unknown[];
}

const SAVE_DEBOUNCE_MS = 350;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function normalizeRoot(root: string | null | undefined): string | null {
  return normalizeWorkspacePath(root);
}

function normalizeSubdir(value: string | null | undefined): string {
  return (value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function buildPersistedWorkspaceUiState(_root: string): PersistedWorkspaceUiState {
  const state = useStore.getState();
  return {
    deskCurrentPath: normalizeSubdir(state.deskCurrentPath),
    deskExpandedPaths: [...(state.deskExpandedPaths || [])].map(normalizeSubdir).filter(Boolean),
    deskSelectedPath: normalizeSubdir(state.deskSelectedPath),
    rightWorkspaceTab: state.rightWorkspaceTab,
    jianView: state.jianView,
    jianDrawerOpen: !!state.jianDrawerOpen,
  };
}

export async function loadPersistedWorkspaceUiState(root: string): Promise<PersistedWorkspaceUiState | null> {
  const normalized = normalizeRoot(root);
  const state = useStore.getState();
  if (!normalized || !hasServerConnection(state)) return null;
  try {
    const res = await hanaFetch(`/api/preferences/workspace-ui-state?workspace=${encodeURIComponent(normalized)}`);
    const data = await res.json().catch(() => null);
    return data?.state && typeof data.state === 'object' ? data.state as PersistedWorkspaceUiState : null;
  } catch (err) {
    console.warn('[workspace-ui-state] load failed:', err);
    return null;
  }
}

export function schedulePersistCurrentWorkspaceUiState(root?: string | null): void {
  const normalized = normalizeRoot(root ?? useStore.getState().deskBasePath);
  if (!normalized || !hasServerConnection(useStore.getState())) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistCurrentWorkspaceUiStateNow(normalized);
  }, SAVE_DEBOUNCE_MS);
}

export async function persistCurrentWorkspaceUiStateNow(root?: string | null): Promise<void> {
  const normalized = normalizeRoot(root ?? useStore.getState().deskBasePath);
  if (!normalized || !hasServerConnection(useStore.getState())) return;
  const state = buildPersistedWorkspaceUiState(normalized);
  try {
    await hanaFetch('/api/preferences/workspace-ui-state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace: normalized, state }),
    });
  } catch (err) {
    console.warn('[workspace-ui-state] save failed:', err);
  }
}
