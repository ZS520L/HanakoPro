import { describe, expect, it, vi } from "vitest";

vi.mock("path", async () => {
  const nodePath = await vi.importActual("node:path");
  return { default: nodePath.win32 };
});

vi.mock("../core/llm-utils.js", () => ({
  isToolCallBlock: (b) => (b.type === "tool_use" || b.type === "toolCall") && !!b.name,
  getToolArgs: (b) => b.input || b.arguments,
}));

const {
  isValidSessionPath,
  isActiveSessionPath,
} = await import("../core/message-utils.js");

describe("Windows session path validation", () => {
  it("accepts the same path when only drive and user-directory casing differs", () => {
    const agentsDir = "C:\\Users\\Alice\\.hanako\\agents";
    const sessionPath = "c:\\users\\alice\\.hanako\\agents\\hana\\sessions\\old.jsonl";

    expect(isValidSessionPath(sessionPath, agentsDir)).toBe(true);
    expect(isActiveSessionPath(sessionPath, agentsDir)).toBe(true);
  });

  it("still rejects sibling paths that only share a textual prefix", () => {
    const agentsDir = "C:\\Users\\Alice\\.hanako\\agents";
    const sessionPath = "C:\\Users\\Alice\\.hanako\\agents-evil\\hana\\sessions\\old.jsonl";

    expect(isValidSessionPath(sessionPath, agentsDir)).toBe(false);
    expect(isActiveSessionPath(sessionPath, agentsDir)).toBe(false);
  });
});
