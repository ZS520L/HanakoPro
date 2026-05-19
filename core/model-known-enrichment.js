import { getPiModel } from "../lib/pi-sdk/index.js";
import { lookupKnown } from "../shared/known-models.js";
import { normalizeVisionCapabilities, withThinkingFormatCompat } from "../shared/model-capabilities.js";

const RUNTIME_ENRICHED_PROVIDERS = new Set(["kimi-coding"]);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function getPiBuiltinModel(provider, modelId) {
  if (!provider || !modelId) return null;
  try {
    return getPiModel(provider, modelId) || null;
  } catch {
    return null;
  }
}

function mergeCompat(model, known) {
  if (!known || model.provider === "openai") return model;
  return {
    ...model,
    compat: {
      supportsDeveloperRole: false,
      ...(isPlainObject(model.compat) ? model.compat : {}),
    },
  };
}

export function enrichModelFromKnownMetadata(model) {
  if (!isPlainObject(model)) return model;
  if (!RUNTIME_ENRICHED_PROVIDERS.has(model.provider)) return model;

  const known = lookupKnown(model.provider, model.id);
  const piBuiltin = getPiBuiltinModel(model.provider, model.id);
  const patch = {};

  if (!model.headers && piBuiltin?.headers) {
    patch.headers = { ...piBuiltin.headers };
  }

  const hasImageInput = Array.isArray(model.input) && model.input.includes("image");
  const knownImage = known?.image ?? known?.vision;
  const image = hasImageInput || knownImage === true;
  const visionCapabilities = image ? normalizeVisionCapabilities(known?.visionCapabilities) : null;
  if (visionCapabilities && !model.visionCapabilities) {
    patch.visionCapabilities = visionCapabilities;
  }

  const withPatch = Object.keys(patch).length > 0 ? { ...model, ...patch } : model;
  const withCompat = mergeCompat(withPatch, known);
  return withThinkingFormatCompat(withCompat, {
    provider: withCompat.provider,
    api: withCompat.api,
    baseUrl: withCompat.baseUrl,
    id: withCompat.id,
  });
}
