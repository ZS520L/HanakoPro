export const MAX_WAIT_SECONDS = 300;

export function normalizeWaitSeconds(value) {
  const seconds = Math.round(Number(value));
  if (!Number.isFinite(seconds)) return 1;
  return Math.min(Math.max(seconds, 1), MAX_WAIT_SECONDS);
}

export function waitTimingDetails(value, startedAt = Date.now()) {
  const seconds = normalizeWaitSeconds(value);
  return {
    seconds,
    startedAt,
    durationMs: seconds * 1000,
  };
}
