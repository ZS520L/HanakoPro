import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createSessionOps } from "../../core/slash-commands/session-ops.js";

let tmpDir, engine, agents;

function agentDir(id) { return path.join(tmpDir, "agents", id); }
function bridgeDirFor(id) { return path.join(agentDir(id), "bridge"); }
function readIndex(id) {
  const p = path.join(bridgeDirFor(id), "bridge-sessions.json");
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : {};
}
function writeIndex(id, data) {
  const dir = bridgeDirFor(id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "bridge-sessions.json"), JSON.stringify(data, null, 2));
}

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), "hana-sops-" + Date.now() + Math.random().toString(36).slice(2));
  agents = {
    a1: { id: "a1", sessionDir: agentDir("a1") },
    a2: { id: "a2", sessionDir: agentDir("a2") },
  };
  for (const a of Object.values(agents)) {
    fs.mkdirSync(path.join(a.sessionDir, "bridge", "owner"), { recursive: true });
  }
  engine = {
    getAgent: vi.fn((id) => agents[id] || null),
    isBridgeSessionStreaming: vi.fn(() => false),
    abortBridgeSession: vi.fn(async () => true),
    isSessionStreaming: vi.fn(() => false),
    abortSession: vi.fn(async () => false),
    bridgeSessionManager: {
      readIndex: (agent) => {
        const p = path.join(agent.sessionDir, "bridge", "bridge-sessions.json");
        return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : {};
      },
      writeIndex: (idx, agent) => {
        const dir = path.join(agent.sessionDir, "bridge");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "bridge-sessions.json"), JSON.stringify(idx, null, 2));
      },
      injectMessage: vi.fn(() => true),
    },
  };
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SessionOps bridge kind", () => {
  it("isStreaming delegates to engine", () => {
    const ops = createSessionOps({ engine });
    ops.isStreaming({ kind: "bridge", sessionKey: "k", agentId: "a1" });
    expect(engine.isBridgeSessionStreaming).toHaveBeenCalledWith("k");
  });

  it("abort delegates to engine", async () => {
    const ops = createSessionOps({ engine });
    const r = await ops.abort({ kind: "bridge", sessionKey: "k", agentId: "a1" });
    expect(r).toBe(true);
    expect(engine.abortBridgeSession).toHaveBeenCalledWith("k");
  });

  it("rotate renames jsonl, preserves meta, returns {status:'rotated'}", async () => {
    const jsonl = "owner/session-1.jsonl";
    fs.writeFileSync(path.join(bridgeDirFor("a1"), jsonl), '{"role":"user"}\n');
    writeIndex("a1", { "tg_dm_x@a1": { file: jsonl, name: "Alice", userId: "u1" } });

    const ops = createSessionOps({ engine });
    const res = await ops.rotate({ kind: "bridge", sessionKey: "tg_dm_x@a1", agentId: "a1" });

    expect(res).toEqual({ status: "rotated" });
    const idx = readIndex("a1");
    expect(idx["tg_dm_x@a1"].file).toBeUndefined();
    expect(idx["tg_dm_x@a1"].name).toBe("Alice");
    expect(fs.existsSync(path.join(bridgeDirFor("a1"), jsonl))).toBe(false);
    const listing = fs.readdirSync(path.join(bridgeDirFor("a1"), "owner"));
    expect(listing.some(f => /\.archived-\d+-[a-z0-9]+\.jsonl$/.test(f))).toBe(true);
  });

  it("delete removes jsonl and index entry, returns {status:'deleted'}", async () => {
    const jsonl = "owner/session-2.jsonl";
    fs.writeFileSync(path.join(bridgeDirFor("a1"), jsonl), '{"role":"user"}\n');
    writeIndex("a1", { "tg_dm_y@a1": { file: jsonl, name: "Bob" } });

    const ops = createSessionOps({ engine });
    const res = await ops.delete({ kind: "bridge", sessionKey: "tg_dm_y@a1", agentId: "a1" });

    expect(res).toEqual({ status: "deleted" });
    const idx = readIndex("a1");
    expect(idx["tg_dm_y@a1"]).toBeUndefined();
    expect(fs.existsSync(path.join(bridgeDirFor("a1"), jsonl))).toBe(false);
  });

  it("rotate on entry without file field returns {status:'no-history'} and preserves meta", async () => {
    writeIndex("a1", { "tg_dm_z@a1": { name: "NoFile" } });
    const ops = createSessionOps({ engine });
    const res = await ops.rotate({ kind: "bridge", sessionKey: "tg_dm_z@a1", agentId: "a1" });
    expect(res).toEqual({ status: "no-history" });
    expect(readIndex("a1")["tg_dm_z@a1"].name).toBe("NoFile");
  });

  it("rotate returns {status:'not-found'} for unknown sessionKey", async () => {
    const ops = createSessionOps({ engine });
    const res = await ops.rotate({ kind: "bridge", sessionKey: "unknown@a1", agentId: "a1" });
    expect(res).toEqual({ status: "not-found" });
  });

  it("delete returns {status:'not-found'} for unknown sessionKey", async () => {
    const ops = createSessionOps({ engine });
    const res = await ops.delete({ kind: "bridge", sessionKey: "unknown@a1", agentId: "a1" });
    expect(res).toEqual({ status: "not-found" });
  });

  it("rotate throws on non-.jsonl entry.file (C1 data-loss protection)", async () => {
    const bad = "owner/no-ext";
    fs.writeFileSync(path.join(bridgeDirFor("a1"), bad), "{}\n");
    writeIndex("a1", { "k@a1": { file: bad } });
    const ops = createSessionOps({ engine });
    await expect(ops.rotate({ kind: "bridge", sessionKey: "k@a1", agentId: "a1" })).rejects.toThrow(/\.jsonl/);
  });

  it("rotate handles legacy string entry format", async () => {
    const jsonl = "owner/legacy.jsonl";
    fs.writeFileSync(path.join(bridgeDirFor("a1"), jsonl), "{}\n");
    writeIndex("a1", { "k@a1": jsonl });
    const ops = createSessionOps({ engine });
    const res = await ops.rotate({ kind: "bridge", sessionKey: "k@a1", agentId: "a1" });
    expect(res.status).toBe("rotated");
  });

  it("delete handles legacy string entry format", async () => {
    const jsonl = "owner/legacy-del.jsonl";
    fs.writeFileSync(path.join(bridgeDirFor("a1"), jsonl), "{}\n");
    writeIndex("a1", { "k@a1": jsonl });
    const ops = createSessionOps({ engine });
    const res = await ops.delete({ kind: "bridge", sessionKey: "k@a1", agentId: "a1" });
    expect(res.status).toBe("deleted");
    expect(fs.existsSync(path.join(bridgeDirFor("a1"), jsonl))).toBe(false);
  });

  it("rotate routes per-agent sessionDir (multi-agent, I2 fix)", async () => {
    const jsonl = "owner/a2.jsonl";
    fs.writeFileSync(path.join(bridgeDirFor("a2"), jsonl), "{}\n");
    writeIndex("a2", { "k@a2": { file: jsonl } });
    const ops = createSessionOps({ engine });
    await ops.rotate({ kind: "bridge", sessionKey: "k@a2", agentId: "a2" });
    expect(fs.existsSync(path.join(bridgeDirFor("a2"), jsonl))).toBe(false);
    expect(fs.existsSync(path.join(bridgeDirFor("a1"), "bridge-sessions.json"))).toBe(false);
  });

  it("injectAssistantMessage delegates to bridgeSessionManager.injectMessage", () => {
    const ops = createSessionOps({ engine });
    ops.injectAssistantMessage({ kind: "bridge", sessionKey: "k", agentId: "a1" }, "hi");
    expect(engine.bridgeSessionManager.injectMessage).toHaveBeenCalledWith("k", "hi", { agentId: "a1" });
  });

  it("compact delegates to engine.compactBridgeSession and returns usage", async () => {
    // Phase 7：不再注入 [上下文已压缩] 占位，走真正的 SDK compact 路径
    engine.compactBridgeSession = vi.fn(async () => ({
      tokensBefore: 9000, tokensAfter: 3200, contextWindow: 128000,
    }));
    const ops = createSessionOps({ engine });
    const r = await ops.compact({ kind: "bridge", sessionKey: "tg_dm_w@a1", agentId: "a1" });
    expect(engine.compactBridgeSession).toHaveBeenCalledWith("tg_dm_w@a1", { agentId: "a1" });
    expect(r).toEqual({ tokensBefore: 9000, tokensAfter: 3200, contextWindow: 128000 });
    // 不再调 injectMessage
    expect(engine.bridgeSessionManager.injectMessage).not.toHaveBeenCalled();
  });

  it("compact throws when engine.compactBridgeSession is missing", async () => {
    // 保守防御：engine 版本不匹配时显式报错而非静默失败
    delete engine.compactBridgeSession;
    const ops = createSessionOps({ engine });
    await expect(ops.compact({ kind: "bridge", sessionKey: "tg_dm_x@a1", agentId: "a1" }))
      .rejects.toThrow(/compactBridgeSession not available/);
  });

  it("compact propagates errors from engine.compactBridgeSession", async () => {
    engine.compactBridgeSession = vi.fn(async () => { throw new Error("streaming"); });
    const ops = createSessionOps({ engine });
    await expect(ops.compact({ kind: "bridge", sessionKey: "k@a1", agentId: "a1" }))
      .rejects.toThrow(/streaming/);
  });

  it("freshCompact delegates to engine.freshCompactBridgeSession and returns usage", async () => {
    engine.freshCompactBridgeSession = vi.fn(async () => ({
      tokensBefore: 11000,
      tokensAfter: 5000,
      contextWindow: 128000,
      fresh: true,
      reason: "manual",
    }));
    const ops = createSessionOps({ engine });

    const r = await ops.freshCompact({ kind: "bridge", sessionKey: "tg_dm_w@a1", agentId: "a1" });

    expect(engine.freshCompactBridgeSession).toHaveBeenCalledWith("tg_dm_w@a1", { agentId: "a1", reason: "manual" });
    expect(r).toMatchObject({ tokensBefore: 11000, tokensAfter: 5000, fresh: true });
  });

  it("freshCompact rejects desktop refs until desktop freshness is explicitly implemented", async () => {
    const ops = createSessionOps({ engine });
    await expect(ops.freshCompact({ kind: "desktop", agentId: "a1", sessionPath: "/x" }))
      .rejects.toThrow(/desktop.*not supported/);
  });
});

describe("SessionOps desktop kind", () => {
  it("rotate throws 'not supported'", async () => {
    const ops = createSessionOps({ engine });
    await expect(ops.rotate({ kind: "desktop", agentId: "a1", sessionPath: "/x" }))
      .rejects.toThrow(/desktop.*not supported/);
  });

  it("delete throws 'not supported'", async () => {
    const ops = createSessionOps({ engine });
    await expect(ops.delete({ kind: "desktop", agentId: "a1", sessionPath: "/x" }))
      .rejects.toThrow(/desktop.*not supported/);
  });

  it("injectAssistantMessage throws (C2 fix: no silent no-op)", () => {
    const ops = createSessionOps({ engine });
    expect(() => ops.injectAssistantMessage(
      { kind: "desktop", agentId: "a1", sessionPath: "/x" }, "hi"
    )).toThrow(/desktop.*not supported/);
  });
});
