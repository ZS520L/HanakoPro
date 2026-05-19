import { describe, expect, it } from "vitest";
import { normalizeProviderPayload } from "../core/provider-compat.js";

const userOnlyMessages = [{ role: "user", content: "hi" }];

function normalizeChatPayload(name, model, payload, options = {}) {
  return [
    name,
    normalizeProviderPayload(payload, model, {
      mode: "chat",
      outputBudgetSource: "sdk-default",
      ...options,
    }),
  ];
}

describe("provider payload snapshots", () => {
  it("keeps final chat payload contracts stable across representative providers", () => {
    const payloads = Object.fromEntries([
      normalizeChatPayload(
        "dashscopeDeepSeekV4Flash",
        {
          id: "deepseek-v4-flash",
          provider: "dashscope",
          api: "openai-completions",
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          reasoning: true,
          maxTokens: 384000,
        },
        {
          model: "deepseek-v4-flash",
          messages: userOnlyMessages,
          reasoning_effort: "high",
          max_completion_tokens: 32000,
        },
        { reasoningLevel: "high" }
      ),
      normalizeChatPayload(
        "officialDeepSeekOpenAI",
        {
          id: "deepseek-v4-flash",
          provider: "deepseek",
          api: "openai-completions",
          baseUrl: "https://api.deepseek.com",
          reasoning: true,
          maxTokens: 384000,
        },
        {
          model: "deepseek-v4-flash",
          messages: userOnlyMessages,
          reasoning_effort: "high",
          max_completion_tokens: 32000,
        },
        { reasoningLevel: "high" }
      ),
      normalizeChatPayload(
        "anthropicMessagesNative",
        {
          id: "claude-opus-4-7",
          provider: "anthropic",
          api: "anthropic-messages",
          maxTokens: 128000,
        },
        {
          model: "claude-opus-4-7",
          system: "stable system prompt",
          messages: userOnlyMessages,
          max_tokens: 32000,
        }
      ),
      normalizeChatPayload(
        "anthropicCompatibleReasoning",
        {
          id: "kimi-k2.6",
          provider: "kimi-coding",
          api: "anthropic-messages",
          reasoning: true,
          maxTokens: 98304,
          compat: { thinkingFormat: "anthropic" },
        },
        {
          model: "kimi-k2.6",
          messages: userOnlyMessages,
          thinking: { type: "enabled", budget_tokens: 8192 },
          max_tokens: 32000,
        },
        { reasoningLevel: "high" }
      ),
    ]);

    expect(payloads).toMatchInlineSnapshot(`
      {
        "anthropicCompatibleReasoning": {
          "max_tokens": 32000,
          "messages": [
            {
              "content": "hi",
              "role": "user",
            },
          ],
          "model": "kimi-k2.6",
          "thinking": {
            "budget_tokens": 8192,
            "type": "enabled",
          },
        },
        "anthropicMessagesNative": {
          "max_tokens": 32000,
          "messages": [
            {
              "content": [
                {
                  "cache_control": {
                    "type": "ephemeral",
                  },
                  "text": "hi",
                  "type": "text",
                },
              ],
              "role": "user",
            },
          ],
          "model": "claude-opus-4-7",
          "system": [
            {
              "cache_control": {
                "type": "ephemeral",
              },
              "text": "stable system prompt",
              "type": "text",
            },
          ],
        },
        "dashscopeDeepSeekV4Flash": {
          "messages": [
            {
              "content": "hi",
              "role": "user",
            },
          ],
          "model": "deepseek-v4-flash",
          "reasoning_effort": "high",
        },
        "officialDeepSeekOpenAI": {
          "max_tokens": 65536,
          "messages": [
            {
              "content": "hi",
              "role": "user",
            },
          ],
          "model": "deepseek-v4-flash",
          "reasoning_effort": "high",
          "thinking": {
            "type": "enabled",
          },
        },
      }
    `);
  });
});
