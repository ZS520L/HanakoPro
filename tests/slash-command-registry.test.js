import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandRegistry } from "../core/slash-command-registry.js";

describe("SlashCommandRegistry", () => {
  let r;
  beforeEach(() => { r = new SlashCommandRegistry(); });

  it("registers and looks up a command by normalized name", () => {
    r.registerCommand({ name: "Stop", permission: "owner", handler: async () => {} });
    expect(r.lookup("stop")?.name).toBe("stop");
    expect(r.lookup("STOP")?.name).toBe("stop");
    expect(r.lookup("stop ")?.name).toBe("stop");
  });

  it("normalizes hyphen to underscore on register and lookup", () => {
    r.registerCommand({ name: "bot-ping", permission: "anyone", handler: async () => {} });
    expect(r.lookup("bot-ping")?.name).toBe("bot_ping");
    expect(r.lookup("bot_ping")?.name).toBe("bot_ping");
  });

  it("adds numeric suffix on name conflict", () => {
    r.registerCommand({ name: "ping", permission: "anyone", handler: async () => {}, source: "core" });
    const h = r.registerCommand({ name: "ping", permission: "anyone", handler: async () => {}, source: "plugin", sourceId: "p" });
    expect(h.name).toBe("ping_2");
    expect(r.lookup("ping_2")?.source).toBe("plugin");
  });

  it("supports aliases pointing to same def", () => {
    r.registerCommand({ name: "stop", aliases: ["abort", "halt"], permission: "owner", handler: async () => {} });
    expect(r.lookup("abort")?.name).toBe("stop");
    expect(r.lookup("halt")?.name).toBe("stop");
  });

  it("unregisterBySource clears all commands from that source", () => {
    r.registerCommand({ name: "a", permission: "anyone", handler: async () => {}, source: "plugin", sourceId: "p1" });
    r.registerCommand({ name: "b", permission: "anyone", handler: async () => {}, source: "plugin", sourceId: "p1" });
    r.registerCommand({ name: "c", permission: "anyone", handler: async () => {}, source: "core" });
    const n = r.unregisterBySource("plugin", "p1");
    expect(n).toBe(2);
    expect(r.lookup("a")).toBeNull();
    expect(r.lookup("c")?.name).toBe("c");
  });

  it("list returns unique defs (alias dedup)", () => {
    r.registerCommand({ name: "stop", aliases: ["abort"], permission: "owner", handler: async () => {} });
    expect(r.list()).toHaveLength(1);
  });

  it("rejects plugin/skill attempts to register core-reserved names", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = r.registerCommand(
      { name: "stop", permission: "anyone", handler: async () => {} },
      { source: "plugin", sourceId: "evil" }
    );
    expect(h).toBeNull();
    expect(r.lookup("stop")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("core-reserved"));
    warn.mockRestore();
  });

  it("allows core source to register reserved names", () => {
    const h = r.registerCommand(
      { name: "stop", permission: "owner", handler: async () => {} },
      { source: "core" }
    );
    expect(h?.name).toBe("stop");
  });

  it("discipline #3 blocks reserved name even under suffix (stop_2 also not registered)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.registerCommand(
      { name: "stop", permission: "anyone", handler: async () => {} },
      { source: "plugin", sourceId: "evil" }
    );
    expect(r.lookup("stop")).toBeNull();
    expect(r.lookup("stop_2")).toBeNull();
    warn.mockRestore();
  });

  it("warns when alias collides with existing command name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    r.registerCommand({ name: "abort", permission: "owner", handler: async () => {} });
    r.registerCommand({ name: "stop", aliases: ["abort"], permission: "owner", handler: async () => {} });
    expect(r.lookup("abort")?.name).toBe("abort");
    expect(r.lookup("stop")?.name).toBe("stop");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("alias"));
    warn.mockRestore();
  });

  it("def.source cannot bypass discipline #3 gate", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const h = r.registerCommand(
      { name: "stop", permission: "anyone", handler: async () => {}, source: "core" },
      { source: "plugin", sourceId: "evil" }
    );
    expect(h).toBeNull();
    expect(r.lookup("stop")).toBeNull();
    warn.mockRestore();
  });

  it("aliases also respect discipline #3: plugin cannot smuggle reserved name via aliases", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // primary name 不碰保留字，但 aliases 含 'stop'——尝试绕闸门
    const h = r.registerCommand(
      { name: "totallyfine", aliases: ["stop", "halt"], permission: "anyone", handler: async () => {} },
      { source: "plugin", sourceId: "sneaky" }
    );
    // primary name 注册成功
    expect(h?.name).toBe("totallyfine");
    // reserved alias 'stop' 被拒，lookup 拿不到 totallyfine
    expect(r.lookup("stop")).toBeNull();
    // 非 reserved alias 'halt' 仍能注册并指向同一 def
    expect(r.lookup("halt")?.name).toBe("totallyfine");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("core-reserved"));
    warn.mockRestore();
  });
});
