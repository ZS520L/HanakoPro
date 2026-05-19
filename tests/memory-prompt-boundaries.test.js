import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../server/i18n.js", () => ({
  getLocale: () => "zh-CN",
}));

vi.mock("../core/llm-client.js", () => ({
  callText: vi.fn().mockResolvedValue("[]"),
}));

import { callText } from "../core/llm-client.js";
import { SessionSummaryManager } from "../lib/memory/session-summary.js";
import { compileToday, compileWeek, compileLongterm } from "../lib/memory/compile.js";
import { processDirtySessions } from "../lib/memory/deep-memory.js";

const RESOLVED_MODEL = {
  model: "m",
  api: "openai-completions",
  api_key: "k",
  base_url: "http://x",
};

function makeFakeSummaryManager(summaries) {
  return {
    getSummariesInRange: vi.fn().mockReturnValue(summaries),
  };
}

describe("memory prompt boundaries", () => {
  let tmpDir;

  beforeEach(() => {
    vi.clearAllMocks();
    callText.mockResolvedValue("[]");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-memory-prompts-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("session summary centers memory on the user model and keeps work only at theme level", async () => {
    const manager = new SessionSummaryManager(path.join(tmpDir, "summaries"));

    await manager._callRollingLLM("【用户】我最近在关注记忆系统。", "", RESOLVED_MODEL, 2);

    const prompt = callText.mock.calls[0][0].systemPrompt;
    expect(prompt).toContain("记忆的核心职责是维护用户模型");
    expect(prompt).toContain("工作相关内容只允许保留到大主题层级");
    expect(prompt).toContain("如果这条信息回答的是“和用户工作时该怎么做”");
    expect(prompt).toContain("如果这条信息回答的是“用户最近在关注哪个领域/项目/主题”");
  });

  it("today and week prompts keep broad work themes but reject work details", async () => {
    const summaries = [
      {
        session_id: "s1",
        updated_at: new Date().toISOString(),
        summary: "## 重要事实\n无\n\n## 事情经过\n用户在讨论记忆系统。",
      },
    ];
    const manager = makeFakeSummaryManager(summaries);

    await compileToday(manager, path.join(tmpDir, "today.md"), RESOLVED_MODEL);
    await compileWeek(manager, path.join(tmpDir, "week.md"), RESOLVED_MODEL);

    const todayPrompt = callText.mock.calls[0][0].systemPrompt;
    const weekPrompt = callText.mock.calls[1][0].systemPrompt;
    for (const prompt of [todayPrompt, weekPrompt]) {
      expect(prompt).toContain("工作相关内容只允许保留到大主题层级");
      expect(prompt).toContain("领域/项目/主题");
      expect(prompt).toContain("不要记录执行步骤、文件名、工具、命令、检查顺序、协作偏好、工作细节");
      expect(prompt).toContain("不要输出 Markdown 标题");
    }
  });

  it("longterm prompt keeps durable user profile instead of work patterns", async () => {
    const weekPath = path.join(tmpDir, "week.md");
    const longtermPath = path.join(tmpDir, "longterm.md");
    fs.writeFileSync(weekPath, "用户最近在关注记忆系统。", "utf-8");

    await compileLongterm(weekPath, longtermPath, RESOLVED_MODEL);

    const prompt = callText.mock.calls[0][0].systemPrompt;
    expect(prompt).toContain("记忆不是工作日志");
    expect(prompt).toContain("用户画像");
    expect(prompt).toContain("长期关注方向");
    expect(prompt).toContain("不要输出 Markdown 标题");
    expect(prompt).not.toContain("工作模式");
  });

  it("deep memory only extracts profile and coarse current-interest facts", async () => {
    const summaryManager = {
      getDirtySessions: vi.fn().mockReturnValue([
        {
          session_id: "s1",
          summary: "## 重要事实\n无\n\n## 事情经过\n用户在讨论记忆系统。",
          snapshot: "",
          updated_at: new Date().toISOString(),
        },
      ]),
      markProcessed: vi.fn(),
    };
    const factStore = { addBatch: vi.fn() };

    await processDirtySessions(summaryManager, factStore, RESOLVED_MODEL);

    const prompt = callText.mock.calls[0][0].systemPrompt;
    expect(prompt).toContain("只提取用户画像和粗颗粒近况");
    expect(prompt).toContain("禁止提取工作方式偏好");
    expect(prompt).toContain("如果一条事实描述的是“以后遇到类似任务应该怎么做”");
  });
});
