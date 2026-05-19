import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../core/llm-client.js", () => ({
  callText: vi.fn().mockResolvedValue("## 重要事实\n新事实\n\n## 事情经过\n新事件"),
}));

import {
  readCompiledResetAt,
  writeCompiledResetMarker,
  clearCompiledMemoryArtifacts,
  clearCompiledSummarySources,
  normalizeCompiledSectionBody,
} from "../lib/memory/compiled-memory-state.js";
import { SessionSummaryManager } from "../lib/memory/session-summary.js";
import { callText } from "../core/llm-client.js";

const RESOLVED_MODEL = { model: "m", api: "openai-completions", api_key: "k", base_url: "http://x" };

describe("compiled memory reset state", () => {
  let tmpDir;
  let memoryDir;
  let summariesDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-compiled-reset-"));
    memoryDir = path.join(tmpDir, "memory");
    summariesDir = path.join(memoryDir, "summaries");
    fs.mkdirSync(summariesDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes and reads the compiled reset watermark", () => {
    const resetAt = "2026-04-29T08:00:00.000Z";
    writeCompiledResetMarker(memoryDir, resetAt);

    expect(readCompiledResetAt(memoryDir)).toBe(resetAt);
    const raw = JSON.parse(fs.readFileSync(path.join(memoryDir, "reset.json"), "utf-8"));
    expect(raw.compiledResetAt).toBe(resetAt);
  });

  it("clears compiled artifacts and fingerprints without deleting summaries", () => {
    for (const name of ["memory.md", "facts.md", "today.md", "week.md", "longterm.md"]) {
      fs.writeFileSync(path.join(memoryDir, name), "old content", "utf-8");
      fs.writeFileSync(path.join(memoryDir, `${name}.fingerprint`), "fingerprint", "utf-8");
    }
    fs.writeFileSync(path.join(summariesDir, "s1.json"), "{}", "utf-8");

    clearCompiledMemoryArtifacts(memoryDir);

    for (const name of ["memory.md", "facts.md", "today.md", "week.md", "longterm.md"]) {
      expect(fs.readFileSync(path.join(memoryDir, name), "utf-8")).toBe("");
      expect(fs.existsSync(path.join(memoryDir, `${name}.fingerprint`))).toBe(false);
    }
    expect(fs.existsSync(path.join(summariesDir, "s1.json"))).toBe(true);
  });

  it("clears summary source files and calls the cache clearer", () => {
    fs.writeFileSync(path.join(summariesDir, "s1.json"), "{}", "utf-8");
    fs.writeFileSync(path.join(summariesDir, "s1.tmp"), "not a summary", "utf-8");
    let cacheCleared = false;

    clearCompiledSummarySources(summariesDir, { clearCache: () => { cacheCleared = true; } });

    expect(fs.existsSync(path.join(summariesDir, "s1.json"))).toBe(false);
    expect(fs.existsSync(path.join(summariesDir, "s1.tmp"))).toBe(true);
    expect(cacheCleared).toBe(true);
  });

  it("normalizes section body content by removing headings and JSON string arrays", () => {
    expect(normalizeCompiledSectionBody("# 本周主题概要\n\n- 用户关注记忆系统")).toBe("- 用户关注记忆系统");
    expect(normalizeCompiledSectionBody("## 长期背景记录\n\n### 偏好\n\n用户喜欢沉静的 UI")).toBe("用户喜欢沉静的 UI");
    expect(normalizeCompiledSectionBody("[\"用户关注 Project Hana\", \"用户喜欢清晰边界\"]")).toBe("- 用户关注 Project Hana\n- 用户喜欢清晰边界");
  });
});

describe("SessionSummaryManager reset support", () => {
  let tmpDir;
  let summariesDir;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-summary-reset-"));
    summariesDir = path.join(tmpDir, "summaries");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("filters summaries at or before the reset watermark", () => {
    const manager = new SessionSummaryManager(summariesDir);
    manager.saveSummary("old", {
      session_id: "old",
      created_at: "2026-04-29T07:00:00.000Z",
      updated_at: "2026-04-29T07:30:00.000Z",
      summary: "old summary",
    });
    manager.saveSummary("new", {
      session_id: "new",
      created_at: "2026-04-29T08:30:00.000Z",
      updated_at: "2026-04-29T08:30:00.000Z",
      summary: "new summary",
    });

    const summaries = manager.getSummariesInRange(
      new Date("2026-04-29T00:00:00.000Z"),
      new Date("2026-04-30T00:00:00.000Z"),
      { since: "2026-04-29T08:00:00.000Z" },
    );

    expect(summaries.map((s) => s.session_id)).toEqual(["new"]);
  });

  it("clearAll removes JSON summary files and clears the in-memory cache", () => {
    const manager = new SessionSummaryManager(summariesDir);
    manager.saveSummary("s1", {
      session_id: "s1",
      created_at: "2026-04-29T08:30:00.000Z",
      updated_at: "2026-04-29T08:30:00.000Z",
      summary: "summary",
    });

    manager.clearAll();

    expect(manager.getAllSummaries()).toEqual([]);
    expect(fs.readdirSync(summariesDir).filter((name) => name.endsWith(".json"))).toEqual([]);
  });

  it("ignores pre-reset existing summary when rolling a post-reset session", async () => {
    const manager = new SessionSummaryManager(summariesDir);
    manager.saveSummary("s1", {
      session_id: "s1",
      created_at: "2026-04-29T07:00:00.000Z",
      updated_at: "2026-04-29T07:30:00.000Z",
      summary: "old summary",
      messageCount: 1,
    });
    writeCompiledResetMarker(tmpDir, "2026-04-29T08:00:00.000Z");

    await manager.rollingSummary(
      "s1",
      [{ role: "user", content: "new message", timestamp: "2026-04-29T08:01:00.000Z" }],
      RESOLVED_MODEL,
    );

    const userContent = callText.mock.calls[0][0].messages[0].content;
    expect(userContent).not.toContain("old summary");
    expect(manager.getSummary("s1").summary).toContain("新事实");
  });

  it("does not save a rolling summary that started before reset and finishes after reset", async () => {
    const manager = new SessionSummaryManager(summariesDir);
    callText.mockImplementationOnce(async () => {
      writeCompiledResetMarker(tmpDir, "2026-04-29T08:00:00.000Z");
      return "## 重要事实\n旧事实\n\n## 事情经过\n旧事件";
    });

    await manager.rollingSummary(
      "s1",
      [{ role: "user", content: "old message", timestamp: "2026-04-29T07:59:00.000Z" }],
      RESOLVED_MODEL,
    );

    expect(manager.getSummary("s1")).toBeNull();
  });
});
