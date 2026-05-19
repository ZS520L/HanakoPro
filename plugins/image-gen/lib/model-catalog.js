/**
 * plugins/image-gen/lib/model-catalog.js
 *
 * Single source of truth for all image-generation model catalogs.
 * Adapters use resolveModelId() for short-name → full-ID resolution.
 * Routes use getKnownModels() for provider summary and settings UI.
 *
 * Adding a new model: append one entry to the relevant provider array.
 * Everything else (adapter fallback, settings UI, tool description) picks it up automatically.
 */

/**
 * @typedef {{ id: string, name: string, aliases?: string[] }} ModelEntry
 */

/** @type {Record<string, ModelEntry[]>} */
export const MODEL_CATALOG = {
  volcengine: [
    { id: "doubao-seedream-3-0-t2i", name: "Seedream 3.0", aliases: ["3.0"] },
    { id: "doubao-seedream-4-0-250828", name: "Seedream 4.0", aliases: ["4.0"] },
    { id: "doubao-seedream-4-5-251128", name: "Seedream 4.5", aliases: ["4.5"] },
    { id: "doubao-seedream-5-0-lite-260128", name: "Seedream 5.0 Lite", aliases: ["5.0", "5.0-lite"] },
  ],
  openai: [
    { id: "gpt-image-2", name: "GPT Image 2", aliases: ["2"] },
    { id: "gpt-image-1", name: "GPT Image 1", aliases: ["1"] },
    { id: "gpt-image-1.5", name: "GPT Image 1.5", aliases: ["1.5"] },
    { id: "gpt-image-1-mini", name: "GPT Image 1 Mini", aliases: ["1-mini", "mini"] },
    { id: "dall-e-3", name: "DALL-E 3", aliases: ["dalle3", "dall-e-3"] },
  ],
  "openai-codex-oauth": [
    { id: "gpt-image-2", name: "GPT Image 2", aliases: ["2"] },
  ],
};

/**
 * Resolve a raw model identifier to a valid API model ID.
 *
 * Resolution order:
 *   1. Exact match on id (already a full ID)
 *   2. Alias match (short name like "5.0")
 *   3. Fallback to the last entry in the catalog (latest model)
 *
 * @param {string} provider   Provider key in MODEL_CATALOG
 * @param {string | undefined | null} raw  Raw model string from user/config
 * @returns {string} Resolved model ID guaranteed to be in the catalog
 */
export function resolveModelId(provider, raw) {
  const catalog = MODEL_CATALOG[provider];
  if (!catalog?.length) return raw || "";

  if (raw) {
    // 1. Exact ID match
    const byId = catalog.find(m => m.id === raw);
    if (byId) return byId.id;

    // 2. Alias match (case-insensitive)
    const lower = raw.toLowerCase();
    for (const entry of catalog) {
      if (entry.aliases?.some(a => a.toLowerCase() === lower)) {
        return entry.id;
      }
    }
  }

  // 3. Fallback: last entry (latest/default model)
  return catalog[catalog.length - 1].id;
}

/**
 * Get the known models list for a provider, formatted for settings UI.
 * Returns [{id, name}] without aliases (aliases are an adapter concern).
 *
 * @param {string} provider
 * @returns {{ id: string, name: string }[]}
 */
export function getKnownModels(provider) {
  const catalog = MODEL_CATALOG[provider];
  if (!catalog) return [];
  return catalog.map(({ id, name }) => ({ id, name }));
}

/**
 * Get the default (latest) model ID for a provider.
 *
 * @param {string} provider
 * @returns {string | null}
 */
export function getDefaultModelId(provider) {
  const catalog = MODEL_CATALOG[provider];
  if (!catalog?.length) return null;
  return catalog[catalog.length - 1].id;
}
