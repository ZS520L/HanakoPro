import { lookupKnown } from "../shared/known-models.js";

const VALID_THINKING_LEVELS = new Set(["off", "auto", "low", "medium", "high", "xhigh"]);

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function normalizeSessionThinkingLevel(level) {
  return VALID_THINKING_LEVELS.has(level) ? level : "auto";
}

export function modelSupportsXhigh(model) {
  const id = lower(model?.id);
  const known = lookupKnown(model?.provider, model?.id);
  return model?.xhigh === true
    || known?.xhigh === true
    || id.includes("gpt-5.2")
    || id.includes("gpt-5.3")
    || id.includes("gpt-5.4")
    || id.includes("opus-4-6")
    || id.includes("opus-4.6");
}

export function normalizeThinkingLevelForModel(level, model) {
  const normalized = normalizeSessionThinkingLevel(level);
  if (normalized === "xhigh" && !modelSupportsXhigh(model)) return "high";
  return normalized;
}

export function resolveThinkingLevelForModel(level, model, resolveThinkingLevel = (value) => value) {
  return resolveThinkingLevel(normalizeThinkingLevelForModel(level, model));
}
