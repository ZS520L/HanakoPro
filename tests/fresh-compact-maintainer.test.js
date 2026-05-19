import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { updateAgentPhoneProjectionMeta } from "../lib/conversations/agent-phone-projection.js";

const freshCompactAgentPhoneSessionMock = vi.fn(async () => ({ fresh: true }));

vi.mock("../hub/agent-executor.js", () => ({
  freshCompactAgentPhoneSession: (...args) => freshCompactAgentPhoneSessionMock(...args),
}));

import { FreshCompactMaintainer } from "../hub/fresh-compact-maintainer.js";

let rootDir;

function makeAgent(id = "agent-a") {
  const agentDir = path.join(rootDir, "agents", id);
  const sessionDir = path.join(rootDir, "sessions", id);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });
  return { id, agentDir, sessionDir };
}

describe("FreshCompactMaintainer", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-maintainer-"));
    freshCompactAgentPhoneSessionMock.mockClear();
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("runs stale bridge and phone fresh-compacts from the background maintainer", async () => {
    const agent = makeAgent();
    const phoneFile = path.join(agent.agentDir, "phone", "sessions", "ch_crew", "phone.jsonl");
    fs.mkdirSync(path.dirname(phoneFile), { recursive: true });
    fs.writeFileSync(phoneFile, "", "utf-8");
    await updateAgentPhoneProjectionMeta({
      agentDir: agent.agentDir,
      agentId: agent.id,
      conversationId: "ch_crew",
      conversationType: "channel",
      patch: {
        phoneSessionFile: path.relative(agent.agentDir, phoneFile).split(path.sep).join("/"),
        lastFreshCompactDate: "2026-05-14",
      },
    });

    const bridgeSessionManager = {
      listDailyFreshCompactTargets: vi.fn(() => [{ sessionKey: "tg_dm_owner" }]),
      freshCompactSession: vi.fn(async () => ({ fresh: true })),
    };
    const engine = {
      agents: new Map([[agent.id, agent]]),
      getAgent: (id) => (id === agent.id ? agent : null),
      bridgeSessionManager,
    };
    const maintainer = new FreshCompactMaintainer({
      hub: { engine },
      delayBetweenJobsMs: 0,
    });
    const now = new Date(2026, 4, 15, 4, 10);

    const result = await maintainer.runDaily({ now });

    expect(bridgeSessionManager.listDailyFreshCompactTargets).toHaveBeenCalledWith(agent, { now });
    expect(bridgeSessionManager.freshCompactSession).toHaveBeenCalledWith("tg_dm_owner", {
      agentId: agent.id,
      reason: "daily",
      now,
    });
    expect(freshCompactAgentPhoneSessionMock).toHaveBeenCalledWith(agent.id, {
      engine,
      conversationId: "ch_crew",
      conversationType: "channel",
      now,
      reason: "daily",
    });
    expect(result).toMatchObject({ bridgeCompacted: 1, phoneCompacted: 1 });
  });
});
