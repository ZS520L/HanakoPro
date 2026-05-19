/**
 * web-search.js — web_search 自定义工具
 *
 * 对外暴露一个统一的 web_search tool，只使用显式配置的 provider。
 *
 * 统一返回格式：[{ title, url, snippet }]
 */

import { Type } from "../pi-sdk/index.js";
import { loadConfig } from "../memory/config-loader.js";
import { getLocale, t } from "../../server/i18n.js";
import { safeParseResponse } from "../../shared/safe-parse.js";
import { BrowserManager } from "../browser/browser-manager.js";
import browserSearch from "../browser/browser-search-extractors.cjs";
import {
  SearchRateLimitError,
  createSearchRateLimiter,
  retryAfterMsFromHeaders,
} from "./search-rate-limiter.js";

const { BROWSER_SEARCH_PROVIDER_IDS } = browserSearch;

export const DEFAULT_SEARCH_PROVIDER = "bing_browser";
const defaultSearchRateLimiter = createSearchRateLimiter();

/**
 * @deprecated Module-level singleton — kept for backward compat only.
 * Prefer passing configPath / searchConfigResolver directly to createWebSearchTool().
 */
let _configPath = null;
let _searchConfigResolver = null;

export function initWebSearch(configPath, opts = {}) {
  _configPath = configPath;
  if (opts.searchConfigResolver) _searchConfigResolver = opts.searchConfigResolver;
}

export function resetWebSearchRateLimiterForTests() {
  defaultSearchRateLimiter.reset();
}

function throwIfRateLimited(res, label) {
  if (res.status !== 429) return;
  throw new SearchRateLimitError(`${label} API 429`, {
    status: res.status,
    retryAfterMs: retryAfterMsFromHeaders(res.headers),
  });
}

// ════════════════════════════════════════
// Provider: Tavily
// ════════════════════════════════════════

async function searchTavily(query, maxResults, apiKey) {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: "basic",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  throwIfRateLimited(res, "Tavily");
  const data = await safeParseResponse(res, null);
  if (!data) throw new Error(`Tavily API ${res.status}`);

  return (data.results || []).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.content || "",
  }));
}

// ════════════════════════════════════════
// Provider: Serper (Google)
// ════════════════════════════════════════

async function searchSerper(query, maxResults, apiKey) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({ q: query, num: maxResults }),
    signal: AbortSignal.timeout(30_000),
  });

  throwIfRateLimited(res, "Serper");
  const data = await safeParseResponse(res, null);
  if (!data) throw new Error(`Serper API ${res.status}`);

  return (data.organic || []).slice(0, maxResults).map((r) => ({
    title: r.title || "",
    url: r.link || "",
    snippet: r.snippet || "",
  }));
}

// ════════════════════════════════════════
// Provider: Brave Search
// ════════════════════════════════════════

async function searchBrave(query, maxResults, apiKey) {
  const params = new URLSearchParams({ q: query, count: maxResults });
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(30_000),
  });

  throwIfRateLimited(res, "Brave");
  const data = await safeParseResponse(res, null);
  if (!data) throw new Error(`Brave API ${res.status}`);

  return (data.web?.results || []).slice(0, maxResults).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.description || "",
  }));
}

const PROVIDERS = {
  tavily: { search: searchTavily, requiresApiKey: true, sourceType: "api" },
  serper: { search: searchSerper, requiresApiKey: true, sourceType: "api" },
  brave: { search: searchBrave, requiresApiKey: true, sourceType: "api" },
  ...Object.fromEntries(BROWSER_SEARCH_PROVIDER_IDS.map((id) => [
    id,
    { search: searchBrowserProvider, requiresApiKey: false, sourceType: "browser" },
  ])),
};

function providerMeta(provider) {
  const meta = PROVIDERS[provider];
  if (!meta) throw new Error(`Unknown provider: ${provider}`);
  return meta;
}

export function searchProviderRequiresApiKey(provider) {
  return providerMeta(provider).requiresApiKey;
}

async function searchBrowserProvider(query, maxResults, _apiKey, provider) {
  const response = await BrowserManager.instance().searchWeb({
    provider,
    query,
    maxResults,
    locale: getLocale(),
  });
  const diagnostics = response.diagnostics || {};
  if (diagnostics.blocked || diagnostics.status === "blocked") {
    throw new Error(diagnostics.reason || "search page is blocked");
  }
  if (diagnostics.status === "extraction_failed") {
    throw new Error(diagnostics.reason || "search results could not be extracted");
  }
  return {
    query,
    provider,
    source_type: "browser",
    results: response.results || [],
    diagnostics,
  };
}

/**
 * 验证搜索 API key 是否有效
 * @param {string} provider - tavily / serper / brave
 * @param {string} apiKey - 要验证的 key
 * @returns {Promise<boolean>}
 */
export async function verifySearchKey(provider, apiKey) {
  const meta = providerMeta(provider);
  if (!meta.requiresApiKey) return true;
  // 用一个简短查询测试 key 是否可用
  await defaultSearchRateLimiter.run(provider, meta.sourceType, () => (
    meta.search("test", 1, apiKey, provider)
  ));
  return true;
}

function normalizeSearchResult(r) {
  return {
    title: r.title || "",
    url: r.url || "",
    content: r.content || r.snippet || "",
    rank: r.rank ?? null,
    score: r.score ?? null,
    metadata: r.metadata || {},
  };
}

async function doSearch(query, maxResults, { configPath, searchConfigResolver, rateLimiter } = {}) {
  // Use explicitly passed args; fall back to module globals for backward compat
  const resolverFn = searchConfigResolver ?? _searchConfigResolver;
  const cfgPath = configPath ?? _configPath;
  let cfg = null;
  const readConfig = () => {
    if (!cfgPath) return {};
    if (!cfg) cfg = loadConfig(cfgPath);
    return cfg;
  };

  // 优先从 resolver 获取搜索配置，否则从 agent config 读取
  let provider = "";
  let apiKey = "";
  if (resolverFn) {
    const resolved = resolverFn();
    provider = resolved.provider || "";
    apiKey = resolved.api_key || "";
  }
  if (!provider) {
    const searchCfg = readConfig().search || {};
    if (!provider) provider = searchCfg.provider || DEFAULT_SEARCH_PROVIDER;
    if (!apiKey) apiKey = searchCfg.api_key || "";
  }

  if (!provider) {
    throw new Error(t("error.searchProviderNotConfigured"));
  }

  let meta;
  try {
    meta = providerMeta(provider);
  } catch {
    throw new Error(t("error.searchProviderUnknown", { provider }));
  }
  if (meta.requiresApiKey && !apiKey) {
    const searchCfg = readConfig().search || {};
    apiKey = searchCfg.api_key || "";
  }
  if (meta.requiresApiKey && !apiKey) {
    throw new Error(t("error.searchProviderMissingKey", { provider }));
  }

  try {
    const limiter = rateLimiter || defaultSearchRateLimiter;
    const payload = await limiter.run(provider, meta.sourceType, () => (
      meta.search(query, maxResults, apiKey, provider)
    ));
    if (Array.isArray(payload)) {
      const results = payload.map(normalizeSearchResult);
      return {
        query,
        results,
        provider,
        source_type: meta.sourceType,
        diagnostics: {},
      };
    }
    return {
      query: payload.query || query,
      results: (payload.results || []).map(normalizeSearchResult),
      provider,
      source_type: payload.source_type || meta.sourceType,
      diagnostics: payload.diagnostics || {},
    };
  } catch (err) {
    throw new Error(t("error.searchFailed", { msg: err.message }));
  }
}

// ════════════════════════════════════════
// Tool 定义
// ════════════════════════════════════════

/**
 * @param {object} [opts]
 * @param {string} [opts.configPath]           - per-agent config.yaml path
 * @param {Function} [opts.searchConfigResolver] - per-agent resolver returning { provider, api_key }
 * @param {object} [opts.rateLimiter]          - test/advanced hook with run(provider, sourceType, op)
 */
export function createWebSearchTool({ configPath, searchConfigResolver, rateLimiter } = {}) {
  // Capture per-agent config in the closure so each agent's tool reads its own config
  const closureOpts = { configPath, searchConfigResolver, rateLimiter };

  return {
    name: "web_search",
    label: t("toolDef.webSearch.label"),
    description: t("toolDef.webSearch.description"),
    parameters: Type.Object({
      query: Type.String({ description: t("toolDef.webSearch.queryDesc") }),
      maxResults: Type.Optional(
        Type.Number({ description: t("toolDef.webSearch.maxResultsDesc"), default: 5 })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const query = params.query?.trim();
      if (!query) {
        return {
          content: [{ type: "text", text: t("error.searchEmptyQuery") }],
          details: {},
        };
      }

      try {
        const searchPayload = await doSearch(query, params.maxResults ?? 5, closureOpts);
        const { results, provider } = searchPayload;

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: t("error.searchNoResults", { provider }) }],
            details: searchPayload,
          };
        }

        const formatted = results
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.content}`)
          .join("\n\n");

        return {
          content: [{ type: "text", text: t("error.searchResults", { provider, results: formatted }) }],
          details: searchPayload,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: t("error.searchError", { msg: err.message }) }],
          details: {},
        };
      }
    },
  };
}
