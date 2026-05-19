/**
 * #521 回归测试。
 *
 * 验证 evaluateSessionHealth 能正确识别"反复 empty_stream / error"模式的
 * 会话；同时严守"识别失败时绝不阻断 restore"的容错语义。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { evaluateSessionHealth } from "../core/session-health.js";

let tmpDir;
let sessionPath;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-health-"));
  sessionPath = path.join(tmpDir, "session.jsonl");
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function entry(role, opts = {}) {
  return JSON.stringify({
    type: "message",
    id: opts.id || crypto.randomUUID(),
    timestamp: opts.timestamp || Date.now(),
    message: {
      role,
      content: opts.content || [],
      stopReason: opts.stopReason,
      ...(opts.errorMessage ? { errorMessage: opts.errorMessage } : {}),
    },
  });
}

function writeSession(...lines) {
  fs.writeFileSync(sessionPath, lines.join("\n"));
}

describe("evaluateSessionHealth", () => {
  it("missing session file → healthy (don't block restore on missing file)", () => {
    const result = evaluateSessionHealth(path.join(tmpDir, "nonexistent.jsonl"));
    expect(result).toEqual({ healthy: true, recentErrors: 0, totalChecked: 0, exists: false });
  });

  it("clean session with no errors → healthy", () => {
    writeSession(
      entry("user"),
      entry("assistant", { stopReason: "stop" }),
      entry("user"),
      entry("assistant", { stopReason: "stop" }),
    );
    const result = evaluateSessionHealth(sessionPath);
    expect(result.healthy).toBe(true);
    expect(result.recentErrors).toBe(0);
    expect(result.totalChecked).toBe(2);
  });

  it("3 trailing assistant errors → unhealthy (#521 reproduction)", () => {
    writeSession(
      entry("user"),
      entry("assistant", { stopReason: "stop" }),
      entry("user"),
      entry("assistant", { stopReason: "error", errorMessage: "empty_stream" }),
      entry("user"),
      entry("assistant", { stopReason: "error", errorMessage: "empty_stream" }),
      entry("user"),
      entry("assistant", { stopReason: "error", errorMessage: "empty_stream" }),
    );
    const result = evaluateSessionHealth(sessionPath);
    expect(result.healthy).toBe(false);
    expect(result.recentErrors).toBe(3);
  });

  it("only inspects last `lookback` assistant messages", () => {
    const lines = [];
    for (let i = 0; i < 12; i++) {
      lines.push(entry("user"));
      lines.push(entry("assistant", { stopReason: "stop" }));
    }
    writeSession(...lines);
    const result = evaluateSessionHealth(sessionPath, { lookback: 10 });
    expect(result.totalChecked).toBe(10);
    expect(result.healthy).toBe(true);
  });

  it("old errors outside lookback window do not poison new healthy session", () => {
    const lines = [];
    for (let i = 0; i < 5; i++) {
      lines.push(entry("user"));
      lines.push(entry("assistant", { stopReason: "error" }));
    }
    for (let i = 0; i < 10; i++) {
      lines.push(entry("user"));
      lines.push(entry("assistant", { stopReason: "stop" }));
    }
    writeSession(...lines);
    const result = evaluateSessionHealth(sessionPath, { lookback: 10 });
    expect(result.healthy).toBe(true);
    expect(result.recentErrors).toBe(0);
  });

  it("malformed JSONL lines are skipped, not fatal", () => {
    writeSession(
      "this is not json at all",
      "{broken json",
      entry("assistant", { stopReason: "error" }),
      entry("assistant", { stopReason: "error" }),
      entry("assistant", { stopReason: "error" }),
    );
    const result = evaluateSessionHealth(sessionPath);
    expect(result.healthy).toBe(false);
    expect(result.recentErrors).toBe(3);
  });

  it("non-message entries (compaction, custom_message) are ignored", () => {
    writeSession(
      JSON.stringify({ type: "compaction", id: "c1", summary: "earlier turns" }),
      JSON.stringify({ type: "model_change", provider: "openai", modelId: "gpt-5" }),
      entry("assistant", { stopReason: "error" }),
      entry("assistant", { stopReason: "error" }),
      entry("assistant", { stopReason: "error" }),
    );
    const result = evaluateSessionHealth(sessionPath);
    expect(result.healthy).toBe(false);
    expect(result.recentErrors).toBe(3);
  });

  it("user / tool_result entries are not counted as assistants", () => {
    writeSession(
      entry("user"),
      entry("user"),
      entry("user"),
      JSON.stringify({ type: "message", id: "t1", timestamp: 1, message: { role: "tool_result", content: [] } }),
      entry("assistant", { stopReason: "error" }),
    );
    const result = evaluateSessionHealth(sessionPath);
    expect(result.totalChecked).toBe(1);
    expect(result.recentErrors).toBe(1);
    // Only 1 error, threshold default 3 → still healthy
    expect(result.healthy).toBe(true);
  });

  it("custom errorThreshold is respected", () => {
    writeSession(
      entry("assistant", { stopReason: "error" }),
      entry("assistant", { stopReason: "stop" }),
      entry("assistant", { stopReason: "stop" }),
    );
    expect(evaluateSessionHealth(sessionPath, { errorThreshold: 1 }).healthy).toBe(false);
    expect(evaluateSessionHealth(sessionPath, { errorThreshold: 5 }).healthy).toBe(true);
  });

  it("read errors (e.g. permission denied) → fall back to healthy (don't block restore)", () => {
    // 写一个 dir 而不是 file，触发 EISDIR
    const result = evaluateSessionHealth(tmpDir);
    expect(result.healthy).toBe(true);
    expect(result.exists).toBe(false);
  });
});
