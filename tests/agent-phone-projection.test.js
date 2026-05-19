import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getAgentPhoneProjectionPath,
  ensureAgentPhoneProjection,
  recordAgentPhoneActivity,
  readAgentPhoneProjection,
  updateAgentPhoneProjectionMeta,
} from "../lib/conversations/agent-phone-projection.js";

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hana-agent-phone-test-"));
}

describe("agent phone projection", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mktemp();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores each agent conversation projection under that agent directory", async () => {
    const hanaDir = path.join(tmpDir, "agents", "hana");
    const yuiDir = path.join(tmpDir, "agents", "yui");

    const hanaPath = await ensureAgentPhoneProjection({
      agentDir: hanaDir,
      agentId: "hana",
      conversationId: "dm:yui",
      conversationType: "dm",
    });
    const yuiPath = await ensureAgentPhoneProjection({
      agentDir: yuiDir,
      agentId: "yui",
      conversationId: "dm:hana",
      conversationType: "dm",
    });

    expect(hanaPath).toContain(path.join("hana", "phone", "conversations"));
    expect(yuiPath).toContain(path.join("yui", "phone", "conversations"));
    expect(hanaPath).not.toBe(yuiPath);
    expect(path.basename(hanaPath)).not.toContain(":");
    expect(fs.existsSync(hanaPath)).toBe(true);
    expect(fs.existsSync(yuiPath)).toBe(true);
  });

  it("records viewed state and keeps activity in the agent projection document", async () => {
    const agentDir = path.join(tmpDir, "agents", "hana");

    await recordAgentPhoneActivity({
      agentDir,
      agentId: "hana",
      conversationId: "ch_crew",
      conversationType: "channel",
      state: "viewed",
      summary: "已查看 2 条新消息",
      timestamp: "2026-05-12T12:00:00.000Z",
      details: { lastMessageTimestamp: "2026-05-12 20:00:00" },
    });

    const projectionPath = getAgentPhoneProjectionPath(agentDir, "ch_crew");
    const projection = readAgentPhoneProjection(projectionPath);

    expect(projection.meta).toMatchObject({
      agentId: "hana",
      conversationId: "ch_crew",
      conversationType: "channel",
      state: "viewed",
      summary: "已查看 2 条新消息",
      lastViewedTimestamp: "2026-05-12 20:00:00",
    });
    expect(projection.activities).toEqual([
      expect.objectContaining({
        state: "viewed",
        summary: "已查看 2 条新消息",
      }),
    ]);
  });

  it("updates phone session metadata without removing activity history", async () => {
    const agentDir = path.join(tmpDir, "agents", "hana");
    await recordAgentPhoneActivity({
      agentDir,
      agentId: "hana",
      conversationId: "ch_crew",
      conversationType: "channel",
      state: "viewed",
      summary: "已查看",
      timestamp: "2026-05-12T12:00:00.000Z",
    });

    await updateAgentPhoneProjectionMeta({
      agentDir,
      agentId: "hana",
      conversationId: "ch_crew",
      conversationType: "channel",
      patch: { phoneSessionFile: "phone/sessions/ch_crew/session.jsonl" },
    });

    const projection = readAgentPhoneProjection(getAgentPhoneProjectionPath(agentDir, "ch_crew"));
    expect(projection.meta.phoneSessionFile).toBe("phone/sessions/ch_crew/session.jsonl");
    expect(projection.activities.map((activity) => activity.state)).toEqual(["viewed"]);
  });
});
