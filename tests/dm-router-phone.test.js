import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { DmRouter } from "../hub/dm-router.js";
import { getAgentPhoneProjectionPath, readAgentPhoneProjection, updateAgentPhoneProjectionMeta } from "../lib/conversations/agent-phone-projection.js";

const { runAgentPhoneSessionMock } = vi.hoisted(() => ({
  runAgentPhoneSessionMock: vi.fn(async () => "收到 <done/>"),
}));

vi.mock("../hub/agent-executor.js", () => ({
  runAgentPhoneSession: runAgentPhoneSessionMock,
}));

vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  createModuleLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function writeDmFile(filePath, sender, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, [
    "---",
    "type: dm",
    "---",
    "",
    `### ${sender} | 2026-05-12 20:00:00`,
    "",
    body,
    "",
    "---",
    "",
  ].join("\n"), "utf-8");
}

describe("DmRouter agent phone session", () => {
  it("uses a reusable phone session and records per-agent DM activity", async () => {
    runAgentPhoneSessionMock.mockClear();
    runAgentPhoneSessionMock.mockResolvedValueOnce("收到 <done/>");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-dm-phone-"));
    const agentsDir = path.join(root, "agents");
    const aliceDir = path.join(agentsDir, "alice");
    const bobDir = path.join(agentsDir, "bob");
    writeDmFile(path.join(aliceDir, "dm", "bob.md"), "bob", "ping");
    writeDmFile(path.join(bobDir, "dm", "alice.md"), "bob", "ping");
    await updateAgentPhoneProjectionMeta({
      agentDir: aliceDir,
      agentId: "alice",
      conversationId: "dm:bob",
      conversationType: "dm",
      patch: {
        toolMode: "write",
        replyMinChars: "20",
        replyMaxChars: "80",
      },
    });

    const emit = vi.fn();
    const activityRecord = vi.fn();
    const router = new DmRouter({
      hub: {
        engine: {
          agentsDir,
          getAgent: (id) => ({
            id,
            agentDir: id === "alice" ? aliceDir : bobDir,
            agentName: id === "alice" ? "Alice" : "Bob",
            config: { agent: { name: id, yuan: id === "alice" ? "ming" : "hanako" } },
            personality: `I am ${id}`,
          }),
        },
        eventBus: { emit },
        agentPhoneActivities: { record: activityRecord },
      },
    });

    await router._processReply("bob", "alice");

    expect(runAgentPhoneSessionMock).toHaveBeenCalledOnce();
    expect(runAgentPhoneSessionMock.mock.calls[0][2]).toMatchObject({
      conversationId: "dm:bob",
      conversationType: "dm",
      toolMode: "write",
    });
    const phonePrompt = runAgentPhoneSessionMock.mock.calls[0][1][0].text;
    expect(phonePrompt).toContain("Reflect");
    expect(phonePrompt).toContain("<reflect>");
    expect(phonePrompt).toContain("20");
    expect(phonePrompt).toContain("80");
    expect(phonePrompt).not.toContain("只在能推进话题时回复");
    expect(runAgentPhoneSessionMock.mock.calls[0][2]).not.toHaveProperty("maxTokens");
    expect(activityRecord.mock.calls.map((call) => call[0].state)).toEqual(
      expect.arrayContaining(["viewed", "replying", "idle"]),
    );
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      type: "dm_new_message",
      from: "alice",
      to: "bob",
    }), null);

    const projection = readAgentPhoneProjection(getAgentPhoneProjectionPath(aliceDir, "dm:bob"));
    expect(projection.meta).toMatchObject({
      agentId: "alice",
      conversationId: "dm:bob",
      conversationType: "dm",
      state: "idle",
    });

    fs.rmSync(root, { recursive: true, force: true });
  });
});
