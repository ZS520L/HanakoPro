import { estimateTokens } from "../lib/pi-sdk/index.js";
import { lookupKnown } from "../shared/known-models.js";

const MOONSHOT_CALIBRATED_MODELS = new Set([
  "moonshot-v1-8k",
  "moonshot-v1-32k",
]);

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function usageTotal(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const total = finiteNumber(usage.totalTokens);
  if (total !== null && total > 0) return total;
  return Math.max(0,
    (finiteNumber(usage.input) ?? 0)
    + (finiteNumber(usage.output) ?? 0)
    + (finiteNumber(usage.cacheRead) ?? 0)
    + (finiteNumber(usage.cacheWrite) ?? 0)
  );
}

export function shouldCalibrateMoonshotContextUsage(model) {
  return model?.provider === "moonshot" && MOONSHOT_CALIBRATED_MODELS.has(model?.id);
}

export function estimateMessagesContextTokens(messages) {
  if (!Array.isArray(messages)) return null;
  return messages.reduce((sum, message) => sum + estimateTokens(message), 0);
}

export function estimateMoonshotPromptOverhead(messages) {
  if (!Array.isArray(messages)) return 0;

  let estimatedThroughMessage = 0;
  let overhead = 0;

  for (const message of messages) {
    estimatedThroughMessage += estimateTokens(message);
    if (message?.role !== "assistant" || !message.usage) continue;
    if (message.stopReason === "aborted" || message.stopReason === "error") continue;

    const providerTokens = usageTotal(message.usage);
    if (providerTokens <= 0) continue;
    overhead = Math.max(overhead, providerTokens - estimatedThroughMessage);
  }

  return Math.max(0, overhead);
}

export function estimateContextUsageTokens(messages, model) {
  const estimated = estimateMessagesContextTokens(messages);
  if (estimated == null) return null;
  if (!shouldCalibrateMoonshotContextUsage(model)) return estimated;
  return estimated + estimateMoonshotPromptOverhead(messages);
}

export function resolveContextUsageWindow(model, observedWindow = null) {
  const knownContext = finiteNumber(lookupKnown(model?.provider, model?.id)?.context);
  if (model?.provider === "moonshot" && knownContext !== null && knownContext > 0) {
    return knownContext;
  }
  const modelWindow = finiteNumber(model?.contextWindow);
  if (modelWindow !== null && modelWindow > 0) return modelWindow;
  const observed = finiteNumber(observedWindow);
  return observed !== null && observed > 0 ? observed : null;
}

export function getContextUsageMessages(session) {
  const direct = session?.agent?.state?.messages;
  const directMessages = Array.isArray(direct) ? direct : null;
  try {
    const contextMessages = session?.sessionManager?.buildSessionContext?.()?.messages;
    if (Array.isArray(contextMessages) && contextMessages.length > 0) {
      if (!directMessages || contextMessages.length >= directMessages.length) return contextMessages;
    }
  } catch {}
  return directMessages;
}

export function computeContextUsageSnapshot(session) {
  const usage = session?.getContextUsage?.();
  const contextWindow = resolveContextUsageWindow(session?.model, usage?.contextWindow);
  const estimatedTokens = estimateContextUsageTokens(getContextUsageMessages(session), session?.model);
  let tokens = finiteNumber(usage?.tokens);
  if (tokens === null || (tokens <= 0 && estimatedTokens !== null && estimatedTokens > 0)) {
    tokens = estimatedTokens;
  }
  const percent = tokens !== null && contextWindow ? (tokens / contextWindow) * 100 : null;
  return {
    tokens,
    contextWindow,
    percent,
  };
}
