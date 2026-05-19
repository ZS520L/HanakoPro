import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HanaEngine } from "../core/engine.js";

describe("HanaEngine.buildTools", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  it("throws when opts.agentDir points at an unknown agent instead of using focus tools", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-build-tools-"));
    const focusAgentDir = path.join(tmpDir, "agents", "focus");
    const missingAgentDir = path.join(tmpDir, "agents", "missing");

    const engine = Object.create(HanaEngine.prototype);
    engine.hanakoHome = tmpDir;
    engine.getAgent = vi.fn(() => null);
    engine._pluginManager = null;
    engine._prefs = { getFileBackup: () => ({ enabled: false }) };
    engine._readPreferences = () => ({ sandbox: true });
    engine._agentMgr = {
      agent: {
        id: "focus",
        agentDir: focusAgentDir,
        tools: [{ name: "focus_custom_tool", execute: vi.fn() }],
      },
    };

    expect(() => engine.buildTools(tmpDir, undefined, {
      agentDir: missingAgentDir,
      workspace: tmpDir,
    })).toThrow(/agent "missing" not found/);
  });

  it("uses an explicit permission mode provider instead of the desktop session default", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-build-tools-"));
    const agentDir = path.join(tmpDir, "agents", "focus");
    const sessionPath = path.join(tmpDir, "sessions", "bridge.jsonl");
    const execute = vi.fn(async () => ({ details: { executed: true } }));
    const confirmStore = {
      create: vi.fn(() => ({
        confirmId: "confirm-tool-1",
        promise: Promise.resolve({ action: "rejected" }),
      })),
    };

    const engine = Object.create(HanaEngine.prototype);
    engine.hanakoHome = tmpDir;
    engine.getAgent = vi.fn(() => ({ id: "focus", agentDir, tools: [] }));
    engine._pluginManager = null;
    engine._prefs = { getFileBackup: () => ({ enabled: false }) };
    engine._readPreferences = () => ({ sandbox: true });
    engine._confirmStore = confirmStore;
    engine._emitEvent = vi.fn();
    engine.getSessionPermissionMode = vi.fn(() => "ask");
    engine._agentMgr = {
      agent: {
        id: "focus",
        agentDir,
        tools: [],
      },
    };

    const { customTools } = engine.buildTools(tmpDir, [
      { name: "stage_files", execute },
    ], {
      agentDir,
      workspace: tmpDir,
      getPermissionMode: () => "operate",
    });

    const result = await customTools[0].execute(
      "call-1",
      { path: "x" },
      { sessionManager: { getSessionFile: () => sessionPath } },
    );

    expect(confirmStore.create).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    expect(result.details.executed).toBe(true);
  });

  it("hides stable availability-disabled tools before building the model schema", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-build-tools-availability-"));
    const agentDir = path.join(tmpDir, "agents", "focus");
    const agent = {
      id: "focus",
      agentDir,
      config: { tools: { disabled: ["browser"] } },
      tools: [],
    };

    const engine = Object.create(HanaEngine.prototype);
    engine.hanakoHome = tmpDir;
    engine.getAgent = vi.fn(() => agent);
    engine.isChannelsEnabled = vi.fn(() => false);
    engine._pluginManager = null;
    engine._prefs = { getFileBackup: () => ({ enabled: false }) };
    engine._readPreferences = () => ({ sandbox: true });
    engine._confirmStore = null;
    engine._emitEvent = vi.fn();
    engine.getSessionPermissionMode = vi.fn(() => "operate");
    engine._agentMgr = {
      agent,
    };

    const { customTools } = engine.buildTools(tmpDir, [
      { name: "browser", execute: vi.fn() },
      { name: "channel", execute: vi.fn() },
      { name: "cron", execute: vi.fn() },
    ], {
      agentDir,
      workspace: tmpDir,
      getPermissionMode: () => "operate",
    });

    expect(customTools.map((tool) => tool.name)).toEqual(["cron"]);
  });

  it("registers files created or modified by write and edit tools in the active session", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-build-tools-touch-"));
    const agentDir = path.join(tmpDir, "agents", "focus");
    const workspace = path.join(tmpDir, "workspace");
    const sessionPath = path.join(agentDir, "sessions", "touch.jsonl");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(sessionPath, "{}\n");

    const registerSessionFile = vi.fn(({ sessionPath, filePath, label, origin, operation }) => ({
      id: `sf_${operation}`,
      sessionPath,
      filePath,
      label,
      origin,
      operation,
    }));
    const engine = Object.create(HanaEngine.prototype);
    engine.hanakoHome = tmpDir;
    engine.registerSessionFile = registerSessionFile;
    engine.getAgent = vi.fn(() => ({ id: "focus", agentDir, tools: [] }));
    engine._pluginManager = null;
    engine._prefs = { getFileBackup: () => ({ enabled: false }) };
    engine._readPreferences = () => ({ sandbox: false });
    engine._confirmStore = null;
    engine._emitEvent = vi.fn();
    engine.getSessionPermissionMode = vi.fn(() => "operate");
    engine._agentMgr = {
      agent: {
        id: "focus",
        agentDir,
        tools: [],
      },
    };

    const { tools } = engine.buildTools(workspace, [], {
      agentDir,
      workspace,
      getSessionPath: () => sessionPath,
    });
    const write = tools.find(tool => tool.name === "write");
    const edit = tools.find(tool => tool.name === "edit");

    const writeResult = await write.execute("write-1", { path: "draft.md", content: "hello\n" });
    const editResult = await edit.execute("edit-1", {
      path: "draft.md",
      edits: [{ oldText: "hello", newText: "hello Hana" }],
    });

    expect(registerSessionFile).toHaveBeenCalledWith(expect.objectContaining({
      sessionPath,
      filePath: path.join(workspace, "draft.md"),
      label: "draft.md",
      origin: "agent_write",
      operation: "created",
    }));
    expect(registerSessionFile).toHaveBeenCalledWith(expect.objectContaining({
      sessionPath,
      filePath: path.join(workspace, "draft.md"),
      label: "draft.md",
      origin: "agent_edit",
      operation: "modified",
    }));
    expect(writeResult.details.sessionFile).toMatchObject({
      id: "sf_created",
      filePath: path.join(workspace, "draft.md"),
      origin: "agent_write",
    });
    expect(editResult.details.sessionFile).toMatchObject({
      id: "sf_modified",
      filePath: path.join(workspace, "draft.md"),
      origin: "agent_edit",
    });
  });

  it("does not collect inline diff contents when inline_diff is disabled", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-build-tools-no-diff-"));
    const agentDir = path.join(tmpDir, "agents", "focus");
    const workspace = path.join(tmpDir, "workspace");
    const sessionPath = path.join(agentDir, "sessions", "touch.jsonl");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(sessionPath, "{}\n");

    const engine = Object.create(HanaEngine.prototype);
    engine.hanakoHome = tmpDir;
    engine.registerSessionFile = vi.fn(({ sessionPath, filePath, label, origin, operation }) => ({
      id: `sf_${operation}`,
      sessionPath,
      filePath,
      label,
      origin,
      operation,
    }));
    engine.getAgent = vi.fn(() => ({ id: "focus", agentDir, tools: [] }));
    engine._pluginManager = null;
    engine._prefs = { getFileBackup: () => ({ enabled: false }) };
    engine._readPreferences = () => ({ sandbox: false, inline_diff: false });
    engine._confirmStore = null;
    engine._emitEvent = vi.fn();
    engine.getSessionPermissionMode = vi.fn(() => "operate");
    engine._agentMgr = {
      agent: {
        id: "focus",
        agentDir,
        tools: [],
      },
    };

    const { tools } = engine.buildTools(workspace, [], {
      agentDir,
      workspace,
      getSessionPath: () => sessionPath,
    });
    const write = tools.find(tool => tool.name === "write");

    const writeResult = await write.execute("write-1", { path: "draft.md", content: "hello\n" });

    expect(writeResult.details).toMatchObject({
      filePath: path.join(workspace, "draft.md"),
      fileName: "draft.md",
      sessionFile: expect.objectContaining({
        id: "sf_created",
        filePath: path.join(workspace, "draft.md"),
      }),
    });
    expect(writeResult.details.oldContent).toBeUndefined();
    expect(writeResult.details.newContent).toBeUndefined();
  });

  it("emits file write progress events while writing files", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-build-tools-progress-"));
    const agentDir = path.join(tmpDir, "agents", "focus");
    const workspace = path.join(tmpDir, "workspace");
    const sessionPath = path.join(agentDir, "sessions", "touch.jsonl");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(sessionPath, "{}\n");

    const emitted = [];
    const engine = Object.create(HanaEngine.prototype);
    engine.hanakoHome = tmpDir;
    engine.registerSessionFile = vi.fn(({ sessionPath, filePath, label, origin, operation }) => ({
      id: `sf_${operation}`,
      sessionPath,
      filePath,
      label,
      origin,
      operation,
    }));
    engine.getAgent = vi.fn(() => ({ id: "focus", agentDir, tools: [] }));
    engine._pluginManager = null;
    engine._prefs = { getFileBackup: () => ({ enabled: false }) };
    engine._readPreferences = () => ({ sandbox: false, inline_diff: false });
    engine._confirmStore = null;
    engine._emitEvent = vi.fn((event, sp) => emitted.push({ event, sessionPath: sp }));
    engine.getSessionPermissionMode = vi.fn(() => "operate");
    engine._agentMgr = {
      agent: {
        id: "focus",
        agentDir,
        tools: [],
      },
    };

    const { tools } = engine.buildTools(workspace, [], {
      agentDir,
      workspace,
      getSessionPath: () => sessionPath,
    });
    const write = tools.find(tool => tool.name === "write");
    const content = "hello\n".repeat(30_000);

    const result = await write.execute("write-progress", { path: "large.md", content });

    expect(fs.readFileSync(path.join(workspace, "large.md"), "utf8")).toBe(content);
    expect(result.content?.[0]?.text).toContain("Successfully wrote");
    const progressEvents = emitted
      .filter(item => item.sessionPath === sessionPath && item.event.type === "tool_execution_update")
      .map(item => item.event);
    expect(progressEvents.map(event => event.stage)).toContain("preparing");
    expect(progressEvents.map(event => event.stage)).toContain("writing");
    expect(progressEvents.map(event => event.stage)).toContain("written");
    expect(progressEvents.map(event => event.stage)).toContain("done");
    expect(progressEvents.some(event => event.stage === "writing" && event.totalBytes === Buffer.byteLength(content, "utf8"))).toBe(true);
    expect(progressEvents.some(event => event.stage === "writing" && event.previewChunk?.startsWith("hello\n"))).toBe(true);
  });

  it("keeps plugin dev Agent tools hidden until the global dev setting is enabled", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-build-tools-dev-"));
    const agentDir = path.join(tmpDir, "agents", "focus");
    const engine = Object.create(HanaEngine.prototype);
    engine.hanakoHome = tmpDir;
    engine.getAgent = vi.fn(() => ({ id: "focus", agentDir, tools: [] }));
    engine._pluginManager = null;
    engine._pluginDevService = { getDiagnostics: vi.fn() };
    engine._prefs = {
      getFileBackup: () => ({ enabled: false }),
      getPluginDevToolsEnabled: () => false,
    };
    engine._readPreferences = () => ({ sandbox: true });
    engine._confirmStore = null;
    engine._emitEvent = vi.fn();
    engine.getSessionPermissionMode = vi.fn(() => "operate");
    engine._agentMgr = {
      agent: {
        id: "focus",
        agentDir,
        tools: [],
      },
    };

    const { customTools } = engine.buildTools(tmpDir, [], {
      agentDir,
      workspace: tmpDir,
      getPermissionMode: () => "operate",
    });

    expect(customTools.some((tool) => tool.name.startsWith("plugin_dev_"))).toBe(false);
  });

  it("adds plugin dev Agent tools when the user enables the dev setting", () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-build-tools-dev-"));
    const agentDir = path.join(tmpDir, "agents", "focus");
    const engine = Object.create(HanaEngine.prototype);
    engine.hanakoHome = tmpDir;
    engine.getAgent = vi.fn(() => ({ id: "focus", agentDir, tools: [] }));
    engine._pluginManager = null;
    engine._pluginDevService = {
      installFromSource: vi.fn(),
      reloadPlugin: vi.fn(),
      enablePlugin: vi.fn(),
      disablePlugin: vi.fn(),
      resetPlugin: vi.fn(),
      uninstallPlugin: vi.fn(),
      invokeTool: vi.fn(),
      getDiagnostics: vi.fn(),
      listSurfaces: vi.fn(),
      describeSurfaceDebug: vi.fn(),
      runScenario: vi.fn(),
    };
    engine._prefs = {
      getFileBackup: () => ({ enabled: false }),
      getPluginDevToolsEnabled: () => true,
    };
    engine._readPreferences = () => ({ sandbox: true });
    engine._confirmStore = null;
    engine._emitEvent = vi.fn();
    engine.getSessionPermissionMode = vi.fn(() => "operate");
    engine._agentMgr = {
      agent: {
        id: "focus",
        agentDir,
        tools: [],
      },
    };

    const { customTools } = engine.buildTools(tmpDir, [], {
      agentDir,
      workspace: tmpDir,
      getPermissionMode: () => "operate",
    });

    expect(customTools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "plugin_dev_install",
      "plugin_dev_reload",
      "plugin_dev_uninstall",
      "plugin_dev_invoke_tool",
      "plugin_dev_run_scenario",
    ]));
  });
});
