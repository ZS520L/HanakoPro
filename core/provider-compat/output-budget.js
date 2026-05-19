/**
 * Generic output budget normalization.
 *
 * This module only handles provider-independent request policy. Provider wire
 * details stay in provider-compat/<provider>.js modules.
 */

const SDK_IMPLICIT_MAX_TOKENS_CAP = 32000;
const OUTPUT_CAP_FIELDS = [
  "max_completion_tokens",
  "max_tokens",
  "max_output_tokens",
  "maxOutputTokens",
];

const DEFAULT_OUTPUT_CAP_CAPABILITY = Object.freeze({
  id: "default-optional",
  required: false,
  preserveImplicitSdkDefault: false,
});
const OUTPUT_BUDGET_SOURCE_UNSPECIFIED = "unspecified";
const PRESERVED_OUTPUT_BUDGET_SOURCES = new Set(["user", "system"]);

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function positiveInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function getModelOutputLimit(model) {
  return positiveInteger(model?.maxTokens || model?.maxOutput);
}

function isOfficialDeepSeekEndpoint(model) {
  const provider = lower(model?.provider);
  const baseUrl = lower(model?.baseUrl || model?.base_url);
  return provider === "deepseek" || baseUrl.includes("api.deepseek.com");
}

const OUTPUT_CAP_CAPABILITIES = [
  {
    id: "explicit-required",
    required: true,
    preserveImplicitSdkDefault: true,
    matches: (model) => model?.compat?.outputCapRequired === true,
  },
  {
    id: "official-deepseek",
    required: false,
    preserveImplicitSdkDefault: true,
    matches: isOfficialDeepSeekEndpoint,
  },
  {
    id: "anthropic-native",
    required: true,
    preserveImplicitSdkDefault: true,
    matches: (model) => lower(model?.provider) === "anthropic"
      || lower(model?.baseUrl || model?.base_url).includes("api.anthropic.com"),
  },
  {
    id: "bedrock-native",
    required: true,
    preserveImplicitSdkDefault: true,
    matches: (model) => {
      const provider = lower(model?.provider);
      return provider === "amazon-bedrock" || provider === "bedrock";
    },
  },
  {
    id: "anthropic-messages",
    required: true,
    preserveImplicitSdkDefault: true,
    matches: (model) => lower(model?.api) === "anthropic-messages",
  },
];

export function resolveOutputCapCapability(model) {
  if (!model || typeof model !== "object") return DEFAULT_OUTPUT_CAP_CAPABILITY;
  return OUTPUT_CAP_CAPABILITIES.find((capability) => capability.matches(model))
    || DEFAULT_OUTPUT_CAP_CAPABILITY;
}

function isImplicitSdkOutputCap(value, model) {
  const modelLimit = getModelOutputLimit(model);
  if (!modelLimit) return false;
  return positiveInteger(value) === Math.min(modelLimit, SDK_IMPLICIT_MAX_TOKENS_CAP);
}

function resolveOutputBudgetSource(options = {}) {
  const outputBudgetSource = lower(options.outputBudgetSource);
  if (outputBudgetSource) return outputBudgetSource;
  const maxTokensSource = lower(options.maxTokensSource);
  if (maxTokensSource) return maxTokensSource;
  if (positiveInteger(options.userMaxTokens) !== null) return "user";
  return OUTPUT_BUDGET_SOURCE_UNSPECIFIED;
}

export function resolveOutputBudgetPolicy(model, options = {}) {
  const mode = options.mode || "chat";
  const source = resolveOutputBudgetSource(options);
  const capability = resolveOutputCapCapability(model);
  const preserveForSource = PRESERVED_OUTPUT_BUDGET_SOURCES.has(source);
  const removeImplicitSdkDefault = mode !== "utility"
    && !preserveForSource
    && !capability.required
    && !capability.preserveImplicitSdkDefault;

  return {
    mode,
    source,
    capability,
    preserveForSource,
    removeImplicitSdkDefault,
  };
}

/**
 * Remove Pi SDK's hidden default output cap from providers where the field is
 * optional. This preserves provider-native defaults while keeping required
 * providers and official DeepSeek thinking handling intact.
 */
export function normalizeImplicitOutputBudget(payload, model, options = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const policy = resolveOutputBudgetPolicy(model, options);
  if (!policy.removeImplicitSdkDefault) return payload;

  let next = payload;
  for (const field of OUTPUT_CAP_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(next, field)) continue;
    if (!isImplicitSdkOutputCap(next[field], model)) continue;
    if (next === payload) next = { ...payload };
    delete next[field];
  }

  return next;
}
