import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const clearConfigCache = vi.fn();
const callText = vi.fn();

vi.mock("../lib/memory/config-loader.js", () => ({
  clearConfigCache,
  getRawConfig: () => ({}),
}));

vi.mock("../core/llm-client.js", () => ({
  callText,
}));

function expectAppEvent(emitEvent, type, payload) {
  expect(emitEvent).toHaveBeenCalledWith({
    type: "app_event",
    event: {
      type,
      payload,
      source: "server",
    },
  }, null);
}

/** 从 providerRegistry.getCredentials 构造 engine.resolveProviderCredentials（与 ModelManager 行为一致） */
function withResolveCreds(engine) {
  engine.resolveProviderCredentials = (provider) => {
    if (!provider) return { api_key: "", base_url: "", api: "" };
    const cred = engine.providerRegistry?.getCredentials?.(provider);
    if (cred) return { api_key: cred.apiKey || "", base_url: cred.baseUrl || "", api: cred.api || "" };
    return { api_key: "", base_url: "", api: "" };
  };
  return engine;
}

describe("model sync related routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("provider-only config updates trigger model registry sync", async () => {
    const { createConfigRoute } = await import("../server/routes/config.js");
    const app = new Hono();
    const saveProvider = vi.fn();
    const reload = vi.fn();
    const engine = {
      config: {},
      currentAgentId: "hana",
      setHomeFolder: vi.fn(),
      updateConfig: vi.fn().mockResolvedValue(undefined),
      onProviderChanged: vi.fn().mockResolvedValue(undefined),
      providerRegistry: { saveProvider, removeProvider: vi.fn(), reload },
      emitEvent: vi.fn(),
    };

    app.route("/api", createConfigRoute(engine));

    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providers: {
          dashscope: {
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            api: "openai-completions",
            api_key: "sk-test",
            models: ["qwen-plus"],
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(saveProvider).toHaveBeenCalledTimes(1);
    expect(saveProvider).toHaveBeenCalledWith("dashscope", {
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      api: "openai-completions",
      api_key: "sk-test",
      models: ["qwen-plus"],
    });
    expect(clearConfigCache).toHaveBeenCalledTimes(1);
    expect(engine.updateConfig).toHaveBeenCalledWith({});
    expect(engine.onProviderChanged).toHaveBeenCalledTimes(1);
    expectAppEvent(engine.emitEvent, "models-changed", { agentId: "hana" });
  });

  it("provider-only config updates return an error and emit no event when provider refresh fails", async () => {
    const { createConfigRoute } = await import("../server/routes/config.js");
    const app = new Hono();
    const engine = {
      config: {},
      currentAgentId: "hana",
      updateConfig: vi.fn().mockResolvedValue(undefined),
      onProviderChanged: vi.fn().mockRejectedValue(new Error("registry refresh failed")),
      providerRegistry: {
        saveProvider: vi.fn(),
        removeProvider: vi.fn(),
      },
      emitEvent: vi.fn(),
    };

    app.route("/api", createConfigRoute(engine));

    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        providers: {
          dashscope: {
            api: "openai-completions",
            models: ["qwen-plus"],
          },
        },
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toContain("registry refresh failed");
    expect(engine.updateConfig).not.toHaveBeenCalled();
    expect(engine.emitEvent).not.toHaveBeenCalled();
  });

  it("shared model preference updates trigger model registry sync", async () => {
    const { createPreferencesRoute } = await import("../server/routes/preferences.js");
    const app = new Hono();
    const engine = {
      getSharedModels: vi.fn(() => ({})),
      getSearchConfig: vi.fn(() => ({ provider: null, api_key: null })),
      getUtilityApi: vi.fn(() => ({ provider: null, base_url: null, api_key: null })),
      setSharedModels: vi.fn(),
      setSearchConfig: vi.fn(),
      setUtilityApi: vi.fn(),
      syncModelsAndRefresh: vi.fn().mockResolvedValue(true),
      currentAgentId: "hana",
      emitEvent: vi.fn(),
    };

    app.route("/api", createPreferencesRoute(engine));

    const res = await app.request("/api/preferences/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: {
          utility: { id: "test-model", provider: "test-provider" },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(engine.setSharedModels).toHaveBeenCalledWith({
      utility: { id: "test-model", provider: "test-provider" },
    });
    expect(engine.syncModelsAndRefresh).toHaveBeenCalledTimes(1);
    expectAppEvent(engine.emitEvent, "models-changed", { agentId: "hana" });
  });

  it("auxiliary vision toggle updates shared prefs without refreshing the model registry", async () => {
    const { createPreferencesRoute } = await import("../server/routes/preferences.js");
    const app = new Hono();
    const engine = {
      getSharedModels: vi.fn(() => ({ vision_enabled: false })),
      getSearchConfig: vi.fn(() => ({ provider: null, api_key: null })),
      getUtilityApi: vi.fn(() => ({ provider: null, base_url: null, api_key: null })),
      resolveModelWithCredentials: vi.fn(),
      setSharedModels: vi.fn(),
      setSearchConfig: vi.fn(),
      setUtilityApi: vi.fn(),
      syncModelsAndRefresh: vi.fn().mockResolvedValue(true),
      currentAgentId: "hana",
      emitEvent: vi.fn(),
    };

    app.route("/api", createPreferencesRoute(engine));

    const res = await app.request("/api/preferences/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: {
          vision_enabled: true,
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(engine.setSharedModels).toHaveBeenCalledWith({
      vision_enabled: true,
    });
    expect(engine.resolveModelWithCredentials).not.toHaveBeenCalled();
    expect(engine.syncModelsAndRefresh).not.toHaveBeenCalled();
    expectAppEvent(engine.emitEvent, "models-changed", { agentId: "hana" });
  });

  it("shared model preference updates return an error and emit no event when model refresh fails", async () => {
    const { createPreferencesRoute } = await import("../server/routes/preferences.js");
    const app = new Hono();
    const engine = {
      getSharedModels: vi.fn(() => ({})),
      getSearchConfig: vi.fn(() => ({ provider: null, api_key: null })),
      getUtilityApi: vi.fn(() => ({ provider: null, base_url: null, api_key: null })),
      setSharedModels: vi.fn(),
      setSearchConfig: vi.fn(),
      setUtilityApi: vi.fn(),
      syncModelsAndRefresh: vi.fn().mockRejectedValue(new Error("model refresh failed")),
      currentAgentId: "hana",
      emitEvent: vi.fn(),
    };

    app.route("/api", createPreferencesRoute(engine));

    const res = await app.request("/api/preferences/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: {
          utility: { id: "test-model", provider: "test-provider" },
        },
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toContain("model refresh failed");
    expect(engine.setSharedModels).toHaveBeenCalledWith({
      utility: { id: "test-model", provider: "test-provider" },
    });
    expect(engine.emitEvent).not.toHaveBeenCalled();
  });

  it("shared model preference updates reject providerless refs before saving", async () => {
    const { createPreferencesRoute } = await import("../server/routes/preferences.js");
    const app = new Hono();
    const engine = {
      getSharedModels: vi.fn(() => ({})),
      getSearchConfig: vi.fn(() => ({ provider: null, api_key: null })),
      getUtilityApi: vi.fn(() => ({ provider: null, base_url: null, api_key: null })),
      setSharedModels: vi.fn(),
      setSearchConfig: vi.fn(),
      setUtilityApi: vi.fn(),
      syncModelsAndRefresh: vi.fn().mockResolvedValue(true),
      emitEvent: vi.fn(),
    };

    app.route("/api", createPreferencesRoute(engine));

    const res = await app.request("/api/preferences/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: {
          utility: { id: "test-model" },
        },
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("provider");
    expect(engine.setSharedModels).not.toHaveBeenCalled();
    expect(engine.syncModelsAndRefresh).not.toHaveBeenCalled();
    expect(engine.emitEvent).not.toHaveBeenCalled();
  });

  it("shared vision model preference updates are provider-aware and image-capable", async () => {
    const { createPreferencesRoute } = await import("../server/routes/preferences.js");
    const app = new Hono();
    const engine = {
      getSharedModels: vi.fn(() => ({ vision: null })),
      getSearchConfig: vi.fn(() => ({ provider: null, api_key: null })),
      getUtilityApi: vi.fn(() => ({ provider: null, base_url: null, api_key: null })),
      resolveModelWithCredentials: vi.fn(() => ({
        model: { id: "qwen-vl", provider: "dashscope", input: ["text", "image"] },
        provider: "dashscope",
        api: "openai-completions",
        api_key: "sk-test",
        base_url: "https://example.test/v1",
      })),
      setSharedModels: vi.fn(),
      setSearchConfig: vi.fn(),
      setUtilityApi: vi.fn(),
      syncModelsAndRefresh: vi.fn().mockResolvedValue(true),
      currentAgentId: "hana",
      emitEvent: vi.fn(),
    };

    app.route("/api", createPreferencesRoute(engine));

    const res = await app.request("/api/preferences/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: { vision: { id: "qwen-vl", provider: "dashscope" } },
      }),
    });

    expect(res.status).toBe(200);
    expect(engine.resolveModelWithCredentials).toHaveBeenCalledWith({
      id: "qwen-vl",
      provider: "dashscope",
    });
    expect(engine.setSharedModels).toHaveBeenCalledWith({
      vision: { id: "qwen-vl", provider: "dashscope" },
    });
    expectAppEvent(engine.emitEvent, "models-changed", { agentId: "hana" });
  });

  it("shared vision model preference rejects text-only models", async () => {
    const { createPreferencesRoute } = await import("../server/routes/preferences.js");
    const app = new Hono();
    const engine = {
      getSharedModels: vi.fn(() => ({ vision: null })),
      getSearchConfig: vi.fn(() => ({ provider: null, api_key: null })),
      getUtilityApi: vi.fn(() => ({ provider: null, base_url: null, api_key: null })),
      resolveModelWithCredentials: vi.fn(() => ({
        model: { id: "deepseek-chat", provider: "deepseek", input: ["text"] },
        provider: "deepseek",
        api: "openai-completions",
        api_key: "sk-test",
        base_url: "https://example.test/v1",
      })),
      setSharedModels: vi.fn(),
      setSearchConfig: vi.fn(),
      setUtilityApi: vi.fn(),
      syncModelsAndRefresh: vi.fn().mockResolvedValue(true),
      emitEvent: vi.fn(),
    };

    app.route("/api", createPreferencesRoute(engine));

    const res = await app.request("/api/preferences/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        models: { vision: { id: "deepseek-chat", provider: "deepseek" } },
      }),
    });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toContain("image");
    expect(engine.setSharedModels).not.toHaveBeenCalled();
    expect(engine.emitEvent).not.toHaveBeenCalled();
  });

  it("inline 凭证缺少显式 provider 时返回 400", async () => {
    const { createConfigRoute } = await import("../server/routes/config.js");
    const app = new Hono();
    const engine = {
      config: {},
      configPath: "/tmp/test-config.yaml",
      setHomeFolder: vi.fn(),
      updateConfig: vi.fn().mockResolvedValue(undefined),
      syncModelsAndRefresh: vi.fn().mockResolvedValue(true),
      getHomeFolder: vi.fn(() => null),
      getThinkingLevel: vi.fn(() => "medium"),
      getSandbox: vi.fn(() => "workspace-write"),
      getLocale: vi.fn(() => "zh-CN"),
      getTimezone: vi.fn(() => "Asia/Shanghai"),
      getLearnSkills: vi.fn(() => false),
      emitEvent: vi.fn(),
    };

    app.route("/api", createConfigRoute(engine));

    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api: {
          api_key: "sk-test",
        },
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("api.provider is required");
    expect(engine.emitEvent).not.toHaveBeenCalled();
  });

  it("inline 空 api_key 也会同步到 provider 配置，用于真正清空凭证", async () => {
    const { createConfigRoute } = await import("../server/routes/config.js");
    const app = new Hono();
    const saveProvider = vi.fn();
    const engine = {
      config: {},
      configPath: "/tmp/test-config.yaml",
      setHomeFolder: vi.fn(),
      updateConfig: vi.fn().mockResolvedValue(undefined),
      onProviderChanged: vi.fn().mockResolvedValue(undefined),
      providerRegistry: {
        saveProvider,
        removeProvider: vi.fn(),
      },
      getHomeFolder: vi.fn(() => null),
      getThinkingLevel: vi.fn(() => "medium"),
      getSandbox: vi.fn(() => "workspace-write"),
      getLocale: vi.fn(() => "zh-CN"),
      getTimezone: vi.fn(() => "Asia/Shanghai"),
      getLearnSkills: vi.fn(() => false),
      currentAgentId: "hana",
      emitEvent: vi.fn(),
    };

    app.route("/api", createConfigRoute(engine));

    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api: {
          provider: "openai",
          api_key: "",
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(saveProvider).toHaveBeenCalledWith("openai", { api_key: "" });
    expect(engine.onProviderChanged).toHaveBeenCalledTimes(1);
    expectAppEvent(engine.emitEvent, "models-changed", { agentId: "hana" });
  });

  it("global locale config updates emit locale-changed after success", async () => {
    const { createConfigRoute } = await import("../server/routes/config.js");
    const app = new Hono();
    const engine = {
      config: {},
      configPath: "/tmp/test-config.yaml",
      setLocale: vi.fn(),
      updateConfig: vi.fn().mockResolvedValue(undefined),
      providerRegistry: {
        saveProvider: vi.fn(),
        removeProvider: vi.fn(),
      },
      emitEvent: vi.fn(),
    };

    app.route("/api", createConfigRoute(engine));

    const res = await app.request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: "en-US" }),
    });

    expect(res.status).toBe(200);
    expect(engine.setLocale).toHaveBeenCalledWith("en-US");
    expect(engine.updateConfig).not.toHaveBeenCalled();
    expectAppEvent(engine.emitEvent, "locale-changed", { locale: "en-US" });
  });

  it("model routes expose stable ids and readable display names", async () => {
    const { createModelsRoute } = await import("../server/routes/models.js");
    const app = new Hono();
    const engine = {
      availableModels: [
        {
          id: "gpt-5.4",
          name: "Gpt 5.4",
          provider: "openai-codex",
          reasoning: true,
        },
        {
          id: "deepseek-v4-pro",
          name: "DeepSeek V4 Pro",
          provider: "deepseek",
          reasoning: true,
        },
      ],
      currentModel: { id: "gpt-5.4", name: "Gpt 5.4" },
      config: {},
      providerRegistry: { get: () => ({}) },
    };

    app.route("/api", createModelsRoute(engine));

    const allRes = await app.request("/api/models");
    const allData = await allRes.json();
    expect(allRes.status).toBe(200);
    expect(allData.models[0].id).toBe("gpt-5.4");
    expect(allData.models[0].name).toBe("Gpt 5.4");
    expect(allData.models[1].xhigh).toBe(true);
  });

  it("model health accepts explicit model refs and uses the utility LLM path", async () => {
    const { createModelsRoute } = await import("../server/routes/models.js");
    const app = new Hono();
    const resolved = {
      model: {
        id: "deepseek-v4-flash",
        provider: "deepseek",
        reasoning: true,
        maxTokens: 384000,
      },
      provider: "deepseek",
      api: "openai-completions",
      api_key: "sk-test",
      base_url: "https://api.deepseek.com/v1",
    };
    const engine = {
      availableModels: [],
      currentModel: null,
      config: {},
      resolveModelWithCredentials: vi.fn(() => resolved),
    };
    callText.mockResolvedValue("ok");

    app.route("/api", createModelsRoute(engine));

    const healthRes = await app.request("/api/models/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: { id: "deepseek-v4-flash", provider: "deepseek" },
      }),
    });
    const healthData = await healthRes.json();

    expect(healthRes.status).toBe(200);
    expect(healthData).toMatchObject({ ok: true, provider: "deepseek" });
    expect(engine.resolveModelWithCredentials).toHaveBeenCalledWith({
      id: "deepseek-v4-flash",
      provider: "deepseek",
    });
    expect(callText).toHaveBeenCalledWith(expect.objectContaining({
      api: "openai-completions",
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com/v1",
      model: resolved.model,
      maxTokens: 128,
      timeoutMs: 15_000,
    }));
  });

  it("model health reports empty-after-thinking as a diagnostic failure", async () => {
    const { AppError } = await import("../shared/errors.js");
    const { createModelsRoute } = await import("../server/routes/models.js");
    const app = new Hono();
    const resolved = {
      model: {
        id: "MiniMax-M2.7",
        provider: "minimax",
        reasoning: true,
      },
      provider: "minimax",
      api: "openai-completions",
      api_key: "sk-test",
      base_url: "https://api.minimax.io/v1",
    };
    const engine = {
      availableModels: [],
      currentModel: null,
      config: {},
      resolveModelWithCredentials: vi.fn(() => resolved),
    };
    callText.mockRejectedValue(new AppError("LLM_EMPTY_RESPONSE", {
      message: "LLM returned only thinking content without visible text",
      context: { model: "MiniMax-M2.7", reason: "empty_after_thinking" },
    }));

    app.route("/api", createModelsRoute(engine));

    const healthRes = await app.request("/api/models/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "MiniMax-M2.7", provider: "minimax" }),
    });
    const healthData = await healthRes.json();

    expect(healthRes.status).toBe(200);
    expect(healthData).toMatchObject({
      ok: false,
      code: "LLM_EMPTY_RESPONSE",
      reason: "empty_after_thinking",
      error: "LLM returned only thinking content without visible text",
    });
  });

  it("oauth provider with empty baseUrl falls back to registry", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn().mockReturnValue([
        {
          id: "gpt-5.4",
          name: "GPT-5.4",
          provider: "openai-codex",
          contextWindow: 272000,
          maxOutputTokens: 128000,
        },
      ]),
      providerRegistry: {
        getCredentials: () => ({ apiKey: "", baseUrl: "", api: "openai-codex-responses" }),
        getAuthJsonKey: (id) => id,
        getDefaultModels: () => [],
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "openai-codex" }),
    });

    expect(res.status).toBe(200);
    expect(engine.getRegistryModelsForProvider).toHaveBeenCalledWith("openai-codex");
    const data = await res.json();
    expect(data.source).toBe("registry");
    expect(data.models[0].id).toBe("gpt-5.4");
  });

  it("provider model delete refreshes runtime models and notifies the app", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    const removeModel = vi.fn();
    const engine = {
      currentAgentId: "hana",
      onProviderChanged: vi.fn().mockResolvedValue(undefined),
      emitEvent: vi.fn(),
      providerRegistry: { removeModel },
      hanakoHome: "/tmp",
    };

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/openrouter/models/openrouter%2Fqwen%2Fqwen-vl-plus", {
      method: "DELETE",
    });

    expect(res.status).toBe(200);
    expect(removeModel).toHaveBeenCalledWith("openrouter", "openrouter/qwen/qwen-vl-plus");
    expect(clearConfigCache).toHaveBeenCalledTimes(1);
    expect(engine.onProviderChanged).toHaveBeenCalledTimes(1);
    expectAppEvent(engine.emitEvent, "models-changed", { agentId: "hana" });
    expect(engine.emitEvent).toHaveBeenCalledTimes(1);
  });

  it("provider model update refreshes runtime models and notifies the app", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    const updateModelEntry = vi.fn();
    const engine = {
      currentAgentId: "hana",
      onProviderChanged: vi.fn().mockResolvedValue(undefined),
      emitEvent: vi.fn(),
      providerRegistry: { updateModelEntry },
      hanakoHome: "/tmp",
    };

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/openrouter/models/openrouter%2Fqwen%2Fqwen-vl-plus", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Qwen VL Plus" }),
    });

    expect(res.status).toBe(200);
    expect(updateModelEntry).toHaveBeenCalledWith("openrouter", "openrouter/qwen/qwen-vl-plus", {
      name: "Qwen VL Plus",
    });
    expect(clearConfigCache).toHaveBeenCalledTimes(1);
    expect(engine.onProviderChanged).toHaveBeenCalledTimes(1);
    expectAppEvent(engine.emitEvent, "models-changed", { agentId: "hana" });
    expect(engine.emitEvent).toHaveBeenCalledTimes(1);
  });

  it("providers summary treats no-auth providers as credential-ready without api_key", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    const allowsMissingApiKey = vi.fn(() => true);
    const engine = {
      providerRegistry: {
        getAllProvidersRaw: vi.fn(() => ({
          ollama: {
            base_url: "http://192.168.1.20:11434/v1",
            api: "openai-completions",
            models: ["llama3"],
          },
        })),
        get: vi.fn(() => ({
          authType: "none",
          baseUrl: "http://localhost:11434/v1",
          api: "openai-completions",
          displayName: "Ollama",
        })),
        isOAuth: vi.fn(() => false),
        getAuthType: vi.fn(() => "none"),
        allowsMissingApiKey,
        getAuthJsonKey: (id) => id,
        getOAuthProviderIds: () => [],
        getAll: () => new Map(),
      },
      preferences: {
        getOAuthCustomModels: () => ({}),
      },
      hanakoHome: "/tmp",
    };

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/summary");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.providers.ollama).toMatchObject({
      auth_type: "none",
      has_credentials: true,
      api_key: "",
      models: ["llama3"],
    });
    expect(allowsMissingApiKey).toHaveBeenCalledWith(
      "ollama",
      "http://192.168.1.20:11434/v1",
    );
  });

  it("oauth provider with empty registry falls back to defaults", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn().mockReturnValue([]),
      providerRegistry: {
        getCredentials: () => ({ apiKey: "", baseUrl: "", api: "openai-codex-responses" }),
        getAuthJsonKey: (id) => id,
        getDefaultModels: (id) => id === "openai-codex" ? ["gpt-5.4", "gpt-5.3-codex"] : [],
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "openai-codex" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("builtin");
    expect(data.models.map(m => m.id)).toContain("gpt-5.4");
  });

  it("provider with explicit api_key uses remote catalog", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "MiniMax-M2.5", context_length: 1000000, max_output_tokens: 80000 },
          { id: "MiniMax-M2", context_length: 1000000, max_output_tokens: 80000 },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn().mockReturnValue([]),
      providerRegistry: {
        getCredentials: () => null,
        getAuthJsonKey: (id) => id,
        getDefaultModels: () => [],
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "minimax",
        base_url: "https://api.minimaxi.com/v1",
        api: "openai-completions",
        api_key: "sk-test",
      }),
    });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const data = await res.json();
    expect(data.models).toHaveLength(2);
    expect(data.models[0].id).toBe("MiniMax-M2.5");
  });

  it("fetch-models does not expose the official DeepSeek provider id as a model", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "deepseek" },
          { id: "deepseek-v4-pro", context_length: 1000000, max_output_tokens: 384000 },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn().mockReturnValue([]),
      providerRegistry: {
        getCredentials: () => null,
        getAuthJsonKey: (id) => id,
        getDefaultModels: () => [],
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "deepseek",
        base_url: "https://api.deepseek.com/v1",
        api: "openai-completions",
        api_key: "sk-test",
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.models.map(m => m.id)).toEqual(["deepseek-v4-pro"]);
    expect(data.ignoredModels).toEqual(["deepseek"]);
  });

  it("discovered-models filters cached official DeepSeek provider ids", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-test-model-cache-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "models-cache.json"),
        JSON.stringify({
          deepseek: {
            fetchedAt: "2026-05-06T08:00:00.000Z",
            models: [
              { id: "deepseek" },
              { id: "deepseek-v4-flash" },
            ],
          },
        }),
        "utf-8",
      );

      const app = new Hono();
      const engine = withResolveCreds({
        providerRegistry: {
          getCredentials: () => ({ apiKey: "sk-test", baseUrl: "https://api.deepseek.com/v1", api: "openai-completions" }),
        },
        hanakoHome: tmpDir,
      });

      app.route("/api", createProvidersRoute(engine));

      const res = await app.request("/api/providers/deepseek/discovered-models");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.models.map(m => m.id)).toEqual(["deepseek-v4-flash"]);
      expect(data.ignoredModels).toEqual(["deepseek"]);
      expect(data.fetchedAt).toBe("2026-05-06T08:00:00.000Z");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("api-key provider with saved credentials uses remote catalog", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "qwen3.5-flash", context_length: 131072, max_output_tokens: 16384 },
          { id: "qwen3.5-plus", context_length: 1048576, max_output_tokens: 65536 },
          { id: "qwen3-max", context_length: 262144, max_output_tokens: 32768 },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn().mockReturnValue([]),
      providerRegistry: {
        getCredentials: () => null,
        getAuthJsonKey: (id) => id,
        getDefaultModels: () => [],
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "dashscope",
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        api: "openai-completions",
      }),
    });

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const data = await res.json();
    expect(data.models).toHaveLength(3);
  });

  it("remote 404 falls back to registry", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }));

    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn().mockReturnValue([
        { id: "gpt-5.4", name: "GPT-5.4", provider: "openai-codex", contextWindow: 272000, maxOutputTokens: 128000 },
      ]),
      providerRegistry: {
        getCredentials: () => ({ apiKey: "oauth-token", baseUrl: "https://api.openai.com/v1", api: "openai-codex-responses" }),
        getAuthJsonKey: () => "openai-codex",
        getDefaultModels: () => [],
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "openai-codex-oauth" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("registry");
    expect(data.models[0].id).toBe("gpt-5.4");
  });

  it("remote 401 returns error without fallback", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized" }));

    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn(),
      providerRegistry: {
        getCredentials: () => ({ apiKey: "bad-key", baseUrl: "https://api.example.com/v1", api: "openai-completions" }),
        getAuthJsonKey: (id) => id,
        getDefaultModels: () => [],
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "some-provider" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.error).toContain("401");
    expect(data.models).toEqual([]);
    expect(engine.getRegistryModelsForProvider).not.toHaveBeenCalled();
  });

  it("defaults fallback uses authJsonKey when provider ID has no defaults", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();

    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn().mockReturnValue([]),
      providerRegistry: {
        getCredentials: () => ({ apiKey: "", baseUrl: "", api: "openai-codex-responses" }),
        getAuthJsonKey: () => "openai-codex",
        getDefaultModels: (id) => {
          if (id === "openai-codex") return ["gpt-5.4", "gpt-5.3-codex"];
          return null;
        },
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "openai-codex-oauth" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("builtin");
    expect(data.models.map(m => m.id)).toEqual(["gpt-5.4", "gpt-5.3-codex"]);
  });

  it("anthropic-messages hits /v1/models and normalizes Anthropic fields", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "claude-opus-4-7",
            display_name: "Claude Opus 4.7",
            max_input_tokens: 200000,
            max_tokens: 64000,
          },
          { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", max_input_tokens: 200000, max_tokens: 64000 },
        ],
        has_more: false,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn().mockReturnValue([]),
      providerRegistry: {
        getCredentials: () => ({ apiKey: "sk-test", baseUrl: "https://api.anthropic.com", api: "anthropic-messages" }),
        getAuthJsonKey: (id) => id,
        getDefaultModels: () => [],
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "anthropic" }),
    });

    expect(res.status).toBe(200);
    const url = fetchMock.mock.calls[0][0];
    expect(url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");

    const data = await res.json();
    expect(data.models).toEqual([
      { id: "claude-opus-4-7", name: "Claude Opus 4.7", context: 200000, maxOutput: 64000 },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", context: 200000, maxOutput: 64000 },
    ]);
  });

  it("google-generative-ai hits native Gemini /models with x-goog-api-key and normalizes fields", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          {
            name: "models/gemini-3.1-pro-preview",
            baseModelId: "gemini-3.1-pro-preview",
            displayName: "Gemini 3.1 Pro Preview",
            inputTokenLimit: 1048576,
            outputTokenLimit: 65536,
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn().mockReturnValue([]),
      providerRegistry: {
        getCredentials: () => ({
          apiKey: "gemini-key",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          api: "google-generative-ai",
        }),
        getAuthJsonKey: (id) => id,
        getDefaultModels: () => [],
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "gemini" }),
    });

    expect(res.status).toBe(200);
    const fetchCall = fetchMock.mock.calls[0];
    expect(fetchCall[0]).toBe("https://generativelanguage.googleapis.com/v1beta/models");
    expect(fetchCall[1].headers["x-goog-api-key"]).toBe("gemini-key");
    expect(fetchCall[1].headers.Authorization).toBeUndefined();

    const data = await res.json();
    expect(data.models).toEqual([
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro Preview",
        context: 1048576,
        maxOutput: 65536,
      },
    ]);
  });

  it("anthropic-messages falls back to defaults when remote 404s", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }));

    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn().mockReturnValue([]),
      providerRegistry: {
        getCredentials: () => ({ apiKey: "sk-test", baseUrl: "https://api.kimi.com/coding", api: "anthropic-messages" }),
        getAuthJsonKey: (id) => id,
        getDefaultModels: (id) => id === "kimi-coding" ? ["kimi-k2.6", "kimi-k2.5"] : [],
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "kimi-coding" }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.source).toBe("builtin");
    expect(data.models.map(m => m.id)).toEqual(["kimi-k2.6", "kimi-k2.5"]);
  });

  it("request body api_key overrides saved credentials", async () => {
    const { createProvidersRoute } = await import("../server/routes/providers.js");
    const app = new Hono();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "test-model" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const engine = withResolveCreds({
      getRegistryModelsForProvider: vi.fn().mockReturnValue([]),
      providerRegistry: {
        getCredentials: () => ({ apiKey: "saved-key", baseUrl: "https://api.example.com/v1", api: "openai-completions" }),
        getAuthJsonKey: (id) => id,
        getDefaultModels: () => [],
      },
      hanakoHome: "/tmp",
    });

    app.route("/api", createProvidersRoute(engine));

    const res = await app.request("/api/providers/fetch-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "test-provider",
        api_key: "body-key",
      }),
    });

    expect(res.status).toBe(200);
    const fetchCall = fetchMock.mock.calls[0];
    expect(fetchCall[1].headers["Authorization"]).toBe("Bearer body-key");
  });
});
