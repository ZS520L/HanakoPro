import { describe, expect, it } from "vitest";
import {
  buildFreshCompactMetaPatch,
  buildFreshCompactSnapshot,
  getFreshCompactDate,
  shouldRunFreshCompact,
} from "../lib/fresh-compact/policy.js";

describe("fresh compact policy", () => {
  it("uses the 4am logical day as the daily freshness bucket", () => {
    expect(getFreshCompactDate(new Date(2026, 4, 15, 3, 30))).toBe("2026-05-14");
    expect(getFreshCompactDate(new Date(2026, 4, 15, 4, 0))).toBe("2026-05-15");
  });

  it("requests daily fresh compact when the stored date is stale", () => {
    const snapshot = buildFreshCompactSnapshot({
      systemPrompt: "prompt v2",
      state: { memoryEnabled: true },
    });

    expect(shouldRunFreshCompact({
      meta: {
        lastFreshCompactDate: "2026-05-14",
        freshCompactPromptHash: snapshot.promptHash,
        freshCompactStateHash: snapshot.stateHash,
      },
      snapshot,
      now: new Date("2026-05-15T09:00:00"),
    })).toEqual({ run: true, reason: "daily" });
  });

  it("does not treat phone lastRefreshedDate as a fresh-compact completion marker", () => {
    expect(shouldRunFreshCompact({
      meta: { lastRefreshedDate: "2026-05-15" },
      now: new Date(2026, 4, 15, 9, 0),
    })).toEqual({ run: true, reason: "daily" });
  });

  it("does not spend extra automatic compactions when prompt or state changes within the same day", () => {
    const oldSnapshot = buildFreshCompactSnapshot({
      systemPrompt: "prompt v1",
      state: { memoryEnabled: true },
    });
    const newPromptSnapshot = buildFreshCompactSnapshot({
      systemPrompt: "prompt v2",
      state: { memoryEnabled: true },
    });
    const newStateSnapshot = buildFreshCompactSnapshot({
      systemPrompt: "prompt v1",
      state: { memoryEnabled: false },
    });

    expect(shouldRunFreshCompact({
      meta: {
        lastFreshCompactDate: "2026-05-15",
        freshCompactPromptHash: oldSnapshot.promptHash,
        freshCompactStateHash: oldSnapshot.stateHash,
      },
      snapshot: newPromptSnapshot,
      now: new Date("2026-05-15T09:00:00"),
    })).toEqual({ run: false, reason: null });

    expect(shouldRunFreshCompact({
      meta: {
        lastFreshCompactDate: "2026-05-15",
        freshCompactPromptHash: oldSnapshot.promptHash,
        freshCompactStateHash: oldSnapshot.stateHash,
      },
      snapshot: newStateSnapshot,
      now: new Date("2026-05-15T09:00:00"),
    })).toEqual({ run: false, reason: null });
  });

  it("does not request fresh compact when date, prompt, and state are current", () => {
    const snapshot = buildFreshCompactSnapshot({
      systemPrompt: "prompt",
      state: { model: "openai/gpt-4o" },
    });

    expect(shouldRunFreshCompact({
      meta: {
        lastFreshCompactDate: "2026-05-15",
        freshCompactPromptHash: snapshot.promptHash,
        freshCompactStateHash: snapshot.stateHash,
      },
      snapshot,
      now: new Date("2026-05-15T09:00:00"),
    })).toEqual({ run: false, reason: null });
  });

  it("builds a flat metadata patch suitable for bridge index and phone projection stores", () => {
    const snapshot = buildFreshCompactSnapshot({
      systemPrompt: "prompt",
      state: { toolMode: "read_only" },
    });

    expect(buildFreshCompactMetaPatch({
      snapshot,
      reason: "manual",
      now: new Date("2026-05-15T09:00:00.000Z"),
      usage: { tokensBefore: 1000, tokensAfter: 400, contextWindow: 128000 },
    })).toEqual({
      lastFreshCompactDate: "2026-05-15",
      lastFreshCompactedAt: "2026-05-15T09:00:00.000Z",
      freshCompactPromptHash: snapshot.promptHash,
      freshCompactStateHash: snapshot.stateHash,
      freshCompactReason: "manual",
      freshCompactTokensBefore: 1000,
      freshCompactTokensAfter: 400,
      freshCompactContextWindow: 128000,
    });
  });
});
