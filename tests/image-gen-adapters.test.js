import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// saveImage writes to disk — mock it out so tests stay pure
vi.mock("../plugins/image-gen/lib/download.js", () => ({
  saveImage: vi.fn(async (_buf, _mime, _dir, customName) => {
    const filename = customName ? `${customName}-abc.png` : `1234-abc.png`;
    return { filename, filePath: `/tmp/generated/${filename}` };
  }),
}));

function makeBusCtx(apiKey, baseUrl, providerId = "volcengine") {
  return {
    bus: {
      request: vi.fn(async (type, payload) => {
        if (type === "provider:credentials" && payload.providerId === providerId) {
          return { apiKey, baseUrl };
        }
        return { error: "not_found" };
      }),
    },
    config: {
      get: vi.fn((key) => {
        if (key === "providerDefaults") return {};
        return null;
      }),
    },
    dataDir: "/tmp/test-data",
    log: vi.fn(),
  };
}

function makeCodexJwt(accountId) {
  const payload = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": {
      chatgpt_account_id: accountId,
    },
  })).toString("base64url");
  return `header.${payload}.signature`;
}

describe("volcengine adapter", () => {
  beforeEach(() => mockFetch.mockReset());

  it("does not send Seedream 5-only output_format to Seedream 4.0", async () => {
    const { volcengineImageAdapter } = await import("../plugins/image-gen/adapters/volcengine.js");

    const fakeB64 = Buffer.from("fake-image").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ b64_json: fakeB64, size: "2048x2048" }],
      }),
    });

    const ctx = makeBusCtx("test-key", "https://ark.cn-beijing.volces.com/api/v3");
    const result = await volcengineImageAdapter.submit({
      prompt: "a cat",
      model: "doubao-seedream-4-0-250828",
      size: "2K",
      format: "png",
    }, ctx);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    expect(opts.headers["Authorization"]).toBe("Bearer test-key");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("doubao-seedream-4-0-250828");
    expect(body.prompt).toBe("a cat");
    expect(body.response_format).toBe("b64_json");
    expect(body.size).toBe("2K");
    expect(body).not.toHaveProperty("output_format");

    expect(result.files).toHaveLength(1);
    expect(typeof result.taskId).toBe("string");
    expect(result.taskId.length).toBeGreaterThan(0);
  });

  it("sends output_format only for Seedream 5 models", async () => {
    const { volcengineImageAdapter } = await import("../plugins/image-gen/adapters/volcengine.js");

    const fakeB64 = Buffer.from("fake-image").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: fakeB64 }] }),
    });

    const ctx = makeBusCtx("test-key", "https://ark.cn-beijing.volces.com/api/v3");
    await volcengineImageAdapter.submit({
      prompt: "a cat",
      model: "doubao-seedream-5-0-lite-260128",
      format: "png",
    }, ctx);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.output_format).toBe("png");
  });

  it("applies Seedream 3-only providerDefaults without leaking them to newer models", async () => {
    const { volcengineImageAdapter } = await import("../plugins/image-gen/adapters/volcengine.js");

    const fakeB64 = Buffer.from("img").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: fakeB64 }] }),
    });

    const ctx = makeBusCtx("key", "https://test.com");
    ctx.config.get = vi.fn((key) => {
      if (key === "providerDefaults") return { volcengine: { watermark: true, guidance_scale: 7.5, seed: 42 } };
      return null;
    });

    await volcengineImageAdapter.submit({
      prompt: "test",
      model: "doubao-seedream-3-0-t2i",
    }, ctx);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.watermark).toBe(true);
    expect(body.guidance_scale).toBe(7.5);
    expect(body.seed).toBe(42);

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: fakeB64 }] }),
    });

    await volcengineImageAdapter.submit({
      prompt: "test",
      model: "doubao-seedream-4-0-250828",
    }, ctx);

    const seedream4Body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(seedream4Body.watermark).toBe(true);
    expect(seedream4Body).not.toHaveProperty("guidance_scale");
    expect(seedream4Body).not.toHaveProperty("seed");
  });

  it("throws on API error with status and message", async () => {
    const { volcengineImageAdapter } = await import("../plugins/image-gen/adapters/volcengine.js");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "invalid key" } }),
    });

    const ctx = makeBusCtx("bad", "https://test.com");
    await expect(volcengineImageAdapter.submit({
      prompt: "a cat", model: "test",
    }, ctx)).rejects.toThrow(/401/);
  });

  it("throws when data array is empty", async () => {
    const { volcengineImageAdapter } = await import("../plugins/image-gen/adapters/volcengine.js");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const ctx = makeBusCtx("key", "https://test.com");
    await expect(volcengineImageAdapter.submit({
      prompt: "test", model: "test",
    }, ctx)).rejects.toThrow();
  });

  it("accepts Volcengine Coding Plan credentials in the same auth path used by submit", async () => {
    const { volcengineImageAdapter } = await import("../plugins/image-gen/adapters/volcengine.js");

    const request = vi.fn(async (type, payload) => {
      if (type === "provider:credentials" && payload.providerId === "volcengine") {
        return { error: "no_credentials" };
      }
      if (type === "provider:credentials" && payload.providerId === "volcengine-coding") {
        return {
          apiKey: "coding-plan-key",
          baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
          api: "openai-completions",
        };
      }
      return { error: "not_found" };
    });

    const result = await volcengineImageAdapter.checkAuth({
      bus: { request },
    });

    expect(result).toEqual({ ok: true });
    expect(request).toHaveBeenCalledWith("provider:credentials", { providerId: "volcengine" });
    expect(request).toHaveBeenCalledWith("provider:credentials", { providerId: "volcengine-coding" });
  });
});

describe("openai adapter", () => {
  beforeEach(() => mockFetch.mockReset());

  it("sends correct request and returns files from b64_json", async () => {
    const { openaiImageAdapter } = await import("../plugins/image-gen/adapters/openai.js");

    const fakeB64 = Buffer.from("fake-openai-image").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ b64_json: fakeB64, revised_prompt: "A fluffy dog in a park" }],
      }),
    });

    const ctx = makeBusCtx("sk-test", "https://api.openai.com/v1", "openai");
    const result = await openaiImageAdapter.submit({
      prompt: "a dog",
      model: "gpt-image-1",
      size: "1024x1024",
      quality: "medium",
      format: "png",
    }, ctx);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/generations");
    expect(opts.headers["Authorization"]).toBe("Bearer sk-test");
    const body = JSON.parse(opts.body);
    expect(body.model).toBe("gpt-image-1");
    expect(body.prompt).toBe("a dog");
    expect(body.quality).toBe("medium");
    expect(body.n).toBe(1);

    expect(result.files).toHaveLength(1);
    expect(typeof result.taskId).toBe("string");
  });

  it("applies providerDefaults (background)", async () => {
    const { openaiImageAdapter } = await import("../plugins/image-gen/adapters/openai.js");

    const fakeB64 = Buffer.from("img").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: fakeB64 }] }),
    });

    const ctx = makeBusCtx("key", "https://api.openai.com/v1", "openai");
    ctx.config.get = vi.fn((key) => {
      if (key === "providerDefaults") return { openai: { background: "transparent" } };
      return null;
    });

    await openaiImageAdapter.submit({
      prompt: "test",
      model: "gpt-image-1",
    }, ctx);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.background).toBe("transparent");
  });

  it("throws on API error", async () => {
    const { openaiImageAdapter } = await import("../plugins/image-gen/adapters/openai.js");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "rate limit exceeded" } }),
    });

    const ctx = makeBusCtx("key", "https://test.com", "openai");
    await expect(openaiImageAdapter.submit({
      prompt: "test", model: "test",
    }, ctx)).rejects.toThrow(/429/);
  });
});

describe("openai codex oauth adapter", () => {
  beforeEach(() => mockFetch.mockReset());

  it("uses Codex OAuth credentials and saves image_generation_call results", async () => {
    const { openaiCodexImageAdapter } = await import("../plugins/image-gen/adapters/openai-codex.js");

    const fakeB64 = Buffer.from("fake-codex-image").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: [
          { type: "message", content: [{ type: "output_text", text: "done" }] },
          { type: "image_generation_call", result: fakeB64 },
        ],
      }),
    });

    const ctx = makeBusCtx("oauth-token", "https://chatgpt.com/backend-api", "openai-codex-oauth");
    ctx.bus.request = vi.fn(async (type, payload) => {
      if (type === "provider:credentials" && payload.providerId === "openai-codex-oauth") {
        return {
          apiKey: "oauth-token",
          baseUrl: "https://chatgpt.com/backend-api",
          api: "openai-codex-responses",
          accountId: "acct_123",
        };
      }
      return { error: "not_found" };
    });

    const result = await openaiCodexImageAdapter.submit({
      prompt: "a quiet notebook on a wooden desk",
      model: "gpt-image-2",
      ratio: "1:1",
      quality: "high",
      format: "png",
    }, ctx);

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(opts.headers.Authorization).toBe("Bearer oauth-token");
    expect(opts.headers["chatgpt-account-id"]).toBe("acct_123");
    expect(opts.headers["OpenAI-Beta"]).toBe("responses=experimental");

    const body = JSON.parse(opts.body);
    expect(body.model).toBe("gpt-5.5");
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    expect(body.input[0].content[0]).toEqual({
      type: "input_text",
      text: "a quiet notebook on a wooden desk",
    });
    expect(body.tools[0]).toMatchObject({
      type: "image_generation",
      size: "1024x1024",
      quality: "high",
      output_format: "png",
    });

    expect(result.files).toHaveLength(1);
    expect(typeof result.taskId).toBe("string");
  });

  it("derives the Codex account id from the OAuth token when credentials omit it", async () => {
    const { openaiCodexImageAdapter } = await import("../plugins/image-gen/adapters/openai-codex.js");

    const fakeB64 = Buffer.from("fake-codex-image").toString("base64");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        output: [{ type: "image_generation_call", result: fakeB64 }],
      }),
    });

    const ctx = makeBusCtx(
      makeCodexJwt("acct_from_token"),
      "https://chatgpt.com/backend-api",
      "openai-codex-oauth",
    );

    await openaiCodexImageAdapter.submit({
      prompt: "test",
    }, ctx);

    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers["chatgpt-account-id"]).toBe("acct_from_token");
  });

  it("parses Codex streaming image_generation_call results", async () => {
    const { openaiCodexImageAdapter } = await import("../plugins/image-gen/adapters/openai-codex.js");

    const fakeB64 = Buffer.from("fake-codex-stream-image").toString("base64");
    const encoder = new TextEncoder();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "response.output_item.done",
            item: { type: "image_generation_call", result: fakeB64 },
          })}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
    });

    const ctx = makeBusCtx("oauth-token", "https://chatgpt.com/backend-api", "openai-codex-oauth");
    ctx.bus.request = vi.fn(async (type, payload) => {
      if (type === "provider:credentials" && payload.providerId === "openai-codex-oauth") {
        return {
          apiKey: "oauth-token",
          baseUrl: "https://chatgpt.com/backend-api",
          api: "openai-codex-responses",
          accountId: "acct_123",
        };
      }
      return { error: "not_found" };
    });

    const result = await openaiCodexImageAdapter.submit({
      prompt: "a quiet notebook",
      format: "png",
    }, ctx);

    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).stream).toBe(true);
    expect(result.files).toHaveLength(1);
  });

  it("requires a decodable Codex account id for ChatGPT backend requests", async () => {
    const { openaiCodexImageAdapter } = await import("../plugins/image-gen/adapters/openai-codex.js");

    const ctx = makeBusCtx("oauth-token", "https://chatgpt.com/backend-api", "openai-codex-oauth");

    await expect(openaiCodexImageAdapter.submit({
      prompt: "test",
    }, ctx)).rejects.toThrow(/account/i);
  });
});
