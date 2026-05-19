import { describe, expect, it } from "vitest";
import { normalizeProviderPayload } from "../../core/provider-compat.js";

const mimoModel = {
  id: "mimo-v2-flash",
  provider: "mimo",
  baseUrl: "https://api.xiaomimimo.com/v1",
  api: "openai-completions",
  reasoning: true,
  maxTokens: 65536,
  compat: {
    thinkingFormat: "qwen-chat-template",
    reasoningProfile: "mimo-openai",
  },
};

describe("provider-compat/mimo", () => {
  it("treats Xiaomi Token Plan OpenAI-compatible endpoints as MiMo", () => {
    const tokenPlanModel = {
      id: "mimo-v2.5-pro",
      provider: "xiaomi-token",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      api: "openai-completions",
      reasoning: true,
      maxTokens: 65536,
      compat: { supportsDeveloperRole: false },
    };
    const payload = {
      model: "mimo-v2.5-pro",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
    };

    const result = normalizeProviderPayload(payload, tokenPlanModel, {
      mode: "chat",
      reasoningLevel: "high",
    });

    expect(result.chat_template_kwargs).toEqual({
      enable_thinking: true,
      preserve_thinking: true,
    });
    expect(result).not.toHaveProperty("reasoning_effort");
  });

  it("chat mode enables MiMo thinking through chat_template_kwargs and removes OpenAI reasoning_effort", () => {
    const payload = {
      model: "mimo-v2-flash",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "medium",
      max_completion_tokens: 4096,
    };

    const result = normalizeProviderPayload(payload, mimoModel, {
      mode: "chat",
      reasoningLevel: "high",
    });

    expect(result).not.toBe(payload);
    expect(result.chat_template_kwargs).toEqual({
      enable_thinking: true,
      preserve_thinking: true,
    });
    expect(result).not.toHaveProperty("reasoning_effort");
    expect(payload).toHaveProperty("reasoning_effort", "medium");
  });

  it("restores reasoning_content for assistant tool-call history from thinking blocks", () => {
    const payload = {
      model: "mimo-v2-flash",
      messages: [
        { role: "user", content: "query time" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Need to call the date tool.", thinkingSignature: "reasoning_content" },
            { type: "toolCall", id: "call_1", name: "date", arguments: {} },
          ],
          tool_calls: [{ id: "call_1", type: "function", function: { name: "date", arguments: "{}" } }],
        },
        { role: "tool", tool_call_id: "call_1", content: "2026-05-13" },
        { role: "user", content: "continue" },
      ],
      tools: [{ type: "function", function: { name: "date" } }],
    };

    const result = normalizeProviderPayload(payload, mimoModel, {
      mode: "chat",
      reasoningLevel: "high",
    });

    expect(result.messages[1]).toMatchObject({
      reasoning_content: "Need to call the date tool.",
      content: "",
    });
  });

  it("fails closed when tool-call history lost its real reasoning_content", () => {
    const payload = {
      model: "mimo-v2-flash",
      messages: [
        { role: "user", content: "query time" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_1", type: "function", function: { name: "date", arguments: "{}" } }],
        },
      ],
      tools: [{ type: "function", function: { name: "date" } }],
    };

    expect(() => normalizeProviderPayload(payload, mimoModel, {
      mode: "chat",
      reasoningLevel: "high",
    })).toThrow(/MiMo.*reasoning_content.*tool_calls/);
  });

  it("utility mode disables thinking and strips stale reasoning_content", () => {
    const payload = {
      model: "mimo-v2-flash",
      messages: [
        {
          role: "assistant",
          content: "",
          reasoning_content: "previous thinking",
          tool_calls: [{ id: "call_1", type: "function", function: { name: "date", arguments: "{}" } }],
        },
      ],
      reasoning_effort: "high",
      chat_template_kwargs: { enable_thinking: true, preserve_thinking: true },
    };

    const result = normalizeProviderPayload(payload, mimoModel, { mode: "utility" });

    expect(result.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(result).not.toHaveProperty("reasoning_effort");
    expect(result.messages[0]).not.toHaveProperty("reasoning_content");
  });
});
