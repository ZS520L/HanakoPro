/**
 * compress-fork.test.js — 压缩分叉功能的单元/契约测试
 *
 * 验证：
 * 1. resolveContextConfig 的 threshold 与 context_usage percent 比较逻辑一致
 * 2. splitMessages 用于分叉时正确分割 compressible/retained
 * 3. 新会话消息结构：summary(user) + 固定回复(assistant) + retained
 */
import { describe, it, expect } from "vitest";
import {
  cloneMessageForForkRetention,
  resolveContextConfig,
  splitMessages,
} from "../core/context-compressor.js";

describe("compress-fork: threshold detection", () => {
  it("compressionAvailable is true when percent >= threshold * 100", () => {
    const ctxConfig = resolveContextConfig({ context: { enabled: true, threshold: 0.7 } });
    // Simulating what chat.js does: pct from getContextUsage is 0-100
    const pct = 75; // 75%
    const available = ctxConfig.enabled && pct != null && (pct / 100) >= ctxConfig.threshold;
    expect(available).toBe(true);
  });

  it("compressionAvailable is false when percent < threshold * 100", () => {
    const ctxConfig = resolveContextConfig({ context: { enabled: true, threshold: 0.7 } });
    const pct = 50;
    const available = ctxConfig.enabled && pct != null && (pct / 100) >= ctxConfig.threshold;
    expect(available).toBe(false);
  });

  it("compressionAvailable is false when compression disabled", () => {
    const ctxConfig = resolveContextConfig({ context: { enabled: false, threshold: 0.7 } });
    const pct = 90;
    const available = ctxConfig.enabled && pct != null && (pct / 100) >= ctxConfig.threshold;
    expect(available).toBe(false);
  });
});

describe("compress-fork: message structure", () => {
  const FIXED_AI_REPLY = "我已了解之前的对话背景，让我们继续。";

  it("builds correct forked session message structure", () => {
    const messages = [
      { role: "system", content: "sys prompt" },
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
      { role: "user", content: "u3" },
      { role: "assistant", content: "a3" },
    ];

    const { compressible, retained } = splitMessages(messages, 1, {
      systemPrompt: true,
      recentToolResults: true,
    });

    // compressible should not contain system (protected)
    expect(compressible.every(m => m.role !== "system")).toBe(true);
    // retained should have the last turn + system
    expect(retained.length).toBeGreaterThan(0);

    // Simulate what compressFork does with the compressed summary
    const summary = "This is a compressed summary of the conversation.";
    const ts = Date.now();
    const forkedMessages = [];

    // 1. Summary as user message
    forkedMessages.push({
      role: "user",
      content: [{ type: "text", text: summary }],
      timestamp: ts,
    });

    // 2. Fixed AI reply
    forkedMessages.push({
      role: "assistant",
      content: [{ type: "text", text: FIXED_AI_REPLY }],
      timestamp: ts + 1,
    });

    // 3. Retained messages (skip system)
    for (const m of retained) {
      if (m.role === "system") continue;
      forkedMessages.push({ ...m, timestamp: m.timestamp || (ts + 2) });
    }

    // Verify structure
    expect(forkedMessages[0].role).toBe("user");
    expect(forkedMessages[0].content[0].text).toBe(summary);
    expect(forkedMessages[1].role).toBe("assistant");
    expect(forkedMessages[1].content[0].text).toBe(FIXED_AI_REPLY);
    // The rest should be non-system retained messages
    const retainedNonSystem = retained.filter(m => m.role !== "system");
    expect(forkedMessages.length).toBe(2 + retainedNonSystem.length);
  });

  it("preserves tool call pairs in retained when forking", () => {
    const messages = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "", tool_calls: [{ id: "tc1", function: { name: "read", arguments: "{}" } }] },
      { role: "tool", content: "file contents", tool_call_id: "tc1" },
      { role: "assistant", content: "a3" },
      { role: "user", content: "u3" },
      { role: "assistant", content: "a4" },
    ];

    const { compressible, retained } = splitMessages(messages, 1, {
      systemPrompt: true,
      recentToolResults: true,
    });

    // Tool pairs should be protected
    expect(retained.some(m => m.role === "tool")).toBe(true);
    expect(retained.some(m => Array.isArray(m.tool_calls))).toBe(true);
    expect(compressible.every(m => m.role !== "tool")).toBe(true);
    expect(compressible.every(m => !m.tool_calls)).toBe(true);
  });

  it("original session is unchanged (fork is non-destructive)", () => {
    const originalMessages = [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
      { role: "assistant", content: "a2" },
    ];

    // Deep copy to verify non-mutation
    const snapshot = JSON.parse(JSON.stringify(originalMessages));

    splitMessages(originalMessages, 1, { systemPrompt: true, recentToolResults: true });

    // Original should be untouched
    expect(originalMessages).toEqual(snapshot);
  });

  it("strips stale assistant usage when retaining messages for a fork", () => {
    const original = {
      role: "assistant",
      content: [{ type: "text", text: "recent answer" }],
      usage: { input: 20_000, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20_010 },
      timestamp: 123,
    };

    const forked = cloneMessageForForkRetention(original);

    expect(forked).not.toHaveProperty("usage");
    expect(forked.content).toEqual(original.content);
    expect(original).toHaveProperty("usage");
  });
});
