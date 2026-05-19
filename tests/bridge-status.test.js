import { describe, expect, it, vi } from "vitest";
import os from "os";

const createTelegramAdapter = vi.fn();
const createFeishuAdapter = vi.fn();
const createQQAdapter = vi.fn();
const createWechatAdapter = vi.fn();

vi.mock("../lib/bridge/telegram-adapter.js", () => ({
  createTelegramAdapter: (...args) => createTelegramAdapter(...args),
}));
vi.mock("../lib/bridge/feishu-adapter.js", () => ({
  createFeishuAdapter: (...args) => createFeishuAdapter(...args),
}));
vi.mock("../lib/bridge/qq-adapter.js", () => ({
  createQQAdapter: (...args) => createQQAdapter(...args),
}));
vi.mock("../lib/bridge/wechat-adapter.js", () => ({
  createWechatAdapter: (...args) => createWechatAdapter(...args),
}));
vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => null,
}));

import { BridgeManager } from "../lib/bridge/bridge-manager.js";

describe("BridgeManager platform status", () => {
  it("starts wechat in connecting state until the adapter reports readiness", () => {
    createTelegramAdapter.mockReset();
    createFeishuAdapter.mockReset();
    createQQAdapter.mockReset();
    createWechatAdapter.mockReset();
    createWechatAdapter.mockReturnValue({ stop: vi.fn() });

    const engine = {
      hanakoHome: os.tmpdir(),
      agent: null,
      getAgent: vi.fn(() => null),
    };
    const hub = { eventBus: { emit: vi.fn() } };
    const bm = new BridgeManager({ engine, hub });

    bm.startPlatform("wechat", { botToken: "wx-token", hanaHome: os.tmpdir() }, "hana");

    expect(bm.getStatus("hana").wechat).toMatchObject({ status: "connecting", error: null });
  });
});
