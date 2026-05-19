import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { ConfigCoordinator } from "../core/config-coordinator.js";

describe("updateConfig with agentId", () => {
  const tempRoots = [];

  afterEach(() => {
    for (const dir of tempRoots.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(name) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-config-coord-"));
    tempRoots.push(root);
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function makeDeps(overrides = {}) {
    const focusAgent = {
      id: "focus",
      config: { models: { chat: { id: "focus-chat", provider: "openai" } } },
      updateConfig: vi.fn(),
    };
    const targetAgent = {
      id: "target",
      config: { models: { chat: { id: "target-chat", provider: "deepseek" } } },
      updateConfig: vi.fn(),
    };
    return {
      focusAgent,
      targetAgent,
      deps: {
        hanakoHome: "/tmp/test",
        agentsDir: "/tmp/test/agents",
        getAgent: () => focusAgent,
        getAgentById: (id) => (id === "target" ? targetAgent : null),
        getActiveAgentId: () => "focus",
        getAgents: () => new Map([["focus", focusAgent], ["target", targetAgent]]),
        getModels: () => ({ availableModels: [], defaultModel: null }),
        getPrefs: () => ({ getPreferences: () => ({}), savePreferences: vi.fn() }),
        getSkills: () => ({ syncAgentSkills: vi.fn() }),
        getSession: () => null,
        getSessionCoordinator: () => null,
        getHub: () => null,
        emitEvent: vi.fn(),
        emitDevLog: vi.fn(),
        getCurrentModel: () => null,
        ...overrides,
      },
    };
  }

  it("returns only the requested agent explicit home folder", () => {
    const focusHome = makeTempDir("focus-home");
    const { focusAgent, targetAgent, deps } = makeDeps({
      getPrefs: () => ({
        getPrimaryAgent: () => "focus",
        getPreferences: () => ({ primaryAgent: "focus" }),
        savePreferences: vi.fn(),
      }),
    });
    focusAgent.config.desk = { home_folder: focusHome };
    targetAgent.config.desk = {};
    const coord = new ConfigCoordinator(deps);

    expect(coord.getExplicitHomeFolder("target")).toBeNull();
    expect(coord.getHomeFolder("target")).not.toBe(focusHome);
  });

  it("传入 agentId 时刷新目标 agent 而非焦点 agent", async () => {
    const { focusAgent, targetAgent, deps } = makeDeps();
    const coord = new ConfigCoordinator(deps);

    await coord.updateConfig({}, { agentId: "target" });

    expect(targetAgent.updateConfig).toHaveBeenCalledWith({});
    expect(focusAgent.updateConfig).not.toHaveBeenCalled();
  });

  it("显式刷新 description 时只把刷新意图传给目标 agent", async () => {
    const { focusAgent, targetAgent, deps } = makeDeps();
    const coord = new ConfigCoordinator(deps);

    await coord.updateConfig({}, { agentId: "target", refreshDescription: true });

    expect(targetAgent.updateConfig).toHaveBeenCalledWith({}, { refreshDescription: true });
    expect(focusAgent.updateConfig).not.toHaveBeenCalled();
  });

  it("不传 agentId 时刷新焦点 agent", async () => {
    const { focusAgent, targetAgent, deps } = makeDeps();
    const coord = new ConfigCoordinator(deps);

    await coord.updateConfig({});

    expect(focusAgent.updateConfig).toHaveBeenCalledWith({});
    expect(targetAgent.updateConfig).not.toHaveBeenCalled();
  });

  it("setSharedModels 同步当前 agent 的小工具和大工具模型内存态", () => {
    let prefs = {};
    const { focusAgent, deps } = makeDeps({
      getPrefs: () => ({
        getPreferences: () => prefs,
        savePreferences: (next) => { prefs = { ...next }; },
      }),
    });
    focusAgent.setUtilityModel = vi.fn();
    focusAgent.setMemoryModel = vi.fn();
    const coord = new ConfigCoordinator(deps);

    coord.setSharedModels({
      utility: { id: "deepseek-v4-flash", provider: "deepseek" },
      utility_large: { id: "deepseek-v4-pro", provider: "deepseek" },
    });

    expect(focusAgent.setUtilityModel).toHaveBeenCalledWith({ id: "deepseek-v4-flash", provider: "deepseek" });
    expect(focusAgent.setMemoryModel).toHaveBeenCalledWith({ id: "deepseek-v4-pro", provider: "deepseek" });
  });

  it("resolveUtilityConfig 传入 agentId 时使用目标 agent 配置", () => {
    const resolveUtilityConfig = vi.fn(() => ({ ok: true }));
    const { targetAgent, deps } = makeDeps({
      getModels: () => ({ resolveUtilityConfig }),
    });
    const coord = new ConfigCoordinator(deps);

    expect(coord.resolveUtilityConfig({ agentId: "target" })).toEqual({ ok: true });

    expect(resolveUtilityConfig).toHaveBeenCalledWith(
      targetAgent.config,
      expect.objectContaining({
        utility: null,
        utility_large: null,
      }),
      expect.objectContaining({
        provider: null,
        base_url: null,
        api_key: null,
      }),
    );
  });

  it("resolveUtilityConfig 传入未知 agentId 时 fail closed", () => {
    const { deps } = makeDeps({
      getModels: () => ({ resolveUtilityConfig: vi.fn() }),
    });
    const coord = new ConfigCoordinator(deps);

    expect(() => coord.resolveUtilityConfig({ agentId: "missing" }))
      .toThrow(/agent missing not found/);
  });

  it("setSharedModels 同步所有已加载 agent，并在清空时回到各自 chat fallback", () => {
    let prefs = {
      utility_model: { id: "util", provider: "openai" },
      utility_large_model: { id: "large", provider: "openai" },
    };
    const { focusAgent, targetAgent, deps } = makeDeps({
      getPrefs: () => ({
        getPreferences: () => prefs,
        savePreferences: (next) => { prefs = { ...next }; },
      }),
    });
    focusAgent.setUtilityModel = vi.fn();
    focusAgent.setMemoryModel = vi.fn();
    targetAgent.setUtilityModel = vi.fn();
    targetAgent.setMemoryModel = vi.fn();
    const coord = new ConfigCoordinator(deps);

    coord.setSharedModels({ utility: null, utility_large: null });

    expect(focusAgent.setUtilityModel).toHaveBeenCalledWith({ id: "focus-chat", provider: "openai" });
    expect(focusAgent.setMemoryModel).toHaveBeenCalledWith({ id: "focus-chat", provider: "openai" });
    expect(targetAgent.setUtilityModel).toHaveBeenCalledWith({ id: "target-chat", provider: "deepseek" });
    expect(targetAgent.setMemoryModel).toHaveBeenCalledWith({ id: "target-chat", provider: "deepseek" });
  });

  it("setSharedModels stores vision without mutating utility or memory runtime state", () => {
    let prefs = {
      vision_model: { id: "qwen-vl", provider: "dashscope" },
    };
    const { focusAgent, deps } = makeDeps({
      getPrefs: () => ({
        getPreferences: () => prefs,
        savePreferences: (next) => { prefs = { ...next }; },
      }),
    });
    focusAgent.setUtilityModel = vi.fn();
    focusAgent.setMemoryModel = vi.fn();
    const coord = new ConfigCoordinator(deps);

    coord.setSharedModels({
      vision: { id: "gpt-4o", provider: "openai" },
    });

    expect(prefs.vision_model).toEqual({ id: "gpt-4o", provider: "openai" });
    expect(focusAgent.setUtilityModel).not.toHaveBeenCalledWith({ id: "gpt-4o", provider: "openai" });
    expect(focusAgent.setMemoryModel).not.toHaveBeenCalledWith({ id: "gpt-4o", provider: "openai" });
  });

  it("getSharedModels exposes auxiliary vision as disabled by default", () => {
    const { deps } = makeDeps({
      getPrefs: () => ({
        getPreferences: () => ({}),
        savePreferences: vi.fn(),
      }),
    });
    const coord = new ConfigCoordinator(deps);

    expect(coord.getSharedModels()).toEqual(expect.objectContaining({
      vision_enabled: false,
    }));
  });

  it("setSharedModels stores and clears auxiliary vision without mutating utility or memory runtime state", () => {
    let prefs = {};
    const { focusAgent, deps } = makeDeps({
      getPrefs: () => ({
        getPreferences: () => prefs,
        savePreferences: (next) => { prefs = { ...next }; },
      }),
    });
    focusAgent.setUtilityModel = vi.fn();
    focusAgent.setMemoryModel = vi.fn();
    const coord = new ConfigCoordinator(deps);

    coord.setSharedModels({ vision_enabled: true });
    expect(prefs.vision_auxiliary_enabled).toBe(true);
    expect(coord.getSharedModels()).toEqual(expect.objectContaining({
      vision_enabled: true,
    }));
    expect(focusAgent.setUtilityModel).not.toHaveBeenCalled();
    expect(focusAgent.setMemoryModel).not.toHaveBeenCalled();

    coord.setSharedModels({ vision_enabled: false });
    expect(prefs).not.toHaveProperty("vision_auxiliary_enabled");
    expect(coord.getSharedModels()).toEqual(expect.objectContaining({
      vision_enabled: false,
    }));
  });

  it("agentId 等于焦点 agent 时，模型切换逻辑正常执行", async () => {
    const models = {
      availableModels: [{ id: "gpt-4", provider: "openai", name: "GPT-4" }],
      defaultModel: null,
    };
    const { focusAgent, deps } = makeDeps({
      getModels: () => models,
      getActiveAgentId: () => "focus",
    });
    const coord = new ConfigCoordinator(deps);

    await coord.updateConfig(
      { models: { chat: { id: "gpt-4", provider: "openai" } } },
      { agentId: "focus" },
    );

    expect(focusAgent.updateConfig).toHaveBeenCalled();
    // defaultModel 应被设置（findModel 会找到 gpt-4）
    expect(models.defaultModel).toEqual({ id: "gpt-4", provider: "openai", name: "GPT-4" });
  });

  it("agentId 为非焦点 agent 时，不执行模型切换", async () => {
    const models = {
      availableModels: [{ id: "gpt-4", provider: "openai", name: "GPT-4" }],
      defaultModel: null,
    };
    const { targetAgent, deps } = makeDeps({
      getModels: () => models,
    });
    const coord = new ConfigCoordinator(deps);

    await coord.updateConfig(
      { models: { chat: { id: "gpt-4", provider: "openai" } } },
      { agentId: "target" },
    );

    expect(targetAgent.updateConfig).toHaveBeenCalled();
    // defaultModel 不应被设置（非焦点 agent 不做模型切换）
    expect(models.defaultModel).toBeNull();
  });

  it("setDefaultModel 传入非焦点 agentId 时，只更新目标 agent 配置", async () => {
    const models = {
      availableModels: [{ id: "gpt-4", provider: "openai", name: "GPT-4" }],
      defaultModel: null,
    };
    const { focusAgent, targetAgent, deps } = makeDeps({
      getModels: () => models,
    });
    const coord = new ConfigCoordinator(deps);

    const result = await coord.setDefaultModel("gpt-4", "openai", { agentId: "target" });

    expect(result).toEqual({ id: "gpt-4", provider: "openai", name: "GPT-4" });
    expect(targetAgent.updateConfig).toHaveBeenCalledWith({
      models: { chat: { id: "gpt-4", provider: "openai" } },
    });
    expect(focusAgent.updateConfig).not.toHaveBeenCalled();
    expect(models.defaultModel).toBeNull();
  });

  it("setDefaultModel 不传 agentId 时，保持焦点 agent 语义", async () => {
    const models = {
      availableModels: [{ id: "gpt-4", provider: "openai", name: "GPT-4" }],
      defaultModel: null,
    };
    const { focusAgent, targetAgent, deps } = makeDeps({
      getModels: () => models,
      getActiveAgentId: () => "focus",
    });
    const coord = new ConfigCoordinator(deps);

    const result = await coord.setDefaultModel("gpt-4", "openai");

    expect(result).toEqual({ id: "gpt-4", provider: "openai", name: "GPT-4" });
    expect(focusAgent.updateConfig).toHaveBeenCalledWith({
      models: { chat: { id: "gpt-4", provider: "openai" } },
    });
    expect(targetAgent.updateConfig).not.toHaveBeenCalled();
    expect(models.defaultModel).toEqual({ id: "gpt-4", provider: "openai", name: "GPT-4" });
  });

  it("persistSessionMeta 写入 sessionMemoryEnabled，而不是 master&&session 组合态", async () => {
    const focusAgent = {
      id: "focus",
      memoryEnabled: false,
      sessionMemoryEnabled: true,
    };
    const writeSessionMeta = vi.fn();
    const coord = new ConfigCoordinator({
      hanakoHome: "/tmp/test",
      agentsDir: "/tmp/test/agents",
      getAgent: () => focusAgent,
      getAgentById: () => null,
      getActiveAgentId: () => "focus",
      getAgents: () => new Map([["focus", focusAgent]]),
      getModels: () => ({ availableModels: [], defaultModel: null }),
      getPrefs: () => ({ getPreferences: () => ({}), savePreferences: vi.fn() }),
      getSkills: () => ({ syncAgentSkills: vi.fn() }),
      getSession: () => ({
        sessionManager: {
          getSessionFile: () => "/tmp/test/agents/focus/sessions/frozen.jsonl",
        },
      }),
      getSessionCoordinator: () => ({ writeSessionMeta }),
      getHub: () => null,
      emitEvent: vi.fn(),
      emitDevLog: vi.fn(),
      getCurrentModel: () => null,
    });

    await coord.persistSessionMeta();

    expect(writeSessionMeta).toHaveBeenCalledWith(
      "/tmp/test/agents/focus/sessions/frozen.jsonl",
      { memoryEnabled: true },
    );
  });
});
