import { afterEach, describe, expect, it, vi } from "vitest";
import { callText } from "../core/llm-client.js";

describe("callText provider-compat routing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies response body read aborts from timeout as LLM_TIMEOUT", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => {
        const err = new Error("body read aborted");
        err.name = "AbortError";
        throw err;
      },
    });

    await expect(callText({
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      model: "qwen3.5-plus",
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5_000,
    })).rejects.toMatchObject({ code: "LLM_TIMEOUT" });
  });

  it("裸 model id + opts.quirks 仍走 qwen utility 兼容层", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
    });

    await callText({
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      model: "qwen3.5-plus",
      quirks: ["enable_thinking"],
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5_000,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.enable_thinking).toBe(false);
  });

  it("omits temperature from utility requests unless the caller sets it explicitly", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
    });

    await callText({
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      model: { id: "kimi-k2.5", provider: "moonshot", input: ["text", "image"] },
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5_000,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty("temperature");
  });

  it("keeps explicit utility temperature values in the request body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
    });

    await callText({
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      model: { id: "qwen-vl", provider: "dashscope", input: ["text", "image"] },
      messages: [{ role: "user", content: "hi" }],
      temperature: 0,
      timeoutMs: 5_000,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.temperature).toBe(0);
  });

  it("does not synthesize utility output caps from model capability metadata", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
    });

    await callText({
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      model: {
        id: "custom-small-output",
        provider: "openai-compatible",
        api: "openai-completions",
        maxTokens: 512,
      },
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5_000,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("keeps explicit utility output caps as task-owned request budgets", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
    });

    await callText({
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      model: {
        id: "custom-small-output",
        provider: "openai-compatible",
        api: "openai-completions",
        maxTokens: 512,
      },
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 80,
      timeoutMs: 5_000,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.max_tokens).toBe(80);
  });

  it("serializes image content for openai-compatible chat completions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "ok" } }],
      }),
    });

    await callText({
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      model: { id: "qwen-vl", provider: "dashscope", input: ["text", "image"] },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Describe this image." },
          { type: "image", data: "BASE64", mimeType: "image/png" },
        ],
      }],
      timeoutMs: 5_000,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Describe this image." },
      { type: "image_url", image_url: { url: "data:image/png;base64,BASE64" } },
    ]);
  });

  it("serializes image content for anthropic messages", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [{ type: "text", text: "ok" }],
      }),
    });

    await callText({
      api: "anthropic-messages",
      baseUrl: "https://example.test",
      model: { id: "claude-sonnet", provider: "anthropic", input: ["text", "image"] },
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Describe this image." },
          { type: "image", data: "BASE64", mimeType: "image/jpeg" },
        ],
      }],
      timeoutMs: 5_000,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Describe this image." },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: "BASE64",
        },
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("adds cache_control to anthropic utility system prompts", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [{ type: "text", text: "ok" }],
      }),
    });

    await callText({
      api: "anthropic-messages",
      baseUrl: "https://example.test",
      model: { id: "claude-opus-4-5", provider: "anthropic" },
      systemPrompt: "Stable writing system prompt",
      messages: [{ role: "user", content: "write" }],
      timeoutMs: 5_000,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.system).toEqual([
      {
        type: "text",
        text: "Stable writing system prompt",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("forwards model request headers on utility requests", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [{ type: "text", text: "ok" }],
      }),
    });

    await callText({
      api: "anthropic-messages",
      apiKey: "sk-test",
      baseUrl: "https://api.kimi.com/coding",
      model: {
        id: "kimi-for-coding",
        provider: "kimi-coding",
        headers: { "User-Agent": "KimiCLI/1.5" },
      },
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5_000,
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({
      "User-Agent": "KimiCLI/1.5",
      "x-api-key": "sk-test",
    });
  });

  it("keeps callText string-compatible by default and returns usage only when requested", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 40,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 80,
            cache_creation_input_tokens: 40,
          },
        }),
      });

    const defaultResult = await callText({
      api: "anthropic-messages",
      baseUrl: "https://example.test",
      model: { id: "claude-opus-4-5", provider: "anthropic" },
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5_000,
    });

    const detailedResult = await callText({
      api: "anthropic-messages",
      baseUrl: "https://example.test",
      model: { id: "claude-opus-4-5", provider: "anthropic" },
      messages: [{ role: "user", content: "hi" }],
      timeoutMs: 5_000,
      returnUsage: true,
    });

    expect(defaultResult).toBe("ok");
    expect(detailedResult).toEqual({
      text: "ok",
      usage: expect.objectContaining({
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 80,
        cacheWriteTokens: 40,
        cacheHit: true,
        cacheCreated: true,
      }),
    });
  });

  it("classifies responses that become empty only after thinking cleanup", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "<think>The user asked for OK.</think>\n\n" } }],
      }),
    });

    await expect(callText({
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      model: { id: "MiniMax-M2.7", provider: "minimax", reasoning: true },
      messages: [{ role: "user", content: "Reply OK." }],
      timeoutMs: 5_000,
    })).rejects.toMatchObject({
      code: "LLM_EMPTY_RESPONSE",
      message: "LLM returned only thinking content without visible text",
      context: expect.objectContaining({ reason: "empty_after_thinking" }),
    });
  });

  it("returns visible text after stripping a leading thinking block", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: "<think>The user asked for OK.</think>\n\nOK" } }],
      }),
    });

    await expect(callText({
      api: "openai-completions",
      baseUrl: "https://example.test/v1",
      model: { id: "MiniMax-M2.7", provider: "minimax", reasoning: true },
      messages: [{ role: "user", content: "Reply OK." }],
      timeoutMs: 5_000,
    })).resolves.toBe("OK");
  });

  it("classifies anthropic thinking-only content blocks as empty-after-thinking", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [{ type: "thinking", thinking: "The answer is OK." }],
      }),
    });

    await expect(callText({
      api: "anthropic-messages",
      baseUrl: "https://example.test",
      model: {
        id: "MiniMax-M2.7",
        provider: "minimax",
        api: "anthropic-messages",
        reasoning: true,
      },
      messages: [{ role: "user", content: "Reply OK." }],
      timeoutMs: 5_000,
    })).rejects.toMatchObject({
      code: "LLM_EMPTY_RESPONSE",
      message: "LLM returned only thinking content without visible text",
      context: expect.objectContaining({ reason: "empty_after_thinking" }),
    });
  });

  it("returns anthropic visible text while ignoring thinking content blocks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        content: [
          { type: "thinking", thinking: "Need to answer briefly." },
          { type: "text", text: "OK" },
        ],
      }),
    });

    await expect(callText({
      api: "anthropic-messages",
      baseUrl: "https://example.test",
      model: {
        id: "MiniMax-M2.7",
        provider: "minimax",
        api: "anthropic-messages",
        reasoning: true,
      },
      messages: [{ role: "user", content: "Reply OK." }],
      timeoutMs: 5_000,
    })).resolves.toBe("OK");
  });
});
