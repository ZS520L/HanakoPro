import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAgentSessionMock = vi.fn();
const sessionManagerCreateMock = vi.fn();
const sessionManagerOpenMock = vi.fn();
const emitSessionShutdownMock = vi.fn(async (session) => {
  const runner = session?.extensionRunner;
  if (runner?.hasHandlers?.("session_shutdown")) {
    await runner.emit({ type: "session_shutdown" });
    return true;
  }
  return false;
});

vi.mock("../lib/pi-sdk/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createAgentSession: (...args) => createAgentSessionMock(...args),
    SessionManager: {
      ...actual.SessionManager,
      create: (...args) => sessionManagerCreateMock(...args),
      open: (...args) => sessionManagerOpenMock(...args),
    },
    emitSessionShutdown: (...args) => emitSessionShutdownMock(...args),
  };
});

import { runAgentSession } from "../hub/agent-executor.js";
import { freshCompactAgentPhoneSession, runAgentPhoneSession } from "../hub/agent-executor.js";
import { getAgentPhoneProjectionPath, readAgentPhoneProjection, updateAgentPhoneProjectionMeta } from "../lib/conversations/agent-phone-projection.js";
import { getAgentPhoneSessionDir } from "../lib/conversations/agent-phone-session.js";

let rootDir;

function makeAgent(root) {
  const agentDir = path.join(root, "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  return {
    id: "agent-a",
    agentDir,
    tools: [],
    personality: "personality",
    systemPrompt: "system prompt",
    config: { models: { chat: { id: "gpt-4o", provider: "openai" } } },
  };
}

function makeEngine(agent, cwd) {
  return {
    getAgent: (id) => (id === agent.id ? agent : null),
    getHomeCwd: () => cwd,
    createSessionContext: () => ({
      resourceLoader: {},
      getSkillsForAgent: () => ({ skills: [], diagnostics: [] }),
      buildTools: () => ({ tools: [], customTools: [] }),
      resolveModel: () => ({ id: "gpt-4o", provider: "openai", name: "GPT-4o" }),
      authStorage: {},
      modelRegistry: {},
    }),
  };
}

describe("runAgentSession teardown", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-executor-teardown-"));
    createAgentSessionMock.mockReset();
    sessionManagerCreateMock.mockReset();
    sessionManagerOpenMock.mockReset();
    emitSessionShutdownMock.mockClear();
    vi.useRealTimers();
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("hub 临时 session 结束后走 emit -> unsub -> dispose", async () => {
    const cwd = path.join(rootDir, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    const agent = makeAgent(rootDir);
    const engine = makeEngine(agent, cwd);
    const sessionFile = path.join(agent.agentDir, "sessions", "temp", "s1.jsonl");
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, "", "utf-8");
    sessionManagerCreateMock.mockReturnValue({ getSessionFile: () => sessionFile });

    const callOrder = [];
    const session = {
      prompt: vi.fn(async () => {}),
      subscribe: vi.fn(() => () => { callOrder.push("unsub"); }),
      dispose: vi.fn(() => { callOrder.push("dispose"); }),
      sessionManager: { getSessionFile: () => sessionFile },
      extensionRunner: {
        hasHandlers: vi.fn(() => true),
        emit: vi.fn(async () => { callOrder.push("emit"); }),
      },
    };
    createAgentSessionMock.mockResolvedValue({ session });

    await runAgentSession("agent-a", [{ text: "hello", capture: true }], { engine });

    expect(callOrder).toEqual(["emit", "unsub", "dispose"]);
    expect(emitSessionShutdownMock).toHaveBeenCalledWith(session);
    expect(session.dispose).toHaveBeenCalledOnce();
    expect(fs.existsSync(sessionFile)).toBe(false);
  });

  it("hub 临时 session tools follow the master memory switch instead of session memory state", async () => {
    const cwd = path.join(rootDir, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    const agent = makeAgent(rootDir);
    agent.memoryMasterEnabled = true;
    const plainTool = { name: "plain_custom" };
    const memoryTool = { name: "search_memory" };
    agent.tools = [plainTool];
    agent.getToolsSnapshot = vi.fn(({ forceMemoryEnabled } = {}) => (
      forceMemoryEnabled ? [plainTool, memoryTool] : [plainTool]
    ));

    const buildTools = vi.fn((_cwd, customTools) => ({
      tools: [],
      customTools,
    }));
    const engine = {
      ...makeEngine(agent, cwd),
      createSessionContext: () => ({
        resourceLoader: {},
        getSkillsForAgent: () => ({ skills: [], diagnostics: [] }),
        buildTools,
        resolveModel: () => ({ id: "gpt-4o", provider: "openai", name: "GPT-4o" }),
        authStorage: {},
        modelRegistry: {},
      }),
    };
    const sessionFile = path.join(agent.agentDir, "sessions", "temp", "s-master-tools.jsonl");
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, "", "utf-8");
    sessionManagerCreateMock.mockReturnValue({ getSessionFile: () => sessionFile });
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async () => {}),
        subscribe: vi.fn(() => () => {}),
        dispose: vi.fn(),
        sessionManager: { getSessionFile: () => sessionFile },
        extensionRunner: { hasHandlers: vi.fn(() => false) },
      },
    });

    await runAgentSession("agent-a", [{ text: "hello", capture: true }], { engine });

    expect(agent.getToolsSnapshot).toHaveBeenCalledWith({ forceMemoryEnabled: true });
    expect(buildTools.mock.calls[0][1].map((tool) => tool.name)).toEqual([
      "plain_custom",
      "search_memory",
    ]);
    expect(createAgentSessionMock.mock.calls[0][0].customTools.map((tool) => tool.name)).toContain("search_memory");
  });

  it("hub read-only temp sessions keep full schema and enforce read-only at execution time", async () => {
    const cwd = path.join(rootDir, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    const agent = makeAgent(rootDir);
    agent.tools = [{ name: "search_memory" }, { name: "record_experience" }];

    const buildTools = vi.fn((_cwd, customTools) => ({
      tools: [{ name: "read" }, { name: "write" }],
      customTools,
    }));
    const engine = {
      ...makeEngine(agent, cwd),
      createSessionContext: () => ({
        resourceLoader: {},
        getSkillsForAgent: () => ({ skills: [], diagnostics: [] }),
        buildTools,
        resolveModel: () => ({ id: "gpt-4o", provider: "openai", name: "GPT-4o" }),
        authStorage: {},
        modelRegistry: {},
      }),
    };
    const sessionFile = path.join(agent.agentDir, "sessions", "temp", "s-read-only-tools.jsonl");
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, "", "utf-8");
    sessionManagerCreateMock.mockReturnValue({ getSessionFile: () => sessionFile });
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async () => {}),
        subscribe: vi.fn(() => () => {}),
        dispose: vi.fn(),
        sessionManager: { getSessionFile: () => sessionFile },
        extensionRunner: { hasHandlers: vi.fn(() => false) },
      },
    });

    await runAgentSession("agent-a", [{ text: "hello", capture: true }], { engine, readOnly: true });

    const buildOpts = buildTools.mock.calls[0][2];
    expect(buildOpts.getPermissionMode()).toBe("read_only");
    expect(createAgentSessionMock.mock.calls[0][0].tools.map((tool) => tool.name)).toEqual([
      "read",
      "write",
    ]);
    expect(createAgentSessionMock.mock.calls[0][0].customTools.map((tool) => tool.name)).toEqual([
      "search_memory",
      "record_experience",
    ]);
  });

  it("phone session exposes its session path and mirrors live stream events", async () => {
    const cwd = path.join(rootDir, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    const agent = makeAgent(rootDir);
    const emitEvent = vi.fn();
    const engine = {
      ...makeEngine(agent, cwd),
      emitEvent,
    };
    const sessionFile = path.join(agent.agentDir, "phone", "sessions", "ch_crew", "phone.jsonl");
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, "", "utf-8");
    sessionManagerCreateMock.mockReturnValue({ getSessionFile: () => sessionFile });

    let subscriber = null;
    const session = {
      prompt: vi.fn(async () => {
        subscriber?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "hi" },
        });
        subscriber?.({ type: "turn_end" });
      }),
      subscribe: vi.fn((cb) => {
        subscriber = cb;
        return () => {};
      }),
      dispose: vi.fn(),
      sessionManager: { getSessionFile: () => sessionFile },
      getContextUsage: vi.fn(() => ({ tokens: 10, contextWindow: 200000 })),
      extensionRunner: { hasHandlers: vi.fn(() => false) },
    };
    createAgentSessionMock.mockResolvedValue({ session });
    const onSessionReady = vi.fn();

    const text = await runAgentPhoneSession("agent-a", [{ text: "hello", capture: true }], {
      engine,
      conversationId: "ch_crew",
      conversationType: "channel",
      emitEvents: true,
      onSessionReady,
    });

    expect(text).toBe("hi");
    expect(onSessionReady).toHaveBeenCalledWith(sessionFile);
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "message_update",
        isolated: true,
      }),
      sessionFile,
    );
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn_end", isolated: true }),
      sessionFile,
    );
    expect(fs.existsSync(sessionFile)).toBe(true);
  });

  it("phone session appends channel-scoped custom tools after applying phone tool policy", async () => {
    const cwd = path.join(rootDir, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    const agent = makeAgent(rootDir);
    agent.tools = [{ name: "channel" }, { name: "search_memory" }, { name: "record_experience" }];
    agent.getToolsSnapshot = vi.fn(() => agent.tools);

    const buildTools = vi.fn((_cwd, customTools) => ({
      tools: [{ name: "read" }, { name: "write" }],
      customTools,
    }));
    const engine = {
      ...makeEngine(agent, cwd),
      createSessionContext: () => ({
        resourceLoader: {},
        getSkillsForAgent: () => ({ skills: [], diagnostics: [] }),
        buildTools,
        resolveModel: () => ({ id: "gpt-4o", provider: "openai", name: "GPT-4o" }),
        authStorage: {},
        modelRegistry: {},
      }),
    };
    const sessionFile = path.join(agent.agentDir, "phone", "sessions", "ch_crew", "phone-tools.jsonl");
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, "", "utf-8");
    sessionManagerCreateMock.mockReturnValue({ getSessionFile: () => sessionFile });
    const setActiveToolsByName = vi.fn();
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async () => {}),
        subscribe: vi.fn(() => () => {}),
        dispose: vi.fn(),
        setActiveToolsByName,
        sessionManager: { getSessionFile: () => sessionFile },
        getContextUsage: vi.fn(() => ({ tokens: 10, contextWindow: 200000 })),
        extensionRunner: { hasHandlers: vi.fn(() => false) },
      },
    });

    await runAgentPhoneSession("agent-a", [{ text: "hello", capture: true }], {
      engine,
      conversationId: "ch_crew",
      conversationType: "channel",
      toolMode: "read_only",
      extraCustomTools: [
        { name: "channel_reply", execute: vi.fn() },
        { name: "channel_pass", execute: vi.fn() },
      ],
    });

    const buildOpts = buildTools.mock.calls[0][2];
    expect(buildOpts.getPermissionMode()).toBe("read_only");
    expect(createAgentSessionMock.mock.calls[0][0].tools.map((tool) => tool.name)).toEqual([
      "read",
      "write",
    ]);
    expect(createAgentSessionMock.mock.calls[0][0].customTools.map((tool) => tool.name)).toEqual([
      "search_memory",
      "record_experience",
      "channel_reply",
      "channel_pass",
    ]);
    expect(setActiveToolsByName).toHaveBeenCalledWith([
      "read",
      "write",
      "search_memory",
      "record_experience",
      "channel_reply",
      "channel_pass",
    ]);
  });

  it("phone session can use a channel-scoped model override without mutating the agent default", async () => {
    const cwd = path.join(rootDir, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    const agent = makeAgent(rootDir);
    const agentDefaultModel = { id: "gpt-4o", provider: "openai", name: "GPT-4o" };
    const channelModel = { id: "deepseek-v4-flash", provider: "deepseek", name: "DeepSeek V4 Flash" };
    const resolveModel = vi.fn(() => agentDefaultModel);
    const engine = {
      ...makeEngine(agent, cwd),
      availableModels: [agentDefaultModel, channelModel],
      createSessionContext: () => ({
        resourceLoader: {},
        getSkillsForAgent: () => ({ skills: [], diagnostics: [] }),
        buildTools: () => ({ tools: [], customTools: [] }),
        resolveModel,
        authStorage: {},
        modelRegistry: {},
      }),
    };
    const sessionFile = path.join(agent.agentDir, "phone", "sessions", "ch_crew", "phone-model.jsonl");
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, "", "utf-8");
    sessionManagerCreateMock.mockReturnValue({ getSessionFile: () => sessionFile });
    createAgentSessionMock.mockResolvedValue({
      session: {
        prompt: vi.fn(async () => {}),
        subscribe: vi.fn(() => () => {}),
        dispose: vi.fn(),
        sessionManager: { getSessionFile: () => sessionFile },
        getContextUsage: vi.fn(() => ({ tokens: 10, contextWindow: 200000 })),
        extensionRunner: { hasHandlers: vi.fn(() => false) },
      },
    });

    await runAgentPhoneSession("agent-a", [{ text: "hello", capture: true }], {
      engine,
      conversationId: "ch_crew",
      conversationType: "channel",
      modelOverride: { id: "deepseek-v4-flash", provider: "deepseek" },
    });

    expect(createAgentSessionMock.mock.calls[0][0].model).toBe(channelModel);
    expect(agent.config.models.chat).toEqual({ id: "gpt-4o", provider: "openai" });
    expect(resolveModel).not.toHaveBeenCalled();
  });

  it("keeps phone replies non-blocking and leaves daily fresh-compact to the background path", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-12T10:00:00"));
    const cwd = path.join(rootDir, "cwd");
    fs.mkdirSync(cwd, { recursive: true });
    const agent = makeAgent(rootDir);
    const engine = makeEngine(agent, cwd);

    const phoneSessionDir = getAgentPhoneSessionDir(agent.agentDir, "ch_crew");
    const oldSessionFile = path.join(phoneSessionDir, "old.jsonl");
    const newSessionFile = path.join(phoneSessionDir, "new.jsonl");
    fs.mkdirSync(path.dirname(oldSessionFile), { recursive: true });
    fs.writeFileSync(oldSessionFile, "old", "utf-8");
    await updateAgentPhoneProjectionMeta({
      agentDir: agent.agentDir,
      agentId: "agent-a",
      conversationId: "ch_crew",
      conversationType: "channel",
      patch: {
        phoneSessionFile: path.relative(agent.agentDir, oldSessionFile).split(path.sep).join("/"),
        lastRefreshedDate: "2026-05-11",
      },
    });

    const oldManager = { getSessionFile: () => oldSessionFile };
    sessionManagerOpenMock.mockReturnValue(oldManager);
    sessionManagerCreateMock.mockReturnValue({ getSessionFile: () => newSessionFile });
    const compact = vi.fn(async () => {});
    const getContextUsage = vi.fn()
      .mockReturnValueOnce({ tokens: 10, contextWindow: 200000 })
      .mockReturnValueOnce({ tokens: 10, contextWindow: 200000 })
      .mockReturnValueOnce({ tokens: 130000, contextWindow: 200000 })
      .mockReturnValueOnce({ tokens: 48000, contextWindow: 200000 })
      .mockReturnValue({ tokens: 10, contextWindow: 200000 });
    createAgentSessionMock.mockImplementation(async (options) => ({
      session: {
        prompt: vi.fn(async () => {}),
        subscribe: vi.fn(() => () => {}),
        dispose: vi.fn(),
        sessionManager: options.sessionManager,
        getContextUsage,
        compact,
        extensionRunner: { hasHandlers: vi.fn(() => false) },
      },
    }));

    await runAgentPhoneSession("agent-a", [{ text: "hello", capture: true }], {
      engine,
      conversationId: "ch_crew",
      conversationType: "channel",
    });

    expect(sessionManagerOpenMock).toHaveBeenCalledWith(oldSessionFile, path.dirname(oldSessionFile));
    expect(sessionManagerCreateMock).not.toHaveBeenCalled();
    expect(compact).not.toHaveBeenCalled();
    const projectionPath = getAgentPhoneProjectionPath(agent.agentDir, "ch_crew");
    let projection = readAgentPhoneProjection(projectionPath);
    expect(projection.meta.phoneSessionFile).toBe(path.relative(agent.agentDir, oldSessionFile).split(path.sep).join("/"));
    expect(projection.meta.lastFreshCompactDate).toBeUndefined();

    await freshCompactAgentPhoneSession("agent-a", {
      engine,
      conversationId: "ch_crew",
      conversationType: "channel",
      now: new Date("2026-05-12T10:00:00"),
      reason: "daily",
    });

    expect(compact).toHaveBeenCalledOnce();
    projection = readAgentPhoneProjection(projectionPath);
    expect(projection.meta.lastFreshCompactDate).toBe("2026-05-12");
    expect(projection.meta.freshCompactTokensBefore).toBe("130000");
    expect(projection.meta.freshCompactTokensAfter).toBe("48000");

    fs.writeFileSync(newSessionFile, "new", "utf-8");
    sessionManagerOpenMock.mockClear();
    sessionManagerCreateMock.mockClear();
    compact.mockClear();
    await runAgentPhoneSession("agent-a", [{ text: "hello again", capture: true }], {
      engine,
      conversationId: "ch_crew",
      conversationType: "channel",
    });

    expect(sessionManagerOpenMock).toHaveBeenCalledWith(oldSessionFile, path.dirname(oldSessionFile));
    expect(sessionManagerCreateMock).not.toHaveBeenCalled();
    projection = readAgentPhoneProjection(projectionPath);
    expect(projection.meta.lastFreshCompactDate).toBe("2026-05-12");
    expect(compact).not.toHaveBeenCalled();
  });
});
