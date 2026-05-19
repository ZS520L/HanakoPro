import { describe, expect, it } from "vitest";

import { summarizeToolStartArgs } from "../server/routes/chat.js";

describe("chat tool_start arg summary", () => {
  it("keeps normalized wait timing metadata for live countdown", () => {
    expect(summarizeToolStartArgs("wait", { seconds: 31.6 }, 1_700_000_000_000)).toEqual({
      seconds: 32,
      startedAt: 1_700_000_000_000,
      durationMs: 32_000,
    });
  });

  it("does not leak unsummarized args for other tools", () => {
    expect(summarizeToolStartArgs("write", {
      file_path: "/tmp/a.txt",
      content: "secret body",
    }, 1_700_000_000_000)).toEqual({
      file_path: "/tmp/a.txt",
    });
  });
});
