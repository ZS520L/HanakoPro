/**
 * compile.js fingerprint 陷阱修复测试
 *
 * 场景：rollingSummary 持续失败导致 session_summary 表没有新数据，
 * compileToday / compileWeek 每次都看到 sessions=[]。老实现会写一个
 * "empty" fingerprint，使后续恢复后的首次调用仍然命中 fingerprint skip，
 * today.md / week.md 永远不会被重新编译。
 *
 * 新行为：sessions 为空时不写 fingerprint，确保恢复路径可用。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../core/llm-client.js", () => ({
  callText: vi.fn().mockResolvedValue("compiled content from llm"),
}));

vi.mock("../server/i18n.js", () => ({
  getLocale: () => "zh-CN",
}));

import { compileToday, compileWeek, compileFacts, assemble } from "../lib/memory/compile.js";
import { callText } from "../core/llm-client.js";

function makeFakeSummaryManager(summaries) {
  return {
    getSummariesInRange: vi.fn().mockReturnValue(summaries),
  };
}

const RESOLVED_MODEL = { model: "m", api: "openai-completions", api_key: "k", base_url: "http://x" };

describe("compileToday empty-sessions fingerprint trap fix", () => {
  let tmpDir;
  let todayPath;
  let fpPath;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-compile-"));
    todayPath = path.join(tmpDir, "today.md");
    fpPath = todayPath + ".fingerprint";
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not write fingerprint when sessions are empty", async () => {
    const mgr = makeFakeSummaryManager([]);
    await compileToday(mgr, todayPath, RESOLVED_MODEL);

    expect(fs.existsSync(fpPath)).toBe(false);
    expect(callText).not.toHaveBeenCalled();
  });

  it("recovers immediately after sessions reappear (no stale fingerprint lock)", async () => {
    // 1. 先制造"失败期"：sessions 空，导致写 0 bytes today.md（如果已有内容）
    fs.writeFileSync(todayPath, "stale content from yesterday");
    const mgrEmpty = makeFakeSummaryManager([]);
    await compileToday(mgrEmpty, todayPath, RESOLVED_MODEL);

    // 失败期：today.md 被清空，但没有 fingerprint
    expect(fs.readFileSync(todayPath, "utf-8")).toBe("");
    expect(fs.existsSync(fpPath)).toBe(false);

    // 2. summary 恢复：有新 session
    const mgrRecovered = makeFakeSummaryManager([
      { session_id: "s1", updated_at: "2026-04-17T10:00:00Z", summary: "new session summary" },
    ]);
    await compileToday(mgrRecovered, todayPath, RESOLVED_MODEL);

    // 恢复路径：LLM 被调用，文件被写入，fingerprint 被落下
    expect(callText).toHaveBeenCalledOnce();
    expect(fs.readFileSync(todayPath, "utf-8")).toBe("compiled content from llm");
    expect(fs.existsSync(fpPath)).toBe(true);
  });

  it("removes stale fingerprint when sessions become empty", async () => {
    // 先有数据 + fingerprint
    const mgrWith = makeFakeSummaryManager([
      { session_id: "s1", updated_at: "2026-04-17T10:00:00Z", summary: "real summary" },
    ]);
    await compileToday(mgrWith, todayPath, RESOLVED_MODEL);
    expect(fs.existsSync(fpPath)).toBe(true);

    // 进入失败期：sessions 空
    const mgrEmpty = makeFakeSummaryManager([]);
    await compileToday(mgrEmpty, todayPath, RESOLVED_MODEL);

    // 旧 fingerprint 应被删除（保证下次恢复时不会命中老指纹）
    expect(fs.existsSync(fpPath)).toBe(false);
  });

  it("does not rewrite today.md when it is already empty and sessions are empty", async () => {
    // today.md 本就不存在
    const mgrEmpty = makeFakeSummaryManager([]);
    await compileToday(mgrEmpty, todayPath, RESOLVED_MODEL);
    expect(fs.existsSync(todayPath)).toBe(false);

    // 再来一次仍不创建
    await compileToday(mgrEmpty, todayPath, RESOLVED_MODEL);
    expect(fs.existsSync(todayPath)).toBe(false);
  });

  it("skips via fingerprint when sessions are unchanged (non-empty case preserved)", async () => {
    const mgr = makeFakeSummaryManager([
      { session_id: "s1", updated_at: "2026-04-17T10:00:00Z", summary: "real summary" },
    ]);
    await compileToday(mgr, todayPath, RESOLVED_MODEL);
    expect(callText).toHaveBeenCalledOnce();

    // 相同 sessions 再调：fingerprint 命中，应 skip，LLM 不再被调用
    await compileToday(mgr, todayPath, RESOLVED_MODEL);
    expect(callText).toHaveBeenCalledOnce();
  });
});

describe("compileWeek empty-sessions fingerprint trap fix", () => {
  let tmpDir;
  let weekPath;
  let fpPath;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-compile-week-"));
    weekPath = path.join(tmpDir, "week.md");
    fpPath = weekPath + ".fingerprint";
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not write fingerprint when sessions are empty", async () => {
    const mgr = makeFakeSummaryManager([]);
    await compileWeek(mgr, weekPath, RESOLVED_MODEL);

    expect(fs.existsSync(fpPath)).toBe(false);
    expect(callText).not.toHaveBeenCalled();
  });

  it("removes stale fingerprint when sessions become empty", async () => {
    const mgrWith = makeFakeSummaryManager([
      { session_id: "s1", updated_at: "2026-04-17T10:00:00Z", summary: "week summary" },
    ]);
    await compileWeek(mgrWith, weekPath, RESOLVED_MODEL);
    expect(fs.existsSync(fpPath)).toBe(true);

    const mgrEmpty = makeFakeSummaryManager([]);
    await compileWeek(mgrEmpty, weekPath, RESOLVED_MODEL);

    expect(fs.existsSync(fpPath)).toBe(false);
  });
});

describe("compiled section formatting", () => {
  let tmpDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-compile-format-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("strips model-emitted headings before writing today.md", async () => {
    callText.mockResolvedValueOnce("# 今日概要\n\n用户关注记忆系统。");
    const todayPath = path.join(tmpDir, "today.md");
    const mgr = makeFakeSummaryManager([
      { session_id: "s1", updated_at: "2026-04-29T08:30:00.000Z", summary: "用户关注记忆系统。" },
    ]);

    await compileToday(mgr, todayPath, RESOLVED_MODEL);

    expect(fs.readFileSync(todayPath, "utf-8")).toBe("用户关注记忆系统。");
  });

  it("strips closed think and thinking tags before writing compiled memory sections", async () => {
    callText
      .mockResolvedValueOnce("<think>先整理内部推理</think>\n用户关注记忆系统。")
      .mockResolvedValueOnce("<thinking>先整理内部推理</thinking>\n用户关注长期记忆。");
    const todayPath = path.join(tmpDir, "today.md");
    const weekPath = path.join(tmpDir, "week.md");
    const mgr = makeFakeSummaryManager([
      { session_id: "s1", updated_at: "2026-04-29T08:30:00.000Z", summary: "用户关注记忆系统。" },
    ]);

    await compileToday(mgr, todayPath, RESOLVED_MODEL);
    await compileWeek(mgr, weekPath, RESOLVED_MODEL);

    expect(fs.readFileSync(todayPath, "utf-8")).toBe("用户关注记忆系统。");
    expect(fs.readFileSync(weekPath, "utf-8")).toBe("用户关注长期记忆。");
  });

  it("rejects dangling leading thinking blocks without overwriting memory or fingerprinting the bad output", async () => {
    callText.mockResolvedValueOnce("<thinking>未闭合的内部推理\n这些内容不应进入记忆");
    const todayPath = path.join(tmpDir, "today.md");
    const fpPath = `${todayPath}.fingerprint`;
    fs.writeFileSync(todayPath, "已有记忆", "utf-8");
    const mgr = makeFakeSummaryManager([
      { session_id: "s1", updated_at: "2026-04-29T08:30:00.000Z", summary: "用户关注记忆系统。" },
    ]);

    await expect(compileToday(mgr, todayPath, RESOLVED_MODEL)).rejects.toThrow(
      "unterminated thinking block",
    );

    expect(fs.readFileSync(todayPath, "utf-8")).toBe("已有记忆");
    expect(fs.existsSync(fpPath)).toBe(false);
  });

  it("compiles short facts updates instead of directly appending them", async () => {
    callText.mockResolvedValueOnce("用户长期关注记忆系统。");
    const factsPath = path.join(tmpDir, "facts.md");
    fs.writeFileSync(factsPath, "用户喜欢清晰边界。", "utf-8");
    const mgr = makeFakeSummaryManager([
      {
        session_id: "s1",
        updated_at: "2026-04-29T08:30:00.000Z",
        summary: "## 重要事实\n用户长期关注记忆系统。\n\n## 事情经过\n无",
      },
    ]);

    await compileFacts(mgr, factsPath, RESOLVED_MODEL);

    expect(callText).toHaveBeenCalledOnce();
    const request = callText.mock.calls[0][0];
    expect(request.messages[0].content).toContain("用户喜欢清晰边界。");
    expect(request.messages[0].content).toContain("用户长期关注记忆系统。");
    expect(request.systemPrompt).toContain("200字以内");
    expect(fs.readFileSync(factsPath, "utf-8")).toBe("用户长期关注记忆系统。");
  });

  it("extracts facts from third-level rolling summary headings", async () => {
    callText.mockResolvedValueOnce("用户长期关注记忆系统。");
    const factsPath = path.join(tmpDir, "facts.md");
    const mgr = makeFakeSummaryManager([
      {
        session_id: "s1",
        updated_at: "2026-04-29T08:30:00.000Z",
        summary: "### 重要事实\n用户长期关注记忆系统。\n\n### 事情经过\n无",
      },
    ]);

    await compileFacts(mgr, factsPath, RESOLVED_MODEL);

    expect(callText).toHaveBeenCalledOnce();
    const request = callText.mock.calls[0][0];
    expect(request.messages[0].content).toContain("用户长期关注记忆系统。");
    expect(fs.readFileSync(factsPath, "utf-8")).toBe("用户长期关注记忆系统。");
  });

  it("extracts facts from English rolling summary headings", async () => {
    callText.mockResolvedValueOnce("The user is focused on memory systems.");
    const factsPath = path.join(tmpDir, "facts.md");
    const mgr = makeFakeSummaryManager([
      {
        session_id: "s1",
        updated_at: "2026-04-29T08:30:00.000Z",
        summary: "### Key Facts\nThe user is focused on memory systems.\n\n### Timeline\nNone",
      },
    ]);

    await compileFacts(mgr, factsPath, RESOLVED_MODEL);

    expect(callText).toHaveBeenCalledOnce();
    const request = callText.mock.calls[0][0];
    expect(request.messages[0].content).toContain("The user is focused on memory systems.");
    expect(fs.readFileSync(factsPath, "utf-8")).toBe("The user is focused on memory systems.");
  });

  it("ignores unordered-list empty fact markers", async () => {
    const factsPath = path.join(tmpDir, "facts.md");
    const mgr = makeFakeSummaryManager([
      {
        session_id: "s1",
        updated_at: "2026-04-29T08:30:00.000Z",
        summary: "### 重要事实\n- 无\n\n### 事情经过\n- 用户在讨论记忆系统。",
      },
      {
        session_id: "s2",
        updated_at: "2026-04-29T09:30:00.000Z",
        summary: "### Key Facts\n- None\n\n### Timeline\n- The user discussed memory systems.",
      },
    ]);

    await compileFacts(mgr, factsPath, RESOLVED_MODEL);

    expect(callText).not.toHaveBeenCalled();
    expect(fs.readFileSync(factsPath, "utf-8")).toBe("");
  });

  it("assemble strips legacy nested headings from source sections", async () => {
    const factsPath = path.join(tmpDir, "facts.md");
    const todayPath = path.join(tmpDir, "today.md");
    const weekPath = path.join(tmpDir, "week.md");
    const longtermPath = path.join(tmpDir, "longterm.md");
    const memoryPath = path.join(tmpDir, "memory.md");
    fs.writeFileSync(factsPath, "[\"用户喜欢清晰边界\"]", "utf-8");
    fs.writeFileSync(todayPath, "# 今天概要\n\n用户关注记忆系统。", "utf-8");
    fs.writeFileSync(weekPath, "# 本周主题概要\n\n用户持续关注 Project Hana。", "utf-8");
    fs.writeFileSync(longtermPath, "# 长期背景记录\n\n## 偏好\n\n用户偏好沉静 UI。", "utf-8");

    assemble(factsPath, todayPath, weekPath, longtermPath, memoryPath);

    const output = fs.readFileSync(memoryPath, "utf-8");
    expect(output).toContain("## 重要事实\n\n- 用户喜欢清晰边界");
    expect(output).toContain("## 今天\n\n用户关注记忆系统。");
    expect(output).toContain("## 本周早些时候\n\n用户持续关注 Project Hana。");
    expect(output).toContain("## 长期情况\n\n用户偏好沉静 UI。");
    expect(output).not.toContain("# 本周主题概要");
    expect(output).not.toContain("# 长期背景记录");
  });
});

describe("compiled memory reset watermark filtering", () => {
  let tmpDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-compile-since-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("passes since to summary range queries for today and week", async () => {
    const summaries = [
      { session_id: "new", updated_at: "2026-04-29T08:30:00.000Z", summary: "new summary" },
    ];
    const mgr = makeFakeSummaryManager(summaries);

    await compileToday(mgr, path.join(tmpDir, "today.md"), RESOLVED_MODEL, { since: "2026-04-29T08:00:00.000Z" });
    await compileWeek(mgr, path.join(tmpDir, "week.md"), RESOLVED_MODEL, { since: "2026-04-29T08:00:00.000Z" });

    expect(mgr.getSummariesInRange.mock.calls[0][2]).toEqual({ since: "2026-04-29T08:00:00.000Z" });
    expect(mgr.getSummariesInRange.mock.calls[1][2]).toEqual({ since: "2026-04-29T08:00:00.000Z" });
  });

  it("passes since to summary range queries for facts", async () => {
    const mgr = makeFakeSummaryManager([
      {
        session_id: "new",
        updated_at: "2026-04-29T08:30:00.000Z",
        summary: "## 重要事实\n用户关注记忆系统。\n\n## 事情经过\n无",
      },
    ]);

    await compileFacts(mgr, path.join(tmpDir, "facts.md"), RESOLVED_MODEL, { since: "2026-04-29T08:00:00.000Z" });

    expect(mgr.getSummariesInRange.mock.calls[0][2]).toEqual({ since: "2026-04-29T08:00:00.000Z" });
  });
});
