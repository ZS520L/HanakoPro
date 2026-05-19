import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigRoute } from "../server/routes/config.js";

function makeAgent(tmpDir) {
  const agentDir = path.join(tmpDir, "agents", "hana");
  const memoryDir = path.join(agentDir, "memory");
  const summariesDir = path.join(memoryDir, "summaries");
  fs.mkdirSync(summariesDir, { recursive: true });

  for (const name of ["memory.md", "today.md", "week.md", "longterm.md", "facts.md"]) {
    fs.writeFileSync(path.join(memoryDir, name), "old compiled content", "utf-8");
    fs.writeFileSync(path.join(memoryDir, `${name}.fingerprint`), "old-fp", "utf-8");
  }
  fs.writeFileSync(path.join(summariesDir, "old-session.json"), "{}", "utf-8");
  fs.writeFileSync(path.join(summariesDir, "keep.tmp"), "not a summary", "utf-8");

  return {
    id: "hana",
    agentDir,
    memoryMdPath: path.join(memoryDir, "memory.md"),
    summariesDir,
    summaryManager: { clearCache: vi.fn() },
    factStore: {
      exportAll: vi.fn(() => []),
      clearAll: vi.fn(),
    },
  };
}

function makeEngine(agent, tmpDir) {
  return {
    config: {},
    configPath: path.join(tmpDir, "config.yaml"),
    currentAgentId: agent.id,
    agentsDir: path.join(tmpDir, "agents"),
    getAgent: vi.fn((id) => (id === agent.id ? agent : null)),
    updateConfig: vi.fn().mockResolvedValue(undefined),
  };
}

function mountConfigRoute(engine) {
  const app = new Hono();
  app.route("/api", createConfigRoute(engine));
  return app;
}

function expectCompiledMemoryCleared(agent) {
  const memoryDir = path.dirname(agent.memoryMdPath);
  for (const name of ["memory.md", "today.md", "week.md", "longterm.md", "facts.md"]) {
    expect(fs.readFileSync(path.join(memoryDir, name), "utf-8")).toBe("");
    expect(fs.existsSync(path.join(memoryDir, `${name}.fingerprint`))).toBe(false);
  }
  const marker = JSON.parse(fs.readFileSync(path.join(memoryDir, "reset.json"), "utf-8"));
  expect(Date.parse(marker.compiledResetAt)).not.toBeNaN();
  expect(fs.existsSync(path.join(agent.summariesDir, "old-session.json"))).toBe(false);
  expect(fs.existsSync(path.join(agent.summariesDir, "keep.tmp"))).toBe(true);
  expect(agent.summaryManager.clearCache).toHaveBeenCalledOnce();
}

describe("memory routes", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-memory-routes-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("clears compiled memory sources and writes a reset watermark", async () => {
    const agent = makeAgent(tmpDir);
    const engine = makeEngine(agent, tmpDir);
    const app = mountConfigRoute(engine);

    const res = await app.request("/api/memories/compiled?agentId=hana", { method: "DELETE" });

    expect(res.status).toBe(200);
    expectCompiledMemoryCleared(agent);
    expect(agent.factStore.clearAll).not.toHaveBeenCalled();
    expect(engine.updateConfig).toHaveBeenCalledWith({}, { agentId: "hana" });
  });

  it("clears facts, compiled memory sources, and writes a reset watermark", async () => {
    const agent = makeAgent(tmpDir);
    const engine = makeEngine(agent, tmpDir);
    const app = mountConfigRoute(engine);

    const res = await app.request("/api/memories?agentId=hana", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(agent.factStore.clearAll).toHaveBeenCalledOnce();
    expectCompiledMemoryCleared(agent);
    expect(engine.updateConfig).toHaveBeenCalledWith({}, { agentId: "hana" });
  });

  it("requires an explicit agentId for memory delete operations", async () => {
    const agent = makeAgent(tmpDir);
    const engine = makeEngine(agent, tmpDir);
    const app = mountConfigRoute(engine);

    const res = await app.request("/api/memories/compiled", { method: "DELETE" });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toContain("missing agentId");
    expect(agent.summaryManager.clearCache).not.toHaveBeenCalled();
    expect(agent.factStore.clearAll).not.toHaveBeenCalled();
    expect(engine.updateConfig).not.toHaveBeenCalled();
  });
});
