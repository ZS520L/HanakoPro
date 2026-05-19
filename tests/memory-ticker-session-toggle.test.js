import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";

vi.mock("../lib/memory/compile.js", () => ({
  compileToday: vi.fn().mockResolvedValue("compiled"),
  compileWeek: vi.fn().mockResolvedValue("compiled"),
  compileLongterm: vi.fn().mockResolvedValue("compiled"),
  compileFacts: vi.fn().mockResolvedValue("compiled"),
  assemble: vi.fn(),
}));

vi.mock("../lib/memory/deep-memory.js", () => ({
  processDirtySessions: vi.fn().mockResolvedValue({ processed: 0, factsAdded: 0 }),
}));

vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => null,
  createModuleLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createMemoryTicker } from "../lib/memory/memory-ticker.js";
import { compileToday, assemble } from "../lib/memory/compile.js";

function writeSession(sessionPath) {
  const lines = [
    {
      type: "message",
      timestamp: "2026-03-12T15:47:53.599Z",
      message: { role: "user", content: "hello" },
    },
    {
      type: "message",
      timestamp: "2026-03-12T15:48:04.225Z",
      message: { role: "assistant", content: "world" },
    },
  ];
  fs.writeFileSync(sessionPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf-8");
}

function writeMixedSession(sessionPath) {
  const lines = [
    {
      type: "message",
      timestamp: "2026-04-29T07:59:00.000Z",
      message: { role: "user", content: "old user message" },
    },
    {
      type: "message",
      timestamp: "2026-04-29T07:59:10.000Z",
      message: { role: "assistant", content: "old assistant message" },
    },
    {
      type: "message",
      timestamp: "2026-04-29T08:01:00.000Z",
      message: { role: "user", content: "new user message" },
    },
    {
      type: "message",
      timestamp: "2026-04-29T08:01:10.000Z",
      message: { role: "assistant", content: "new assistant message" },
    },
  ];
  fs.writeFileSync(sessionPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf-8");
}

function writeResetMarker(memoryDir, resetAt) {
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(path.join(memoryDir, "reset.json"), JSON.stringify({ compiledResetAt: resetAt }, null, 2), "utf-8");
}

function makeTicker(tmpDir, isSessionMemoryEnabled) {
  const summaryManager = {
    rollingSummary: vi.fn().mockResolvedValue("summary"),
    getSummary: vi.fn().mockReturnValue(null),
  };

  const memoryDir = path.join(tmpDir, "memory");
  const ticker = createMemoryTicker({
    summaryManager,
    configPath: path.join(tmpDir, "config.yaml"),
    factStore: {},
    getResolvedMemoryModel: () => ({ model: "test-model", provider: "test", api: "openai-completions", api_key: "test-key", base_url: "http://localhost:1234" }),
    getMemoryMasterEnabled: () => true,
    isSessionMemoryEnabled,
    onCompiled: vi.fn(),
    sessionDir: path.join(tmpDir, "sessions"),
    memoryDir,
    memoryMdPath: path.join(memoryDir, "memory.md"),
    todayMdPath: path.join(memoryDir, "today.md"),
    weekMdPath: path.join(memoryDir, "week.md"),
    longtermMdPath: path.join(memoryDir, "longterm.md"),
    factsMdPath: path.join(memoryDir, "facts.md"),
  });

  return { ticker, summaryManager };
}

describe("memory ticker respects session-level memory toggle", () => {
  let tmpDir;
  let sessionPath;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-memory-toggle-"));
    fs.mkdirSync(path.join(tmpDir, "sessions"), { recursive: true });
    sessionPath = path.join(tmpDir, "sessions", "2026-03-12T15-47-53-568Z_test.jsonl");
    writeSession(sessionPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips summary + compile when the session memory is disabled", async () => {
    const { ticker, summaryManager } = makeTicker(tmpDir, () => false);

    ticker.notifyTurn(sessionPath);
    await ticker.notifySessionEnd(sessionPath);

    expect(summaryManager.rollingSummary).not.toHaveBeenCalled();
    expect(compileToday).not.toHaveBeenCalled();
    expect(assemble).not.toHaveBeenCalled();
  });

  it("never summarizes agent phone sessions even if session memory is enabled", async () => {
    const phoneSessionPath = path.join(tmpDir, "phone", "sessions", "ch_crew", "phone.jsonl");
    fs.mkdirSync(path.dirname(phoneSessionPath), { recursive: true });
    writeSession(phoneSessionPath);
    const { ticker, summaryManager } = makeTicker(tmpDir, () => true);

    ticker.notifyTurn(phoneSessionPath);
    await ticker.notifySessionEnd(phoneSessionPath);

    expect(summaryManager.rollingSummary).not.toHaveBeenCalled();
    expect(compileToday).not.toHaveBeenCalled();
    expect(assemble).not.toHaveBeenCalled();
  });

  it("still summarizes the session when the session memory is enabled", async () => {
    const { ticker, summaryManager } = makeTicker(tmpDir, () => true);

    ticker.notifyTurn(sessionPath);
    await ticker.notifySessionEnd(sessionPath);

    expect(summaryManager.rollingSummary).toHaveBeenCalledOnce();
    expect(compileToday).toHaveBeenCalled();
    expect(assemble).toHaveBeenCalled();
  });

  it("notifySessionEnd 是 fire-and-forget：即使 rollingSummary 永不 resolve，caller 也能立即继续", async () => {
    const summaryManager = {
      rollingSummary: vi.fn(() => new Promise(() => {})), // 永不 resolve
      getSummary: vi.fn().mockReturnValue(null),
    };
    const memoryDir = path.join(tmpDir, "memory");
    const ticker = createMemoryTicker({
      summaryManager,
      configPath: path.join(tmpDir, "config.yaml"),
      factStore: {},
      getResolvedMemoryModel: () => ({ model: "m", provider: "p", api: "openai-completions", api_key: "k", base_url: "http://x" }),
      getMemoryMasterEnabled: () => true,
      isSessionMemoryEnabled: () => true,
      onCompiled: vi.fn(),
      sessionDir: path.join(tmpDir, "sessions"),
      memoryDir,
      memoryMdPath: path.join(memoryDir, "memory.md"),
      todayMdPath: path.join(memoryDir, "today.md"),
      weekMdPath: path.join(memoryDir, "week.md"),
      longtermMdPath: path.join(memoryDir, "longterm.md"),
      factsMdPath: path.join(memoryDir, "facts.md"),
    });

    ticker.notifyTurn(sessionPath);
    // 不 await：caller 必须能立即继续而不被挂起
    const pending = ticker.notifySessionEnd(sessionPath);
    // 同步断言：返回值是 Promise，但调用方这一行不应被 LLM 挡住
    expect(pending).toBeInstanceOf(Promise);
    // rollingSummary 已经在后台启动（同步触发 Promise 构造）
    expect(summaryManager.rollingSummary).toHaveBeenCalledOnce();
    // 关键：不 await pending，测试仍能走到下一行 —— 证明 fire-and-forget
  });

  it("没有新轮次（count===0）时跳过，返回 resolved Promise", async () => {
    const { ticker, summaryManager } = makeTicker(tmpDir, () => true);
    // 不调 notifyTurn，count 保持 0
    await ticker.notifySessionEnd(sessionPath);
    expect(summaryManager.rollingSummary).not.toHaveBeenCalled();
    expect(compileToday).not.toHaveBeenCalled();
  });

  it("summarizes only post-reset messages in an existing session", async () => {
    const memoryDir = path.join(tmpDir, "memory");
    writeResetMarker(memoryDir, "2026-04-29T08:00:00.000Z");
    writeMixedSession(sessionPath);
    const { ticker, summaryManager } = makeTicker(tmpDir, () => true);

    ticker.notifyTurn(sessionPath);
    await ticker.notifySessionEnd(sessionPath);

    const messages = summaryManager.rollingSummary.mock.calls[0][1];
    expect(messages.map((m) => m.content)).toEqual(["new user message", "new assistant message"]);
    expect(summaryManager.rollingSummary.mock.calls[0][3]).toEqual({ resetAt: "2026-04-29T08:00:00.000Z" });
  });

  it("startup recovery skips sessions whose file mtime is before the reset watermark", async () => {
    const memoryDir = path.join(tmpDir, "memory");
    writeResetMarker(memoryDir, "2026-04-29T08:00:00.000Z");
    writeSession(sessionPath);
    fs.utimesSync(sessionPath, new Date("2026-04-29T07:00:00.000Z"), new Date("2026-04-29T07:00:00.000Z"));
    const { ticker, summaryManager } = makeTicker(tmpDir, () => true);

    await ticker.tick();

    expect(summaryManager.rollingSummary).not.toHaveBeenCalled();
  });
});
