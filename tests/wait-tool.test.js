import { afterEach, describe, expect, it, vi } from "vitest";

import { createWaitTool } from "../lib/tools/wait-tool.js";

describe("wait tool", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns normalized wait timing details", async () => {
    vi.useFakeTimers();
    const tool = createWaitTool();
    const resultPromise = tool.execute("call_1", { seconds: 301.2 });

    await vi.advanceTimersByTimeAsync(300_000);

    await expect(resultPromise).resolves.toEqual({
      content: [{ type: "text", text: "300s" }],
      details: { seconds: 300, durationMs: 300_000 },
    });
  });
});
