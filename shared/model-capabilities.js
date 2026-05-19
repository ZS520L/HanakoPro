function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function getApi(model, context = {}) {
  return lower(model?.api || context.api);
}

function getProvider(model, context = {}) {
  return lower(model?.provider || context.provider);
}

function getBaseUrl(model, context = {}) {
  return lower(model?.baseUrl || model?.base_url || context.baseUrl || context.base_url);
}

function getBaseHost(model, context = {}) {
  const raw = model?.baseUrl || model?.base_url || context.baseUrl || context.base_url;
  if (typeof raw !== "string" || raw.length === 0) return "";
  const text = raw.trim();
  try {
    return new URL(text).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`https://${text}`).hostname.toLowerCase();
    } catch {
      return lower(text).split(/[/?#]/)[0].replace(/:\d+$/, "");
    }
  }
}

function getModelId(model, context = {}) {
  return lower(model?.id || context.id || context.modelId || context.model);
}

function getModelText(model, context = {}) {
  return [
    model?.id,
    model?.name,
    model?.model,
    model?.modelId,
    context.id,
    context.name,
    context.model,
    context.modelId,
  ].map(lower).filter(Boolean).join(" ");
}

function normalizeBoolean(value) {
  return value === true;
}

function isOfficialDeepSeekEndpoint(model, context = {}) {
  return getProvider(model, context) === "deepseek"
    || getBaseUrl(model, context).includes("api.deepseek.com");
}

const OFFICIAL_MIMO_PROVIDERS = new Set([
  "mimo",
  "xiaomi",
  "xiaomi-token",
  "xiaomi-token-plan-cn",
  "xiaomi-token-plan-sgp",
  "xiaomi-token-plan-cn-ams",
  "xiaomi-token-plan-sgp-ams",
]);

export function isOfficialMimoEndpoint(model, context = {}) {
  const provider = getProvider(model, context);
  if (OFFICIAL_MIMO_PROVIDERS.has(provider)) return true;

  const host = getBaseHost(model, context);
  return host === "xiaomimimo.com" || host.endsWith(".xiaomimimo.com");
}

function isDeepSeekV4ModelId(id) {
  return id === "deepseek-v4" || id.startsWith("deepseek-v4-") || id.startsWith("deepseek-v4.");
}

function isDeepSeekThinkingModelId(id) {
  return id === "deepseek-reasoner" || isDeepSeekV4ModelId(id);
}

export function isDeepSeekFamilyModel(model, context = {}) {
  if (!isPlainObject(model)) return false;
  const provider = getProvider(model, context);
  const baseUrl = getBaseUrl(model, context);
  const text = getModelText(model, context);
  return provider === "deepseek"
    || provider.includes("deepseek")
    || baseUrl.includes("api.deepseek.com")
    || text.includes("deepseek-ai/")
    || text.includes("deepseek/")
    || text.includes("deepseek-");
}

export function isDeepSeekReasoningModel(model, context = {}) {
  if (!isDeepSeekFamilyModel(model, context)) return false;
  if (model.reasoning === true) return true;
  if (getThinkingFormat(model, context) || getReasoningProfile(model, context)) return true;

  const text = getModelText(model, context);
  return text.includes("deepseek-reasoner")
    || text.includes("deepseek-r1")
    || text.includes("deepseek-v4");
}

/**
 * Resolve the request-side thinking control format declared by a model.
 *
 * Precedence:
 *   1. Explicit model.compat.thinkingFormat
 *   2. Protocol quirks projected from known-models.json
 *   3. Legacy/runtime derivation for pre-existing models.json entries
 */
export function getThinkingFormat(model, context = {}) {
  if (!isPlainObject(model)) return null;

  const explicit = lower(model.compat?.thinkingFormat);
  if (explicit) return explicit;

  const quirks = Array.isArray(model.quirks) ? model.quirks : [];
  if (quirks.includes("enable_thinking")) return "qwen";

  const api = getApi(model, context);
  const provider = getProvider(model, context);
  const modelId = getModelId(model, context);

  // New models.json entries should carry compat.thinkingFormat. This branch keeps
  // already-projected runtime model objects working until the next provider sync.
  if (model.reasoning === true && api === "anthropic-messages") {
    return "anthropic";
  }

  // Built-in Anthropic models may arrive without Hana's projected compat object.
  if (provider === "anthropic" && model.reasoning !== false) {
    return "anthropic";
  }

  if (
    isOfficialDeepSeekEndpoint(model, context)
    && (model.reasoning === true || isDeepSeekThinkingModelId(modelId))
  ) {
    return "deepseek";
  }

  if (isOfficialMimoEndpoint(model, context) && model.reasoning === true) {
    return "qwen-chat-template";
  }

  return null;
}

/**
 * Resolve the narrower provider/model reasoning profile.
 *
 * thinkingFormat answers "what wire family does the request body use";
 * reasoningProfile answers "which provider-specific effort/replay contract
 * applies inside that wire family".
 */
export function getReasoningProfile(model, context = {}) {
  if (!isPlainObject(model)) return null;

  const explicit = lower(model.compat?.reasoningProfile || model.compat?.thinkingProfile);
  if (explicit) return explicit;

  if (isOfficialMimoEndpoint(model, context) && model.reasoning === true) {
    const api = getApi(model, context);
    if (api === "openai-completions" || api === "openai-responses" || api === "") {
      return "mimo-openai";
    }
  }

  if (!isOfficialDeepSeekEndpoint(model, context)) return null;

  const modelId = getModelId(model, context);
  if (!isDeepSeekV4ModelId(modelId)) return null;

  const api = getApi(model, context);
  if (api === "anthropic-messages") return "deepseek-v4-anthropic";
  if (api === "openai-completions" || api === "openai-responses" || api === "") {
    return "deepseek-v4-openai";
  }

  return null;
}

export function withThinkingFormatCompat(model, context = {}) {
  if (!isPlainObject(model)) return model;

  const format = getThinkingFormat(model, context);
  const profile = getReasoningProfile(model, context);
  if (!format && !profile) return model;

  const compat = isPlainObject(model.compat) ? model.compat : {};
  if (
    (!format || lower(compat.thinkingFormat) === format)
    && (!profile || lower(compat.reasoningProfile) === profile)
  ) {
    return model;
  }

  return {
    ...model,
    compat: {
      ...compat,
      ...(format ? { thinkingFormat: format } : {}),
      ...(profile ? { reasoningProfile: profile } : {}),
    },
  };
}

export function modelSupportsVideoInput(model) {
  if (!isPlainObject(model)) return false;
  if (model.video === true) return true;
  if (model.compat?.hanaVideoInput === true) return true;

  // Legacy runtime objects created before Pi SDK tightened models.json input
  // validation may still carry video in input. Read it for compatibility, but
  // model-sync/migrations must not write it back to Pi-facing JSON.
  return Array.isArray(model.input) && model.input.includes("video");
}

export const MODEL_VIDEO_TRANSPORTS = Object.freeze({
  NONE: "none",
  GEMINI_INLINE_DATA: "gemini-inline-data",
  OPENAI_VIDEO_URL: "openai-video-url",
  UNSUPPORTED: "unsupported",
});

export function resolveModelVideoInputTransport(model, context = {}) {
  if (!modelSupportsVideoInput(model)) return MODEL_VIDEO_TRANSPORTS.NONE;

  const api = getApi(model, context);
  if (api === "google-generative-ai") {
    return MODEL_VIDEO_TRANSPORTS.GEMINI_INLINE_DATA;
  }

  if (api === "openai-completions" && usesOpenAiVideoUrlTransport(model, context)) {
    return MODEL_VIDEO_TRANSPORTS.OPENAI_VIDEO_URL;
  }

  return MODEL_VIDEO_TRANSPORTS.UNSUPPORTED;
}

export function modelSupportsDirectVideoInput(model, context = {}) {
  const transport = resolveModelVideoInputTransport(model, context);
  return transport === MODEL_VIDEO_TRANSPORTS.GEMINI_INLINE_DATA
    || transport === MODEL_VIDEO_TRANSPORTS.OPENAI_VIDEO_URL;
}

function usesOpenAiVideoUrlTransport(model, context = {}) {
  return isDashScopeEndpoint(model, context) || isMoonshotEndpoint(model, context);
}

function isDashScopeEndpoint(model, context = {}) {
  const provider = getProvider(model, context);
  const baseUrl = getBaseUrl(model, context);
  return provider === "dashscope"
    || provider === "dashscope-coding"
    || baseUrl.includes("dashscope");
}

function isMoonshotEndpoint(model, context = {}) {
  const provider = getProvider(model, context);
  const baseUrl = getBaseUrl(model, context);
  return provider === "moonshot"
    || provider === "kimi"
    || baseUrl.includes("moonshot.cn")
    || baseUrl.includes("moonshot.ai");
}

export function withHanaVideoInputCompat(model, enabled) {
  if (!isPlainObject(model) || enabled !== true) return model;

  const compat = isPlainObject(model.compat) ? model.compat : {};
  if (compat.hanaVideoInput === true) return model;

  return {
    ...model,
    compat: {
      ...compat,
      hanaVideoInput: true,
    },
  };
}

/**
 * Resolve stable visual grounding capabilities for an auxiliary vision model.
 *
 * This deliberately reads an explicit capability object instead of inferring
 * from provider or model name. Plain image support means the model can see;
 * grounding means we can ask for coordinates with a known coordinate contract.
 */
export function normalizeVisionCapabilities(value) {
  if (!isPlainObject(value)) return null;
  if (!normalizeBoolean(value.grounding) && !normalizeBoolean(value.visualGrounding)) return null;

  const coordinateSpace = value.coordinateSpace === undefined || value.coordinateSpace === "norm-1000"
    ? "norm-1000"
    : null;
  let boxOrder = null;
  if (value.boxOrder === undefined || value.boxOrder === "xyxy") boxOrder = "xyxy";
  if (value.boxOrder === "yxyx") boxOrder = "yxyx";
  const boxes = value.boxes === false ? false : true;
  const points = value.points === true;
  const outputFormat = ["gemini", "qwen", "anchor", "hanako"].includes(lower(value.outputFormat))
    ? lower(value.outputFormat)
    : "hanako";
  const groundingMode = ["native", "prompted"].includes(lower(value.groundingMode))
    ? lower(value.groundingMode)
    : "native";

  if (!coordinateSpace || !boxOrder) return null;
  if (!boxes && !points) return null;

  return {
    grounding: true,
    boxes,
    points,
    coordinateSpace,
    boxOrder,
    outputFormat,
    groundingMode,
  };
}

export function getVisionCapabilities(model) {
  if (!isPlainObject(model)) return null;
  return normalizeVisionCapabilities(model.visionCapabilities);
}

export function modelSupportsVisualGrounding(model) {
  return getVisionCapabilities(model)?.grounding === true;
}
