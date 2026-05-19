import { describe, expect, it, vi } from "vitest";

const { estimateTokensMock } = vi.hoisted(() => ({
  estimateTokensMock: vi.fn(() => 2000),
}));

vi.mock("../lib/pi-sdk/index.js", () => ({
  createAgentSession: vi.fn(),
  SessionManager: {
    create: vi.fn(),
    open: vi.fn(),
  },
  estimateTokens: estimateTokensMock,
  findCutPoint: vi.fn(),
  generateSummary: vi.fn(),
  emitSessionShutdown: vi.fn(),
  refreshSessionModelFromRegistry: vi.fn(),
}));

vi.mock("../lib/debug-log.js", () => ({
  createModuleLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { SessionCoordinator } from "../core/session-coordinator.js";

describe("SessionCoordinator.switchSessionModel", () => {
  it("reports per-session model switch state through a public query", () => {
    const coord = new SessionCoordinator({
      agentsDir: "/tmp/agents",
      getAgent: () => ({ sessionDir: "/tmp/sessions" }),
      getActiveAgentId: () => "hana",
      getModels: () => null,
      getResourceLoader: () => null,
      getSkills: () => null,
      buildTools: () => ({ tools: [], customTools: [] }),
      emitEvent: () => {},
      getHomeCwd: () => "/tmp",
      agentIdFromSessionPath: () => null,
      switchAgentOnly: async () => {},
      getConfig: () => ({}),
      getPrefs: () => ({ getThinkingLevel: () => "medium" }),
      getAgents: () => new Map(),
      getActivityStore: () => null,
      getAgentById: () => null,
      listAgents: () => [],
    });

    coord.sessions.set("/tmp/session.jsonl", {
      session: {},
      _switching: true,
    });

    expect(coord.isSessionSwitching("/tmp/session.jsonl")).toBe(true);
    expect(coord.isSessionSwitching("/tmp/missing.jsonl")).toBe(false);
  });

  it("does not crash when context usage exists and adaptation is needed", async () => {
    const coord = new SessionCoordinator({
      agentsDir: "/tmp/agents",
      getAgent: () => ({ sessionDir: "/tmp/sessions" }),
      getActiveAgentId: () => "hana",
      getModels: () => null,
      getResourceLoader: () => null,
      getSkills: () => null,
      buildTools: () => ({ tools: [], customTools: [] }),
      emitEvent: () => {},
      getHomeCwd: () => "/tmp",
      agentIdFromSessionPath: () => null,
      switchAgentOnly: async () => {},
      getConfig: () => ({}),
      getPrefs: () => ({ getThinkingLevel: () => "medium" }),
      getAgents: () => new Map(),
      getActivityStore: () => null,
      getAgentById: () => null,
      listAgents: () => [],
    });

    const setModel = vi.fn(async () => {});
    const entry = {
      session: {
        model: { id: "old-model", provider: "test", contextWindow: 64000 },
        isCompacting: false,
        getContextUsage: () => ({ tokens: 10000 }),
        agent: {
          state: {
            messages: [
              { role: "system", content: "sys" },
              { role: "user", content: "question" },
              { role: "assistant", content: "answer" },
            ],
          },
        },
        setModel,
      },
      modelId: "old-model",
      modelProvider: "test",
    };
    coord.sessions.set("/tmp/session.jsonl", entry);

    const compactSpy = vi.spyOn(coord, "_compactWithModel").mockResolvedValue();
    const truncateSpy = vi.spyOn(coord, "_hardTruncate").mockResolvedValue();

    const result = await coord.switchSessionModel("/tmp/session.jsonl", {
      id: "new-model",
      provider: "test",
      contextWindow: 12000,
    });

    expect(result).toEqual({ adaptations: ["compacted"], thinkingLevel: "medium" });
    expect(compactSpy).toHaveBeenCalledOnce();
    expect(truncateSpy).not.toHaveBeenCalled();
    expect(setModel).toHaveBeenCalledWith({
      id: "new-model",
      provider: "test",
      contextWindow: 12000,
    });
    expect(entry.modelId).toBe("new-model");
    expect(entry.modelProvider).toBe("test");
  });

  it("falls back from xhigh to high when switching to a model without max thinking support", async () => {
    const coord = new SessionCoordinator({
      agentsDir: "/tmp/agents",
      getAgent: () => ({ sessionDir: "/tmp/sessions" }),
      getActiveAgentId: () => "hana",
      getModels: () => null,
      getResourceLoader: () => null,
      getSkills: () => null,
      buildTools: () => ({ tools: [], customTools: [] }),
      emitEvent: () => {},
      getHomeCwd: () => "/tmp",
      agentIdFromSessionPath: () => null,
      switchAgentOnly: async () => {},
      getConfig: () => ({}),
      getPrefs: () => ({ getThinkingLevel: () => "xhigh" }),
      getAgents: () => new Map(),
      getActivityStore: () => null,
      getAgentById: () => null,
      listAgents: () => [],
    });
    vi.spyOn(coord, "writeSessionMeta").mockResolvedValue();

    const setModel = vi.fn(async () => {});
    const setThinkingLevel = vi.fn();
    const entry = {
      session: {
        model: { id: "max-model", provider: "test", contextWindow: 64000, xhigh: true },
        isCompacting: false,
        getContextUsage: () => ({ tokens: 1000 }),
        agent: { state: { messages: [] } },
        setModel,
        setThinkingLevel,
      },
      modelId: "max-model",
      modelProvider: "test",
      thinkingLevel: "xhigh",
    };
    coord.sessions.set("/tmp/session.jsonl", entry);

    const result = await coord.switchSessionModel("/tmp/session.jsonl", {
      id: "regular-model",
      provider: "test",
      contextWindow: 64000,
    });

    expect(result).toEqual({ adaptations: [], thinkingLevel: "high" });
    expect(setModel).toHaveBeenCalledOnce();
    expect(setThinkingLevel).toHaveBeenCalledWith("high");
    expect(entry.thinkingLevel).toBe("high");
    expect(coord.writeSessionMeta).toHaveBeenCalledWith("/tmp/session.jsonl", expect.objectContaining({
      thinkingLevel: "high",
    }));
  });
});
