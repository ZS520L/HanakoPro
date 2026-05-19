import { describe, it, expect } from "vitest";
import { listRecentAgentSessions } from "../../core/slash-commands/list-agent-sessions.js";

function makeSession({ path, agentId, modified, title = null, messageCount = 0 }) {
  return { path, agentId, modified, title, messageCount };
}

describe("listRecentAgentSessions", () => {
  it("filters to the given agentId", async () => {
    const engine = {
      listSessions: async () => [
        makeSession({ path: "/a/1.jsonl", agentId: "a1", modified: 3 }),
        makeSession({ path: "/b/1.jsonl", agentId: "a2", modified: 2 }),
        makeSession({ path: "/a/2.jsonl", agentId: "a1", modified: 1 }),
      ],
    };
    const r = await listRecentAgentSessions(engine, "a1");
    expect(r.map(s => s.path)).toEqual(["/a/1.jsonl", "/a/2.jsonl"]);
    expect(r.map(s => s.index)).toEqual([1, 2]);
  });

  it("caps at default limit (10)", async () => {
    const sessions = Array.from({ length: 15 }, (_, i) =>
      makeSession({ path: `/p/${i}.jsonl`, agentId: "a1", modified: 15 - i }));
    const engine = { listSessions: async () => sessions };
    const r = await listRecentAgentSessions(engine, "a1");
    expect(r).toHaveLength(10);
    expect(r[0].index).toBe(1);
    expect(r[9].index).toBe(10);
  });

  it("respects custom limit", async () => {
    const sessions = Array.from({ length: 5 }, (_, i) =>
      makeSession({ path: `/p/${i}.jsonl`, agentId: "a1", modified: 5 - i }));
    const engine = { listSessions: async () => sessions };
    const r = await listRecentAgentSessions(engine, "a1", { limit: 3 });
    expect(r).toHaveLength(3);
  });

  it("excludes paths via excludePaths", async () => {
    const engine = {
      listSessions: async () => [
        makeSession({ path: "/keep.jsonl", agentId: "a1", modified: 2 }),
        makeSession({ path: "/skip.jsonl", agentId: "a1", modified: 1 }),
      ],
    };
    const r = await listRecentAgentSessions(engine, "a1", { excludePaths: ["/skip.jsonl"] });
    expect(r.map(s => s.path)).toEqual(["/keep.jsonl"]);
  });

  it("excludes /.ephemeral/ paths defensively", async () => {
    const engine = {
      listSessions: async () => [
        makeSession({ path: "/normal.jsonl", agentId: "a1", modified: 2 }),
        makeSession({ path: "/agents/x/.ephemeral/x.jsonl", agentId: "a1", modified: 1 }),
      ],
    };
    const r = await listRecentAgentSessions(engine, "a1");
    expect(r.map(s => s.path)).toEqual(["/normal.jsonl"]);
  });

  it("also excludes Windows-style .ephemeral paths", async () => {
    const engine = {
      listSessions: async () => [
        makeSession({ path: "C:\\Users\\foo\\sessions\\keep.jsonl", agentId: "a1", modified: 2 }),
        makeSession({ path: "C:\\Users\\foo\\.ephemeral\\temp.jsonl", agentId: "a1", modified: 1 }),
      ],
    };
    const r = await listRecentAgentSessions(engine, "a1");
    expect(r.map(s => s.path)).toEqual(["C:\\Users\\foo\\sessions\\keep.jsonl"]);
  });

  it("preserves title (null passthrough)", async () => {
    const engine = {
      listSessions: async () => [
        makeSession({ path: "/p.jsonl", agentId: "a1", modified: 1, title: "一次测试" }),
        makeSession({ path: "/q.jsonl", agentId: "a1", modified: 0, title: null }),
      ],
    };
    const r = await listRecentAgentSessions(engine, "a1");
    expect(r[0].title).toBe("一次测试");
    expect(r[1].title).toBeNull();
  });

  it("includes messageCount (defaults to 0 when missing)", async () => {
    const engine = {
      listSessions: async () => [
        makeSession({ path: "/a.jsonl", agentId: "a1", modified: 1, messageCount: 17 }),
        { path: "/b.jsonl", agentId: "a1", modified: 0, title: null },  // no messageCount field
      ],
    };
    const r = await listRecentAgentSessions(engine, "a1");
    expect(r[0].messageCount).toBe(17);
    expect(r[1].messageCount).toBe(0);
  });

  it("throws without agentId", async () => {
    const engine = { listSessions: async () => [] };
    await expect(listRecentAgentSessions(engine, null)).rejects.toThrow(/agentId/);
    await expect(listRecentAgentSessions(engine, "")).rejects.toThrow(/agentId/);
  });

  it("throws when engine has no listSessions", async () => {
    await expect(listRecentAgentSessions({}, "a1")).rejects.toThrow(/listSessions/);
    await expect(listRecentAgentSessions(null, "a1")).rejects.toThrow(/listSessions/);
  });
});
