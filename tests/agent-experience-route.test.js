import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("agents route: experience toggle", () => {
  let tempRoot;
  let agentDir;
  let app;
  let engine;
  const agentId = "hana";

  beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-experience-route-"));
    agentDir = path.join(tempRoot, agentId);
    fs.mkdirSync(path.join(agentDir, "experience"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "config.yaml"), "agent:\n  name: Hana\n", "utf-8");
    fs.writeFileSync(
      path.join(agentDir, "experience", "workflow.md"),
      "<!-- experience-title: d29ya2Zsb3c -->\n1. Keep context boundaries explicit.\n",
      "utf-8",
    );

    const { createAgentsRoute } = await import("../server/routes/agents.js");
    engine = {
      agentsDir: tempRoot,
      getAgent: vi.fn(() => ({
        id: agentId,
        experienceEnabled: false,
        tools: [],
      })),
      providerRegistry: {
        getAllProvidersRaw: vi.fn(() => ({})),
        get: vi.fn(() => null),
      },
      updateConfig: vi.fn().mockResolvedValue(undefined),
      invalidateAgentListCache: vi.fn(),
      getLocale: vi.fn(() => ""),
      getTimezone: vi.fn(() => ""),
      getSandbox: vi.fn(() => false),
      getFileBackup: vi.fn(() => ({ enabled: false })),
      getUpdateChannel: vi.fn(() => "stable"),
      getAutoCheckUpdates: vi.fn(() => true),
      getThinkingLevel: vi.fn(() => "auto"),
      getEditor: vi.fn(() => null),
      getLearnSkills: vi.fn(() => ({})),
      getHeartbeatMaster: vi.fn(() => true),
      getChannelsEnabled: vi.fn(() => false),
      getBridgeReadOnly: vi.fn(() => false),
      getBridgeReceiptEnabled: vi.fn(() => true),
    };
    app = new Hono();
    app.route("/api", createAgentsRoute(engine));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("injects the disabled default for legacy configs without experience.enabled", async () => {
    const res = await app.request(`/api/agents/${agentId}/config`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.experience).toEqual({ enabled: false });
  });

  it("does not expose stored experience content while paused", async () => {
    const res = await app.request(`/api/agents/${agentId}/experience`);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.content).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("Keep context boundaries explicit");
  });

  it("rejects experience writes while paused and preserves stored files", async () => {
    const res = await app.request(`/api/agents/${agentId}/experience`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# workflow\n1. overwrite\n" }),
    });
    expect(res.status).toBe(403);

    const stored = fs.readFileSync(path.join(agentDir, "experience", "workflow.md"), "utf-8");
    expect(stored).toContain("Keep context boundaries explicit");
    expect(stored).not.toContain("overwrite");
  });
});
