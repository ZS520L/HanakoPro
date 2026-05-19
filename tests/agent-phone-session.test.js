import { describe, expect, it } from "vitest";
import {
  AGENT_PHONE_COMPACTION,
  filterAgentPhoneTools,
  getAgentPhoneSessionDir,
  isAgentPhoneSessionPath,
  shouldCompactAgentPhoneSession,
} from "../lib/conversations/agent-phone-session.js";

describe("agent phone session policy", () => {
  it("uses a stable safe session directory per conversation", () => {
    const dir = getAgentPhoneSessionDir("/agents/hana", "dm:yui");
    expect(dir).toContain("/agents/hana/phone/sessions/");
    expect(dir.split("/").at(-1)).not.toContain(":");
  });

  it("recognizes phone sessions so memory pipelines can exclude them", () => {
    expect(isAgentPhoneSessionPath("/agents/hana/phone/sessions/ch_crew/session.jsonl")).toBe(true);
    expect(isAgentPhoneSessionPath("/agents/hana/sessions/session.jsonl")).toBe(false);
  });

  it("compacts immediately at the hard 180K limit even when active", () => {
    expect(shouldCompactAgentPhoneSession({
      tokens: AGENT_PHONE_COMPACTION.HARD_TOKENS,
      isActive: true,
    })).toBe("hard");
  });

  it("only idle-compacts at 120K when not active", () => {
    expect(shouldCompactAgentPhoneSession({
      tokens: AGENT_PHONE_COMPACTION.IDLE_TOKENS,
      isActive: true,
    })).toBe(null);
    expect(shouldCompactAgentPhoneSession({
      tokens: AGENT_PHONE_COMPACTION.IDLE_TOKENS,
      isActive: false,
    })).toBe("idle");
  });

  it("keeps phone write mode from opening recursive communication or browser tools", () => {
    const built = {
      tools: [
        { name: "read" },
        { name: "write" },
        { name: "browser" },
      ],
      customTools: [
        { name: "search_memory" },
        { name: "channel" },
        { name: "dm" },
        { name: "web_search" },
      ],
    };

    const filtered = filterAgentPhoneTools(built, { toolMode: "write" });
    expect(filtered.tools.map((tool) => tool.name)).toEqual(["read", "write"]);
    expect(filtered.customTools.map((tool) => tool.name)).toEqual(["search_memory", "web_search"]);
  });

  it("keeps phone read-only mode schema stable while excluding structural phone blockers", () => {
    const built = {
      tools: [
        { name: "read" },
        { name: "write" },
        { name: "grep" },
        { name: "browser" },
      ],
      customTools: [
        { name: "search_memory" },
        { name: "record_experience" },
        { name: "dm" },
        { name: "web_fetch" },
      ],
    };

    const filtered = filterAgentPhoneTools(built, { toolMode: "read_only" });
    expect(filtered.tools.map((tool) => tool.name)).toEqual(["read", "write", "grep"]);
    expect(filtered.customTools.map((tool) => tool.name)).toEqual([
      "search_memory",
      "record_experience",
      "web_fetch",
    ]);
  });
});
