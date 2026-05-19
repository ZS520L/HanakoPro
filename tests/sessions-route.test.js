import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const { replayLatestUserTurnMock } = vi.hoisted(() => ({
  replayLatestUserTurnMock: vi.fn(async () => ({ text: null, toolMedia: [] })),
}));

const browserManagerMock = {
  _sessions: new Map(), // sessionPath → { running, url }
  isRunning(sp) { return this._sessions.get(sp)?.running ?? false; },
  currentUrl(sp) { return this._sessions.get(sp)?.url ?? null; },
  get hasAnyRunning() { for (const s of this._sessions.values()) if (s.running) return true; return false; },
  suspendForSession: vi.fn(async (sp) => {
    const s = browserManagerMock._sessions.get(sp);
    if (s) s.running = false;
  }),
  resumeForSession: vi.fn(async (sp) => {
    browserManagerMock._sessions.set(sp, { running: true, url: "https://after.example.com" });
  }),
  closeBrowserForSession: vi.fn(),
  getBrowserSessions: vi.fn(() => ({})),
  getBrowserSessionStates: vi.fn(() => ({})),
};

vi.mock("../lib/browser/browser-manager.js", () => ({
  BrowserManager: {
    instance: () => browserManagerMock,
  },
}));

vi.mock("../core/message-utils.js", () => ({
  extractTextContent: vi.fn(() => ({ text: "", images: [], thinking: "", toolUses: [] })),
  loadSessionHistoryMessages: vi.fn(async () => []),
  loadLatestAssistantSummaryFromSessionFile: vi.fn(async () => null),
  isValidSessionPath: vi.fn(() => true),
  isActiveSessionPath: vi.fn(() => true),
}));

vi.mock("../core/session-turn-actions.js", () => ({
  replayLatestUserTurn: replayLatestUserTurnMock,
}));

describe("sessions route", () => {
  let tmpDir;

  beforeEach(() => {
    vi.resetModules();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-sessions-route-"));
    browserManagerMock._sessions.clear();
    browserManagerMock._sessions.set("/tmp/agents/a/sessions/old.jsonl", { running: true, url: "https://before.example.com" });
    browserManagerMock.suspendForSession.mockClear();
    browserManagerMock.resumeForSession.mockClear();
    browserManagerMock.closeBrowserForSession.mockClear();
    browserManagerMock.getBrowserSessions.mockReset();
    browserManagerMock.getBrowserSessions.mockReturnValue({});
    browserManagerMock.getBrowserSessionStates.mockReset();
    browserManagerMock.getBrowserSessionStates.mockReturnValue({});
    replayLatestUserTurnMock.mockClear();
    replayLatestUserTurnMock.mockResolvedValue({ text: null, toolMedia: [] });
  });

  it("restores browser state for the target session after switch", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const app = new Hono();

    const engine = {
      agentsDir: "/tmp/agents",
      currentSessionPath: "/tmp/agents/a/sessions/old.jsonl",
      messages: [{ role: "assistant", content: "ok" }],
      memoryEnabled: true,
      planMode: false,
      memoryModelUnavailableReason: null,
      cwd: "/tmp/workspace",
      currentAgentId: "hana",
      agentName: "Hana",
      currentModel: { id: "gpt-test", provider: "openai" },
      isSessionStreaming: vi.fn(() => false),
      switchSession: vi.fn(async (sessionPath) => {
        engine.currentSessionPath = sessionPath;
      }),
      getSessionByPath: vi.fn((sp) => ({
        messages: [{ role: "assistant", content: "ok" }],
      })),
      getAgent: vi.fn(() => ({ agentName: "Hana" })),
      agentIdFromSessionPath: vi.fn((sp) => {
        const rel = path.relative("/tmp/agents", sp);
        return rel.split(path.sep)[0] || null;
      }),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/tmp/agents/a/sessions/new.jsonl", currentSessionPath: "/tmp/agents/a/sessions/old.jsonl" }),
    });

    const data = await res.json();
    expect(res.status).toBe(200);
    expect(browserManagerMock.suspendForSession).toHaveBeenCalledWith("/tmp/agents/a/sessions/old.jsonl");
    expect(browserManagerMock.resumeForSession).toHaveBeenCalledWith("/tmp/agents/a/sessions/new.jsonl");
    expect(data.browserRunning).toBe(true); // resumeForSession sets it running
    expect(data.browserUrl).toBe("https://after.example.com"); // per-session URL
  });

  it("passes workspaceFolders when creating a new session and returns the normalized scope", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const app = new Hono();
    const cwd = path.join(tmpDir, "main");
    const extra = path.join(tmpDir, "reference");

    const engine = {
      currentAgentId: "hana",
      config: {},
      cwd,
      memoryEnabled: true,
      planMode: false,
      memoryModelUnavailableReason: null,
      createSession: vi.fn(async () => ({ sessionPath: "/tmp/agents/hana/sessions/new.jsonl", agentId: "hana" })),
      createSessionForAgent: vi.fn(),
      persistSessionMeta: vi.fn(),
      updateConfig: vi.fn(async (patch) => Object.assign(engine.config, patch)),
      getAgent: vi.fn(() => ({ agentName: "Hana" })),
      getSessionWorkspaceFolders: vi.fn(() => [extra]),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, workspaceFolders: [extra] }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(engine.createSession).toHaveBeenCalledWith(
      null,
      cwd,
      true,
      undefined,
      { workspaceFolders: [extra] },
    );
    expect(data.workspaceFolders).toEqual([extra]);
  });

  it("includes pinnedAt in the session list response", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const app = new Hono();
    const pinnedAt = "2026-04-29T08:00:00.000Z";

    const engine = {
      listSessions: vi.fn(async () => [{
        path: "/tmp/agents/hana/sessions/a.jsonl",
        title: "Pinned thread",
        firstMessage: "hello",
        modified: new Date("2026-04-29T07:00:00.000Z"),
        messageCount: 2,
        cwd: "/tmp/work",
        agentId: "hana",
        agentName: "Hana",
        pinnedAt,
      }]),
      rcState: null,
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data[0].pinnedAt).toBe(pinnedAt);
  });

  it("includes summary presence in the session list response", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const app = new Hono();
    const summaryManager = {
      getSummary: vi.fn((sessionId) => (
        sessionId === "has-summary"
          ? { session_id: sessionId, summary: "### 重要事实\n- 用户在做记忆系统。" }
          : null
      )),
    };

    const engine = {
      listSessions: vi.fn(async () => [
        {
          path: "/tmp/agents/hana/sessions/has-summary.jsonl",
          title: "Has summary",
          firstMessage: "hello",
          modified: new Date("2026-04-29T07:00:00.000Z"),
          messageCount: 2,
          cwd: "/tmp/work",
          agentId: "hana",
          agentName: "Hana",
        },
        {
          path: "/tmp/agents/hana/sessions/no-summary.jsonl",
          title: "No summary",
          firstMessage: "hello",
          modified: new Date("2026-04-29T06:00:00.000Z"),
          messageCount: 1,
          cwd: "/tmp/work",
          agentId: "hana",
          agentName: "Hana",
        },
      ]),
      getAgent: vi.fn(() => ({ summaryManager })),
      rcState: null,
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.map((s) => [s.path, s.hasSummary])).toEqual([
      ["/tmp/agents/hana/sessions/has-summary.jsonl", true],
      ["/tmp/agents/hana/sessions/no-summary.jsonl", false],
    ]);
    expect(summaryManager.getSummary).toHaveBeenCalledWith("has-summary");
    expect(summaryManager.getSummary).toHaveBeenCalledWith("no-summary");
  });

  it("replays the latest user message through the branch-aware action", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const app = new Hono();
    const sessionPath = path.join(tmpDir, "agents", "hana", "sessions", "a.jsonl");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, "x\n");

    const engine = {
      agentsDir: path.join(tmpDir, "agents"),
      isSessionStreaming: vi.fn(() => false),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/latest-user-message/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: sessionPath,
        sourceEntryId: "entry-u1",
        clientMessageId: "client-u1",
        text: "edited",
        displayMessage: { text: "edited" },
        uiContext: { currentViewed: "/tmp/work", activeFile: null, activePreview: null, pinnedFiles: [] },
      }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
    expect(replayLatestUserTurnMock).toHaveBeenCalledWith(engine, {
      sessionPath,
      sourceEntryId: "entry-u1",
      clientMessageId: "client-u1",
      replacementText: "edited",
      displayMessage: { text: "edited" },
      uiContext: { currentViewed: "/tmp/work", activeFile: null, activePreview: null, pinnedFiles: [] },
    });
  });

  it("returns a session summary through an explicit route", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const app = new Hono();
    const sessionPath = "/tmp/agents/hana/sessions/with-summary.jsonl";
    const summaryManager = {
      getSummary: vi.fn(() => ({
        session_id: "with-summary",
        summary: "### 重要事实\n- 用户在做记忆系统。\n\n### 事情经过\n- 10:00 用户讨论 session 摘要。",
        created_at: "2026-04-29T07:00:00.000Z",
        updated_at: "2026-04-29T08:00:00.000Z",
      })),
    };

    const engine = {
      agentsDir: "/tmp/agents",
      agentIdFromSessionPath: vi.fn(() => "hana"),
      getAgent: vi.fn(() => ({ summaryManager })),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request(`/api/sessions/summary?path=${encodeURIComponent(sessionPath)}`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      hasSummary: true,
      summary: "### 重要事实\n- 用户在做记忆系统。\n\n### 事情经过\n- 10:00 用户讨论 session 摘要。",
      createdAt: "2026-04-29T07:00:00.000Z",
      updatedAt: "2026-04-29T08:00:00.000Z",
    });
    expect(engine.agentIdFromSessionPath).toHaveBeenCalledWith(sessionPath);
    expect(summaryManager.getSummary).toHaveBeenCalledWith("with-summary");
  });

  it("returns an empty summary state when the session has no summary", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const app = new Hono();
    const engine = {
      agentsDir: "/tmp/agents",
      agentIdFromSessionPath: vi.fn(() => "hana"),
      getAgent: vi.fn(() => ({ summaryManager: { getSummary: vi.fn(() => null) } })),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/summary?path=%2Ftmp%2Fagents%2Fhana%2Fsessions%2Fempty.jsonl");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({
      hasSummary: false,
      summary: null,
      createdAt: null,
      updatedAt: null,
    });
  });

  it("pins and unpins sessions through an explicit route", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const app = new Hono();
    const pinnedAt = "2026-04-29T08:00:00.000Z";

    const engine = {
      agentsDir: "/tmp/agents",
      setSessionPinned: vi.fn(async (_sessionPath, pinned) => pinned ? pinnedAt : null),
    };

    app.route("/api", createSessionsRoute(engine));

    const pinRes = await app.request("/api/sessions/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/tmp/agents/hana/sessions/a.jsonl", pinned: true }),
    });
    const pinData = await pinRes.json();

    expect(pinRes.status).toBe(200);
    expect(engine.setSessionPinned).toHaveBeenCalledWith("/tmp/agents/hana/sessions/a.jsonl", true);
    expect(pinData).toEqual({ ok: true, pinnedAt });

    const unpinRes = await app.request("/api/sessions/pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/tmp/agents/hana/sessions/a.jsonl", pinned: false }),
    });
    const unpinData = await unpinRes.json();

    expect(unpinRes.status).toBe(200);
    expect(engine.setSessionPinned).toHaveBeenLastCalledWith("/tmp/agents/hana/sessions/a.jsonl", false);
    expect(unpinData).toEqual({ ok: true, pinnedAt: null });
  });

  it("clears pinned state before archiving a session", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const app = new Hono();
    const agentsDir = path.join(tmpDir, "agents");
    const sessionPath = path.join(agentsDir, "hana", "sessions", "a.jsonl");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, "{}\n", "utf-8");

    const engine = {
      agentsDir,
      closeSession: vi.fn(async () => {}),
      setSessionPinned: vi.fn(async () => null),
      rcState: null,
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: sessionPath }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ ok: true });
    expect(engine.setSessionPinned).toHaveBeenCalledWith(sessionPath, false);
    expect(fs.existsSync(path.join(path.dirname(sessionPath), "archived", path.basename(sessionPath)))).toBe(true);
  });

  it("marks current todos completed and removed through an explicit session route", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const { SessionManager } = await import("../lib/pi-sdk/index.js");
    const { loadLatestTodosFromSessionFile, loadLatestTodoSnapshotFromSessionFile } = await import("../lib/tools/todo-compat.js");
    const app = new Hono();
    const agentsDir = path.join(tmpDir, "agents");
    const sessionDir = path.join(agentsDir, "hana", "sessions");
    const manager = SessionManager.create("/tmp/workspace", sessionDir);
    const sessionPath = manager.getSessionFile();
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "working" }],
      api: "test",
      provider: "test",
      model: "test",
      stopReason: "toolUse",
      timestamp: Date.now(),
    });
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "todo-1",
      toolName: "todo_write",
      content: [{ type: "text", text: "1/2" }],
      isError: false,
      timestamp: Date.now(),
      details: {
        todos: [
          { content: "read", activeForm: "reading", status: "completed" },
          { content: "write", activeForm: "writing", status: "in_progress" },
        ],
      },
    });

    const engine = {
      agentsDir,
      isSessionStreaming: vi.fn(() => false),
      getSessionByPath: vi.fn(() => ({ sessionManager: manager })),
      emitEvent: vi.fn(),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/todos/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: sessionPath }),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data).toEqual({ ok: true, todos: [] });
    expect(await loadLatestTodosFromSessionFile(sessionPath)).toEqual([]);
    expect(await loadLatestTodoSnapshotFromSessionFile(sessionPath)).toMatchObject({
      removed: true,
      source: "user",
      todos: [
        { content: "read", activeForm: "reading", status: "completed" },
        { content: "write", activeForm: "writing", status: "completed" },
      ],
    });
    expect(engine.emitEvent).toHaveBeenCalledWith({ type: "todo_update", todos: [] }, sessionPath);
  });

  it("infers subagent agent identity from child sessionPath when history details are missing", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const msgUtils = await import("../core/message-utils.js");
    const app = new Hono();

    vi.mocked(msgUtils.extractTextContent)
      .mockReturnValueOnce({ text: "parent says hi", images: [], thinking: "", toolUses: [] });
    vi.mocked(msgUtils.loadSessionHistoryMessages).mockResolvedValueOnce([
      { role: "assistant", content: "parent says hi" },
      {
        role: "toolResult",
        toolName: "subagent",
        details: {
          taskId: "subagent-1",
          task: "do work",
          sessionPath: "/tmp/agents/hanako/subagent-sessions/child.jsonl",
          streamStatus: "done",
        },
      },
    ]);

    const engine = {
      agentsDir: "/tmp/agents",
      deferredResults: null,
      agentIdFromSessionPath: vi.fn((sp) => {
        const rel = path.relative("/tmp/agents", sp);
        return rel.split(path.sep)[0] || null;
      }),
      getAgent: vi.fn((id) => (id === "hanako" ? { agentName: "Hanako" } : null)),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/messages");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.blocks).toHaveLength(1);
    expect(data.blocks[0]).toMatchObject({
      type: "subagent",
      agentId: "hanako",
      agentName: "Hanako",
      streamKey: "/tmp/agents/hanako/subagent-sessions/child.jsonl",
    });
  });

  it("includes session entry timestamps on displayable history messages", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const msgUtils = await import("../core/message-utils.js");
    const app = new Hono();

    vi.mocked(msgUtils.extractTextContent)
      .mockReturnValueOnce({ text: "hello", images: [], thinking: "", toolUses: [] })
      .mockReturnValueOnce({ text: "hi back", images: [], thinking: "", toolUses: [] });
    vi.mocked(msgUtils.loadSessionHistoryMessages).mockResolvedValueOnce([
      { role: "user", content: "hello", timestamp: "2026-05-07T05:42:00.000Z" },
      { role: "assistant", content: "hi back", timestamp: "2026-05-07T05:43:00.000Z" },
    ]);

    const engine = {
      agentsDir: "/tmp/agents",
      deferredResults: null,
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/messages");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.messages).toEqual([
      {
        id: "0",
        role: "user",
        content: "hello",
        timestamp: "2026-05-07T05:42:00.000Z",
      },
      {
        id: "1",
        role: "assistant",
        content: "hi back",
        timestamp: "2026-05-07T05:43:00.000Z",
      },
    ]);
  });

  it("refreshes session file lifecycle metadata when rebuilding history blocks", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const msgUtils = await import("../core/message-utils.js");
    const app = new Hono();
    const sessionPath = "/tmp/agents/hana/sessions/main.jsonl";

    vi.mocked(msgUtils.extractTextContent)
      .mockReturnValueOnce({ text: "I made a file", images: [], thinking: "", toolUses: [] });
    vi.mocked(msgUtils.loadSessionHistoryMessages).mockResolvedValueOnce([
      { role: "assistant", content: "I made a file" },
      {
        role: "toolResult",
        toolName: "stage_files",
        details: {
          files: [
            {
              fileId: "sf_old",
              filePath: "/cache/old.png",
              label: "old.png",
              ext: "png",
              status: "available",
            },
          ],
        },
      },
      {
        role: "toolResult",
        toolName: "create_artifact",
        details: {
          artifactId: "art-1",
          type: "markdown",
          title: "Plan",
          content: "# Plan",
          artifactFile: {
            fileId: "sf_art",
            filePath: "/cache/plan.md",
            label: "Plan.md",
            ext: "md",
            status: "available",
          },
        },
      },
    ]);

    const engine = {
      agentsDir: "/tmp/agents",
      currentSessionPath: sessionPath,
      deferredResults: null,
      getSessionFile: vi.fn((fileId, options) => {
        expect(options).toEqual({ sessionPath });
        if (fileId === "sf_old") {
          return {
            id: "sf_old",
            filePath: "/cache/old.png",
            label: "old.png",
            ext: "png",
            mime: "image/png",
            kind: "image",
            storageKind: "managed_cache",
            status: "expired",
            missingAt: 1234,
          };
        }
        if (fileId === "sf_art") {
          return {
            id: "sf_art",
            filePath: "/cache/plan.md",
            label: "Plan.md",
            ext: "md",
            mime: "text/markdown",
            kind: "markdown",
            storageKind: "managed_cache",
            status: "expired",
            missingAt: 5678,
          };
        }
        return null;
      }),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request(`/api/sessions/messages?path=${encodeURIComponent(sessionPath)}`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.blocks).toHaveLength(2);
    expect(data.blocks[0]).toMatchObject({
      type: "file",
      fileId: "sf_old",
      status: "expired",
      missingAt: 1234,
      mime: "image/png",
      kind: "image",
    });
    expect(data.blocks[1]).toMatchObject({
      type: "artifact",
      fileId: "sf_art",
      filePath: "/cache/plan.md",
      status: "expired",
      missingAt: 5678,
      mime: "text/markdown",
      kind: "markdown",
    });
  });

  it("returns session registry files alongside restored messages", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const msgUtils = await import("../core/message-utils.js");
    const app = new Hono();
    const sessionPath = "/tmp/agents/hana/sessions/main.jsonl";

    vi.mocked(msgUtils.loadSessionHistoryMessages).mockResolvedValueOnce([]);

    const engine = {
      agentsDir: "/tmp/agents",
      currentSessionPath: sessionPath,
      deferredResults: null,
      listSessionFiles: vi.fn((sp) => {
        expect(sp).toBe(sessionPath);
        return [{
          id: "sf_write",
          sessionPath,
          filePath: "/workspace/draft.md",
          label: "draft.md",
          ext: "md",
          mime: "text/markdown",
          kind: "markdown",
          origin: "agent_write",
          operations: ["created", "modified"],
          createdAt: 1234,
          status: "available",
        }];
      }),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request(`/api/sessions/messages?path=${encodeURIComponent(sessionPath)}`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sessionFiles).toEqual([expect.objectContaining({
      fileId: "sf_write",
      filePath: "/workspace/draft.md",
      origin: "agent_write",
      operations: ["created", "modified"],
      createdAt: 1234,
    })]);
  });

  it("hydrates legacy file blocks without fileId from the session file sidecar by path", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const msgUtils = await import("../core/message-utils.js");
    const app = new Hono();
    const sessionPath = "/tmp/agents/hana/sessions/legacy.jsonl";

    vi.mocked(msgUtils.extractTextContent)
      .mockReturnValueOnce({ text: "legacy file", images: [], thinking: "", toolUses: [] });
    vi.mocked(msgUtils.loadSessionHistoryMessages).mockResolvedValueOnce([
      { role: "assistant", content: "legacy file" },
      {
        role: "toolResult",
        toolName: "stage_files",
        details: {
          files: [
            { filePath: "/cache/legacy.png", label: "legacy.png", ext: "png" },
          ],
        },
      },
    ]);

    const engine = {
      agentsDir: "/tmp/agents",
      currentSessionPath: sessionPath,
      deferredResults: null,
      getSessionFile: vi.fn(),
      getSessionFileByPath: vi.fn((filePath, options) => {
        expect(filePath).toBe("/cache/legacy.png");
        expect(options).toEqual({ sessionPath });
        return {
          id: "sf_legacy",
          filePath,
          label: "legacy.png",
          ext: "png",
          mime: "image/png",
          kind: "image",
          storageKind: "managed_cache",
          status: "expired",
          missingAt: 4321,
        };
      }),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request(`/api/sessions/messages?path=${encodeURIComponent(sessionPath)}`);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.blocks[0]).toMatchObject({
      type: "file",
      fileId: "sf_legacy",
      filePath: "/cache/legacy.png",
      status: "expired",
      missingAt: 4321,
    });
  });

  it("prefers explicit executor metadata over owner-path inference", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const msgUtils = await import("../core/message-utils.js");
    const app = new Hono();

    vi.mocked(msgUtils.extractTextContent)
      .mockReturnValueOnce({ text: "parent says hi", images: [], thinking: "", toolUses: [] });
    vi.mocked(msgUtils.loadSessionHistoryMessages).mockResolvedValueOnce([
      { role: "assistant", content: "parent says hi" },
      {
        role: "toolResult",
        toolName: "subagent",
        details: {
          taskId: "subagent-1",
          task: "delegate to butter",
          requestedAgentId: "butter",
          requestedAgentNameSnapshot: "butter",
          executorAgentId: "butter",
          executorAgentNameSnapshot: "butter",
          sessionPath: "/tmp/agents/hanako/subagent-sessions/child.jsonl",
          streamStatus: "done",
        },
      },
    ]);

    const engine = {
      agentsDir: "/tmp/agents",
      deferredResults: null,
      agentIdFromSessionPath: vi.fn((sp) => {
        const rel = path.relative("/tmp/agents", sp);
        return rel.split(path.sep)[0] || null;
      }),
      getAgent: vi.fn((id) => {
        if (id === "hanako") return { agentName: "Hanako" };
        if (id === "butter") return { agentName: "butter" };
        return null;
      }),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/messages");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.blocks).toHaveLength(1);
    expect(data.blocks[0]).toMatchObject({
      type: "subagent",
      agentId: "butter",
      agentName: "butter",
      requestedAgentId: "butter",
      requestedAgentName: "butter",
      streamKey: "/tmp/agents/hanako/subagent-sessions/child.jsonl",
    });
  });

  it("uses child-session executor snapshot when live agent has been deleted", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const msgUtils = await import("../core/message-utils.js");
    const app = new Hono();

    const agentsDir = path.join(tmpDir, "agents");
    const childSessionPath = path.join(agentsDir, "hanako", "subagent-sessions", "child.jsonl");
    fs.mkdirSync(path.dirname(childSessionPath), { recursive: true });
    fs.writeFileSync(childSessionPath, "", "utf-8");
    fs.writeFileSync(
      path.join(path.dirname(childSessionPath), "session-meta.json"),
      JSON.stringify({
        "child.jsonl": {
          executorAgentId: "deleted-butter",
          executorAgentNameSnapshot: "butter",
          executorMetaVersion: 1,
        },
      }, null, 2),
      "utf-8",
    );

    vi.mocked(msgUtils.extractTextContent)
      .mockReturnValueOnce({ text: "parent says hi", images: [], thinking: "", toolUses: [] });
    vi.mocked(msgUtils.loadSessionHistoryMessages).mockResolvedValueOnce([
      { role: "assistant", content: "parent says hi" },
      {
        role: "toolResult",
        toolName: "subagent",
        details: {
          taskId: "subagent-1",
          task: "legacy delegated task",
          sessionPath: childSessionPath,
          streamStatus: "done",
        },
      },
    ]);

    const engine = {
      agentsDir,
      deferredResults: null,
      agentIdFromSessionPath: vi.fn((sp) => {
        const rel = path.relative(agentsDir, sp);
        return rel.split(path.sep)[0] || null;
      }),
      getAgent: vi.fn((id) => (id === "hanako" ? { agentName: "Hanako" } : null)),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/messages");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.blocks).toHaveLength(1);
    expect(data.blocks[0]).toMatchObject({
      type: "subagent",
      agentId: "deleted-butter",
      agentName: "butter",
      streamKey: childSessionPath,
    });
  });

  it("keeps pending subagent block running even when child-session tail summary is available", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const msgUtils = await import("../core/message-utils.js");
    const app = new Hono();

    vi.mocked(msgUtils.extractTextContent)
      .mockReturnValueOnce({ text: "parent says hi", images: [], thinking: "", toolUses: [] });
    vi.mocked(msgUtils.loadSessionHistoryMessages).mockResolvedValueOnce([
      { role: "assistant", content: "parent says hi" },
      {
        role: "toolResult",
        toolName: "subagent",
        details: {
          taskId: "subagent-1",
          task: "do work",
          sessionPath: "/tmp/agents/hanako/subagent-sessions/child.jsonl",
          streamStatus: "running",
        },
      },
    ]);
    const engine = {
      agentsDir: "/tmp/agents",
      deferredResults: {
        query: vi.fn(() => ({
          status: "pending",
          meta: {
            sessionPath: "/tmp/agents/hanako/subagent-sessions/child.jsonl",
          },
        })),
      },
      agentIdFromSessionPath: vi.fn((sp) => {
        const rel = path.relative("/tmp/agents", sp);
        return rel.split(path.sep)[0] || null;
      }),
      getAgent: vi.fn((id) => (id === "hanako" ? { agentName: "Hanako" } : null)),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/messages");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(msgUtils.loadLatestAssistantSummaryFromSessionFile).not.toHaveBeenCalled();
    expect(data.blocks[0]).toMatchObject({
      type: "subagent",
      streamStatus: "running",
    });
  });

  it("marks running subagent block done only after deferred store resolves", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const msgUtils = await import("../core/message-utils.js");
    const app = new Hono();

    vi.mocked(msgUtils.extractTextContent)
      .mockReturnValueOnce({ text: "parent says hi", images: [], thinking: "", toolUses: [] });
    vi.mocked(msgUtils.loadSessionHistoryMessages).mockResolvedValueOnce([
      { role: "assistant", content: "parent says hi" },
      {
        role: "toolResult",
        toolName: "subagent",
        details: {
          taskId: "subagent-1",
          task: "do work",
          sessionPath: "/tmp/agents/hanako/subagent-sessions/child.jsonl",
          streamStatus: "running",
        },
      },
    ]);
    vi.mocked(msgUtils.loadLatestAssistantSummaryFromSessionFile)
      .mockResolvedValueOnce("child finished");

    const engine = {
      agentsDir: "/tmp/agents",
      deferredResults: {
        query: vi.fn(() => ({
          status: "resolved",
          result: "deferred result",
          meta: {
            sessionPath: "/tmp/agents/hanako/subagent-sessions/child.jsonl",
          },
        })),
      },
      agentIdFromSessionPath: vi.fn((sp) => {
        const rel = path.relative("/tmp/agents", sp);
        return rel.split(path.sep)[0] || null;
      }),
      getAgent: vi.fn((id) => (id === "hanako" ? { agentName: "Hanako" } : null)),
    };

    app.route("/api", createSessionsRoute(engine));

    const res = await app.request("/api/sessions/messages");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(msgUtils.loadLatestAssistantSummaryFromSessionFile).toHaveBeenCalledWith("/tmp/agents/hanako/subagent-sessions/child.jsonl");
    expect(data.blocks[0]).toMatchObject({
      type: "subagent",
      streamStatus: "done",
      summary: "child finished",
    });
  });

  it("exposes structured browser session states and returns refreshed states after close", async () => {
    const { createSessionsRoute } = await import("../server/routes/sessions.js");
    const app = new Hono();
    const sessionPath = "/tmp/agents/hana/sessions/browser.jsonl";
    const states = {
      [sessionPath]: {
        url: "https://example.com",
        running: false,
        resumable: true,
        unavailableReason: null,
      },
    };
    browserManagerMock.getBrowserSessionStates.mockReturnValue(states);

    app.route("/api", createSessionsRoute({ agentsDir: "/tmp/agents" }));

    const listRes = await app.request("/api/browser/session-states");
    expect(listRes.status).toBe(200);
    expect(await listRes.json()).toEqual(states);

    const closeRes = await app.request("/api/browser/close-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionPath }),
    });
    expect(closeRes.status).toBe(200);
    expect(browserManagerMock.closeBrowserForSession).toHaveBeenCalledWith(sessionPath);
    expect(await closeRes.json()).toEqual({ ok: true, sessions: states });
  });
});
