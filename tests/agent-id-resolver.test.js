import { describe, it, expect } from "vitest";
import { resolveAgentParam } from "../lib/tools/agent-id-resolver.js";

describe("resolveAgentParam", () => {
  const agents = [
    { id: "ming", name: "明" },
    { id: "maomao", name: "毛毛" },
    { id: "hanako", name: "小花" },
  ];

  it("returns ok with undefined when raw is empty", () => {
    expect(resolveAgentParam(agents, undefined)).toEqual({ ok: true, agentId: undefined });
    expect(resolveAgentParam(agents, "")).toEqual({ ok: true, agentId: undefined });
  });

  it("matches by id strictly first", () => {
    expect(resolveAgentParam(agents, "ming")).toEqual({ ok: true, agentId: "ming" });
  });

  it("falls back to unique name match when id misses", () => {
    expect(resolveAgentParam(agents, "明")).toEqual({ ok: true, agentId: "ming" });
    expect(resolveAgentParam(agents, "毛毛")).toEqual({ ok: true, agentId: "maomao" });
  });

  it("returns ok=false when name is unknown", () => {
    const result = resolveAgentParam(agents, "不存在");
    expect(result.ok).toBe(false);
    expect(result.ambiguous).toBe(false);
    expect(result.byName).toEqual([]);
  });

  it("returns ambiguous when multiple agents share the same name", () => {
    const dupAgents = [
      { id: "a1", name: "撞名" },
      { id: "a2", name: "撞名" },
    ];
    const result = resolveAgentParam(dupAgents, "撞名");
    expect(result.ok).toBe(false);
    expect(result.ambiguous).toBe(true);
    expect(result.byName).toHaveLength(2);
  });

  it("prefers id over a colliding name", () => {
    // 有个 agent.id == "明"（极少见但合法），另一个 agent.name == "明"
    const tricky = [
      { id: "明", name: "Alpha" },
      { id: "ming", name: "明" },
    ];
    expect(resolveAgentParam(tricky, "明")).toEqual({ ok: true, agentId: "明" });
  });
});
