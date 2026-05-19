import { describe, expect, it, vi } from "vitest";

import { toCompactionLifecycleWsMessage } from "../server/routes/chat.js";

describe("chat route compaction lifecycle messages", () => {
  it("normalizes SDK compaction_start into the frontend protocol", () => {
    expect(toCompactionLifecycleWsMessage(
      { type: "compaction_start", reason: "threshold" },
      "/session/a.jsonl",
      () => null,
    )).toEqual({
      type: "compaction_start",
      sessionPath: "/session/a.jsonl",
      reason: "threshold",
    });
  });

  it("normalizes SDK compaction_end and reads usage from the session", () => {
    const getSessionByPath = vi.fn(() => ({
      getContextUsage: () => ({ tokens: null, contextWindow: 200_000, percent: null }),
    }));

    expect(toCompactionLifecycleWsMessage(
      { type: "compaction_end", reason: "manual", aborted: false, willRetry: false },
      "/session/a.jsonl",
      getSessionByPath,
    )).toEqual({
      type: "compaction_end",
      sessionPath: "/session/a.jsonl",
      reason: "manual",
      aborted: false,
      willRetry: false,
      tokens: null,
      contextWindow: 200_000,
      percent: null,
    });
    expect(getSessionByPath).toHaveBeenCalledWith("/session/a.jsonl");
  });

  it("ignores non-compaction events", () => {
    expect(toCompactionLifecycleWsMessage(
      { type: "turn_end" },
      "/session/a.jsonl",
      () => null,
    )).toBeNull();
  });
});
