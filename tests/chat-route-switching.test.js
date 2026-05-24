import { describe, expect, it, vi } from "vitest";
import { createChatRoute } from "../server/routes/chat.js";

describe("chat route model switch guard", () => {
  it("rejects prompts through the engine public switching API", async () => {
    let createHandlers;
    const upgradeWebSocket = vi.fn((factory) => {
      createHandlers = factory;
      return () => new Response(null);
    });
    const hub = {
      subscribe: vi.fn(),
      send: vi.fn(async () => {}),
    };
    const engine = {
      agentName: "Hana",
      abortAllStreaming: vi.fn(async () => {}),
      getSessionByPath: vi.fn(() => null),
      isSessionStreaming: vi.fn(() => false),
      isSessionSwitching: vi.fn(() => true),
      steerSession: vi.fn(() => false),
      slashDispatcher: null,
    };

    createChatRoute(engine, hub, { upgradeWebSocket });
    const handlers = createHandlers({});
    const ws = {
      readyState: 1,
      send: vi.fn(),
    };

    handlers.onMessage({
      data: JSON.stringify({
        type: "prompt",
        text: "hello",
        sessionPath: "/tmp/session.jsonl",
      }),
    }, ws);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.isSessionSwitching).toHaveBeenCalledWith("/tmp/session.jsonl");
    expect(hub.send).not.toHaveBeenCalled();
    expect(JSON.parse(ws.send.mock.calls[0][0])).toMatchObject({
      type: "error",
      message: "正在切换模型，请稍候",
      sessionPath: "/tmp/session.jsonl",
    });
  });
});

describe("chat route streaming error lifecycle", () => {
  it("closes streaming status when a provider message_end error arrives", () => {
    let createHandlers;
    let subscriber;
    const upgradeWebSocket = vi.fn((factory) => {
      createHandlers = factory;
      return () => new Response(null);
    });
    const hub = {
      subscribe: vi.fn((cb) => {
        subscriber = cb;
      }),
      send: vi.fn(async () => {}),
    };
    const engine = {
      agentName: "Hana",
      abortAllStreaming: vi.fn(async () => {}),
      getSessionByPath: vi.fn(() => null),
      isSessionStreaming: vi.fn(() => false),
      isSessionSwitching: vi.fn(() => false),
      steerSession: vi.fn(() => false),
      slashDispatcher: null,
    };

    createChatRoute(engine, hub, { upgradeWebSocket });
    const handlers = createHandlers({});
    const ws = {
      readyState: 1,
      send: vi.fn(),
    };

    handlers.onOpen({}, ws);
    subscriber({ type: "session_status", isStreaming: true }, "/tmp/session.jsonl");
    subscriber({ type: "tool_execution_start", toolName: "read", args: { path: "plan.docx" } }, "/tmp/session.jsonl");
    subscriber({
      type: "message_end",
      message: {
        stopReason: "error",
        errorMessage: "signal is aborted without reason",
      },
    }, "/tmp/session.jsonl");

    const sent = ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "error", message: "signal is aborted without reason", sessionPath: "/tmp/session.jsonl" }),
      expect.objectContaining({ type: "turn_end", sessionPath: "/tmp/session.jsonl" }),
      expect.objectContaining({ type: "status", isStreaming: false, sessionPath: "/tmp/session.jsonl" }),
    ]));
  });

  it("keeps streaming status active when session_status false arrives before late deltas and turn_end", () => {
    let createHandlers;
    let subscriber;
    const upgradeWebSocket = vi.fn((factory) => {
      createHandlers = factory;
      return () => new Response(null);
    });
    const hub = {
      subscribe: vi.fn((cb) => {
        subscriber = cb;
      }),
      send: vi.fn(async () => {}),
    };
    const engine = {
      agentName: "Hana",
      abortAllStreaming: vi.fn(async () => {}),
      getSessionByPath: vi.fn(() => null),
      isSessionStreaming: vi.fn(() => false),
      isSessionSwitching: vi.fn(() => false),
      steerSession: vi.fn(() => false),
      slashDispatcher: null,
    };

    createChatRoute(engine, hub, { upgradeWebSocket });
    const handlers = createHandlers({});
    const ws = {
      readyState: 1,
      send: vi.fn(),
    };

    handlers.onOpen({}, ws);
    subscriber({ type: "session_status", isStreaming: true }, "/tmp/session.jsonl");
    subscriber({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "第一段" } }, "/tmp/session.jsonl");
    subscriber({ type: "session_status", isStreaming: false }, "/tmp/session.jsonl");

    let sent = ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
    expect(sent.filter(msg => msg.type === "status" && msg.isStreaming === false)).toHaveLength(0);

    subscriber({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "第二段" } }, "/tmp/session.jsonl");
    subscriber({ type: "turn_end" }, "/tmp/session.jsonl");

    sent = ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
    const lateDeltaIndex = sent.findIndex(msg => msg.type === "text_delta" && msg.delta === "第二段");
    const turnEndIndex = sent.findIndex(msg => msg.type === "turn_end");
    const statusFalseIndex = sent.findIndex(msg => msg.type === "status" && msg.isStreaming === false);
    expect(lateDeltaIndex).toBeGreaterThan(-1);
    expect(turnEndIndex).toBeGreaterThan(lateDeltaIndex);
    expect(statusFalseIndex).toBeGreaterThan(turnEndIndex);
  });

  it("does not close streaming on provider turn_end before tool execution continues", () => {
    let createHandlers;
    let subscriber;
    const upgradeWebSocket = vi.fn((factory) => {
      createHandlers = factory;
      return () => new Response(null);
    });
    const hub = {
      subscribe: vi.fn((cb) => {
        subscriber = cb;
      }),
      send: vi.fn(async () => {}),
    };
    const engine = {
      agentName: "Hana",
      abortAllStreaming: vi.fn(async () => {}),
      getSessionByPath: vi.fn(() => null),
      isSessionStreaming: vi.fn(() => false),
      isSessionSwitching: vi.fn(() => false),
      steerSession: vi.fn(() => false),
      slashDispatcher: null,
    };

    createChatRoute(engine, hub, { upgradeWebSocket });
    const handlers = createHandlers({});
    const ws = {
      readyState: 1,
      send: vi.fn(),
    };

    handlers.onOpen({}, ws);
    subscriber({ type: "session_status", isStreaming: true }, "/tmp/session.jsonl");
    subscriber({ type: "message_update", assistantMessageEvent: { type: "toolcall_start" } }, "/tmp/session.jsonl");
    subscriber({ type: "turn_end" }, "/tmp/session.jsonl");

    let sent = ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
    expect(sent.filter(msg => msg.type === "turn_end")).toHaveLength(0);
    expect(sent.filter(msg => msg.type === "status" && msg.isStreaming === false)).toHaveLength(0);

    subscriber({ type: "tool_execution_start", toolName: "browser", args: { action: "navigate", url: "https://example.com" } }, "/tmp/session.jsonl");
    subscriber({ type: "tool_execution_end", toolName: "browser", result: { details: { running: true, url: "https://example.com" } } }, "/tmp/session.jsonl");
    subscriber({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "工具后继续输出" } }, "/tmp/session.jsonl");
    subscriber({ type: "turn_end" }, "/tmp/session.jsonl");

    sent = ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
    expect(sent.filter(msg => msg.type === "status" && msg.isStreaming === false)).toHaveLength(0);

    subscriber({ type: "session_status", isStreaming: false }, "/tmp/session.jsonl");

    sent = ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
    const textIndex = sent.findIndex(msg => msg.type === "text_delta" && msg.delta === "工具后继续输出");
    const turnEndIndex = sent.findIndex(msg => msg.type === "turn_end");
    const statusFalseIndex = sent.findIndex(msg => msg.type === "status" && msg.isStreaming === false);
    expect(textIndex).toBeGreaterThan(-1);
    expect(turnEndIndex).toBeGreaterThan(textIndex);
    expect(statusFalseIndex).toBeGreaterThan(turnEndIndex);
  });

  it("closes streaming immediately on pure text provider turn_end", () => {
    let createHandlers;
    let subscriber;
    const upgradeWebSocket = vi.fn((factory) => {
      createHandlers = factory;
      return () => new Response(null);
    });
    const hub = {
      subscribe: vi.fn((cb) => {
        subscriber = cb;
      }),
      send: vi.fn(async () => {}),
    };
    const engine = {
      agentName: "Hana",
      abortAllStreaming: vi.fn(async () => {}),
      getSessionByPath: vi.fn(() => null),
      isSessionStreaming: vi.fn(() => false),
      isSessionSwitching: vi.fn(() => false),
      steerSession: vi.fn(() => false),
      slashDispatcher: null,
    };

    createChatRoute(engine, hub, { upgradeWebSocket });
    const handlers = createHandlers({});
    const ws = {
      readyState: 1,
      send: vi.fn(),
    };

    handlers.onOpen({}, ws);
    subscriber({ type: "session_status", isStreaming: true }, "/tmp/session.jsonl");
    subscriber({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "纯文本回答" } }, "/tmp/session.jsonl");
    subscriber({ type: "turn_end" }, "/tmp/session.jsonl");

    const sent = ws.send.mock.calls.map(([raw]) => JSON.parse(raw));
    const textIndex = sent.findIndex(msg => msg.type === "text_delta" && msg.delta === "纯文本回答");
    const turnEndIndex = sent.findIndex(msg => msg.type === "turn_end");
    const statusFalseIndex = sent.findIndex(msg => msg.type === "status" && msg.isStreaming === false);
    const contextUsageIndex = sent.findIndex(msg => msg.type === "context_usage");
    expect(textIndex).toBeGreaterThan(-1);
    expect(turnEndIndex).toBeGreaterThan(textIndex);
    expect(statusFalseIndex).toBeGreaterThan(turnEndIndex);
    expect(contextUsageIndex).toBeGreaterThan(statusFalseIndex);
  });
});

describe("chat route interrupt prompt", () => {
  it("persists the visible partial assistant text before submitting the interjection as a new prompt", async () => {
    let createHandlers;
    let subscriber;
    const order = [];
    const sessionManager = {
      getBranch: vi.fn(() => [
        { type: "message", message: { role: "user", content: [{ type: "text", text: "讲故事" }] } },
      ]),
      appendMessage: vi.fn(() => {
        order.push("snapshot");
      }),
    };
    const session = { sessionManager, messages: [] };
    const upgradeWebSocket = vi.fn((factory) => {
      createHandlers = factory;
      return () => new Response(null);
    });
    const engine = {
      agentName: "Hana",
      abortAllStreaming: vi.fn(async () => {}),
      getSessionByPath: vi.fn(() => session),
      ensureSessionLoaded: vi.fn(async () => session),
      isSessionStreaming: vi.fn(() => true),
      isSessionSwitching: vi.fn(() => false),
      steerSession: vi.fn(() => false),
      interruptSessionForPrompt: vi.fn(async () => {
        order.push("interrupt");
        engine.isSessionStreaming.mockReturnValue(false);
        return true;
      }),
      slashDispatcher: null,
    };
    const hub = {
      subscribe: vi.fn((cb) => {
        subscriber = cb;
      }),
      abort: vi.fn(async () => {
        order.push("abort");
        return true;
      }),
      send: vi.fn(async () => {
        order.push("send");
      }),
    };

    createChatRoute(engine, hub, { upgradeWebSocket });
    const handlers = createHandlers({});
    const ws = {
      readyState: 1,
      send: vi.fn(),
    };

    handlers.onOpen({}, ws);
    subscriber({ type: "session_status", isStreaming: true }, "/tmp/session.jsonl");
    subscriber({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "旧故事第一段" } }, "/tmp/session.jsonl");
    subscriber({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "旧故事第二段" } }, "/tmp/session.jsonl");

    handlers.onMessage({
      data: JSON.stringify({
        type: "interrupt_prompt",
        text: "请先处理我的插话",
        sessionPath: "/tmp/session.jsonl",
        displayMessage: { text: "请先处理我的插话" },
      }),
    }, ws);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.interruptSessionForPrompt).toHaveBeenCalledWith("/tmp/session.jsonl");
    expect(hub.abort).not.toHaveBeenCalled();
    expect(engine.steerSession).not.toHaveBeenCalled();
    expect(sessionManager.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: "assistant",
      content: [{ type: "text", text: "旧故事第一段旧故事第二段" }],
      usage: expect.objectContaining({ totalTokens: 0 }),
      stopReason: "interrupted",
    }));
    expect(hub.send).toHaveBeenCalledWith("请先处理我的插话", expect.objectContaining({
      sessionPath: "/tmp/session.jsonl",
      displayMessage: { text: "请先处理我的插话" },
    }));
    expect(order).toEqual(["interrupt", "snapshot", "send"]);
  });

  it("manual abort preserves the session and persists a valid interrupted assistant snapshot", async () => {
    let createHandlers;
    let subscriber;
    const order = [];
    const branch = [
      { type: "message", message: { role: "user", content: [{ type: "text", text: "慢慢输出" }] } },
    ];
    const sessionManager = {
      getBranch: vi.fn(() => branch),
      buildSessionContext: vi.fn(() => ({ messages: branch.map(entry => entry.message) })),
      appendMessage: vi.fn((message) => {
        branch.push({ type: "message", message });
        order.push("snapshot");
      }),
    };
    const session = {
      sessionManager,
      messages: [],
      model: { api: "test-api", provider: "test-provider", id: "test-model", contextWindow: 32_000 },
    };
    const upgradeWebSocket = vi.fn((factory) => {
      createHandlers = factory;
      return () => new Response(null);
    });
    const engine = {
      agentName: "Hana",
      abortAllStreaming: vi.fn(async () => {}),
      getSessionByPath: vi.fn(() => session),
      ensureSessionLoaded: vi.fn(async () => session),
      isSessionStreaming: vi.fn(() => true),
      isSessionSwitching: vi.fn(() => false),
      steerSession: vi.fn(() => false),
      interruptSessionForPrompt: vi.fn(async () => {
        order.push("interrupt");
        engine.isSessionStreaming.mockReturnValue(false);
        return true;
      }),
      slashDispatcher: null,
    };
    const hub = {
      subscribe: vi.fn((cb) => {
        subscriber = cb;
      }),
      abort: vi.fn(async () => {
        order.push("abort");
        return true;
      }),
      send: vi.fn(async () => {
        order.push("send");
      }),
    };

    createChatRoute(engine, hub, { upgradeWebSocket });
    const handlers = createHandlers({});
    const ws = {
      readyState: 1,
      send: vi.fn(),
    };

    handlers.onOpen({}, ws);
    subscriber({ type: "session_status", isStreaming: true }, "/tmp/session.jsonl");
    subscriber({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "已显示但未完成" } }, "/tmp/session.jsonl");

    handlers.onMessage({
      data: JSON.stringify({
        type: "abort",
        sessionPath: "/tmp/session.jsonl",
      }),
    }, ws);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(engine.interruptSessionForPrompt).toHaveBeenCalledWith("/tmp/session.jsonl");
    expect(hub.abort).not.toHaveBeenCalled();
    expect(hub.send).not.toHaveBeenCalled();
    expect(sessionManager.appendMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: "assistant",
      content: [{ type: "text", text: "已显示但未完成" }],
      api: "test-api",
      provider: "test-provider",
      model: "test-model",
      usage: expect.objectContaining({
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: expect.objectContaining({ total: 0 }),
      }),
      stopReason: "interrupted",
    }));
    expect(ws.send.mock.calls.map(([raw]) => JSON.parse(raw))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "context_usage",
        sessionPath: "/tmp/session.jsonl",
        contextWindow: 32_000,
        tokens: expect.any(Number),
      }),
    ]));
    expect(order).toEqual(["interrupt", "snapshot"]);
  });
});
