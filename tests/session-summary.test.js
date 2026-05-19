import { describe, it, expect, vi } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";

vi.mock("../server/i18n.js", () => ({
  getLocale: () => "zh-CN",
}));

vi.mock("../core/llm-client.js", () => ({
  callText: vi.fn(),
}));

vi.mock("../lib/pii-guard.js", () => ({
  scrubPII: (text) => ({ cleaned: text, detected: [] }),
}));

import { SessionSummaryManager } from "../lib/memory/session-summary.js";
import { callText } from "../core/llm-client.js";

describe("SessionSummaryManager._buildConversationText", () => {
  function createManager() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-session-summary-"));
    return {
      manager: new SessionSummaryManager(tmpDir),
      cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
    };
  }

  it("assistant 普通文本全文保留，不再按 300 字截断", () => {
    const { manager, cleanup } = createManager();
    try {
      const longText = "甲".repeat(360);
      const text = manager._buildConversationText([
        {
          role: "assistant",
          content: [{ type: "text", text: longText }],
          timestamp: "2026-04-15T10:00:00.000Z",
        },
      ]);

      expect(text).toContain(`【助手】${longText}`);
      expect(text).not.toContain("长回复已截断");
    } finally {
      cleanup();
    }
  });

  it("assistant 的工具调用只保留简短标题", () => {
    const { manager, cleanup } = createManager();
    try {
      const text = manager._buildConversationText([
        {
          role: "assistant",
          content: [
            { type: "text", text: "我先看看实现。" },
            { type: "tool_use", name: "read", input: { file_path: "/tmp/demo.js" } },
            { type: "tool_use", name: "web_search", input: { query: "notifyTurn" } },
          ],
          timestamp: "2026-04-15T10:00:00.000Z",
        },
      ]);

      expect(text).toContain("【助手】我先看看实现。");
      expect(text).toContain("【助手】读取了 /tmp/demo.js");
      expect(text).toContain("【助手】搜索了 notifyTurn");
      expect(text).not.toContain("tool_use");
    } finally {
      cleanup();
    }
  });
});

describe("SessionSummaryManager.rollingSummary prompt contract", () => {
  function createManager() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-session-summary-"));
    return {
      manager: new SessionSummaryManager(tmpDir),
      cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
    };
  }

  it("asks the model to emit summary fields as third-level headings", async () => {
    callText.mockResolvedValueOnce("### 重要事实\n无\n\n### 事情经过\n[10:00] 用户在讨论记忆系统。");
    const { manager, cleanup } = createManager();
    try {
      await manager.rollingSummary(
        "s1",
        [{ role: "user", content: "我们看一下记忆 rolling。", timestamp: "2026-04-15T10:00:00.000Z" }],
        { model: "m", api: "openai-completions", api_key: "k", base_url: "http://x" },
      );

      const prompt = callText.mock.calls[0][0].systemPrompt;
      expect(prompt).toContain("### 重要事实");
      expect(prompt).toContain("### 事情经过");
      expect(prompt).toContain("直接以 ### 重要事实 开头输出");
      expect(prompt).toContain("两个标题下的正文都必须使用无序列表");
      expect(prompt).toContain("列表项必须以 `- ` 开头");
      expect(prompt).not.toContain("直接以 ## 重要事实 开头输出");
      const formatSection = prompt.slice(
        prompt.indexOf("## 输出格式"),
        prompt.indexOf("## 内容要求"),
      );
      expect(formatSection).not.toContain("只记录用户画像类信息");
      expect(formatSection).not.toContain("按时间顺序记录本 session 发生了什么");
    } finally {
      cleanup();
    }
  });
});
