import { describe, expect, it, vi } from "vitest";
import { guardAssistantMessageStream } from "../lib/pi-sdk/stream-guard.js";

function makeStream(events, result) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
    result: vi.fn(async () => result),
  };
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return { events, result: await stream.result() };
}

function assistantMessage(content) {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "test",
    model: "test",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 1,
  };
}

describe("Pi SDK stream guard", () => {
  it("drops empty-name tool calls before the agent loop can execute them", async () => {
    const invalidTool = { type: "toolCall", id: "call_empty", name: "", arguments: {}, partialArgs: "" };
    const finalMessage = assistantMessage([invalidTool]);
    const inner = makeStream([
      { type: "start", partial: assistantMessage([]) },
      { type: "toolcall_start", contentIndex: 0, partial: assistantMessage([invalidTool]) },
      { type: "toolcall_delta", contentIndex: 0, delta: "", partial: assistantMessage([invalidTool]) },
      { type: "toolcall_end", contentIndex: 0, toolCall: invalidTool, partial: assistantMessage([invalidTool]) },
      { type: "done", reason: "stop", message: finalMessage },
    ], finalMessage);

    const { events, result } = await collect(guardAssistantMessageStream(inner));

    expect(events.map((event) => event.type)).toEqual(["start", "done"]);
    expect(result.content).toEqual([]);
  });

  it("recovers plain text that a provider reported as an empty-name tool call", async () => {
    const invalidTool = {
      type: "toolCall",
      id: "call_empty",
      name: "",
      arguments: {},
      partialArgs: "正文里提到 <tool_call> 标签时，后续内容也应继续显示。",
    };
    const finalMessage = assistantMessage([invalidTool]);
    const inner = makeStream([
      { type: "start", partial: assistantMessage([]) },
      { type: "toolcall_start", contentIndex: 0, partial: assistantMessage([invalidTool]) },
      { type: "toolcall_end", contentIndex: 0, toolCall: invalidTool, partial: assistantMessage([invalidTool]) },
      { type: "done", reason: "stop", message: finalMessage },
    ], finalMessage);

    const { events, result } = await collect(guardAssistantMessageStream(inner));

    expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
    expect(events.find((event) => event.type === "text_delta")?.delta).toBe("正文里提到 <tool_call> 标签时，后续内容也应继续显示。");
    expect(result.content).toEqual([
      { type: "text", text: "正文里提到 <tool_call> 标签时，后续内容也应继续显示。" },
    ]);
  });

  it("recovers backtick text streamed through empty-name tool call deltas", async () => {
    const startTool = {
      type: "toolCall",
      id: "call_empty_backtick",
      name: "",
      arguments: {},
      partialArgs: "`",
    };
    const deltaTool = {
      ...startTool,
      partialArgs: "`inline code` 后续文字",
    };
    const endTool = {
      ...startTool,
      partialArgs: "",
    };
    const finalMessage = assistantMessage([endTool]);
    const inner = makeStream([
      { type: "start", partial: assistantMessage([]) },
      { type: "toolcall_start", contentIndex: 0, partial: assistantMessage([startTool]) },
      { type: "toolcall_delta", contentIndex: 0, delta: "inline code", partial: assistantMessage([deltaTool]) },
      { type: "toolcall_delta", contentIndex: 0, delta: "` 后续文字", partial: assistantMessage([deltaTool]) },
      { type: "toolcall_end", contentIndex: 0, toolCall: endTool, partial: assistantMessage([endTool]) },
      { type: "done", reason: "stop", message: finalMessage },
    ], finalMessage);

    const { events, result } = await collect(guardAssistantMessageStream(inner));

    expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
    expect(events.find((event) => event.type === "text_delta")?.delta).toBe("`inline code` 后续文字");
    expect(result.content).toEqual([
      { type: "text", text: "`inline code` 后续文字" },
    ]);
  });

  it("leaves valid tool calls untouched", async () => {
    const validTool = { type: "toolCall", id: "call_read", name: "read", arguments: { path: "a.txt" }, partialArgs: "{\"path\":\"a.txt\"}" };
    const finalMessage = assistantMessage([validTool]);
    const inner = makeStream([
      { type: "start", partial: assistantMessage([]) },
      { type: "toolcall_start", contentIndex: 0, partial: assistantMessage([validTool]) },
      { type: "toolcall_end", contentIndex: 0, toolCall: validTool, partial: assistantMessage([validTool]) },
      { type: "done", reason: "stop", message: finalMessage },
    ], finalMessage);

    const { events, result } = await collect(guardAssistantMessageStream(inner));

    expect(events.map((event) => event.type)).toEqual(["start", "toolcall_start", "toolcall_end", "done"]);
    expect(result.content).toEqual([validTool]);
  });

  it("mirrors valid tool call stream events for live previews", async () => {
    const validTool = { type: "toolCall", id: "call_write", name: "write", arguments: {}, partialArgs: "{\"path\":\"a.md\",\"content\":\"hi" };
    const finalTool = { ...validTool, arguments: { path: "a.md", content: "hi" }, partialArgs: "{\"path\":\"a.md\",\"content\":\"hi\"}" };
    const finalMessage = assistantMessage([finalTool]);
    const mirrored = [];
    const inner = makeStream([
      { type: "start", partial: assistantMessage([]) },
      { type: "toolcall_start", contentIndex: 0, partial: assistantMessage([validTool]) },
      { type: "toolcall_delta", contentIndex: 0, delta: "hi", partial: assistantMessage([validTool]) },
      { type: "toolcall_end", contentIndex: 0, toolCall: finalTool, partial: assistantMessage([finalTool]) },
      { type: "done", reason: "stop", message: finalMessage },
    ], finalMessage);

    await collect(guardAssistantMessageStream(inner, event => mirrored.push(event)));

    expect(mirrored.map(event => event.type)).toEqual(["toolcall_start", "toolcall_delta", "toolcall_end"]);
    expect(mirrored[1].partial.content[0].partialArgs).toContain("\"content\":\"hi");
  });
});
