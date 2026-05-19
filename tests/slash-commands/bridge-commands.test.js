import { describe, it, expect, vi } from "vitest";
import { bridgeCommands } from "../../core/slash-commands/bridge-commands.js";
import { SlashCommandRegistry } from "../../core/slash-command-registry.js";
import { SlashCommandDispatcher } from "../../core/slash-command-dispatcher.js";

function makeCtx(overrides = {}) {
  return {
    sessionRef: { kind: "bridge", agentId: "a1", sessionKey: "tg_dm_x@a1" },
    sessionOps: {
      isStreaming: vi.fn(() => true),
      abort: vi.fn(async () => true),
      rotate: vi.fn(async () => ({ status: "rotated" })),
      delete: vi.fn(async () => ({ status: "deleted" })),
      compact: vi.fn(async () => {}),
      freshCompact: vi.fn(async () => {}),
    },
    reply: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("/stop", () => {
  const stop = bridgeCommands.find(c => c.name === "stop");
  it("declares owner permission and abort alias", () => {
    expect(stop.permission).toBe("owner");
    expect(stop.aliases).toContain("abort");
  });
  it("calls sessionOps.abort and returns silent when streaming", async () => {
    const ctx = makeCtx();
    const r = await stop.handler(ctx);
    expect(ctx.sessionOps.abort).toHaveBeenCalledWith(ctx.sessionRef);
    expect(r?.silent).toBe(true);
  });
  it("returns reply when nothing to abort", async () => {
    const ctx = makeCtx({ sessionOps: { isStreaming: () => false, abort: vi.fn(async () => false) } });
    const r = await stop.handler(ctx);
    expect(r.reply).toMatch(/当前无活动/);
  });
  it("returns reply when abort reports failure even while streaming was observed", async () => {
    // 防 regression：TOCTOU 假阳性时 abort=false 仍须走 fallback reply
    const ctx = makeCtx({ sessionOps: { isStreaming: () => true, abort: vi.fn(async () => false) } });
    const r = await stop.handler(ctx);
    expect(r.reply).toMatch(/当前无活动/);
  });
});

describe("/new", () => {
  const cmd = bridgeCommands.find(c => c.name === "new");
  it("calls rotate and reports rotated status", async () => {
    const ctx = makeCtx();
    const r = await cmd.handler(ctx);
    expect(ctx.sessionOps.rotate).toHaveBeenCalledWith(ctx.sessionRef);
    expect(r.reply).toMatch(/已开启新会话.*归档/);
  });
  it("reports no-history status distinctly", async () => {
    const ctx = makeCtx({ sessionOps: { rotate: vi.fn(async () => ({ status: "no-history" })) } });
    const r = await cmd.handler(ctx);
    expect(r.reply).toMatch(/无历史/);
  });
  it("reports not-found status distinctly", async () => {
    const ctx = makeCtx({ sessionOps: { rotate: vi.fn(async () => ({ status: "not-found" })) } });
    const r = await cmd.handler(ctx);
    expect(r.reply).toMatch(/未找到/);
  });
});

describe("/reset", () => {
  const cmd = bridgeCommands.find(c => c.name === "reset");
  it("calls delete and reports deleted status", async () => {
    const ctx = makeCtx();
    const r = await cmd.handler(ctx);
    expect(ctx.sessionOps.delete).toHaveBeenCalledWith(ctx.sessionRef);
    expect(r.reply).toMatch(/已重置/);
  });
  it("reports not-found status distinctly", async () => {
    const ctx = makeCtx({ sessionOps: { delete: vi.fn(async () => ({ status: "not-found" })) } });
    const r = await cmd.handler(ctx);
    expect(r.reply).toMatch(/未找到/);
  });

  it("/clear dispatches to the same reset handler and deletes the current session", async () => {
    const registry = new SlashCommandRegistry();
    for (const def of bridgeCommands) registry.registerCommand(def);
    const sessionOps = makeCtx().sessionOps;
    const reply = vi.fn(async () => {});
    const dispatcher = new SlashCommandDispatcher({
      registry,
      hub: {},
      engine: {},
      sessionOps,
    });

    const res = await dispatcher.tryDispatch("/clear", {
      sessionRef: { kind: "bridge", agentId: "a1", sessionKey: "tg_dm_x@a1" },
      source: "telegram",
      isOwner: true,
      reply,
    });

    expect(res.handled).toBe(true);
    expect(sessionOps.delete).toHaveBeenCalledWith({
      kind: "bridge",
      agentId: "a1",
      sessionKey: "tg_dm_x@a1",
    });
    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/已重置/));
  });
});

describe("/compact", () => {
  const cmd = bridgeCommands.find(c => c.name === "compact");

  it("sends progress reply, calls sessionOps.compact, then sends completion with tokens delta", async () => {
    // Phase 7：真压缩要给用户发"正在压缩…"和"已压缩：N→M tokens"两条反馈
    const ctx = makeCtx({
      sessionOps: {
        compact: vi.fn(async () => ({ tokensBefore: 9000, tokensAfter: 3200, contextWindow: 128000 })),
      },
    });
    const r = await cmd.handler(ctx);

    expect(ctx.sessionOps.compact).toHaveBeenCalledWith(ctx.sessionRef);
    expect(ctx.reply).toHaveBeenCalledTimes(2);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/正在压缩/);
    expect(ctx.reply.mock.calls[1][0]).toMatch(/9000.*3200.*tokens/);
    // handler 自己调了 reply，走 silent 避免 dispatcher 再回一遍
    expect(r?.silent).toBe(true);
  });

  it("falls back to generic '已压缩' message when usage unavailable", async () => {
    const ctx = makeCtx({
      sessionOps: { compact: vi.fn(async () => null) },
    });
    await cmd.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(2);
    expect(ctx.reply.mock.calls[1][0]).toBe("（上下文已压缩）");
  });

  it("reports failure via reply (no throw) when compact rejects", async () => {
    // 失败路径不 throw，走 reply → 用户在社交平台能看到"压缩失败：xxx"
    const ctx = makeCtx({
      sessionOps: { compact: vi.fn(async () => { throw new Error("inject failed"); }) },
    });
    const r = await cmd.handler(ctx);
    expect(ctx.reply).toHaveBeenCalledTimes(2);
    expect(ctx.reply.mock.calls[1][0]).toMatch(/压缩失败.*inject failed/);
    expect(r?.silent).toBe(true);
  });
});

describe("/fresh-compact", () => {
  const cmd = bridgeCommands.find(c => c.name === "fresh-compact");

  it("declares owner permission and calls sessionOps.freshCompact", async () => {
    expect(cmd.permission).toBe("owner");
    const ctx = makeCtx({
      sessionOps: {
        freshCompact: vi.fn(async () => ({
          tokensBefore: 10000,
          tokensAfter: 4200,
          contextWindow: 128000,
          fresh: true,
          reason: "manual",
        })),
      },
    });

    const r = await cmd.handler(ctx);

    expect(ctx.sessionOps.freshCompact).toHaveBeenCalledWith(ctx.sessionRef);
    expect(ctx.reply).toHaveBeenCalledTimes(2);
    expect(ctx.reply.mock.calls[0][0]).toMatch(/fresh-compact/);
    expect(ctx.reply.mock.calls[1][0]).toMatch(/10000.*4200.*tokens/);
    expect(r?.silent).toBe(true);
  });

  it("rejects fresh-compact while bridge is attached to a desktop session", async () => {
    const rcState = {
      getAttachment: vi.fn(() => ({ desktopSessionPath: "/desktop/session.jsonl" })),
      isAttached: vi.fn(() => true),
    };
    const ctx = makeCtx({ engine: { rcState } });

    const r = await cmd.handler(ctx);

    expect(r.reply).toMatch(/接管桌面会话期间/);
    expect(ctx.sessionOps.freshCompact).not.toHaveBeenCalled();
  });
});
