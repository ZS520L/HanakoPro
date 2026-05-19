import { describe, expect, it, vi } from "vitest";
import {
  buildUsageDebugRecord,
  logLlmUsage,
  normalizeLlmUsage,
} from "../lib/llm/usage-observer.js";

describe("LLM usage observer", () => {
  it("normalizes Pi SDK usage and marks cache hits", () => {
    const usage = normalizeLlmUsage({
      input: 1200,
      output: 300,
      cacheRead: 900,
      cacheWrite: 150,
      totalTokens: 2550,
      cost: { total: 0.042 },
    });

    expect(usage).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 900,
      cacheWriteTokens: 150,
      totalTokens: 2550,
      costTotal: 0.042,
      cacheHit: true,
      cacheCreated: true,
    });
  });

  it("normalizes Anthropic raw usage fields", () => {
    const usage = normalizeLlmUsage({
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 40,
    });

    expect(usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 40,
      totalTokens: 240,
      cacheHit: true,
      cacheCreated: true,
    });
  });

  it("normalizes OpenAI-compatible usage with cached prompt token details", () => {
    const usage = normalizeLlmUsage({
      prompt_tokens: 250,
      completion_tokens: 50,
      total_tokens: 300,
      prompt_tokens_details: { cached_tokens: 180 },
    });

    expect(usage).toMatchObject({
      inputTokens: 250,
      outputTokens: 50,
      cacheReadTokens: 180,
      cacheWriteTokens: 0,
      totalTokens: 300,
      cacheHit: true,
      cacheCreated: false,
    });
  });

  it("builds a structured debug record without request content", () => {
    const record = buildUsageDebugRecord({
      source: "utility",
      api: "anthropic-messages",
      provider: "anthropic",
      modelId: "claude-opus-4-5",
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 0,
      },
    });

    expect(record).toEqual({
      source: "utility",
      api: "anthropic-messages",
      provider: "anthropic",
      modelId: "claude-opus-4-5",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheWriteTokens: 0,
      totalTokens: 200,
      costTotal: null,
      cacheHit: true,
      cacheCreated: false,
    });
  });

  it("writes model usage as one structured debug log line", () => {
    const logger = { log: vi.fn() };

    logLlmUsage({
      logger,
      source: "chat",
      provider: "anthropic",
      modelId: "claude-opus-4-5",
      usage: { input: 10, output: 2, cacheRead: 8, cacheWrite: 0 },
    });

    expect(logger.log).toHaveBeenCalledWith(
      "llm-usage",
      "model_usage {\"source\":\"chat\",\"api\":null,\"provider\":\"anthropic\",\"modelId\":\"claude-opus-4-5\",\"inputTokens\":10,\"outputTokens\":2,\"cacheReadTokens\":8,\"cacheWriteTokens\":0,\"totalTokens\":20,\"costTotal\":null,\"cacheHit\":true,\"cacheCreated\":false}"
    );
  });
});
