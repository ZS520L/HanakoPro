import { describe, expect, it, vi } from "vitest";
import {
  createFreshCompactDailyScheduler,
  getNextFreshCompactDelayMs,
} from "../lib/fresh-compact/daily-scheduler.js";

describe("fresh compact daily scheduler", () => {
  it("waits until shortly after the 4am logical-day boundary", () => {
    expect(getNextFreshCompactDelayMs(new Date(2026, 4, 15, 3, 30), {
      idleDelayMs: 1_000,
      boundaryOffsetMs: 5 * 60 * 1_000,
    })).toBe(35 * 60 * 1_000);
  });

  it("runs soon when the app starts after the 4am boundary", () => {
    expect(getNextFreshCompactDelayMs(new Date(2026, 4, 15, 10, 0), {
      idleDelayMs: 1_000,
      boundaryOffsetMs: 5 * 60 * 1_000,
    })).toBe(1_000);
  });

  it("fires the daily runner from a timer without awaiting foreground work", async () => {
    vi.useFakeTimers();
    const runDaily = vi.fn(async () => ({ staleRemaining: 0 }));
    const scheduler = createFreshCompactDailyScheduler({
      runDaily,
      getNow: () => new Date(2026, 4, 15, 10, 0),
      idleDelayMs: 1_000,
      boundaryOffsetMs: 5 * 60 * 1_000,
      retryDelayMs: 60 * 60 * 1_000,
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(runDaily).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(runDaily).toHaveBeenCalledWith({ now: new Date(2026, 4, 15, 10, 0) });
    scheduler.stop();
    vi.useRealTimers();
  });
});
