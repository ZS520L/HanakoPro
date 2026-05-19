import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentManager } from "../core/agent-manager.js";

describe("AgentManager.deleteAgent skill bundle lifecycle", () => {
  let tempDir;
  let agentsDir;
  let manager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-agent-delete-bundles-"));
    agentsDir = path.join(tempDir, "agents");
    fs.mkdirSync(path.join(agentsDir, "active"), { recursive: true });
    fs.mkdirSync(path.join(agentsDir, "imported-agent"), { recursive: true });
    fs.writeFileSync(path.join(agentsDir, "active", "config.yaml"), "agent:\n  name: Active\n", "utf-8");
    fs.writeFileSync(path.join(agentsDir, "imported-agent", "config.yaml"), "agent:\n  name: Imported\n", "utf-8");
    fs.writeFileSync(path.join(tempDir, "skill-bundles.json"), JSON.stringify({
      schemaVersion: 1,
      bundles: [
        {
          id: "imported-bundle",
          name: "Imported Bundle",
          skillNames: ["quiet-musing"],
          source: "character-card-import",
          agentId: "imported-agent",
          sourcePackage: "imported-charactercard.zip",
          createdAt: "2026-05-14T00:00:00.000Z",
          updatedAt: "2026-05-14T00:00:00.000Z",
        },
      ],
    }, null, 2), "utf-8");

    const prefs = {
      getPrimaryAgent: vi.fn(() => "active"),
      savePrimaryAgent: vi.fn(),
      getPreferences: vi.fn(() => ({ agentOrder: ["active", "imported-agent"] })),
      savePreferences: vi.fn(),
    };
    manager = new AgentManager({
      hanakoHome: tempDir,
      agentsDir,
      productDir: tempDir,
      userDir: tempDir,
      channelsDir: tempDir,
      getPrefs: () => prefs,
      getModels: () => ({}),
      getHub: () => ({
        scheduler: {
          removeAgentCron: vi.fn(),
          stopHeartbeat: vi.fn(),
        },
      }),
      getSkills: () => ({}),
      getSearchConfig: () => ({}),
      resolveUtilityConfig: () => ({}),
      getSharedModels: () => ({}),
      getChannelManager: () => ({ cleanupAgentFromChannels: vi.fn() }),
      getSessionCoordinator: () => ({}),
    });
    manager.activeAgentId = "active";
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("detaches bundles owned by the deleted agent instead of leaving orphan agentId", async () => {
    await manager.deleteAgent("imported-agent");

    const store = JSON.parse(fs.readFileSync(path.join(tempDir, "skill-bundles.json"), "utf-8"));
    expect(store.bundles).toHaveLength(1);
    expect(store.bundles[0]).toMatchObject({
      id: "imported-bundle",
      agentId: null,
      skillNames: ["quiet-musing"],
    });
  });
});
