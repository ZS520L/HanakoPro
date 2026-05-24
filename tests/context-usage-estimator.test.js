import { describe, expect, it } from "vitest";
import {
  computeContextUsageSnapshot,
  estimateContextUsageTokens,
  estimateMessagesContextTokens,
  estimateMoonshotPromptOverhead,
  resolveContextUsageWindow,
  shouldCalibrateMoonshotContextUsage,
} from "../core/context-usage-estimator.js";

function assistantWithUsage(text, totalTokens) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    usage: {
      input: totalTokens - 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens,
    },
  };
}

describe("context usage estimator", () => {
  it("calibrates moonshot-v1-8k and moonshot-v1-32k fallback with historical provider usage", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      assistantWithUsage("ok", 8000),
      { role: "user", content: [{ type: "text", text: "short follow up" }] },
    ];
    const base = estimateMessagesContextTokens(messages);
    const overhead = estimateMoonshotPromptOverhead(messages);

    expect(shouldCalibrateMoonshotContextUsage({ provider: "moonshot", id: "moonshot-v1-8k" })).toBe(true);
    expect(shouldCalibrateMoonshotContextUsage({ provider: "moonshot", id: "moonshot-v1-32k" })).toBe(true);
    expect(overhead).toBeGreaterThan(0);
    expect(estimateContextUsageTokens(messages, { provider: "moonshot", id: "moonshot-v1-32k" })).toBe(base + overhead);
  });

  it("does not calibrate DeepSeek fallback", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      assistantWithUsage("ok", 8000),
      { role: "user", content: [{ type: "text", text: "short follow up" }] },
    ];
    const base = estimateMessagesContextTokens(messages);

    expect(shouldCalibrateMoonshotContextUsage({ provider: "deepseek", id: "deepseek-chat" })).toBe(false);
    expect(estimateContextUsageTokens(messages, { provider: "deepseek", id: "deepseek-chat" })).toBe(base);
  });

  it("does not calibrate other Moonshot models", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      assistantWithUsage("ok", 8000),
    ];
    const base = estimateMessagesContextTokens(messages);

    expect(shouldCalibrateMoonshotContextUsage({ provider: "moonshot", id: "moonshot-v1-128k" })).toBe(false);
    expect(estimateContextUsageTokens(messages, { provider: "moonshot", id: "moonshot-v1-128k" })).toBe(base);
  });

  it("uses known Moonshot window when runtime metadata reports a larger window", () => {
    expect(resolveContextUsageWindow({
      provider: "moonshot",
      id: "moonshot-v1-32k",
      contextWindow: 1_000_000,
    })).toBe(32_768);
  });

  it("falls back to session manager messages when runtime state is still empty", () => {
    const session = {
      model: { provider: "moonshot", id: "moonshot-v1-32k", contextWindow: 1_000_000 },
      getContextUsage: () => ({ tokens: 0, contextWindow: 1_000_000, percent: 0 }),
      agent: { state: { messages: [] } },
      sessionManager: {
        buildSessionContext: () => ({
          messages: [
            { role: "user", content: [{ type: "text", text: "compressed summary" }] },
            { role: "assistant", content: [{ type: "text", text: "ready" }] },
          ],
        }),
      },
    };

    const usage = computeContextUsageSnapshot(session);

    expect(usage.contextWindow).toBe(32_768);
    expect(usage.tokens).toBeGreaterThan(0);
    expect(usage.percent).toBeGreaterThan(0);
  });
});
