/**
 * onboarding-actions.ts — API call logic for the onboarding wizard
 */

import { AGENT_ID } from './constants';
import { DEFAULT_HEARTBEAT_INTERVAL_MINUTES } from '../../../../shared/default-workspace-constants.js';

export type HanaFetch = (path: string, opts?: RequestInit) => Promise<Response>;

// ── Test connection ──

interface TestConnectionParams {
  hanaFetch: HanaFetch;
  providerUrl: string;
  providerApi: string;
  apiKey: string;
}

export interface TestResult {
  ok: boolean;
  text: string;
}

export async function testConnection({ hanaFetch, providerUrl, providerApi, apiKey }: TestConnectionParams): Promise<TestResult> {
  const res = await hanaFetch('/api/providers/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_url: providerUrl,
      api: providerApi,
      api_key: apiKey,
    }),
  });
  const data = await res.json();
  if (data.ok) {
    return { ok: true, text: t('onboarding.provider.testSuccess') };
  }
  return { ok: false, text: t('onboarding.provider.testFailed') };
}

// ── Save provider ──

interface SaveProviderParams {
  hanaFetch: HanaFetch;
  providerName: string;
  providerUrl: string;
  apiKey: string;
  providerApi: string;
}

export async function saveProvider({ hanaFetch, providerName, providerUrl, apiKey, providerApi }: SaveProviderParams): Promise<void> {
  await hanaFetch(`/api/agents/${AGENT_ID}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api: { provider: providerName },
      providers: {
        [providerName]: {
          base_url: providerUrl,
          api_key: apiKey,
          api: providerApi,
        },
      },
    }),
  });
}

// ── Load models ──

interface LoadModelsParams {
  hanaFetch: HanaFetch;
  providerName: string;
  providerUrl: string;
  providerApi: string;
  apiKey: string;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  context?: number | null;
  maxOutput?: number | null;
}

export interface LoadModelsResult {
  models: DiscoveredModel[];
  error?: string;
}

export async function loadModels({ hanaFetch, providerName, providerUrl, providerApi, apiKey }: LoadModelsParams): Promise<LoadModelsResult> {
  const res = await hanaFetch('/api/providers/fetch-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: providerName,
      base_url: providerUrl,
      api: providerApi,
      api_key: apiKey,
    }),
  });
  const data = await res.json();
  if (data.error) {
    return { models: [], error: data.error };
  }
  return { models: data.models || [] };
}

// ── Save model + utility models ──

export interface AddedModelObject {
  id: string;
  name?: string;
  context?: number;
  maxOutput?: number;
  image?: boolean;
  reasoning?: boolean;
}

export type AddedModelEntry = string | AddedModelObject;

interface SaveModelParams {
  hanaFetch: HanaFetch;
  selectedModel: string;
  providerName: string;
  addedModels: AddedModelEntry[];
  selectedUtility: string;
  selectedUtilityLarge: string;
}

function compactModelEntry(entry: AddedModelEntry): AddedModelEntry {
  if (typeof entry === 'string') return entry;
  const next: AddedModelObject = { id: entry.id };
  const name = entry.name?.trim();
  if (name) next.name = name;
  if (typeof entry.context === 'number' && Number.isFinite(entry.context)) next.context = entry.context;
  if (typeof entry.maxOutput === 'number' && Number.isFinite(entry.maxOutput)) next.maxOutput = entry.maxOutput;
  if (typeof entry.image === 'boolean') next.image = entry.image;
  if (typeof entry.reasoning === 'boolean') next.reasoning = entry.reasoning;
  return Object.keys(next).length === 1 ? next.id : next;
}

export async function saveModel({ hanaFetch, selectedModel, providerName, addedModels, selectedUtility, selectedUtilityLarge }: SaveModelParams): Promise<void> {
  // Save chat model
  await hanaFetch(`/api/agents/${AGENT_ID}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ models: { chat: { id: selectedModel, provider: providerName } } }),
  });

  // Save only the user's explicit Added Models selection to provider.
  const modelEntries = addedModels.map(compactModelEntry);
  await hanaFetch(`/api/agents/${AGENT_ID}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providers: { [providerName]: { models: modelEntries } },
    }),
  });

  // Save utility models to global preferences
  if (selectedUtility || selectedUtilityLarge) {
    const utilityModels: Record<string, { id: string; provider: string }> = {};
    if (selectedUtility) utilityModels.utility = { id: selectedUtility, provider: providerName };
    if (selectedUtilityLarge) utilityModels.utility_large = { id: selectedUtilityLarge, provider: providerName };
    await hanaFetch('/api/preferences/models', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: utilityModels }),
    });
  }
}

// ── Save locale ──

export async function saveLocale(hanaFetch: HanaFetch, locale: string): Promise<void> {
  await hanaFetch(`/api/agents/${AGENT_ID}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale }),
  });
}

// ── Save user name ──

export async function saveUserName(hanaFetch: HanaFetch, name: string): Promise<void> {
  await hanaFetch(`/api/agents/${AGENT_ID}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: { name } }),
  });
}

// ── Workspace ──

export async function loadDefaultWorkspace(hanaFetch: HanaFetch): Promise<string> {
  const res = await hanaFetch('/api/config/default-workspace');
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.path || '';
}

async function ensureDefaultWorkspace(hanaFetch: HanaFetch): Promise<string> {
  const res = await hanaFetch('/api/config/default-workspace', { method: 'POST' });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.path || '';
}

interface SaveWorkspaceParams {
  hanaFetch: HanaFetch;
  workspacePath: string;
  defaultPath: string;
}

export async function saveWorkspace({ hanaFetch, workspacePath, defaultPath }: SaveWorkspaceParams): Promise<void> {
  const selected = workspacePath.trim();
  if (!selected) throw new Error('workspacePath is required');

  if (selected === defaultPath) {
    await ensureDefaultWorkspace(hanaFetch);
  }

  await hanaFetch(`/api/agents/${AGENT_ID}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      desk: {
        home_folder: selected,
        heartbeat_enabled: false,
        heartbeat_interval: DEFAULT_HEARTBEAT_INTERVAL_MINUTES,
      },
    }),
  });
}
