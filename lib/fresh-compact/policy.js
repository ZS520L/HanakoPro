import crypto from "crypto";
import { getLogicalDay } from "../time-utils.js";

export function getFreshCompactDate(now = new Date()) {
  return getLogicalDay(now).logicalDate;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  ).join(",")}}`;
}

export function hashFreshCompactValue(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : stableStringify(value))
    .digest("hex");
}

export function buildFreshCompactSnapshot({ systemPrompt = "", state = {} } = {}) {
  return {
    promptHash: hashFreshCompactValue(String(systemPrompt || "")),
    stateHash: hashFreshCompactValue(state || {}),
  };
}

function getStoredFreshMeta(meta = {}) {
  const nested = meta?.freshCompact && typeof meta.freshCompact === "object"
    ? meta.freshCompact
    : null;
  return nested || meta || {};
}

export function shouldRunFreshCompact({ meta = {}, now = new Date(), force = false } = {}) {
  if (force) return { run: true, reason: "manual" };
  const stored = getStoredFreshMeta(meta);
  const today = getFreshCompactDate(now);
  const lastDate = stored.lastFreshCompactDate || null;
  if (lastDate !== today) return { run: true, reason: "daily" };
  return { run: false, reason: null };
}

export function buildFreshCompactMetaPatch({
  snapshot,
  reason,
  now = new Date(),
  usage = {},
} = {}) {
  const date = now instanceof Date ? now : new Date(now);
  return {
    lastFreshCompactDate: getFreshCompactDate(date),
    lastFreshCompactedAt: date.toISOString(),
    freshCompactPromptHash: snapshot?.promptHash || null,
    freshCompactStateHash: snapshot?.stateHash || null,
    freshCompactReason: reason || "manual",
    freshCompactTokensBefore: usage?.tokensBefore ?? null,
    freshCompactTokensAfter: usage?.tokensAfter ?? null,
    freshCompactContextWindow: usage?.contextWindow ?? null,
  };
}
