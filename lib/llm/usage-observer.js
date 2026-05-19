import { debugLog } from "../debug-log.js";

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = numberOrNull(value);
    if (n !== null) return n;
  }
  return 0;
}

function maybeNumber(...values) {
  for (const value of values) {
    const n = numberOrNull(value);
    if (n !== null) return n;
  }
  return null;
}

function cacheCreationTokens(usage) {
  const direct = maybeNumber(usage?.cacheWrite, usage?.cacheWriteTokens, usage?.cache_creation_input_tokens);
  if (direct !== null) return direct;

  const creation = usage?.cache_creation;
  if (!creation || typeof creation !== "object") return 0;
  return firstNumber(creation.ephemeral_5m_input_tokens)
    + firstNumber(creation.ephemeral_1h_input_tokens);
}

function costTotalFromUsage(usage) {
  return maybeNumber(usage?.costTotal, usage?.cost?.total);
}

function costTotalFromRates(tokens, costRates) {
  if (!costRates || typeof costRates !== "object") return null;
  const input = firstNumber(costRates.input) * tokens.inputTokens / 1_000_000;
  const output = firstNumber(costRates.output) * tokens.outputTokens / 1_000_000;
  const cacheRead = firstNumber(costRates.cacheRead) * tokens.cacheReadTokens / 1_000_000;
  const cacheWrite = firstNumber(costRates.cacheWrite) * tokens.cacheWriteTokens / 1_000_000;
  const total = input + output + cacheRead + cacheWrite;
  return Number.isFinite(total) ? total : null;
}

/**
 * Normalize provider-specific usage payloads into the Pi SDK token vocabulary.
 *
 * Supported inputs:
 * - Pi SDK: { input, output, cacheRead, cacheWrite, totalTokens, cost }
 * - Anthropic: { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens }
 * - OpenAI-compatible: { prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details.cached_tokens }
 */
export function normalizeLlmUsage(usage, options = {}) {
  if (!usage || typeof usage !== "object") return null;

  const inputTokens = firstNumber(usage.input, usage.inputTokens, usage.input_tokens, usage.prompt_tokens);
  const outputTokens = firstNumber(usage.output, usage.outputTokens, usage.output_tokens, usage.completion_tokens);
  const cacheReadTokens = firstNumber(
    usage.cacheRead,
    usage.cacheReadTokens,
    usage.cache_read_input_tokens,
    usage.prompt_tokens_details?.cached_tokens,
    usage.input_tokens_details?.cached_tokens
  );
  const cacheWriteTokens = cacheCreationTokens(usage);
  const fallbackTotal = numberOrNull(usage.prompt_tokens) !== null || numberOrNull(usage.completion_tokens) !== null
    ? inputTokens + outputTokens
    : inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  const totalTokens = firstNumber(
    usage.totalTokens,
    usage.total_tokens,
    fallbackTotal
  );
  const tokens = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
  const explicitCost = costTotalFromUsage(usage);
  const costTotal = explicitCost !== null ? explicitCost : costTotalFromRates(tokens, options.costRates);

  return {
    ...tokens,
    costTotal,
    cacheHit: cacheReadTokens > 0,
    cacheCreated: cacheWriteTokens > 0,
  };
}

export function buildUsageDebugRecord({
  source,
  api = null,
  provider = null,
  modelId = null,
  usage,
  costRates = null,
} = {}) {
  const normalized = normalizeLlmUsage(usage, { costRates });
  if (!normalized) return null;

  return {
    source: source ?? null,
    api: api ?? null,
    provider: provider ?? null,
    modelId: modelId ?? null,
    ...normalized,
  };
}

export function logLlmUsage({
  logger = debugLog(),
  source,
  api = null,
  provider = null,
  modelId = null,
  usage,
  costRates = null,
} = {}) {
  const record = buildUsageDebugRecord({ source, api, provider, modelId, usage, costRates });
  if (!record || !logger || typeof logger.log !== "function") return record;

  try {
    logger.log("llm-usage", `model_usage ${JSON.stringify(record)}`);
  } catch {
    // Debug logging must never affect model calls.
  }

  return record;
}
