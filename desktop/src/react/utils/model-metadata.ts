import knownModelFallbacks from '../../../../lib/known-model-fallbacks.json';
import knownModels from '../../../../lib/known-models.json';

export interface ModelReferenceMeta {
  name?: string;
  displayName?: string;
  context?: number;
  maxOutput?: number;
  image?: boolean;
  vision?: boolean;
  video?: boolean;
  reasoning?: boolean;
  xhigh?: boolean;
  _source?: 'reference';
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeMeta(value: unknown): ModelReferenceMeta | null {
  if (!isRecord(value)) return null;
  return { ...value, _source: 'reference' } as ModelReferenceMeta;
}

export function lookupReferenceModelMeta(modelId: string, provider?: string): ModelReferenceMeta | null {
  if (!modelId) return null;
  const dict = knownModels as Record<string, unknown>;
  const fallbacks = knownModelFallbacks as Record<string, unknown>;
  const bare = modelId.includes('/') ? modelId.split('/').pop() || '' : '';

  if (provider) {
    const providerModels = dict[provider];
    if (isRecord(providerModels)) {
      const exact = normalizeMeta(providerModels[modelId]);
      if (exact) return exact;
      if (bare) {
        const bareHit = normalizeMeta(providerModels[bare]);
        if (bareHit) return bareHit;
      }
    }
  }

  const fallback = normalizeMeta(fallbacks[modelId]);
  if (fallback) return fallback;
  if (bare) {
    const bareFallback = normalizeMeta(fallbacks[bare]);
    if (bareFallback) return bareFallback;
  }

  for (const [key, value] of Object.entries(dict)) {
    if (key === '_comment' || !isRecord(value)) continue;
    const hit = normalizeMeta(value[modelId]);
    if (hit) return hit;
    if (bare) {
      const bareHit = normalizeMeta(value[bare]);
      if (bareHit) return bareHit;
    }
  }
  return null;
}
