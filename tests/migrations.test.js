/**
 * core/migrations.js 单元测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import YAML from "js-yaml";
import { runMigrations } from "../core/migrations.js";
import { getAgentPhoneProjectionPath } from "../lib/conversations/agent-phone-projection.js";

// ── 测试工具 ────────────────────────────────────────────────────────────────

const LATEST_DATA_VERSION = 25;

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hana-migrations-"));
}

/** 最小化 PreferencesManager stub */
function makePrefs(userDir) {
  const p = path.join(userDir, "preferences.json");
  fs.mkdirSync(userDir, { recursive: true });
  if (!fs.existsSync(p)) fs.writeFileSync(p, "{}", "utf-8");
  return {
    getPreferences() { return JSON.parse(fs.readFileSync(p, "utf-8")); },
    savePreferences(data) {
      fs.writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
    },
  };
}

/** 最小化 ProviderRegistry stub — 只需 get() 返回是否存在 */
function makeRegistry(existingProviders) {
  const set = new Set(existingProviders);
  return {
    get(id) { return set.has(id) ? { id } : null; },
    getAllProvidersRaw() { return {}; },
  };
}

function makeRegistryWithModels(providers) {
  const entries = Object.entries(providers || {});
  const set = new Set(entries.map(([id]) => id));
  return {
    get(id) { return set.has(id) ? { id } : null; },
    getAllProvidersRaw() { return providers; },
    getDefaultModels(id) { return providers?.[id]?.defaultModels || []; },
  };
}

function writeAgentConfig(agentsDir, agentId, config) {
  const dir = path.join(agentsDir, agentId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.yaml"),
    YAML.dump(config, { indent: 2, lineWidth: -1, sortKeys: false, quotingType: '"' }),
    "utf-8",
  );
}

function readAgentConfig(agentsDir, agentId) {
  return YAML.load(fs.readFileSync(path.join(agentsDir, agentId, "config.yaml"), "utf-8"));
}

function writeSessionJsonl(filePath, messages) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = messages.map((message, index) => JSON.stringify({
    type: "message",
    id: `m-${index + 1}`,
    timestamp: "2026-04-15T00:00:00.000Z",
    message,
  }));
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
}

function readSessionJsonl(filePath) {
  return fs.readFileSync(filePath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

// ── runner 行为 ──────────────────────────────────────────────────────────────

describe("runMigrations runner", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = path.join(tmpDir, "user");
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("首次运行：_dataVersion 从 0 升到最新", () => {
    const prefs = makePrefs(userDir);
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });

    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    expect(prefs.getPreferences()._dataVersion).toBeGreaterThan(0);
  });

  it("已迁移过：不重复执行", () => {
    const prefs = makePrefs(userDir);
    // 设置一个很大的 _dataVersion，所有迁移都应跳过
    prefs.savePreferences({ _dataVersion: 9999 });

    writeAgentConfig(agentsDir, "hana", { api: { provider: "ghost-provider" } });

    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    // config 不应被修改（ghost-provider 应原样保留）
    const config = readAgentConfig(agentsDir, "hana");
    expect(config.api.provider).toBe("ghost-provider");
  });
});

describe("migration #11: repairCronJobModelRefs", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = path.join(tmpDir, "user");
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function writeCronJobs(agentId, jobs) {
    const deskDir = path.join(agentsDir, agentId, "desk");
    fs.mkdirSync(deskDir, { recursive: true });
    fs.writeFileSync(
      path.join(deskDir, "cron-jobs.json"),
      JSON.stringify({ jobs, nextNum: jobs.length + 1 }, null, 2) + "\n",
      "utf-8",
    );
  }

  function readCronJobs(agentId) {
    return JSON.parse(fs.readFileSync(path.join(agentsDir, agentId, "desk", "cron-jobs.json"), "utf-8")).jobs;
  }

  it("把 cron-jobs.json 里的裸 id / provider-id 字符串迁移为 {id, provider}", () => {
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 10 });
    writeAgentConfig(agentsDir, "hana", { agent: { name: "Hana" } });
    writeCronJobs("hana", [
      { id: "job_22", type: "cron", schedule: "0 3 * * *", prompt: "a", enabled: true, model: "MiniMax-M2.7" },
      { id: "job_23", type: "cron", schedule: "0 3 * * *", prompt: "b", enabled: true, model: { id: "MiniMax-M2.7" } },
      { id: "job_24", type: "cron", schedule: "0 3 * * *", prompt: "c", enabled: true, model: "openai/gpt-4o" },
      { id: "job_25", type: "cron", schedule: "0 3 * * *", prompt: "d", enabled: true, model: "unknown-model" },
    ]);

    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistryWithModels({
        minimax: { models: ["MiniMax-M2.7"] },
        openai: { models: ["gpt-4o"] },
      }),
      log: () => {},
    });

    const jobs = readCronJobs("hana");
    expect(jobs[0].model).toEqual({ id: "MiniMax-M2.7", provider: "minimax" });
    expect(jobs[1].model).toEqual({ id: "MiniMax-M2.7", provider: "minimax" });
    expect(jobs[2].model).toEqual({ id: "gpt-4o", provider: "openai" });
    expect(jobs[3].model).toBe("unknown-model");
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });
});

describe("migration #12: backfill legacy session files into sidecars", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = path.join(tmpDir, "user");
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runMigration12() {
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 11 });
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistryWithModels({}),
      log: () => {},
    });
    return prefs;
  }

  it("registers legacy stage_files and artifacts without rewriting the session jsonl", () => {
    writeAgentConfig(agentsDir, "hana", { agent: { name: "Hana" } });
    const sessionPath = path.join(agentsDir, "hana", "sessions", "legacy.jsonl");
    const stagePath = path.join(tmpDir, "legacy-image.png");
    const artifactPath = path.join(tmpDir, "legacy-artifact.md");
    fs.writeFileSync(stagePath, "png-bytes");
    fs.writeFileSync(artifactPath, "# Artifact\n");
    writeSessionJsonl(sessionPath, [
      {
        role: "toolResult",
        toolName: "stage_files",
        details: { files: [{ filePath: stagePath, label: "Legacy Image" }] },
      },
      {
        role: "toolResult",
        toolName: "create_artifact",
        details: {
          artifactId: "art-old",
          type: "markdown",
          title: "Legacy Artifact",
          content: "# Artifact",
          artifactFile: { filePath: artifactPath, label: "Legacy Artifact.md" },
        },
      },
    ]);

    const before = fs.readFileSync(sessionPath, "utf-8");
    const prefs = runMigration12();

    const sidecar = JSON.parse(fs.readFileSync(`${sessionPath}.files.json`, "utf-8"));
    const files = Object.values(sidecar.files);
    expect(files).toEqual(expect.arrayContaining([
      expect.objectContaining({ filePath: stagePath, origin: "stage_files", status: "available" }),
      expect.objectContaining({ filePath: artifactPath, origin: "agent_artifact", status: "available" }),
    ]));
    expect(fs.readFileSync(sessionPath, "utf-8")).toBe(before);
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("materializes legacy inline browser screenshots as managed session images", () => {
    writeAgentConfig(agentsDir, "hana", { agent: { name: "Hana" } });
    const sessionPath = path.join(agentsDir, "hana", "sessions", "browser.jsonl");
    const base64 = Buffer.from("SCREENSHOT_BYTES").toString("base64");
    writeSessionJsonl(sessionPath, [
      {
        role: "toolResult",
        toolName: "browser",
        content: [{ type: "image", data: base64, mimeType: "image/png" }],
        details: { action: "screenshot", mimeType: "image/png", thumbnail: base64 },
      },
    ]);

    runMigration12();

    const sidecar = JSON.parse(fs.readFileSync(`${sessionPath}.files.json`, "utf-8"));
    const files = Object.values(sidecar.files);
    expect(files).toEqual([
      expect.objectContaining({
        origin: "browser_screenshot",
        storageKind: "managed_cache",
        kind: "image",
        status: "available",
      }),
    ]);
    expect(files[0].filePath).toContain(path.join(tmpDir, "session-files"));
    expect(fs.existsSync(files[0].filePath)).toBe(true);
  });
});

describe("migration #13: normalize recent legacy compatibility state", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = path.join(tmpDir, "user");
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runMigration13() {
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 12 });
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistryWithModels({
        deepseek: {
          models: ["deepseek-v4-pro", "deepseek-v4-flash"],
          defaultModels: ["deepseek-v4-pro", "deepseek-v4-flash"],
        },
      }),
      log: () => {},
    });
    return prefs;
  }

  function writeAddedModelsYaml(providers) {
    fs.writeFileSync(
      path.join(tmpDir, "added-models.yaml"),
      YAML.dump({ providers }, { indent: 2, lineWidth: -1, sortKeys: false, quotingType: "\"" }),
      "utf-8",
    );
  }

  function readAddedModelsYaml() {
    return YAML.load(fs.readFileSync(path.join(tmpDir, "added-models.yaml"), "utf-8"));
  }

  it("removes the reserved official DeepSeek provider id from legacy model lists", () => {
    writeAddedModelsYaml({
      deepseek: {
        base_url: "https://api.deepseek.com/v1",
        api_key: "sk-test",
        models: ["deepseek", "deepseek-v4-pro", { id: "deepseek-v4-flash", reasoning: true }],
      },
      openrouter: {
        base_url: "https://openrouter.ai/api/v1",
        api_key: "sk-test",
        models: ["deepseek"],
      },
    });

    const prefs = runMigration13();

    const raw = readAddedModelsYaml();
    expect(raw.providers.deepseek.models).toEqual([
      "deepseek-v4-pro",
      { id: "deepseek-v4-flash", reasoning: true },
    ]);
    expect(raw.providers.openrouter.models).toEqual(["deepseek"]);
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("seeds DeepSeek defaults when the reserved model id was the only legacy entry", () => {
    writeAddedModelsYaml({
      "deepseek-official-proxy": {
        base_url: "https://api.deepseek.com/v1",
        api_key: "sk-test",
        models: [{ id: "deepseek" }],
      },
    });

    runMigration13();

    const raw = readAddedModelsYaml();
    expect(raw.providers["deepseek-official-proxy"].models).toEqual([
      "deepseek-v4-pro",
      "deepseek-v4-flash",
    ]);
  });

  it("makes legacy implicit memory master defaults explicit without overriding user choices", () => {
    writeAgentConfig(agentsDir, "legacy", {
      agent: { name: "Legacy" },
      memory: { token_budget: 2500 },
    });
    writeAgentConfig(agentsDir, "explicit-off", {
      agent: { name: "Explicit Off" },
      memory: { enabled: false, token_budget: 1000 },
    });
    writeAgentConfig(agentsDir, "explicit-on", {
      agent: { name: "Explicit On" },
      memory: { enabled: true },
    });

    runMigration13();

    expect(readAgentConfig(agentsDir, "legacy").memory).toEqual({
      token_budget: 2500,
      enabled: true,
    });
    expect(readAgentConfig(agentsDir, "explicit-off").memory).toEqual({
      enabled: false,
      token_budget: 1000,
    });
    expect(readAgentConfig(agentsDir, "explicit-on").memory).toEqual({ enabled: true });
  });
});

// ── 迁移 #1：清理悬空 provider 引用 ─────────────────────────────────────────

describe("migration #1: cleanDanglingProviderRefs", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = path.join(tmpDir, "user");
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("清空指向不存在 provider 的 api.provider", () => {
    writeAgentConfig(agentsDir, "hana", {
      api: { provider: "dead-provider" },
    });
    const prefs = makePrefs(userDir);

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry(["openai"]),
      log: () => {},
    });

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.api.provider).toBe("");
  });

  it("保留指向存在 provider 的引用", () => {
    writeAgentConfig(agentsDir, "hana", {
      api: { provider: "openai" },
      models: { chat: "openai/gpt-4o" },
    });
    const prefs = makePrefs(userDir);

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry(["openai"]),
      log: () => {},
    });

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.api.provider).toBe("openai");
    expect(config.models.chat).toEqual({ id: "gpt-4o", provider: "openai" });
  });

  it("清空 models.chat 中 provider/model 格式的悬空引用", () => {
    writeAgentConfig(agentsDir, "hana", {
      models: { chat: "minimax-token_plan/minimax-large", utility: "openai/gpt-4o-mini" },
    });
    const prefs = makePrefs(userDir);

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry(["openai"]),
      log: () => {},
    });

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.models.chat).toBe("");
    expect(config.models.utility).toEqual({ id: "gpt-4o-mini", provider: "openai" });
  });

  it("清空 models.chat 中 {id, provider} 对象格式的悬空引用", () => {
    writeAgentConfig(agentsDir, "hana", {
      models: { chat: { id: "some-model", provider: "dead-provider" } },
    });
    const prefs = makePrefs(userDir);

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry(["openai"]),
      log: () => {},
    });

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.models.chat).toBe("");
  });

  it("清空 embedding_api.provider 的悬空引用", () => {
    writeAgentConfig(agentsDir, "hana", {
      embedding_api: { provider: "dead" },
    });
    const prefs = makePrefs(userDir);

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.embedding_api.provider).toBe("");
  });

  it("清空 preferences 中悬空的共享模型引用", () => {
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      utility_large_model: { id: "some-model", provider: "dead" },
      utility_api_provider: "also-dead",
    });
    fs.mkdirSync(agentsDir, { recursive: true });

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    const p = prefs.getPreferences();
    expect(p.utility_large_model).toBeNull();
    expect(p.utility_api_provider).toBeNull();
  });

  it("preferences 中字符串格式的悬空共享模型也被清空", () => {
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      utility_model: "dead-provider/fast-model",
    });
    fs.mkdirSync(agentsDir, { recursive: true });

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry(["openai"]),
      log: () => {},
    });

    const p = prefs.getPreferences();
    expect(p.utility_model).toBeNull();
  });

  it("多个 agent 同时修复", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "dead" } });
    writeAgentConfig(agentsDir, "butter", { api: { provider: "openai" } });
    writeAgentConfig(agentsDir, "xiaohua", {
      api: { provider: "dead" },
      models: { chat: "dead/model" },
    });
    const prefs = makePrefs(userDir);

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry(["openai"]),
      log: () => {},
    });

    expect(readAgentConfig(agentsDir, "hana").api.provider).toBe("");
    expect(readAgentConfig(agentsDir, "butter").api.provider).toBe("openai");
    expect(readAgentConfig(agentsDir, "xiaohua").api.provider).toBe("");
    expect(readAgentConfig(agentsDir, "xiaohua").models.chat).toBe("");
  });
});

// ── 迁移 #2：bridge 配置从全局 prefs 迁移到 per-agent config.yaml ──────────

describe("migration #2: migrateBridgeToPerAgent", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = path.join(tmpDir, "user");
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  /** 跳过 migration #1 直接测 #2：把 _dataVersion 设为 1 */
  function runMigration2(prefs) {
    const p = prefs.getPreferences();
    p._dataVersion = 1;
    prefs.savePreferences(p);

    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });
  }

  it("基本迁移：单 agent，telegram + owner → config.yaml bridge 区块", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "hana",
      bridge: {
        telegram: { token: "tok123", webhook: true },
        owner: { telegram: "user-001" },
        readOnly: false,
      },
    });

    runMigration2(prefs);

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.bridge.telegram.token).toBe("tok123");
    expect(config.bridge.telegram.webhook).toBe(true);
    expect(config.bridge.telegram.owner).toBe("user-001");

    // prefs.bridge should be deleted
    const p = prefs.getPreferences();
    expect(p.bridge).toBeUndefined();
  });

  it("多 agent 分组：telegram→agent-a，feishu→agent-b", () => {
    writeAgentConfig(agentsDir, "agent-a", { api: { provider: "" } });
    writeAgentConfig(agentsDir, "agent-b", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "agent-a",
      bridge: {
        telegram: { token: "tg-tok", agentId: "agent-a" },
        feishu: { appId: "fs-app", agentId: "agent-b" },
        owner: {},
        readOnly: false,
      },
    });

    runMigration2(prefs);

    const cfgA = readAgentConfig(agentsDir, "agent-a");
    const cfgB = readAgentConfig(agentsDir, "agent-b");

    expect(cfgA.bridge.telegram.token).toBe("tg-tok");
    expect(cfgA.bridge.telegram.agentId).toBeUndefined(); // agentId stripped
    expect(cfgA.bridge.feishu).toBeUndefined();

    expect(cfgB.bridge.feishu.appId).toBe("fs-app");
    expect(cfgB.bridge.feishu.agentId).toBeUndefined();
    expect(cfgB.bridge.telegram).toBeUndefined();
  });

  it("legacy owner key：owner.telegram（无 composite）→ 归入 primary agent", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "hana",
      bridge: {
        telegram: { token: "tok" },
        owner: { telegram: "legacy-owner" },
      },
    });

    runMigration2(prefs);

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.bridge.telegram.owner).toBe("legacy-owner");
  });

  it("composite owner key：owner['telegram:agent-a'] → 归入 agent-a", () => {
    writeAgentConfig(agentsDir, "agent-a", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "agent-a",
      bridge: {
        telegram: { token: "tok", agentId: "agent-a" },
        owner: {
          telegram: "legacy-owner",
          "telegram:agent-a": "composite-owner",
        },
      },
    });

    runMigration2(prefs);

    const config = readAgentConfig(agentsDir, "agent-a");
    // composite key takes priority over legacy key
    expect(config.bridge.telegram.owner).toBe("composite-owner");
  });

  it("无 bridge 配置 → no-op", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ primaryAgent: "hana" });

    runMigration2(prefs);

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.bridge).toBeUndefined();

    const p = prefs.getPreferences();
    expect(p.bridge).toBeUndefined();
  });

  it("agentId 指向已删除 agent → 回退到 primaryAgent", () => {
    // agent-a does NOT exist, only hana exists
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "hana",
      bridge: {
        telegram: { token: "tok", agentId: "deleted-agent" },
        owner: {},
      },
    });

    runMigration2(prefs);

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.bridge.telegram.token).toBe("tok");
    expect(config.bridge.telegram.agentId).toBeUndefined();
  });

  it("保留 bridge.readOnly 为全局偏好，不再写入 agent config", () => {
    writeAgentConfig(agentsDir, "primary", { api: { provider: "" } });
    writeAgentConfig(agentsDir, "secondary", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "primary",
      bridge: {
        telegram: { token: "tg", agentId: "primary" },
        feishu: { appId: "fs", agentId: "secondary" },
        owner: {},
        readOnly: true,
      },
    });

    runMigration2(prefs);

    const cfgPrimary = readAgentConfig(agentsDir, "primary");
    const cfgSecondary = readAgentConfig(agentsDir, "secondary");

    expect(cfgPrimary.bridge.readOnly).toBeUndefined();
    expect(cfgSecondary.bridge.readOnly).toBeUndefined();
    expect(prefs.getPreferences().bridge?.readOnly).toBe(true);
  });
});

// ── 迁移 #3：workspace (home_folder) 从全局 prefs 迁移到 per-agent config ───

describe("migration #3 — migrateWorkspaceToPerAgent", () => {
  let tmpDir, userDir, agentsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    userDir = path.join(tmpDir, "user");
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runMigration3(prefs) {
    const p = prefs.getPreferences();
    p._dataVersion = 2;
    prefs.savePreferences(p);
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });
  }

  it("migrates home_folder to primary agent config.yaml", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "hana",
      home_folder: "/Users/test/Desktop",
      _dataVersion: 2,
    });

    runMigration3(prefs);

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.desk.home_folder).toBe("/Users/test/Desktop");

    const p = prefs.getPreferences();
    expect(p.home_folder).toBeUndefined();
    expect(p._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("skips when home_folder is empty", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ primaryAgent: "hana", _dataVersion: 2 });

    runMigration3(prefs);

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.desk).toBeUndefined();
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("falls back to first agent when primaryAgent not found", () => {
    writeAgentConfig(agentsDir, "alpha", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "deleted-agent",
      home_folder: "/workspace",
      _dataVersion: 2,
    });

    runMigration3(prefs);

    const config = readAgentConfig(agentsDir, "alpha");
    expect(config.desk.home_folder).toBe("/workspace");
    expect(prefs.getPreferences().home_folder).toBeUndefined();
  });

  it("does not write home_folder to non-primary agents, but disables their heartbeat", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    writeAgentConfig(agentsDir, "assistant", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "hana",
      home_folder: "/workspace",
      _dataVersion: 2,
    });

    runMigration3(prefs);

    const hanaConfig = readAgentConfig(agentsDir, "hana");
    const assistantConfig = readAgentConfig(agentsDir, "assistant");
    expect(hanaConfig.desk.home_folder).toBe("/workspace");
    expect(assistantConfig.desk.home_folder).toBeUndefined();
    expect(assistantConfig.desk.heartbeat_enabled).toBe(false);
  });

  it("preserves data when no agent config.yaml exists (version stays at 2)", () => {
    fs.mkdirSync(path.join(agentsDir, "hana"), { recursive: true });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "hana",
      home_folder: "/workspace",
      _dataVersion: 2,
    });

    // migration #3 throws internally; runner catches it and breaks without bumping version
    runMigration3(prefs);

    const p = prefs.getPreferences();
    expect(p.home_folder).toBe("/workspace");
    expect(p._dataVersion).toBe(2);
  });

  it("is idempotent — rerun after success is a no-op", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "hana",
      home_folder: "/workspace",
      _dataVersion: 2,
    });

    runMigration3(prefs);
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);

    // Manually reset _dataVersion to 2 to simulate forced rerun
    const p2 = prefs.getPreferences();
    p2._dataVersion = 2;
    prefs.savePreferences(p2);
    runMigration3(prefs);

    // home_folder is gone from prefs, so migration skips cleanly
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
    const config = readAgentConfig(agentsDir, "hana");
    expect(config.desk.home_folder).toBe("/workspace");
  });

  it("preserves existing desk fields when merging home_folder", () => {
    writeAgentConfig(agentsDir, "hana", {
      api: { provider: "" },
      desk: { heartbeat_enabled: false, heartbeat_interval: 30 },
    });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "hana",
      home_folder: "/workspace",
      _dataVersion: 2,
    });

    runMigration3(prefs);

    const config = readAgentConfig(agentsDir, "hana");
    expect(config.desk.home_folder).toBe("/workspace");
    expect(config.desk.heartbeat_enabled).toBe(false);
    expect(config.desk.heartbeat_interval).toBe(30);
  });

  it("disables heartbeat for non-primary agents", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    writeAgentConfig(agentsDir, "assistant", { api: { provider: "" } });
    writeAgentConfig(agentsDir, "research", { api: { provider: "" } });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "hana",
      home_folder: "/workspace",
      _dataVersion: 2,
    });

    runMigration3(prefs);

    // Primary agent keeps heartbeat on (default)
    const hanaConfig = readAgentConfig(agentsDir, "hana");
    expect(hanaConfig.desk.heartbeat_enabled).toBeUndefined();

    // Non-primary agents get heartbeat disabled
    const assistantConfig = readAgentConfig(agentsDir, "assistant");
    expect(assistantConfig.desk.heartbeat_enabled).toBe(false);

    const researchConfig = readAgentConfig(agentsDir, "research");
    expect(researchConfig.desk.heartbeat_enabled).toBe(false);
  });

  it("respects existing heartbeat_enabled on non-primary agents", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    writeAgentConfig(agentsDir, "assistant", {
      api: { provider: "" },
      desk: { heartbeat_enabled: true },
    });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      primaryAgent: "hana",
      home_folder: "/workspace",
      _dataVersion: 2,
    });

    runMigration3(prefs);

    // User explicitly set heartbeat_enabled=true → migration respects it
    const assistantConfig = readAgentConfig(agentsDir, "assistant");
    expect(assistantConfig.desk.heartbeat_enabled).toBe(true);
  });
});

// ── 迁移 #9：bridge.readOnly 从 per-agent 收敛到全局 prefs ──────────────────

describe("migration #9 — migrateBridgeReadOnlyToGlobal", () => {
  let tmpDir, userDir, agentsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    userDir = path.join(tmpDir, "user");
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runMigration9(prefs) {
    const p = prefs.getPreferences();
    p._dataVersion = 8;
    prefs.savePreferences(p);

    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });
  }

  it("lifts any agent-level bridge.readOnly into preferences and removes stale agent fields", () => {
    writeAgentConfig(agentsDir, "agent-a", {
      api: { provider: "" },
      bridge: {
        readOnly: true,
        telegram: { token: "tg-a" },
      },
    });
    writeAgentConfig(agentsDir, "agent-b", {
      api: { provider: "" },
      bridge: {
        readOnly: false,
        feishu: { appId: "fs-b" },
      },
    });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({});

    runMigration9(prefs);

    expect(prefs.getPreferences().bridge?.readOnly).toBe(true);

    const cfgA = readAgentConfig(agentsDir, "agent-a");
    const cfgB = readAgentConfig(agentsDir, "agent-b");
    expect(cfgA.bridge.readOnly).toBeUndefined();
    expect(cfgB.bridge.readOnly).toBeUndefined();
    expect(cfgA.bridge.telegram).toEqual({ token: "tg-a" });
    expect(cfgB.bridge.feishu).toEqual({ appId: "fs-b" });
  });
});

describe("migration #4 — migrateSubagentExecutorMetadata", () => {
  let tmpDir, userDir, agentsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    userDir = path.join(tmpDir, "user");
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runMigration4(prefs) {
    const p = prefs.getPreferences();
    p._dataVersion = 3;
    prefs.savePreferences(p);
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });
  }

  it("migrates explicit delegated executor metadata into parent session history and child sidecar", () => {
    writeAgentConfig(agentsDir, "hanako", { agent: { name: "Hanako" }, api: { provider: "" } });
    writeAgentConfig(agentsDir, "butter", { agent: { name: "butter" }, api: { provider: "" } });
    const prefs = makePrefs(userDir);
    const parentSessionPath = path.join(agentsDir, "hanako", "sessions", "parent.jsonl");
    const childSessionPath = path.join(agentsDir, "hanako", "subagent-sessions", "child.jsonl");

    writeSessionJsonl(parentSessionPath, [
      { role: "assistant", content: "parent says hi" },
      {
        role: "toolResult",
        toolName: "subagent",
        details: {
          taskId: "subagent-1",
          task: "delegate to butter",
          agentId: "butter",
          agentName: "butter",
          sessionPath: childSessionPath,
          streamStatus: "done",
        },
      },
    ]);
    fs.mkdirSync(path.dirname(childSessionPath), { recursive: true });
    fs.writeFileSync(childSessionPath, "", "utf-8");

    runMigration4(prefs);

    const entries = readSessionJsonl(parentSessionPath);
    const details = entries[1].message.details;
    expect(details.executorAgentId).toBe("butter");
    expect(details.executorAgentNameSnapshot).toBe("butter");
    expect(details.executorMetaVersion).toBe(1);

    const sidecar = JSON.parse(fs.readFileSync(path.join(path.dirname(childSessionPath), "session-meta.json"), "utf-8"));
    expect(sidecar["child.jsonl"]).toMatchObject({
      executorAgentId: "butter",
      executorAgentNameSnapshot: "butter",
      executorMetaVersion: 1,
    });
  });

  it("backfills legacy self-dispatch records from the owning agent directory when executor metadata is missing", () => {
    writeAgentConfig(agentsDir, "hanako", { agent: { name: "Hanako" }, api: { provider: "" } });
    const prefs = makePrefs(userDir);
    const parentSessionPath = path.join(agentsDir, "hanako", "sessions", "parent.jsonl");
    const childSessionPath = path.join(agentsDir, "hanako", "subagent-sessions", "child.jsonl");

    writeSessionJsonl(parentSessionPath, [
      { role: "assistant", content: "parent says hi" },
      {
        role: "toolResult",
        toolName: "subagent",
        details: {
          taskId: "subagent-1",
          task: "self-dispatch legacy task",
          sessionPath: childSessionPath,
          streamStatus: "done",
        },
      },
    ]);
    fs.mkdirSync(path.dirname(childSessionPath), { recursive: true });
    fs.writeFileSync(childSessionPath, "", "utf-8");

    runMigration4(prefs);

    const entries = readSessionJsonl(parentSessionPath);
    const details = entries[1].message.details;
    expect(details.executorAgentId).toBe("hanako");
    expect(details.executorAgentNameSnapshot).toBe("Hanako");
    expect(details.agentId).toBe("hanako");
    expect(details.agentName).toBe("Hanako");

    const sidecar = JSON.parse(fs.readFileSync(path.join(path.dirname(childSessionPath), "session-meta.json"), "utf-8"));
    expect(sidecar["child.jsonl"]).toMatchObject({
      executorAgentId: "hanako",
      executorAgentNameSnapshot: "Hanako",
      executorMetaVersion: 1,
    });
  });
});

// ── 迁移 #7：模型能力字段 vision → image 重命名 ─────────────────────────────

describe("#7 migrateVisionToImage", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = tmpDir; // hanakoHome 根目录，模拟 added-models.yaml 所在位置
    fs.mkdirSync(agentsDir, { recursive: true });
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runMigration7(prefs) {
    prefs.savePreferences({ _dataVersion: 6 });  // 跳过 #1-#6，直接测 #7
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });
  }

  function writeAddedModelsYaml(providers) {
    const data = { providers };
    fs.writeFileSync(
      path.join(tmpDir, "added-models.yaml"),
      YAML.dump(data, { indent: 2, lineWidth: -1, sortKeys: false, quotingType: "\"" }),
      "utf-8",
    );
  }
  function readAddedModelsYaml() {
    return YAML.load(fs.readFileSync(path.join(tmpDir, "added-models.yaml"), "utf-8"));
  }

  it("重命名 added-models.yaml 里 model 对象的 vision 字段为 image", () => {
    const prefs = makePrefs(userDir);
    writeAddedModelsYaml({
      dashscope: {
        base_url: "https://x.y/v1",
        api_key: "sk-x",
        models: [
          { id: "qwen3-max", vision: true, reasoning: true },
          { id: "qwen-plus", vision: false },
          "qwen-turbo",  // 裸字符串条目，不应报错
        ],
      },
    });

    runMigration7(prefs);

    const raw = readAddedModelsYaml();
    const models = raw.providers.dashscope.models;
    expect(models[0]).toEqual({ id: "qwen3-max", image: true, reasoning: true });
    expect(models[0].vision).toBeUndefined();
    expect(models[1]).toEqual({ id: "qwen-plus", image: false });
    expect(models[2]).toBe("qwen-turbo");
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("幂等：已迁移过的 added-models.yaml 重跑不改写", () => {
    const prefs = makePrefs(userDir);
    writeAddedModelsYaml({
      dashscope: {
        base_url: "https://x.y/v1",
        api_key: "sk-x",
        models: [{ id: "qwen3-max", image: true }],
      },
    });

    runMigration7(prefs);

    const raw = readAddedModelsYaml();
    expect(raw.providers.dashscope.models[0]).toEqual({ id: "qwen3-max", image: true });
  });

  it("image 已存在时不覆盖，但仍删除残留 vision", () => {
    const prefs = makePrefs(userDir);
    writeAddedModelsYaml({
      dashscope: {
        base_url: "https://x.y/v1",
        api_key: "sk-x",
        models: [{ id: "qwen3-max", image: true, vision: false }],
      },
    });

    runMigration7(prefs);

    const raw = readAddedModelsYaml();
    expect(raw.providers.dashscope.models[0]).toEqual({ id: "qwen3-max", image: true });
  });

  it("兜底处理 agent config.yaml 的 models.overrides 残留", () => {
    const prefs = makePrefs(userDir);
    writeAgentConfig(agentsDir, "hana", {
      models: {
        overrides: {
          "qwen3-max": { vision: true, reasoning: false, displayName: "Qwen" },
          "deepseek-chat": { vision: false },
        },
      },
    });

    runMigration7(prefs);

    const cfg = readAgentConfig(agentsDir, "hana");
    expect(cfg.models.overrides["qwen3-max"]).toEqual({ image: true, reasoning: false, displayName: "Qwen" });
    expect(cfg.models.overrides["deepseek-chat"]).toEqual({ image: false });
  });

  it("added-models.yaml 不存在时不报错，_dataVersion 推进", () => {
    const prefs = makePrefs(userDir);
    // 不写 added-models.yaml 也不写任何 agent config

    runMigration7(prefs);

    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });
});

describe("migration #14: migrate Gemini OpenAI compatibility configs to native Google API", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = tmpDir;
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runMigration14(prefs) {
    prefs.savePreferences({ _dataVersion: 13 });
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });
  }

  function writeAddedModelsYaml(providers) {
    fs.writeFileSync(
      path.join(tmpDir, "added-models.yaml"),
      YAML.dump({ providers }, { indent: 2, lineWidth: -1, sortKeys: false, quotingType: "\"" }),
      "utf-8",
    );
  }

  function readAddedModelsYaml() {
    return YAML.load(fs.readFileSync(path.join(tmpDir, "added-models.yaml"), "utf-8"));
  }

  it("rewrites official Gemini OpenAI endpoint configs to the native Google API", () => {
    const prefs = makePrefs(userDir);
    writeAddedModelsYaml({
      gemini: {
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai/",
        api: "openai-completions",
        api_key: "sk-test",
        models: ["gemini-3.1-pro-preview"],
      },
    });

    runMigration14(prefs);

    const raw = readAddedModelsYaml();
    expect(raw.providers.gemini.base_url).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(raw.providers.gemini.api).toBe("google-generative-ai");
    expect(raw.providers.gemini.models).toEqual(["gemini-3.1-pro-preview"]);
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("also repairs custom aliases that point directly at the official Gemini OpenAI endpoint", () => {
    const prefs = makePrefs(userDir);
    writeAddedModelsYaml({
      "my-gemini": {
        base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
        api_key: "sk-test",
        models: ["gemini-3-flash-preview"],
      },
      "proxy-gemini": {
        base_url: "https://proxy.example.com/v1/openai",
        api: "openai-completions",
        api_key: "sk-test",
        models: ["gemini-3-flash-preview"],
      },
    });

    runMigration14(prefs);

    const raw = readAddedModelsYaml();
    expect(raw.providers["my-gemini"].base_url).toBe("https://generativelanguage.googleapis.com/v1beta");
    expect(raw.providers["my-gemini"].api).toBe("google-generative-ai");
    expect(raw.providers["proxy-gemini"].base_url).toBe("https://proxy.example.com/v1/openai");
    expect(raw.providers["proxy-gemini"].api).toBe("openai-completions");
  });
});

describe("migration #15: repair legacy session sidecar thinking levels", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = tmpDir;
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runMigration15(prefs) {
    prefs.savePreferences({ _dataVersion: 14 });
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });
  }

  function writeSessionMeta(agentId, meta) {
    const sessionDir = path.join(agentsDir, agentId, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir, "session-meta.json"),
      JSON.stringify(meta, null, 2) + "\n",
      "utf-8",
    );
  }

  function readSessionMeta(agentId) {
    return JSON.parse(fs.readFileSync(path.join(agentsDir, agentId, "sessions", "session-meta.json"), "utf-8"));
  }

  it("downgrades prompt-snapshotted xhigh entries when xhigh support cannot be proven", () => {
    const prefs = makePrefs(userDir);
    const originalMeta = {
      "legacy-xhigh.jsonl": {
        thinkingLevel: "xhigh",
        memoryEnabled: true,
        workspaceFolders: ["/tmp/project"],
        promptSnapshot: {
          version: 1,
          systemPrompt: "frozen prompt",
          appendSystemPrompt: [],
          skillsResult: { skills: [], diagnostics: [] },
          agentsFilesResult: { agentsFiles: [] },
        },
      },
      "known-xhigh-model.jsonl": {
        thinkingLevel: "xhigh",
        model: { id: "gpt-5.4-thinking", provider: "openai" },
        promptSnapshot: {
          version: 1,
          systemPrompt: "frozen prompt",
          appendSystemPrompt: [],
          skillsResult: { skills: [], diagnostics: [] },
          agentsFilesResult: { agentsFiles: [] },
        },
      },
      "live-session.jsonl": {
        thinkingLevel: "xhigh",
      },
      "already-high.jsonl": {
        thinkingLevel: "high",
        promptSnapshot: {
          version: 1,
          systemPrompt: "frozen prompt",
          appendSystemPrompt: [],
          skillsResult: { skills: [], diagnostics: [] },
          agentsFilesResult: { agentsFiles: [] },
        },
      },
    };
    writeSessionMeta("hana", originalMeta);

    runMigration15(prefs);

    const meta = readSessionMeta("hana");
    expect(meta["legacy-xhigh.jsonl"]).toMatchObject({
      thinkingLevel: "high",
      memoryEnabled: true,
      workspaceFolders: ["/tmp/project"],
    });
    expect(meta["legacy-xhigh.jsonl"].promptSnapshot.systemPrompt).toBe("frozen prompt");
    expect(meta["known-xhigh-model.jsonl"].thinkingLevel).toBe("xhigh");
    expect(meta["live-session.jsonl"].thinkingLevel).toBe("xhigh");
    expect(meta["already-high.jsonl"].thinkingLevel).toBe("high");

    const backupPath = path.join(agentsDir, "hana", "sessions", "session-meta.json.pre-v15.bak");
    expect(JSON.parse(fs.readFileSync(backupPath, "utf-8"))).toEqual(originalMeta);
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });
});

describe("migration #16: video capability projection", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = tmpDir;
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runMigration16(prefs) {
    prefs.savePreferences({ _dataVersion: 15 });
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistryWithModels({
        dashscope: { models: [{ id: "qwen3-vl-plus" }] },
      }),
      log: () => {},
    });
  }

  it("repairs stale models.json input arrays for known video-capable models", () => {
    const prefs = makePrefs(userDir);
    const modelsJsonPath = path.join(tmpDir, "models.json");
    fs.writeFileSync(modelsJsonPath, JSON.stringify({
      providers: {
        dashscope: {
          models: [
            { id: "qwen3-vl-plus", input: ["text", "image"] },
            { id: "qwen-plus", input: ["text"] },
          ],
        },
      },
    }, null, 2) + "\n", "utf-8");

    runMigration16(prefs);

    const raw = JSON.parse(fs.readFileSync(modelsJsonPath, "utf-8"));
    expect(raw.providers.dashscope.models[0].input).toEqual(["text", "image"]);
    expect(raw.providers.dashscope.models[0].compat.hanaVideoInput).toBe(true);
    expect(raw.providers.dashscope.models[0]).not.toHaveProperty("video");
    expect(raw.providers.dashscope.models[1].input).toEqual(["text"]);
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("promotes legacy agent model override video flags into added-models.yaml", () => {
    const prefs = makePrefs(userDir);
    fs.writeFileSync(
      path.join(tmpDir, "added-models.yaml"),
      YAML.dump({
        providers: {
          dashscope: {
            base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            api_key: "sk-x",
            models: ["qwen3-vl-plus"],
          },
        },
      }, { indent: 2, lineWidth: -1, sortKeys: false, quotingType: "\"" }),
      "utf-8",
    );
    writeAgentConfig(agentsDir, "hana", {
      models: {
        overrides: {
          "qwen3-vl-plus": { video: true, displayName: "Qwen VL" },
        },
      },
    });

    runMigration16(prefs);

    const raw = YAML.load(fs.readFileSync(path.join(tmpDir, "added-models.yaml"), "utf-8"));
    expect(raw.providers.dashscope.models[0]).toEqual({ id: "qwen3-vl-plus", video: true });
    const cfg = readAgentConfig(agentsDir, "hana");
    expect(cfg.models.overrides["qwen3-vl-plus"]).toEqual({ displayName: "Qwen VL" });
  });
});

describe("migration #20: Pi model input schema compatibility", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = tmpDir;
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runMigration20(prefs) {
    prefs.savePreferences({ _dataVersion: 19 });
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistryWithModels({}),
      log: () => {},
    });
  }

  it("removes invalid Pi input modalities and preserves Hana video capability in compat", async () => {
    const prefs = makePrefs(userDir);
    const modelsJsonPath = path.join(tmpDir, "models.json");
    fs.writeFileSync(modelsJsonPath, JSON.stringify({
      providers: {
        dashscope: {
          baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          api: "openai-completions",
          apiKey: "sk-test",
          models: [
            { id: "qwen3-vl-plus", name: "Qwen VL", input: ["text", "image", "video"] },
            { id: "qwen-plus", name: "Qwen Plus", input: ["text", "audio"] },
            { id: "custom-video", name: "Custom Video", input: ["video"], video: true },
          ],
          modelOverrides: {
            "qwen3-vl-plus": { input: ["text", "image", "video"] },
            "qwen-plus": { input: ["text", "audio"] },
          },
        },
      },
    }, null, 2) + "\n", "utf-8");

    runMigration20(prefs);

    const raw = JSON.parse(fs.readFileSync(modelsJsonPath, "utf-8"));
    expect(raw.providers.dashscope.models[0]).toMatchObject({
      id: "qwen3-vl-plus",
      input: ["text", "image"],
      compat: { hanaVideoInput: true },
    });
    expect(raw.providers.dashscope.models[1]).toMatchObject({
      id: "qwen-plus",
      input: ["text"],
    });
    expect(raw.providers.dashscope.models[1].compat?.hanaVideoInput).toBeUndefined();
    expect(raw.providers.dashscope.models[2]).toMatchObject({
      id: "custom-video",
      input: ["text"],
      compat: { hanaVideoInput: true },
    });
    expect(raw.providers.dashscope.models[2]).not.toHaveProperty("video");
    expect(raw.providers.dashscope.modelOverrides["qwen3-vl-plus"]).toMatchObject({
      input: ["text", "image"],
      compat: { hanaVideoInput: true },
    });
    expect(raw.providers.dashscope.modelOverrides["qwen-plus"]).toEqual({
      input: ["text"],
    });

    const { AuthStorage, createModelRegistry } = await import("../lib/pi-sdk/index.js");
    const registry = createModelRegistry(new AuthStorage(tmpDir), modelsJsonPath);
    const available = await registry.getAvailable();
    expect(available.map((model) => model.id)).toEqual(["qwen3-vl-plus", "qwen-plus", "custom-video"]);
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });
});

describe("migration #21: video transport capability refresh", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = tmpDir;
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runMigration21(prefs) {
    prefs.savePreferences({ _dataVersion: 20 });
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistryWithModels({}),
      log: () => {},
    });
  }

  it("repairs existing models.json entries for newly declared Kimi video models", () => {
    const prefs = makePrefs(userDir);
    const modelsJsonPath = path.join(tmpDir, "models.json");
    fs.writeFileSync(modelsJsonPath, JSON.stringify({
      providers: {
        moonshot: {
          baseUrl: "https://api.moonshot.cn/v1",
          api: "openai-completions",
          apiKey: "sk-test",
          models: [
            { id: "kimi-k2.6", name: "Kimi K2.6", input: ["text", "image"] },
          ],
        },
      },
    }, null, 2) + "\n", "utf-8");

    runMigration21(prefs);

    const raw = JSON.parse(fs.readFileSync(modelsJsonPath, "utf-8"));
    expect(raw.providers.moonshot.models[0]).toMatchObject({
      id: "kimi-k2.6",
      input: ["text", "image"],
      compat: { hanaVideoInput: true },
    });
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });
});

describe("migration #8 — repairPostMigrationModelRefs", () => {
  let tmpDir, userDir, agentsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    userDir = path.join(tmpDir, "user");
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("修复 migration #5 之后又被旧入口写回的裸字符串 chat model", () => {
    writeAgentConfig(agentsDir, "hana", {
      models: { chat: "qwen3.6-flash" },
    });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 7 });

    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistryWithModels({
        dashscope: {
          models: [{ id: "qwen3.6-flash" }],
        },
      }),
      log: () => {},
    });

    const cfg = readAgentConfig(agentsDir, "hana");
    expect(cfg.models.chat).toEqual({ id: "qwen3.6-flash", provider: "dashscope" });
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });
});

describe("migration #10 — cleanupSummarizerCompilerRemnants", () => {
  let tmpDir, userDir, agentsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    userDir = path.join(tmpDir, "user");
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("删除 preferences 里的 summarizer_model / compiler_model 字段（key 整体消失）", () => {
    const prefs = makePrefs(userDir);
    prefs.savePreferences({
      _dataVersion: 9,
      utility_model: "openai/gpt-4o-mini",
      summarizer_model: "openai/gpt-4o-mini",
      compiler_model: { id: "gpt-4o", provider: "openai" },
    });

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry(["openai"]),
      log: () => {},
    });

    const p = prefs.getPreferences();
    expect("summarizer_model" in p).toBe(false);
    expect("compiler_model" in p).toBe(false);
    expect(p.utility_model).toBe("openai/gpt-4o-mini");
  });

  it("删除每个 agent config.yaml 的 models.summarizer / models.compiler", () => {
    writeAgentConfig(agentsDir, "hana", {
      models: {
        chat: { id: "claude-opus-4-7", provider: "anthropic" },
        utility: { id: "claude-haiku-4-5", provider: "anthropic" },
        summarizer: "openai/gpt-4o-mini",
        compiler: { id: "gpt-4o", provider: "openai" },
      },
    });
    writeAgentConfig(agentsDir, "butter", {
      models: { chat: { id: "claude-haiku-4-5", provider: "anthropic" } },
    });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 9 });

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry(["anthropic", "openai"]),
      log: () => {},
    });

    const hana = readAgentConfig(agentsDir, "hana");
    expect("summarizer" in hana.models).toBe(false);
    expect("compiler" in hana.models).toBe(false);
    expect(hana.models.chat).toEqual({ id: "claude-opus-4-7", provider: "anthropic" });
    expect(hana.models.utility).toEqual({ id: "claude-haiku-4-5", provider: "anthropic" });

    // 没有残留的 agent 不被影响
    const butter = readAgentConfig(agentsDir, "butter");
    expect(butter.models.chat).toEqual({ id: "claude-haiku-4-5", provider: "anthropic" });
  });

  it("幂等：没有残留字段时不抛错，version 仍推进", () => {
    writeAgentConfig(agentsDir, "hana", {
      models: { chat: { id: "claude-opus-4-7", provider: "anthropic" } },
    });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 9 });

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry(["anthropic"]),
      log: () => {},
    });

    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });
});

describe("migration #17 — migrateBridgeSessionKeysToAgentScoped", () => {
  let tmpDir, userDir, agentsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    userDir = path.join(tmpDir, "user");
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function writeBridgeIndex(agentId, index) {
    const bridgeDir = path.join(agentsDir, agentId, "sessions", "bridge");
    fs.mkdirSync(bridgeDir, { recursive: true });
    fs.writeFileSync(
      path.join(bridgeDir, "bridge-sessions.json"),
      JSON.stringify(index, null, 2) + "\n",
      "utf-8",
    );
  }

  function readBridgeIndex(agentId) {
    return JSON.parse(fs.readFileSync(
      path.join(agentsDir, agentId, "sessions", "bridge", "bridge-sessions.json"),
      "utf-8",
    ));
  }

  it("adds the owning agent suffix to legacy bridge session keys", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    writeBridgeIndex("hana", {
      "wx_dm_wx-user": { file: "owner/wx.jsonl", userId: "wx-user", name: "Alice" },
      "tg_dm_12345": "owner/tg.jsonl",
      "wx_dm_someone@openim": { file: "owner/openim.jsonl", userId: "someone@openim" },
      "wx_dm_existing@hana": { file: "owner/current.jsonl", userId: "existing" },
    });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 16 });

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    const index = readBridgeIndex("hana");
    expect(index["wx_dm_wx-user"]).toBeUndefined();
    expect(index["tg_dm_12345"]).toBeUndefined();
    expect(index["wx_dm_someone@openim"]).toBeUndefined();
    expect(index["wx_dm_wx-user@hana"]).toEqual({ file: "owner/wx.jsonl", userId: "wx-user", name: "Alice" });
    expect(index["tg_dm_12345@hana"]).toBe("owner/tg.jsonl");
    expect(index["wx_dm_someone@openim@hana"]).toEqual({ file: "owner/openim.jsonl", userId: "someone@openim" });
    expect(index["wx_dm_existing@hana"]).toEqual({ file: "owner/current.jsonl", userId: "existing" });
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("fills an existing scoped metadata entry from legacy history", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    writeBridgeIndex("hana", {
      "wx_dm_user": { file: "owner/legacy.jsonl", userId: "user", name: "Old" },
      "wx_dm_user@hana": { name: "Current", chatId: "user" },
    });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 16 });

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    const index = readBridgeIndex("hana");
    expect(index["wx_dm_user"]).toBeUndefined();
    expect(index["wx_dm_user@hana"]).toEqual({
      file: "owner/legacy.jsonl",
      userId: "user",
      name: "Current",
      chatId: "user",
    });
  });

  it("keeps legacy history when the scoped key already has history", () => {
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });
    writeBridgeIndex("hana", {
      "wx_dm_user": { file: "owner/legacy.jsonl", userId: "user", name: "Old" },
      "wx_dm_user@hana": { file: "owner/current.jsonl", userId: "user", name: "Current" },
    });
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 16 });

    runMigrations({
      hanakoHome: tmpDir, agentsDir, prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    const index = readBridgeIndex("hana");
    expect(index["wx_dm_user"]).toEqual({ file: "owner/legacy.jsonl", userId: "user", name: "Old" });
    expect(index["wx_dm_user@hana"]).toEqual({ file: "owner/current.jsonl", userId: "user", name: "Current" });
  });
});

describe("migration #22 — migrateChannelPhoneSettingsDefaults", () => {
  let tmpDir, userDir, agentsDir, channelsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    userDir = path.join(tmpDir, "user");
    agentsDir = path.join(tmpDir, "agents");
    channelsDir = path.join(tmpDir, "channels");
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(channelsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("adds explicit default reminder and disabled model override fields to legacy channel files", () => {
    fs.writeFileSync(
      path.join(channelsDir, "ch_legacy.md"),
      [
        "---",
        "id: ch_legacy",
        "members: [hana, butter]",
        "name: Legacy",
        "---",
        "",
        "### user | 2026-05-12 12:00:00",
        "",
        "hello",
        "",
        "---",
        "",
      ].join("\n"),
      "utf-8",
    );
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 21 });

    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    const raw = fs.readFileSync(path.join(channelsDir, "ch_legacy.md"), "utf-8");
    expect(raw).toContain("agentPhoneReminderIntervalMinutes: 31");
    expect(raw).toContain("agentPhoneProactiveEnabled: true");
    expect(raw).toContain("agentPhoneModelOverrideEnabled: false");
    expect(raw).toContain("### user | 2026-05-12 12:00:00");
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });
});

describe("migration #23 — removeAgentPhoneReplyInstructions", () => {
  let tmpDir, userDir, agentsDir, channelsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    userDir = path.join(tmpDir, "user");
    agentsDir = path.join(tmpDir, "agents");
    channelsDir = path.join(tmpDir, "channels");
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(channelsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("removes the deprecated free-text reply-scope settings from channel and phone projection files", () => {
    fs.writeFileSync(
      path.join(channelsDir, "ch_legacy.md"),
      [
        "---",
        "id: ch_legacy",
        "members: [hana, butter]",
        "name: Legacy",
        `agentPhoneReplyInstructions: ${encodeURIComponent("只在能推进话题时回复")}`,
        "agentPhoneReplyMinChars: 20",
        "---",
        "",
        "### user | 2026-05-12 12:00:00",
        "",
        "hello",
        "",
        "---",
        "",
      ].join("\n"),
      "utf-8",
    );

    const agentDir = path.join(agentsDir, "hana");
    const projectionPath = getAgentPhoneProjectionPath(agentDir, "ch_legacy");
    fs.mkdirSync(path.dirname(projectionPath), { recursive: true });
    fs.writeFileSync(
      projectionPath,
      [
        "---",
        "agentId: hana",
        "conversationId: ch_legacy",
        `replyInstructions: ${encodeURIComponent("只在能推进话题时回复")}`,
        "replyMinChars: 20",
        "---",
        "",
        "# Agent Phone",
        "",
      ].join("\n"),
      "utf-8",
    );

    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 22 });

    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    const channelRaw = fs.readFileSync(path.join(channelsDir, "ch_legacy.md"), "utf-8");
    expect(channelRaw).not.toContain("agentPhoneReplyInstructions");
    expect(channelRaw).toContain("agentPhoneReplyMinChars: 20");
    expect(channelRaw).toContain("### user | 2026-05-12 12:00:00");

    const projectionRaw = fs.readFileSync(projectionPath, "utf-8");
    expect(projectionRaw).not.toContain("replyInstructions");
    expect(projectionRaw).toContain("replyMinChars: 20");
    expect(projectionRaw).toContain("# Agent Phone");
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });
});

describe("migration #24 — migrateChannelPhoneGuardLimitDefaults", () => {
  let tmpDir, userDir, agentsDir, channelsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    userDir = path.join(tmpDir, "user");
    agentsDir = path.join(tmpDir, "agents");
    channelsDir = path.join(tmpDir, "channels");
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(channelsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("adds a per-channel guard limit based on channel member count", () => {
    fs.writeFileSync(
      path.join(channelsDir, "ch_crew.md"),
      [
        "---",
        "id: ch_crew",
        "members: [hana, butter, ming]",
        "name: Crew",
        "---",
        "",
        "### user | 2026-05-12 12:00:00",
        "",
        "hello",
        "",
      ].join("\n"),
      "utf-8",
    );
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 23 });

    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    const raw = fs.readFileSync(path.join(channelsDir, "ch_crew.md"), "utf-8");
    expect(raw).toContain("agentPhoneGuardLimit: 36");
    expect(raw).toContain("### user | 2026-05-12 12:00:00");
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });
});

describe("migration #25 — migrateChannelPhoneProactiveDefaults", () => {
  let tmpDir, userDir, agentsDir, channelsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    userDir = path.join(tmpDir, "user");
    agentsDir = path.join(tmpDir, "agents");
    channelsDir = path.join(tmpDir, "channels");
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.mkdirSync(channelsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it("adds an enabled proactive initiation flag to existing channel metadata", () => {
    fs.writeFileSync(
      path.join(channelsDir, "ch_crew.md"),
      [
        "---",
        "id: ch_crew",
        "members: [hana, butter, ming]",
        "agentPhoneReminderIntervalMinutes: 31",
        "agentPhoneGuardLimit: 36",
        "---",
        "",
        "### user | 2026-05-12 12:00:00",
        "",
        "hello",
        "",
      ].join("\n"),
      "utf-8",
    );
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 24 });

    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    const raw = fs.readFileSync(path.join(channelsDir, "ch_crew.md"), "utf-8");
    expect(raw).toContain("agentPhoneProactiveEnabled: true");
    expect(raw).toContain("### user | 2026-05-12 12:00:00");
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("preserves channels where proactive initiation was explicitly disabled", () => {
    fs.writeFileSync(
      path.join(channelsDir, "ch_quiet.md"),
      [
        "---",
        "id: ch_quiet",
        "members: [hana, butter, ming]",
        "agentPhoneProactiveEnabled: false",
        "---",
        "",
      ].join("\n"),
      "utf-8",
    );
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 24 });

    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });

    const raw = fs.readFileSync(path.join(channelsDir, "ch_quiet.md"), "utf-8");
    expect(raw).toContain("agentPhoneProactiveEnabled: false");
    expect(raw.match(/agentPhoneProactiveEnabled/g)).toHaveLength(1);
  });
});

describe("migration #18 — create local identity registries", () => {
  let tmpDir, userDir, agentsDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    userDir = path.join(tmpDir, "user");
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function runFrom17() {
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 17 });
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry: makeRegistry([]),
      log: () => {},
    });
    return prefs;
  }

  it("creates stable server, legacy owner user, and default personal space for old data roots", () => {
    fs.mkdirSync(path.join(tmpDir, "user", "avatars"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "user", "user.md"), "old profile\n", "utf-8");
    writeAgentConfig(agentsDir, "hana", { api: { provider: "" } });

    const prefs = runFrom17();

    const serverNode = readJson(path.join(tmpDir, "server-node.json"));
    const users = readJson(path.join(tmpDir, "users.json"));
    const spaces = readJson(path.join(tmpDir, "spaces.json"));

    expect(serverNode).toEqual(expect.objectContaining({
      schemaVersion: 1,
      label: "Local Hana",
    }));
    expect(serverNode.serverId).toMatch(/^server_[0-9a-f-]{36}$/);

    expect(users.schemaVersion).toBe(1);
    expect(users.defaultUserId).toMatch(/^user_[0-9a-f-]{36}$/);
    expect(users.users).toEqual([
      expect.objectContaining({
        userId: users.defaultUserId,
        kind: "legacy_owner",
        displayName: "Local User",
        profileSource: "legacy_user_profile",
      }),
    ]);

    expect(spaces.schemaVersion).toBe(1);
    expect(spaces.defaultSpaceId).toMatch(/^space_[0-9a-f-]{36}$/);
    expect(spaces.spaces).toEqual([
      expect.objectContaining({
        spaceId: spaces.defaultSpaceId,
        ownerUserId: users.defaultUserId,
        label: "Personal Space",
        kind: "personal",
        membershipModel: "single_user_implicit",
        storage: {
          provider: "legacy_hana_home",
          legacyRoot: true,
        },
      }),
    ]);
    expect(fs.existsSync(path.join(tmpDir, "user", "user.md"))).toBe(true);
    expect(fs.existsSync(path.join(agentsDir, "hana", "config.yaml"))).toBe(true);
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("preserves existing valid identity registries exactly", () => {
    const serverNodePath = path.join(tmpDir, "server-node.json");
    const usersPath = path.join(tmpDir, "users.json");
    const spacesPath = path.join(tmpDir, "spaces.json");
    const serverNode = {
      schemaVersion: 1,
      serverId: "server_existing",
      label: "Existing Server",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const users = {
      schemaVersion: 1,
      defaultUserId: "user_existing",
      users: [{
        userId: "user_existing",
        kind: "legacy_owner",
        displayName: "Existing User",
        profileSource: "legacy_user_profile",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      }],
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const spaces = {
      schemaVersion: 1,
      defaultSpaceId: "space_existing",
      spaces: [{
        spaceId: "space_existing",
        ownerUserId: "user_existing",
        label: "Existing Space",
        kind: "personal",
        storage: { provider: "legacy_hana_home", legacyRoot: true },
        membershipModel: "single_user_implicit",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      }],
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    writeJson(serverNodePath, serverNode);
    writeJson(usersPath, users);
    writeJson(spacesPath, spaces);

    const prefs = runFrom17();

    expect(readJson(serverNodePath)).toEqual(serverNode);
    expect(readJson(usersPath)).toEqual(users);
    expect(readJson(spacesPath)).toEqual(spaces);
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("completes partial identity registries with consistent owner and space references", () => {
    writeJson(path.join(tmpDir, "server-node.json"), {
      schemaVersion: 1,
      serverId: "server_partial",
      label: "Partial Server",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    writeJson(path.join(tmpDir, "users.json"), {
      schemaVersion: 1,
      defaultUserId: "user_partial",
      users: [{
        userId: "user_partial",
        kind: "legacy_owner",
        displayName: "Partial User",
        profileSource: "legacy_user_profile",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-01T00:00:00.000Z",
      }],
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    const prefs = runFrom17();
    const spaces = readJson(path.join(tmpDir, "spaces.json"));

    expect(spaces.defaultSpaceId).toMatch(/^space_[0-9a-f-]{36}$/);
    expect(spaces.spaces[0]).toEqual(expect.objectContaining({
      spaceId: spaces.defaultSpaceId,
      ownerUserId: "user_partial",
      kind: "personal",
      membershipModel: "single_user_implicit",
    }));
    expect(readJson(path.join(tmpDir, "server-node.json")).serverId).toBe("server_partial");
    expect(readJson(path.join(tmpDir, "users.json")).defaultUserId).toBe("user_partial");
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("fails explicitly and keeps migration version unchanged when identity registries are invalid", () => {
    fs.writeFileSync(path.join(tmpDir, "users.json"), "{ broken json", "utf-8");
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 17 });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      runMigrations({
        hanakoHome: tmpDir,
        agentsDir,
        prefs,
        providerRegistry: makeRegistry([]),
        log: () => {},
      });
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[migrations] #18 失败:"));
    } finally {
      errorSpy.mockRestore();
    }

    expect(prefs.getPreferences()._dataVersion).toBe(17);
    expect(fs.existsSync(path.join(tmpDir, "server-node.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "spaces.json"))).toBe(false);
  });
});

describe("migration #19 — migrate legacy API-key auth to provider config", () => {
  let tmpDir, agentsDir, userDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    agentsDir = path.join(tmpDir, "agents");
    userDir = path.join(tmpDir, "user");
    fs.mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function writeAuth(data) {
    writeJson(path.join(tmpDir, "auth.json"), data);
  }

  function writeAddedModels(data) {
    fs.writeFileSync(
      path.join(tmpDir, "added-models.yaml"),
      YAML.dump(data, { indent: 2, lineWidth: -1, sortKeys: false, quotingType: '"' }),
      "utf-8",
    );
  }

  function readAddedModels() {
    return YAML.load(fs.readFileSync(path.join(tmpDir, "added-models.yaml"), "utf-8"));
  }

  function makeProviderRegistry() {
    return {
      reload: vi.fn(),
      get(id) {
        if (id === "deepseek") {
          return {
            id: "deepseek",
            authType: "api-key",
            baseUrl: "https://api.deepseek.com",
            api: "openai-completions",
            authJsonKey: "deepseek",
          };
        }
        if (id === "openai-codex-oauth") {
          return {
            id: "openai-codex-oauth",
            authType: "oauth",
            baseUrl: "",
            api: "openai-codex-responses",
            authJsonKey: "openai-codex",
          };
        }
        if (id === "openai-codex") {
          return {
            id: "openai-codex-oauth",
            authType: "oauth",
            baseUrl: "",
            api: "openai-codex-responses",
            authJsonKey: "openai-codex",
          };
        }
        if (id === "ollama") {
          return {
            id: "ollama",
            authType: "none",
            baseUrl: "http://localhost:11434/v1",
            api: "openai-completions",
            authJsonKey: "ollama",
          };
        }
        return null;
      },
      getDefaultModels(id) {
        return id === "deepseek" ? ["deepseek-v4-pro", "deepseek-v4-flash"] : [];
      },
    };
  }

  function runFrom18(providerRegistry = makeProviderRegistry()) {
    const prefs = makePrefs(userDir);
    prefs.savePreferences({ _dataVersion: 18 });
    runMigrations({
      hanakoHome: tmpDir,
      agentsDir,
      prefs,
      providerRegistry,
      log: () => {},
    });
    return prefs;
  }

  it("moves legacy DeepSeek API key into existing added-models provider before auth cleanup", () => {
    writeAuth({
      deepseek: { type: "api_key", key: "sk-legacy-4d2a" },
      "openai-codex": { type: "oauth", access: "oauth-access-token" },
    });
    writeAddedModels({
      providers: {
        deepseek: {
          models: ["deepseek-v4-flash"],
        },
      },
    });

    const prefs = runFrom18();

    const providers = readAddedModels().providers;
    expect(providers.deepseek).toEqual({
      api_key: "sk-legacy-4d2a",
      base_url: "https://api.deepseek.com",
      api: "openai-completions",
      models: ["deepseek-v4-flash"],
    });
    expect(providers["openai-codex-oauth"]).toBeUndefined();
    expect(readJson(path.join(tmpDir, "auth.json"))["openai-codex"].access).toBe("oauth-access-token");
    expect(prefs.getPreferences()._dataVersion).toBe(LATEST_DATA_VERSION);
  });

  it("recreates a missing known provider from legacy auth and models.json", () => {
    writeAuth({
      deepseek: { type: "api_key", key: "sk-legacy-4d2a" },
    });
    writeAddedModels({ providers: {} });
    writeJson(path.join(tmpDir, "models.json"), {
      providers: {
        deepseek: {
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
          models: [
            { id: "deepseek-v4-pro" },
            { id: "deepseek-v4-flash" },
          ],
        },
      },
    });

    runFrom18();

    expect(readAddedModels().providers.deepseek).toEqual({
      api_key: "sk-legacy-4d2a",
      base_url: "https://api.deepseek.com",
      api: "openai-completions",
      models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    });
  });

  it("recovers a legacy key from models.json after auth.json has already been cleaned", () => {
    writeAuth({});
    writeAddedModels({
      providers: {
        deepseek: {
          models: ["deepseek-v4-flash"],
        },
      },
    });
    writeJson(path.join(tmpDir, "models.json"), {
      providers: {
        deepseek: {
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
          apiKey: "sk-projected-6ad1",
          models: [
            { id: "deepseek-v4-flash" },
          ],
        },
      },
    });

    runFrom18();

    expect(readAddedModels().providers.deepseek).toEqual({
      api_key: "sk-projected-6ad1",
      base_url: "https://api.deepseek.com",
      api: "openai-completions",
      models: ["deepseek-v4-flash"],
    });
  });

  it("does not persist the synthetic local API key from no-auth provider projections", () => {
    writeAuth({});
    writeAddedModels({
      providers: {
        ollama: {
          base_url: "http://localhost:11434/v1",
          api: "openai-completions",
          models: ["llama3.2"],
        },
      },
    });
    writeJson(path.join(tmpDir, "models.json"), {
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          api: "openai-completions",
          apiKey: "local",
          models: [
            { id: "llama3.2" },
          ],
        },
      },
    });

    runFrom18();

    expect(readAddedModels().providers.ollama).toEqual({
      base_url: "http://localhost:11434/v1",
      api: "openai-completions",
      models: ["llama3.2"],
    });
  });

  it("does not overwrite an explicit added-models API key, including an intentional clear", () => {
    writeAuth({
      deepseek: { type: "api_key", key: "sk-old-3ffa" },
    });
    writeAddedModels({
      providers: {
        deepseek: {
          api_key: "",
          base_url: "https://api.deepseek.com",
          api: "openai-completions",
          models: ["deepseek-v4-pro"],
        },
      },
    });

    runFrom18();

    expect(readAddedModels().providers.deepseek.api_key).toBe("");
  });
});
