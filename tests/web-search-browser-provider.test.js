import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchWebMock = vi.fn();

vi.mock("../lib/browser/browser-manager.js", () => ({
  BrowserManager: {
    instance: () => ({
      searchWeb: searchWebMock,
    }),
  },
}));

import {
  createWebSearchTool,
  resetWebSearchRateLimiterForTests,
  searchProviderRequiresApiKey,
  verifySearchKey,
} from "../lib/tools/web-search.js";

describe("web_search browser providers", () => {
  beforeEach(() => {
    searchWebMock.mockReset();
    resetWebSearchRateLimiterForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not require API keys for browser-backed providers", async () => {
    expect(searchProviderRequiresApiKey("bing_browser")).toBe(false);
    expect(searchProviderRequiresApiKey("google_browser")).toBe(false);
    expect(searchProviderRequiresApiKey("duckduckgo_browser")).toBe(false);
    await expect(verifySearchKey("bing_browser", "")).resolves.toBe(true);
  });

  it("returns Tavily-like structured details from a browser provider", async () => {
    searchWebMock.mockResolvedValue({
      query: "hana search",
      provider: "bing_browser",
      source_type: "browser",
      results: [
        {
          title: "Result",
          url: "https://example.com",
          content: "Snippet",
          rank: 1,
          score: null,
          metadata: { display_url: "example.com", engine: "bing" },
        },
      ],
      diagnostics: {
        final_url: "https://www.bing.com/search?q=hana+search",
        blocked: false,
        captcha: false,
        elapsed_ms: 1234,
      },
    });

    const tool = createWebSearchTool({
      searchConfigResolver: () => ({ provider: "bing_browser", api_key: "" }),
    });
    const result = await tool.execute("call-1", { query: "hana search", maxResults: 3 });

    expect(searchWebMock).toHaveBeenCalledWith({
      provider: "bing_browser",
      query: "hana search",
      maxResults: 3,
      locale: "zh",
    });
    expect(result.details).toMatchObject({
      query: "hana search",
      provider: "bing_browser",
      source_type: "browser",
      results: [
        {
          title: "Result",
          url: "https://example.com",
          content: "Snippet",
          rank: 1,
          metadata: { engine: "bing" },
        },
      ],
      diagnostics: {
        blocked: false,
        captcha: false,
      },
    });
    expect(result.content[0].type).toBe("text");
  });

  it("routes provider execution through the injected rate limiter", async () => {
    searchWebMock.mockResolvedValue({
      query: "hana limited",
      provider: "bing_browser",
      source_type: "browser",
      results: [
        {
          title: "Limited Result",
          url: "https://example.com/limited",
          content: "Limited snippet",
          rank: 1,
          score: null,
          metadata: { engine: "bing" },
        },
      ],
      diagnostics: { blocked: false, captcha: false },
    });
    const rateLimiter = {
      run: vi.fn(async (_provider, _sourceType, operation) => operation()),
    };

    const tool = createWebSearchTool({
      searchConfigResolver: () => ({ provider: "bing_browser", api_key: "" }),
      rateLimiter,
    });
    const result = await tool.execute("call-limited", { query: "hana limited", maxResults: 1 });

    expect(result.details.results).toHaveLength(1);
    expect(rateLimiter.run).toHaveBeenCalledWith(
      "bing_browser",
      "browser",
      expect.any(Function),
    );
  });

  it("surfaces API 429 responses as rate limit errors with Retry-After", async () => {
    let capturedError = null;
    const rateLimiter = {
      run: vi.fn(async (_provider, _sourceType, operation) => {
        try {
          return await operation();
        } catch (err) {
          capturedError = err;
          throw err;
        }
      }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "too many requests" }),
      {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "3" },
      },
    )));

    const tool = createWebSearchTool({
      searchConfigResolver: () => ({ provider: "brave", api_key: "test-key" }),
      rateLimiter,
    });
    await tool.execute("call-429", { query: "hana limited", maxResults: 1 });

    expect(rateLimiter.run).toHaveBeenCalledWith("brave", "api", expect.any(Function));
    expect(capturedError).toMatchObject({
      name: "SearchRateLimitError",
      status: 429,
      retryAfterMs: 3_000,
    });
  });

  it("defaults to Bing browser search when no search provider is configured", async () => {
    searchWebMock.mockResolvedValue({
      query: "hana default",
      provider: "bing_browser",
      source_type: "browser",
      results: [
        {
          title: "Default Result",
          url: "https://example.com/default",
          content: "Default snippet",
          rank: 1,
          score: null,
          metadata: { engine: "bing" },
        },
      ],
      diagnostics: {
        final_url: "https://www.bing.com/search?q=hana+default",
        blocked: false,
        captcha: false,
      },
    });

    const tool = createWebSearchTool({
      searchConfigResolver: () => ({ provider: "", api_key: "" }),
    });
    const result = await tool.execute("call-2", { query: "hana default", maxResults: 2 });

    expect(searchWebMock).toHaveBeenCalledWith({
      provider: "bing_browser",
      query: "hana default",
      maxResults: 2,
      locale: "zh",
    });
    expect(result.details).toMatchObject({
      query: "hana default",
      provider: "bing_browser",
      source_type: "browser",
      results: [
        {
          title: "Default Result",
          url: "https://example.com/default",
          content: "Default snippet",
          rank: 1,
          metadata: { engine: "bing" },
        },
      ],
    });
  });

  it("surfaces browser extraction failures instead of reporting them as empty results", async () => {
    searchWebMock.mockResolvedValue({
      query: "中文 搜索",
      provider: "bing_browser",
      source_type: "browser",
      results: [],
      diagnostics: {
        status: "extraction_failed",
        blocked: false,
        captcha: false,
        reason: "Search results could not be extracted from bing page.",
      },
    });

    const tool = createWebSearchTool({
      searchConfigResolver: () => ({ provider: "bing_browser", api_key: "" }),
    });
    const result = await tool.execute("call-extraction-failed", { query: "中文 搜索", maxResults: 3 });

    expect(result.content[0].text).toContain("could not be extracted");
    expect(result.content[0].text).not.toContain("不太理想");
  });
});
