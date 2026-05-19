import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RcStateStore } from "../../core/slash-commands/rc-state.js";

describe("RcStateStore pending-selection", () => {
  let store;
  beforeEach(() => {
    vi.useFakeTimers();
    store = new RcStateStore({ ttlMs: 5_000 });
  });
  afterEach(() => vi.useRealTimers());

  it("stores and retrieves pending spec", () => {
    store.setPending("tg_dm_x@a1", {
      type: "rc-select",
      promptText: "请选择",
      options: [{ path: "/p/1.jsonl", title: "T" }],
    });
    const p = store.getPending("tg_dm_x@a1");
    expect(p.type).toBe("rc-select");
    expect(p.promptText).toBe("请选择");
    expect(p.options[0].path).toBe("/p/1.jsonl");
    expect(typeof p.expiresAt).toBe("number");
  });

  it("isPending true after set, false after clear", () => {
    store.setPending("k", { type: "rc-select", promptText: "x", options: [] });
    expect(store.isPending("k")).toBe(true);
    store.clearPending("k");
    expect(store.isPending("k")).toBe(false);
  });

  it("expires exactly at ttl boundary (lazy expiration on read)", () => {
    store.setPending("k", { type: "rc-select", promptText: "x", options: [] });
    vi.advanceTimersByTime(4_999);
    expect(store.isPending("k")).toBe(true);
    vi.advanceTimersByTime(1);
    // 边界之后立刻不可用
    expect(store.isPending("k")).toBe(false);
    expect(store.getPending("k")).toBeNull();
  });

  it("getPending on expired entry purges it (lazy GC)", () => {
    store.setPending("k", { type: "rc-select", promptText: "x", options: [] });
    vi.advanceTimersByTime(6_000);
    // 第一次访问清掉
    expect(store.getPending("k")).toBeNull();
    // 再访问也还是 null（已从 Map 删除）
    expect(store.getPending("k")).toBeNull();
  });

  it("returns null for unknown key", () => {
    expect(store.getPending("nope")).toBeNull();
    expect(store.isPending("nope")).toBe(false);
  });

  it("different sessionKeys are isolated", () => {
    store.setPending("k1", { type: "rc-select", promptText: "p1", options: [{ path: "a" }] });
    store.setPending("k2", { type: "rc-select", promptText: "p2", options: [{ path: "b" }] });
    expect(store.getPending("k1").options[0].path).toBe("a");
    expect(store.getPending("k2").options[0].path).toBe("b");
    store.clearPending("k1");
    expect(store.isPending("k1")).toBe(false);
    expect(store.isPending("k2")).toBe(true);
  });

  it("setPending overwrites prior for same sessionKey", () => {
    store.setPending("k", { type: "rc-select", promptText: "v1", options: [] });
    store.setPending("k", { type: "rc-select", promptText: "v2", options: [] });
    expect(store.getPending("k").promptText).toBe("v2");
  });
});

describe("RcStateStore attachment", () => {
  let store;
  beforeEach(() => { store = new RcStateStore(); });

  it("attach + getAttachment round-trip", () => {
    store.attach("k", "/path/to/session.jsonl");
    const att = store.getAttachment("k");
    expect(att.desktopSessionPath).toBe("/path/to/session.jsonl");
    expect(typeof att.attachedAt).toBe("number");
  });

  it("isAttached reflects state", () => {
    expect(store.isAttached("k")).toBe(false);
    store.attach("k", "/p");
    expect(store.isAttached("k")).toBe(true);
    store.detach("k");
    expect(store.isAttached("k")).toBe(false);
  });

  it("reset clears both pending and attachment", () => {
    store.setPending("k", { type: "rc-select", promptText: "p", options: [] });
    store.attach("k", "/p");
    store.reset("k");
    expect(store.isPending("k")).toBe(false);
    expect(store.isAttached("k")).toBe(false);
  });

  it("listAttachments enumerates current state", () => {
    store.attach("k1", "/p1");
    store.attach("k2", "/p2");
    const list = store.listAttachments();
    expect(list).toHaveLength(2);
    const paths = list.map(e => e.desktopSessionPath).sort();
    expect(paths).toEqual(["/p1", "/p2"]);
    const keys = list.map(e => e.sessionKey).sort();
    expect(keys).toEqual(["k1", "k2"]);
  });

  it("attach overwrites prior attachment for same sessionKey", () => {
    store.attach("k", "/p1");
    store.attach("k", "/p2");
    expect(store.getAttachment("k").desktopSessionPath).toBe("/p2");
  });

  it("rejects attaching the same desktop session from another bridge session", () => {
    store.attach("k1", "/shared.jsonl");
    expect(() => store.attach("k2", "/shared.jsonl")).toThrow(/另一个 bridge 会话接管/);
    expect(store.getAttachment("k1")?.desktopSessionPath).toBe("/shared.jsonl");
    expect(store.getAttachment("k2")).toBeNull();
  });

  it("invalidateDesktopSession clears both attachment and pending that reference the target", () => {
    store.attach("k1", "/shared.jsonl");
    store.setPending("k2", {
      type: "rc-select",
      promptText: "menu",
      options: [{ path: "/shared.jsonl", title: "Shared" }],
    });
    store.setPending("k3", {
      type: "rc-select",
      promptText: "menu",
      options: [{ path: "/other.jsonl", title: "Other" }],
    });

    const invalidated = store.invalidateDesktopSession("/shared.jsonl");

    expect(invalidated.detachedAttachments).toEqual([
      expect.objectContaining({
        sessionKey: "k1",
        desktopSessionPath: "/shared.jsonl",
      }),
    ]);
    expect(invalidated.clearedPendingSessionKeys).toEqual(["k2"]);
    expect(store.isAttached("k1")).toBe(false);
    expect(store.isPending("k2")).toBe(false);
    expect(store.isPending("k3")).toBe(true);
  });

  it("detach on unknown key is no-op (no throw)", () => {
    expect(() => store.detach("nope")).not.toThrow();
  });
});
