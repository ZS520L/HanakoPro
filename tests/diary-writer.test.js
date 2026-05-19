import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../server/i18n.js", () => ({
  getLocale: () => "zh-CN",
  t: (key) => key,
}));

vi.mock("../core/llm-client.js", () => ({
  callText: vi.fn(),
}));

vi.mock("../lib/pii-guard.js", () => ({
  scrubPII: (text) => ({ cleaned: text, detected: [] }),
}));

import { callText } from "../core/llm-client.js";
import { writeDiary } from "../lib/diary/diary-writer.js";

let tempRoot;

function makeSession(sessionDir, sessionId, messages) {
  const filePath = path.join(sessionDir, `${sessionId}.jsonl`);
  const lines = [
    { type: "session", id: sessionId, timestamp: "2026-05-07T03:59:00.000Z", cwd: tempRoot },
    ...messages.map((message, index) => ({
      type: "message",
      id: `${sessionId}-${index}`,
      parentId: index === 0 ? null : `${sessionId}-${index - 1}`,
      timestamp: message.timestamp,
      message: {
        role: message.role,
        content: message.content,
      },
    })),
  ];
  fs.writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf-8");
  return filePath;
}

function baseOpts(overrides = {}) {
  const sessionDir = path.join(tempRoot, "sessions");
  fs.mkdirSync(sessionDir, { recursive: true });

  const summaryManager = {
    getSummariesInRange: vi.fn().mockReturnValue([]),
    getSummary: vi.fn().mockReturnValue(null),
    rollingSummary: vi.fn(),
  };

  return {
    summaryManager,
    sessionDir,
    resolvedModel: {
      model: { id: "test-model", provider: "test-provider" },
      api: "openai-completions",
      api_key: "test-key",
      base_url: "http://localhost:1234",
    },
    agentPersonality: "你是 Hana。",
    memory: "",
    userName: "测试用户",
    agentName: "小花",
    cwd: tempRoot,
    isSessionMemoryEnabledForPath: vi.fn().mockReturnValue(true),
    generateTemporarySummary: vi.fn(),
    ...overrides,
  };
}

function diaryPrompt() {
  return callText.mock.calls[0][0].messages[0].content;
}

describe("writeDiary hybrid material collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T12:00:00+08:00"));
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-diary-test-"));
    callText.mockResolvedValue("# 2026-05-07 测试日记\n\n今天把日记写好了。");
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("persists a rolling summary for today's missing memory-enabled session before writing diary", async () => {
    const opts = baseOpts();
    makeSession(opts.sessionDir, "enabled-session", [
      { role: "user", content: "今天想把日记链路改成摘要优先。", timestamp: "2026-05-07T04:10:00.000Z" },
      { role: "assistant", content: "我会补齐缺失摘要。", timestamp: "2026-05-07T04:12:00.000Z" },
    ]);
    opts.summaryManager.rollingSummary.mockResolvedValue("## 事情经过\n[12:10] 用户讨论日记链路，助手补齐缺失摘要。");

    const result = await writeDiary(opts);

    expect(result.error).toBeUndefined();
    expect(opts.summaryManager.rollingSummary).toHaveBeenCalledWith(
      "enabled-session",
      expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "今天想把日记链路改成摘要优先。" }),
      ]),
      opts.resolvedModel,
    );
    expect(opts.generateTemporarySummary).not.toHaveBeenCalled();
    expect(diaryPrompt()).toContain("## 事情经过");
    expect(diaryPrompt()).toContain("补齐缺失摘要");
  });

  it("uses temporary compaction for a memory-disabled session without saving a rolling summary", async () => {
    const opts = baseOpts({
      isSessionMemoryEnabledForPath: vi.fn().mockReturnValue(false),
      generateTemporarySummary: vi.fn().mockResolvedValue("## 临时摘要\n记忆关闭的 session 也参与这次日记，但不会落回摘要库。"),
    });
    makeSession(opts.sessionDir, "memory-off-session", [
      { role: "user", content: "这条 session 关闭了记忆。", timestamp: "2026-05-07T05:10:00.000Z" },
      { role: "assistant", content: "那就只临时压缩给日记用。", timestamp: "2026-05-07T05:12:00.000Z" },
    ]);

    const result = await writeDiary(opts);

    expect(result.error).toBeUndefined();
    expect(opts.summaryManager.rollingSummary).not.toHaveBeenCalled();
    expect(opts.generateTemporarySummary).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "memory-off-session",
      previousSummary: "",
    }));
    expect(diaryPrompt()).toContain("临时补齐");
    expect(diaryPrompt()).toContain("不会落回摘要库");
  });

  it("keeps an in-range stale summary and adds a temporary compaction supplement", async () => {
    const staleSummary = {
      session_id: "stale-session",
      created_at: "2026-05-07T03:00:00.000Z",
      updated_at: "2026-05-07T04:11:00.000Z",
      messageCount: 1,
      summary: "## 事情经过\n[12:10] 用户开始讨论日记链路。",
    };
    const opts = baseOpts({
      summaryManager: {
        getSummariesInRange: vi.fn().mockReturnValue([staleSummary]),
        getSummary: vi.fn().mockReturnValue(staleSummary),
        rollingSummary: vi.fn(),
      },
      generateTemporarySummary: vi.fn().mockResolvedValue("## 临时摘要\n[12:20] 后续决定残缺内容用 compaction 补齐，不要落回 session。"),
    });
    makeSession(opts.sessionDir, "stale-session", [
      { role: "user", content: "今天想把日记链路改成摘要优先。", timestamp: "2026-05-07T04:10:00.000Z" },
      { role: "assistant", content: "我先看摘要。", timestamp: "2026-05-07T04:11:00.000Z" },
      { role: "user", content: "残缺内容用 compaction 补齐，但不要落回 session。", timestamp: "2026-05-07T04:20:00.000Z" },
    ]);

    const result = await writeDiary(opts);

    expect(result.error).toBeUndefined();
    expect(opts.summaryManager.rollingSummary).not.toHaveBeenCalled();
    expect(opts.generateTemporarySummary).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "stale-session",
      previousSummary: staleSummary.summary,
    }));
    expect(diaryPrompt()).toContain("用户开始讨论日记链路");
    expect(diaryPrompt()).toContain("临时补齐");
    expect(diaryPrompt()).toContain("不要落回 session");
  });
});
