import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Mock callText before importing module under test
vi.mock("../../core/llm-client.js", () => ({
  callText: vi.fn(),
}));

import { callText } from "../../core/llm-client.js";
import { summarizeSessionForRc } from "../../core/slash-commands/rc-summary.js";

let tmpFile;

function writeSessionFile(lines) {
  tmpFile = path.join(os.tmpdir(), `rc-summary-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(tmpFile, lines.map(l => JSON.stringify(l)).join("\n"));
  return tmpFile;
}

function makeUserMsg(text) {
  return { type: "message", message: { role: "user", content: [{ type: "text", text }] } };
}
function makeAssistantMsg(text, tools = []) {
  const blocks = [{ type: "text", text }];
  for (const name of tools) blocks.push({ type: "tool_use", name, input: {} });
  return { type: "message", message: { role: "assistant", content: blocks } };
}

function makeEngine({ utilConfig, chatCreds } = {}) {
  return {
    resolveUtilityConfig: utilConfig === undefined
      ? vi.fn(() => { throw new Error("not configured"); })
      : vi.fn(() => utilConfig),
    resolveModelWithCredentials: chatCreds === undefined
      ? vi.fn(() => { throw new Error("chat not resolved"); })
      : vi.fn(() => chatCreds),
  };
}

function makeAgent(chatId = "gpt-5", provider = "openai") {
  return { config: { models: { chat: { id: chatId, provider } } } };
}

beforeEach(() => {
  callText.mockReset();
});
afterEach(() => {
  if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  tmpFile = null;
});

describe("summarizeSessionForRc — 3-tier fallback", () => {
  it("returns null when session path is missing", async () => {
    const r = await summarizeSessionForRc(makeEngine(), makeAgent(), "/does/not/exist.jsonl");
    expect(r).toBeNull();
    expect(callText).not.toHaveBeenCalled();
  });

  it("returns null when session is empty (no messages)", async () => {
    const p = writeSessionFile([]);
    const r = await summarizeSessionForRc(makeEngine(), makeAgent(), p);
    expect(r).toBeNull();
  });

  it("Tier 1 (utility) succeeds → does not reach tier 2/3", async () => {
    const p = writeSessionFile([makeUserMsg("hi"), makeAssistantMsg("hello")]);
    callText.mockResolvedValueOnce("utility summary");
    const engine = makeEngine({
      utilConfig: {
        utility: "gpt-4o-mini", utility_large: "gpt-4o",
        api_key: "k", base_url: "https://x", api: "openai",
        large_api_key: "k", large_base_url: "https://x", large_api: "openai",
      },
    });
    const r = await summarizeSessionForRc(engine, makeAgent(), p);
    expect(r).toBe("utility summary");
    expect(callText).toHaveBeenCalledTimes(1);
  });

  it("Tier 1 fails → falls back to Tier 2 (utility_large)", async () => {
    const p = writeSessionFile([makeUserMsg("hi"), makeAssistantMsg("hello")]);
    callText.mockRejectedValueOnce(new Error("utility down"));
    callText.mockResolvedValueOnce("large summary");
    const engine = makeEngine({
      utilConfig: {
        utility: "gpt-4o-mini", utility_large: "gpt-4o",
        api_key: "k", base_url: "https://x", api: "openai",
        large_api_key: "k", large_base_url: "https://x", large_api: "openai",
      },
    });
    const r = await summarizeSessionForRc(engine, makeAgent(), p);
    expect(r).toBe("large summary");
    expect(callText).toHaveBeenCalledTimes(2);
  });

  it("Tiers 1+2 fail → falls back to Tier 3 (chat)", async () => {
    const p = writeSessionFile([makeUserMsg("hi"), makeAssistantMsg("hello")]);
    callText.mockRejectedValueOnce(new Error("utility down"));
    callText.mockRejectedValueOnce(new Error("large down"));
    callText.mockResolvedValueOnce("chat summary");
    const engine = makeEngine({
      utilConfig: {
        utility: "u", utility_large: "ul",
        api_key: "k", base_url: "https://x", api: "openai",
        large_api_key: "k", large_base_url: "https://x", large_api: "openai",
      },
      chatCreds: { model: "gpt-5", provider: "openai", api: "openai", api_key: "k2", base_url: "https://y" },
    });
    const r = await summarizeSessionForRc(engine, makeAgent("gpt-5"), p);
    expect(r).toBe("chat summary");
    expect(callText).toHaveBeenCalledTimes(3);
  });

  it("all three tiers fail → returns null (caller does tier-4 plain text)", async () => {
    const p = writeSessionFile([makeUserMsg("hi"), makeAssistantMsg("hello")]);
    callText.mockRejectedValue(new Error("offline"));
    const engine = makeEngine({
      utilConfig: {
        utility: "u", utility_large: "ul",
        api_key: "k", base_url: "https://x", api: "openai",
        large_api_key: "k", large_base_url: "https://x", large_api: "openai",
      },
      chatCreds: { model: "gpt-5", provider: "openai", api: "openai", api_key: "k2", base_url: "https://y" },
    });
    const r = await summarizeSessionForRc(engine, makeAgent("gpt-5"), p);
    expect(r).toBeNull();
    expect(callText).toHaveBeenCalledTimes(3);
  });

  it("engine.resolveUtilityConfig throws → tier 1+2 skipped, tier 3 tried", async () => {
    const p = writeSessionFile([makeUserMsg("hi"), makeAssistantMsg("hello")]);
    callText.mockResolvedValueOnce("chat only");
    const engine = makeEngine({
      utilConfig: undefined,  // default mock throws
      chatCreds: { model: "gpt-5", provider: "openai", api: "openai", api_key: "k", base_url: "https://x" },
    });
    const r = await summarizeSessionForRc(engine, makeAgent("gpt-5"), p);
    expect(r).toBe("chat only");
    expect(callText).toHaveBeenCalledTimes(1);
  });

  it("utility config incomplete (missing api_key) → skips tier 1 cleanly", async () => {
    const p = writeSessionFile([makeUserMsg("hi"), makeAssistantMsg("hello")]);
    callText.mockResolvedValueOnce("from large");
    const engine = makeEngine({
      utilConfig: {
        utility: "u", utility_large: "ul",
        api_key: "",   // incomplete — tier 1 skipped
        base_url: "https://x", api: "openai",
        large_api_key: "k", large_base_url: "https://x", large_api: "openai",
      },
    });
    const r = await summarizeSessionForRc(engine, makeAgent(), p);
    expect(r).toBe("from large");
    // Tier 1 skipped (no api_key), Tier 2 called with large creds
    expect(callText).toHaveBeenCalledTimes(1);
  });

  it("trims whitespace on success", async () => {
    const p = writeSessionFile([makeUserMsg("hi"), makeAssistantMsg("hello")]);
    callText.mockResolvedValueOnce("  padded summary  \n");
    const engine = makeEngine({
      utilConfig: {
        utility: "u", utility_large: "ul",
        api_key: "k", base_url: "https://x", api: "openai",
        large_api_key: "k", large_base_url: "https://x", large_api: "openai",
      },
    });
    const r = await summarizeSessionForRc(engine, makeAgent(), p);
    expect(r).toBe("padded summary");
  });

  it("asks for a concise but useful Chinese summary under 100 characters", async () => {
    const p = writeSessionFile([
      makeUserMsg("帮我检查远程控制的摘要为什么太短"),
      makeAssistantMsg("我正在查看 /rc 接管后的摘要生成逻辑，准备调整提示词。", ["read"]),
    ]);
    callText.mockResolvedValueOnce("正在调整 /rc 摘要提示词，重点补足当前进展和下一步线索。");
    const engine = makeEngine({
      utilConfig: {
        utility: "u", utility_large: "ul",
        api_key: "k", base_url: "https://x", api: "openai",
        large_api_key: "k", large_base_url: "https://x", large_api: "openai",
      },
    });

    await summarizeSessionForRc(engine, makeAgent(), p);

    const system = callText.mock.calls[0][0].messages[0].content;
    expect(system).toContain("100 字以内");
    expect(system).toContain("当前进展");
    expect(system).toContain("下一步线索");
    expect(system).not.toContain("40 字以内");
  });
});
