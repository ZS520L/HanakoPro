import { DAY_BOUNDARY_HOUR } from "../time-utils.js";

export const DEFAULT_FRESH_COMPACT_IDLE_DELAY_MS = 60_000;
export const DEFAULT_FRESH_COMPACT_BOUNDARY_OFFSET_MS = 5 * 60 * 1000;
export const DEFAULT_FRESH_COMPACT_RETRY_DELAY_MS = 60 * 60 * 1000;

function asDate(now) {
  return now instanceof Date ? now : new Date(now);
}

function nextBoundaryWithOffset(now, boundaryOffsetMs) {
  const date = asDate(now);
  const boundary = new Date(date);
  boundary.setHours(DAY_BOUNDARY_HOUR, 0, 0, 0);
  const runAt = new Date(boundary.getTime() + boundaryOffsetMs);
  if (date < runAt) return runAt;
  const tomorrow = new Date(boundary);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return new Date(tomorrow.getTime() + boundaryOffsetMs);
}

export function getNextFreshCompactDelayMs(now = new Date(), opts = {}) {
  const date = asDate(now);
  const idleDelayMs = opts.idleDelayMs ?? DEFAULT_FRESH_COMPACT_IDLE_DELAY_MS;
  const boundaryOffsetMs = opts.boundaryOffsetMs ?? DEFAULT_FRESH_COMPACT_BOUNDARY_OFFSET_MS;
  const boundary = new Date(date);
  boundary.setHours(DAY_BOUNDARY_HOUR, 0, 0, 0);
  const earliest = new Date(boundary.getTime() + boundaryOffsetMs);
  if (date < earliest) return Math.max(0, earliest.getTime() - date.getTime());
  return Math.max(0, idleDelayMs);
}

export function createFreshCompactDailyScheduler({
  runDaily,
  getNow = () => new Date(),
  idleDelayMs = DEFAULT_FRESH_COMPACT_IDLE_DELAY_MS,
  boundaryOffsetMs = DEFAULT_FRESH_COMPACT_BOUNDARY_OFFSET_MS,
  retryDelayMs = DEFAULT_FRESH_COMPACT_RETRY_DELAY_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  warn = (msg) => console.warn(msg),
} = {}) {
  if (typeof runDaily !== "function") {
    throw new Error("fresh compact scheduler requires runDaily");
  }

  let timer = null;
  let stopped = true;
  let running = false;

  const clear = () => {
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  };

  const schedule = (delayMs) => {
    if (stopped) return;
    clear();
    timer = setTimer(() => {
      timer = null;
      void fire();
    }, Math.max(0, delayMs));
    timer?.unref?.();
  };

  const scheduleNextBoundary = () => {
    const now = getNow();
    const nextRunAt = nextBoundaryWithOffset(now, boundaryOffsetMs);
    schedule(nextRunAt.getTime() - asDate(now).getTime());
  };

  async function fire() {
    if (stopped) return;
    if (running) {
      schedule(retryDelayMs);
      return;
    }
    running = true;
    try {
      const now = getNow();
      const result = await runDaily({ now });
      if (result?.staleRemaining > 0 || result?.retry === true) {
        schedule(retryDelayMs);
      } else {
        scheduleNextBoundary();
      }
    } catch (err) {
      warn?.(`[fresh-compact] daily scheduler failed: ${err?.message || err}`);
      schedule(retryDelayMs);
    } finally {
      running = false;
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      schedule(getNextFreshCompactDelayMs(getNow(), { idleDelayMs, boundaryOffsetMs }));
    },
    stop() {
      stopped = true;
      clear();
    },
    triggerNow() {
      if (stopped) return;
      clear();
      schedule(0);
    },
  };
}
