const OFFICIAL_DEEPSEEK_PROVIDER_ID = "deepseek";
const OFFICIAL_DEEPSEEK_HOST = "api.deepseek.com";
const OFFICIAL_DEEPSEEK_RESERVED_MODEL_IDS = new Set(["deepseek"]);

function modelIdOf(modelEntry) {
  if (typeof modelEntry === "object" && modelEntry !== null) {
    return typeof modelEntry.id === "string" ? modelEntry.id : "";
  }
  return typeof modelEntry === "string" ? modelEntry : "";
}

function normalizedModelId(modelEntry) {
  return modelIdOf(modelEntry).trim().toLowerCase();
}

function hostnameOf(baseUrl = "") {
  if (!baseUrl || typeof baseUrl !== "string") return "";
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return baseUrl.toLowerCase();
  }
}

function isOfficialDeepSeekProvider(providerId, baseUrl = "") {
  const normalizedProvider = typeof providerId === "string" ? providerId.trim().toLowerCase() : "";
  if (normalizedProvider === OFFICIAL_DEEPSEEK_PROVIDER_ID) return true;
  return hostnameOf(baseUrl) === OFFICIAL_DEEPSEEK_HOST;
}

function isReservedOfficialDeepSeekModelId(providerId, modelEntry, options = {}) {
  if (!isOfficialDeepSeekProvider(providerId, options.baseUrl)) return false;
  return OFFICIAL_DEEPSEEK_RESERVED_MODEL_IDS.has(normalizedModelId(modelEntry));
}

export class ProviderModelValidationError extends Error {
  constructor(providerId, modelId) {
    super(
      `Invalid model id "${modelId}" for provider "${providerId}": ` +
      `"${modelId}" is a provider id, not a model id. Use a concrete model id such as deepseek-v4-pro or deepseek-v4-flash.`,
    );
    this.name = "ProviderModelValidationError";
    this.code = "INVALID_PROVIDER_MODEL_ID";
    this.statusCode = 400;
  }
}

export function getInvalidProviderModelIds(providerId, models, options = {}) {
  if (!Array.isArray(models)) return [];
  const invalid = [];
  for (const modelEntry of models) {
    if (!isReservedOfficialDeepSeekModelId(providerId, modelEntry, options)) continue;
    const id = modelIdOf(modelEntry).trim();
    if (id && !invalid.includes(id)) invalid.push(id);
  }
  return invalid;
}

export function validateProviderModels(providerId, models, options = {}) {
  const invalid = getInvalidProviderModelIds(providerId, models, options);
  if (invalid.length === 0) return;
  throw new ProviderModelValidationError(providerId, invalid[0]);
}

export function filterDiscoveredProviderModels(providerId, models, options = {}) {
  if (!Array.isArray(models)) return { models: [], ignoredModels: [] };
  const filtered = [];
  const ignoredModels = [];
  for (const model of models) {
    if (isReservedOfficialDeepSeekModelId(providerId, model, options)) {
      const id = modelIdOf(model).trim();
      if (id && !ignoredModels.includes(id)) ignoredModels.push(id);
      continue;
    }
    filtered.push(model);
  }
  return { models: filtered, ignoredModels };
}
