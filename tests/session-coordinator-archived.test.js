import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";

async function loadCoord(tmpDir) {
  const { SessionCoordinator } = await import("../core/session-coordinator.js");
  const deps = {
    agentsDir: path.join(tmpDir, "agents"),
    listAgents: () => [
      { id: "a", name: "AgentA" },
      { id: "b", name: "AgentB" },
    ],
    getAgent: (id) => id
      ? { id, agentName: `Agent${id.toUpperCase()}` }
      : { id: "a", agentName: "AgentA" },
    getActiveAgentId: () => "a",
    agentIdFromSessionPath: (p) => {
      const rel = path.relative(path.join(tmpDir, "agents"), p);
      return rel.split(path.sep)[0];
    },
  };
  return new SessionCoordinator(deps);
}

describe("session-coordinator: archived helpers", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "hana-coord-arch-"));
  });

  afterEach(() => {
    fsSync.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("clearSessionTitle removes entry from session-titles.json", async () => {
    const sessDir = path.join(tmpDir, "agents", "a", "sessions");
    await fs.mkdir(sessDir, { recursive: true });
    const sessionPath = path.join(sessDir, "s1.jsonl");
    const titlePath = path.join(sessDir, "session-titles.json");
    await fs.writeFile(
      titlePath,
      JSON.stringify({ [sessionPath]: "My Title", other: "keep" }),
    );

    const coord = await loadCoord(tmpDir);
    await coord.clearSessionTitle(sessionPath);

    const raw = JSON.parse(await fs.readFile(titlePath, "utf-8"));
    expect(raw[sessionPath]).toBeUndefined();
    expect(raw.other).toBe("keep");
  });

  it("clearSessionTitle is a no-op when titles.json missing", async () => {
    const sessDir = path.join(tmpDir, "agents", "a", "sessions");
    await fs.mkdir(sessDir, { recursive: true });
    const coord = await loadCoord(tmpDir);
    await expect(
      coord.clearSessionTitle(path.join(sessDir, "s1.jsonl")),
    ).resolves.toBeUndefined();
  });

  it("listArchivedSessions aggregates across agents, sorts by mtime desc", async () => {
    const aArch = path.join(tmpDir, "agents", "a", "sessions", "archived");
    const bArch = path.join(tmpDir, "agents", "b", "sessions", "archived");
    await fs.mkdir(aArch, { recursive: true });
    await fs.mkdir(bArch, { recursive: true });
    const now = Date.now();
    await fs.writeFile(path.join(aArch, "a1.jsonl"), "{}\n");
    await fs.utimes(
      path.join(aArch, "a1.jsonl"),
      (now - 86400000) / 1000,
      (now - 86400000) / 1000,
    );
    await fs.writeFile(path.join(bArch, "b1.jsonl"), "{}\n");
    await fs.utimes(
      path.join(bArch, "b1.jsonl"),
      (now - 3600_000) / 1000,
      (now - 3600_000) / 1000,
    );
    await fs.writeFile(path.join(bArch, "b2.jsonl"), "{}\n");
    await fs.utimes(path.join(bArch, "b2.jsonl"), now / 1000, now / 1000);

    const coord = await loadCoord(tmpDir);
    const list = await coord.listArchivedSessions();

    expect(list.length).toBe(3);
    expect(list.map((s) => path.basename(s.path))).toEqual([
      "b2.jsonl",
      "b1.jsonl",
      "a1.jsonl",
    ]);
    expect(list[0].agentId).toBe("b");
    expect(list[0].agentName).toBe("AgentB");
    expect(typeof list[0].sizeBytes).toBe("number");
    expect(list[0].archivedAt).toBeTruthy();
  });

  it("listArchivedSessions reads title from session-titles.json by active-path key", async () => {
    const sessDir = path.join(tmpDir, "agents", "a", "sessions");
    const aArch = path.join(sessDir, "archived");
    await fs.mkdir(aArch, { recursive: true });
    await fs.writeFile(path.join(aArch, "x.jsonl"), "{}\n");
    const activeKey = path.join(sessDir, "x.jsonl");
    await fs.writeFile(
      path.join(sessDir, "session-titles.json"),
      JSON.stringify({ [activeKey]: "Preserved" }),
    );

    const coord = await loadCoord(tmpDir);
    const list = await coord.listArchivedSessions();
    expect(list[0].title).toBe("Preserved");
  });
});
