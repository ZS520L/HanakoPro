import { describe, it, expect } from "vitest";
import { resolveContextConfig, shouldTriggerCompression, splitMessages, executeCompression } from "../core/context-compressor.js";
import { DEFAULT_CONTEXT_COMPRESSION } from "../shared/context-compression.js";

describe("resolveContextConfig", () => {
  it("returns defaults when no config", () => {
    expect(resolveContextConfig({})).toEqual(DEFAULT_CONTEXT_COMPRESSION);
    expect(resolveContextConfig(null)).toEqual(DEFAULT_CONTEXT_COMPRESSION);
  });

  it("merges partial config", () => {
    const config = resolveContextConfig({
      context: { enabled: true, threshold: 0.8 },
    });
    expect(config.enabled).toBe(true);
    expect(config.threshold).toBe(0.8);
    expect(config.mode).toBe("rolling-summary");
    expect(config.protect.systemPrompt).toBe(true);
  });

  it("merges nested protect", () => {
    const config = resolveContextConfig({
      context: { protect: { systemPrompt: false } },
    });
    expect(config.protect.systemPrompt).toBe(false);
    expect(config.protect.pinnedMemory).toBe(true);
  });

  it("normalizes legacy utility compression model to custom mode", () => {
    const config = resolveContextConfig({
      context: { compressionModel: "utility" },
    });
    expect(config.compressionModel).toBe("custom");
    expect(config.compressionCustomModel).toBe(null);
  });

  it("keeps a valid custom compression model reference", () => {
    const config = resolveContextConfig({
      context: {
        compressionModel: "custom",
        compressionCustomModel: { id: "gpt-4.1-mini", provider: "openai" },
      },
    });
    expect(config.compressionModel).toBe("custom");
    expect(config.compressionCustomModel).toEqual({ id: "gpt-4.1-mini", provider: "openai" });
  });
});

describe("shouldTriggerCompression", () => {
  const fakeMessages = [
    { role: "user", content: "a".repeat(100) },
    { role: "assistant", content: "b".repeat(100) },
  ];

  it("returns false when disabled", () => {
    expect(
      shouldTriggerCompression({
        messages: fakeMessages,
        contextWindow: 10,
        contextConfig: { ...DEFAULT_CONTEXT_COMPRESSION, enabled: false },
      }),
    ).toBe(false);
  });

  it("returns false when under threshold", () => {
    expect(
      shouldTriggerCompression({
        messages: fakeMessages,
        contextWindow: 1_000_000,
        contextConfig: { ...DEFAULT_CONTEXT_COMPRESSION, enabled: true, threshold: 0.7 },
      }),
    ).toBe(false);
  });
});

describe("splitMessages", () => {
  const msgs = [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "a2" },
    { role: "user", content: "u3" },
    { role: "assistant", content: "a3" },
    { role: "user", content: "u4" },
    { role: "assistant", content: "a4" },
  ];

  it("protects recent N turns", () => {
    const { compressible, retained } = splitMessages(msgs, 2);
    // 2 turns = last 2 user messages and everything after
    expect(retained.length).toBeGreaterThan(0);
    expect(compressible.length + retained.length).toBe(msgs.length);
  });

  it("protects all when N >= total turns", () => {
    const { compressible, retained } = splitMessages(msgs, 10);
    expect(compressible.length).toBe(0);
    expect(retained.length).toBe(msgs.length);
  });

  it("filters system messages from compressible when protect.systemPrompt=true", () => {
    const msgsWithSystem = [
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ];
    const { compressible, retained } = splitMessages(msgsWithSystem, 1, { systemPrompt: true, recentToolResults: true });
    // system message should NOT be in compressible
    expect(compressible.every(m => m.role !== "system")).toBe(true);
    // system message should be in retained
    expect(retained.some(m => m.role === "system")).toBe(true);
    expect(compressible.length + retained.length).toBe(msgsWithSystem.length);
  });

  it("filters tool messages from compressible when protect.recentToolResults=true", () => {
    const msgsWithTool = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "tool", content: "tool_result" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ];
    const { compressible, retained } = splitMessages(msgsWithTool, 1, { systemPrompt: true, recentToolResults: true });
    expect(compressible.every(m => m.role !== "tool")).toBe(true);
    expect(retained.some(m => m.role === "tool")).toBe(true);
  });

  it("protects tool_calls assistant + tool result as a pair", () => {
    const msgsWithToolPair = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "", tool_calls: [{ id: "tc1", function: { name: "read", arguments: "{}" } }] },
      { role: "tool", content: "file contents", tool_call_id: "tc1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3" },
      { role: "assistant", content: "a3" },
    ];
    const { compressible, retained } = splitMessages(msgsWithToolPair, 1, { systemPrompt: true, recentToolResults: true });
    // Both the tool_calls assistant msg and the tool result should be protected
    expect(compressible.every(m => m.role !== "tool")).toBe(true);
    expect(compressible.every(m => !m.tool_calls)).toBe(true);
    // They should be in retained
    expect(retained.some(m => m.role === "tool")).toBe(true);
    expect(retained.some(m => Array.isArray(m.tool_calls))).toBe(true);
  });

  it("includes system and tool in compressible when protect is off", () => {
    const msgsWithAll = [
      { role: "system", content: "sys" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "tool", content: "tool_result" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3" },
      { role: "assistant", content: "a3" },
    ];
    // protect=1 → retain only u3+a3, compressible = system+u1+a1+tool+u2+a2
    const { compressible, retained } = splitMessages(msgsWithAll, 1, { systemPrompt: false, recentToolResults: false });
    expect(compressible.some(m => m.role === "system")).toBe(true);
    expect(compressible.some(m => m.role === "tool")).toBe(true);
  });
});

describe("executeCompression", () => {
  const mockGenerate = async (prompt) => "test summary";

  it("calls rolling-summary by default", async () => {
    const result = await executeCompression({
      messages: [{ role: "user", content: "hello" }],
      mode: "rolling-summary",
      model: {},
      generateFn: mockGenerate,
    });
    expect(result).toBe("test summary");
  });

  it("handles custom mode with template", async () => {
    let receivedPrompt = "";
    const result = await executeCompression({
      messages: [{ role: "user", content: "hello" }],
      mode: "custom",
      model: {},
      generateFn: async (prompt) => {
        receivedPrompt = prompt;
        return "custom result";
      },
      customPrompt: "Compress: {{history}}",
    });
    expect(result).toBe("custom result");
    expect(receivedPrompt).toContain("Compress:");
  });

  it("falls back to rolling-summary for unknown mode", async () => {
    const result = await executeCompression({
      messages: [{ role: "user", content: "hello" }],
      mode: "unknown-mode",
      model: {},
      generateFn: mockGenerate,
    });
    expect(result).toBe("test summary");
  });

  it("returns empty for empty messages", async () => {
    const result = await executeCompression({
      messages: [],
      mode: "ebbinghaus",
      model: {},
      generateFn: mockGenerate,
    });
    expect(result).toBe("");
  });
});
