/**
 * SessionCoordinator.writeSessionMeta 序列化回归测试
 *
 * 验证并发调用 writeSessionMeta 不会因 RMW 竞态丢失字段，
 * 且写入失败不会阻塞队列后续项。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";

vi.mock("../lib/pi-sdk/index.js", () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    create: vi.fn(),
    list: vi.fn(),
    open: vi.fn(),
  },
  SettingsManager: {
    inMemory: vi.fn(() => ({})),
  },
}));

vi.mock("../lib/debug-log.js", () => ({
  createModuleLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { SessionCoordinator } from "../core/session-coordinator.js";
import { SessionManager } from "../lib/pi-sdk/index.js";

function makeCoordinatorDeps(overrides = {}) {
  return {
    agentsDir: "/tmp/agents",
    getAgent: () => ({
      sessionDir: overrides._sessionDir || "/tmp/agent-sessions",
      setMemoryEnabled: vi.fn(),
      buildSystemPrompt: () => "mock-prompt",
      config: {},
      tools: [],
      agentDir: "/tmp/agents/hana",
    }),
    getActiveAgentId: () => "test",
    getModels: () => ({
      currentModel: { id: "m", name: "m" },
      authStorage: {},
      modelRegistry: {},
      resolveThinkingLevel: () => "medium",
    }),
    getResourceLoader: () => ({
      getSystemPrompt: () => "",
      getAppendSystemPrompt: () => [],
    }),
    getSkills: () => null,
    buildTools: () => ({ tools: [], customTools: [] }),
    emitEvent: vi.fn(),
    getHomeCwd: () => "/tmp/home",
    agentIdFromSessionPath: () => null,
    switchAgentOnly: async () => {},
    getConfig: () => ({}),
    getPrefs: () => ({ getThinkingLevel: () => "medium" }),
    getAgents: () => new Map(),
    getActivityStore: () => null,
    getAgentById: () => null,
    listAgents: () => [],
    getDeferredResultStore: () => null,
    ...overrides,
  };
}

describe("SessionCoordinator.writeSessionMeta serialization", () => {
  let tmpDir, sessionDir, sessionCoord, fakeSessionPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meta-serial-"));
    sessionDir = path.join(tmpDir, "sessions");
    fs.mkdirSync(sessionDir, { recursive: true });
    fakeSessionPath = path.join(sessionDir, "test-session.jsonl");
    vi.mocked(SessionManager.list).mockReset();

    const deps = makeCoordinatorDeps({ _sessionDir: sessionDir });
    // override getAgent to return dynamic sessionDir from tmpDir
    deps.getAgent = () => ({
      sessionDir,
      setMemoryEnabled: vi.fn(),
      buildSystemPrompt: () => "mock-prompt",
      config: {},
      tools: [],
      agentDir: path.join(tmpDir, "agents", "hana"),
    });

    sessionCoord = new SessionCoordinator(deps);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("two concurrent writeSessionMeta calls with different fields preserve both", async () => {
    const p1 = sessionCoord.writeSessionMeta(fakeSessionPath, { memoryEnabled: false });
    const p2 = sessionCoord.writeSessionMeta(fakeSessionPath, { toolNames: ["read", "bash"] });
    await Promise.all([p1, p2]);

    const metaPath = path.join(sessionDir, "session-meta.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf-8"));
    const entry = meta[path.basename(fakeSessionPath)];
    expect(entry.memoryEnabled).toBe(false);
    expect(entry.toolNames).toEqual(["read", "bash"]);
  });

  it("three sequential writes accumulate fields correctly", async () => {
    await sessionCoord.writeSessionMeta(fakeSessionPath, { memoryEnabled: true });
    await sessionCoord.writeSessionMeta(fakeSessionPath, { toolNames: ["a"] });
    await sessionCoord.writeSessionMeta(fakeSessionPath, { memoryEnabled: false });

    const metaPath = path.join(sessionDir, "session-meta.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf-8"));
    const entry = meta[path.basename(fakeSessionPath)];
    expect(entry.memoryEnabled).toBe(false);
    expect(entry.toolNames).toEqual(["a"]);
  });

  it("a failed write does not block subsequent writes from the same queue", async () => {
    // Force _doWriteSessionMeta to actually REJECT (not just log internally) by
    // making getAgent() throw on the first call. getAgent() is invoked before the
    // try-catch loop, so an exception there causes the async function to reject,
    // which would poison the queue if the guard were `.then(next)` only.
    let getAgentCalls = 0;
    const realSessionDir = sessionDir;
    sessionCoord._d.getAgent = () => {
      getAgentCalls += 1;
      if (getAgentCalls === 1) {
        throw new Error("injected getAgent failure");
      }
      return { sessionDir: realSessionDir };
    };

    let secondWriteRan = false;
    const p1 = sessionCoord.writeSessionMeta(fakeSessionPath, { memoryEnabled: true });
    const p2 = sessionCoord.writeSessionMeta(fakeSessionPath, { toolNames: ["x"] }).then((v) => {
      secondWriteRan = true;
      return v;
    });
    // Use allSettled: p1 is expected to reject (or resolve after swallowing);
    // what matters is that p2 still ran regardless.
    await Promise.allSettled([p1, p2]);

    // p2 should have landed in the real meta file
    const metaPath = path.join(realSessionDir, "session-meta.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf-8"));
    const entry = meta[path.basename(fakeSessionPath)];
    expect(entry.toolNames).toEqual(["x"]);
    // p1's failure did NOT prevent p2 from running
    expect(secondWriteRan).toBe(true);
    expect(getAgentCalls).toBeGreaterThanOrEqual(2);
  });

  it("model and modelId fields are stripped from written meta", async () => {
    await sessionCoord.writeSessionMeta(fakeSessionPath, {
      memoryEnabled: true,
      model: "should-be-deleted",
      modelId: "also-deleted",
    });

    const metaPath = path.join(sessionDir, "session-meta.json");
    const meta = JSON.parse(await fsp.readFile(metaPath, "utf-8"));
    const entry = meta[path.basename(fakeSessionPath)];
    expect(entry.model).toBeUndefined();
    expect(entry.modelId).toBeUndefined();
    expect(entry.memoryEnabled).toBe(true);
  });

  it("setSessionPinned writes and clears pinnedAt on the session meta entry", async () => {
    const pinnedAt = await sessionCoord.setSessionPinned(fakeSessionPath, true);

    const metaPath = path.join(sessionDir, "session-meta.json");
    let meta = JSON.parse(await fsp.readFile(metaPath, "utf-8"));
    expect(meta[path.basename(fakeSessionPath)].pinnedAt).toBe(pinnedAt);
    expect(new Date(pinnedAt).toString()).not.toBe("Invalid Date");

    const unpinnedAt = await sessionCoord.setSessionPinned(fakeSessionPath, false);

    meta = JSON.parse(await fsp.readFile(metaPath, "utf-8"));
    expect(unpinnedAt).toBeNull();
    expect(meta[path.basename(fakeSessionPath)].pinnedAt).toBeNull();
  });

  it("listSessions exposes pinnedAt from the session directory sidecar", async () => {
    const agentsDir = path.join(tmpDir, "agents");
    const agentSessionDir = path.join(agentsDir, "hana", "sessions");
    const sessionPath = path.join(agentSessionDir, "pinned.jsonl");
    const pinnedAt = "2026-04-29T08:00:00.000Z";
    fs.mkdirSync(agentSessionDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentSessionDir, "session-meta.json"),
      JSON.stringify({ [path.basename(sessionPath)]: { pinnedAt } }, null, 2),
      "utf-8",
    );

    vi.mocked(SessionManager.list).mockResolvedValueOnce([
      {
        path: sessionPath,
        title: null,
        firstMessage: "hello",
        modified: new Date("2026-04-29T07:00:00.000Z"),
        messageCount: 1,
        cwd: "/tmp/work",
      },
    ]);

    const coord = new SessionCoordinator(makeCoordinatorDeps({
      agentsDir,
      listAgents: () => [{ id: "hana", name: "Hana" }],
      agentIdFromSessionPath: (p) => {
        const rel = path.relative(agentsDir, p);
        return rel.split(path.sep)[0] || null;
      },
    }));

    const sessions = await coord.listSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].pinnedAt).toBe(pinnedAt);
    expect(sessions[0].agentId).toBe("hana");
  });
});
