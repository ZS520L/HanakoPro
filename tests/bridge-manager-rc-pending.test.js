/**
 * BridgeManager RC pending-selection 拦截集成测试
 *
 * 场景：sessionKey 处于 rc-select pending 态时，
 * 非斜杠消息应被 handleRcPendingInput 吃掉，不落到 hub.send（不喂 LLM）。
 * 斜杠命令应始终优先，即使有 pending 也走 slashDispatcher。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/bridge/telegram-adapter.js", () => ({ createTelegramAdapter: vi.fn() }));
vi.mock("../lib/bridge/feishu-adapter.js", () => ({ createFeishuAdapter: vi.fn() }));
vi.mock("../lib/debug-log.js", () => ({ debugLog: () => null }));
vi.mock("../core/slash-commands/rc-summary.js", () => ({
  summarizeSessionForRc: vi.fn(async () => "fake summary"),
}));

import os from "os";
import { BridgeManager } from "../lib/bridge/bridge-manager.js";
import { createSlashSystem } from "../core/slash-commands/index.js";

function createMocks() {
  const adapter = {
    sendReply: vi.fn().mockResolvedValue(),
    stop: vi.fn(),
  };
  const engine = {
    getAgent: vi.fn((id) => id === "hana"
      ? { id: "hana", agentName: "T", config: { bridge: { telegram: { owner: "owner123" } }, models: { chat: { id: "gpt-5", provider: "openai" } } }, sessionDir: os.tmpdir() }
      : null),
    isBridgeSessionStreaming: vi.fn(() => false),
    isSessionStreaming: vi.fn(() => false),
    abortBridgeSession: vi.fn(async () => false),
    steerBridgeSession: vi.fn(() => false),
    bridgeSessionManager: { injectMessage: vi.fn(() => true), readIndex: () => ({}), writeIndex: () => {} },
    agentName: "T",
    hanakoHome: os.tmpdir(),
    currentAgentId: "hana",
    listSessions: vi.fn(async () => []),
  };
  const hub = {
    send: vi.fn().mockResolvedValue("AI response"),
    eventBus: { emit: vi.fn() },
  };
  const slashSystem = createSlashSystem({ engine, hub });
  engine.slashDispatcher = slashSystem.dispatcher;
  engine.slashRegistry = slashSystem.registry;
  engine.rcState = slashSystem.rcState;

  const bm = new BridgeManager({ engine, hub });
  bm._platforms.set("telegram:hana", { adapter, status: "connected", agentId: "hana", platform: "telegram" });
  bm.blockStreaming = false;

  return { bm, adapter, engine, hub, rcState: slashSystem.rcState };
}

function primeRcPending({ rcState, engine, sessionKey, options }) {
  rcState.setPending(sessionKey, {
    type: "rc-select",
    promptText: "menu",
    options,
  });
  engine.listSessions.mockResolvedValue(options.map(option => ({ path: option.path, agentId: "hana" })));
}

describe("BridgeManager RC pending-selection interception", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("numeric input when pending-selection active → handled by rc handler, NOT sent to hub", async () => {
    const { bm, hub, adapter, engine, rcState } = createMocks();
    primeRcPending({
      rcState,
      engine,
      sessionKey: "tg_dm_owner123@hana",
      options: [{ path: "/fake/s.jsonl", title: "架构" }],
    });

    await bm._handleMessage("telegram", {
      sessionKey: "tg_dm_owner123@hana",
      text: "1",
      userId: "owner123",
      chatId: "owner123",
      agentId: "hana",
    });

    // hub.send 不应被调用（消息被 rc 拦截）
    await vi.advanceTimersByTimeAsync(3000);
    expect(hub.send).not.toHaveBeenCalled();
    expect(adapter.sendReply).not.toHaveBeenCalledWith("owner123", "（T正在输入...）");
    const replies = adapter.sendReply.mock.calls.map(c => c[1]);
    expect(replies.some(r => /正在接管/.test(r))).toBe(true);
    expect(replies.some(r => /已接管/.test(r))).toBe(true);
    // 接管态已建立
    expect(rcState.isAttached("tg_dm_owner123@hana")).toBe(true);
  });

  it("non-numeric input when pending active → replies '请输入数字', does NOT send to hub", async () => {
    const { bm, hub, adapter, engine, rcState } = createMocks();
    primeRcPending({
      rcState,
      engine,
      sessionKey: "tg_dm_owner123@hana",
      options: [{ path: "/a.jsonl", title: "A" }, { path: "/b.jsonl", title: "B" }],
    });

    await bm._handleMessage("telegram", {
      sessionKey: "tg_dm_owner123@hana",
      text: "昨天那个",
      userId: "owner123",
      chatId: "owner123",
      agentId: "hana",
    });

    await vi.advanceTimersByTimeAsync(3000);
    expect(hub.send).not.toHaveBeenCalled();
    expect(adapter.sendReply).not.toHaveBeenCalledWith("owner123", "（T正在输入...）");
    const replies = adapter.sendReply.mock.calls.map(c => c[1]);
    expect(replies.some(r => /请输入数字编号.*1-2/.test(r))).toBe(true);
    // pending 保留
    expect(rcState.isPending("tg_dm_owner123@hana")).toBe(true);
  });

  it("slash command ALWAYS wins over pending-selection (priority rule)", async () => {
    // 纪律：/exitrc 等斜杠命令必须被 dispatcher 接住，即使 pending 在
    const { bm, hub, adapter, engine, rcState } = createMocks();
    primeRcPending({
      rcState,
      engine,
      sessionKey: "tg_dm_owner123@hana",
      options: [{ path: "/a.jsonl", title: "A" }],
    });

    await bm._handleMessage("telegram", {
      sessionKey: "tg_dm_owner123@hana",
      text: "/exitrc",
      userId: "owner123",
      chatId: "owner123",
      agentId: "hana",
    });

    await vi.advanceTimersByTimeAsync(3000);
    expect(hub.send).not.toHaveBeenCalled();
    const replies = adapter.sendReply.mock.calls.map(c => c[1]);
    expect(replies.some(r => /已退出接管/.test(r))).toBe(true);
    // pending 和 attachment 都被 /exitrc 清掉
    expect(rcState.isPending("tg_dm_owner123@hana")).toBe(false);
    expect(rcState.isAttached("tg_dm_owner123@hana")).toBe(false);
  });

  it("non-owner numeric input when pending active → NOT intercepted (pending is owner-only)", async () => {
    // pending 按 sessionKey 隔离，但非 owner 在同一 sessionKey 打数字时不应触发
    // （guest 模式 sessionKey 不同，owner 模式 sessionKey 一致但 isOwner=false 不应被当作选择）
    // 此测试用"DM from 非 owner userId" 模拟——实际这种 key 不会出现，但防御性确认逻辑
    const { bm, hub, adapter, engine, rcState } = createMocks();
    primeRcPending({
      rcState,
      engine,
      sessionKey: "tg_dm_owner123@hana",
      options: [{ path: "/a.jsonl", title: "A" }],
    });

    await bm._handleMessage("telegram", {
      sessionKey: "tg_dm_owner123@hana",
      text: "1",
      userId: "random-guest",      // 非 owner
      chatId: "owner123",
      agentId: "hana",
    });

    await vi.advanceTimersByTimeAsync(3000);
    // pending 仍保留（未被 guest 选中）
    expect(rcState.isPending("tg_dm_owner123@hana")).toBe(true);
    expect(rcState.isAttached("tg_dm_owner123@hana")).toBe(false);
  });

  it("group messages do not consume rc pending-selection state", async () => {
    const { bm, hub, engine, rcState } = createMocks();
    primeRcPending({
      rcState,
      engine,
      sessionKey: "tg_group_42@hana",
      options: [{ path: "/a.jsonl", title: "A" }],
    });

    await bm._handleMessage("telegram", {
      sessionKey: "tg_group_42@hana",
      text: "1",
      userId: "owner123",
      chatId: "42",
      isGroup: true,
      agentId: "hana",
      senderName: "Owner",
    });

    await vi.advanceTimersByTimeAsync(3000);
    expect(rcState.isPending("tg_group_42@hana")).toBe(true);
    expect(rcState.isAttached("tg_group_42@hana")).toBe(false);
    expect(hub.send).toHaveBeenCalledOnce();
  });

  it("no pending state → numeric input goes through normal debounce path", async () => {
    const { bm, hub } = createMocks();

    bm._handleMessage("telegram", {
      sessionKey: "tg_dm_owner123@hana",
      text: "2",
      userId: "owner123",
      chatId: "owner123",
      agentId: "hana",
    });

    await vi.advanceTimersByTimeAsync(2500);
    // 没 pending → "2" 被正常 debounce + 送给 hub.send
    expect(hub.send).toHaveBeenCalledOnce();
    expect(hub.send.mock.calls[0][0]).toMatch(/2/);
  });
});
