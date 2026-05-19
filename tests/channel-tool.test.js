import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createChannel, appendMessage } from "../lib/channels/channel-store.js";
import { createChannelTool } from "../lib/tools/channel-tool.js";

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-tool-test-"));
}

describe("channel tool membership contract", () => {
  let tmpDir;
  let channelsDir;
  let agentsDir;

  beforeEach(() => {
    tmpDir = mktemp();
    channelsDir = path.join(tmpDir, "channels");
    agentsDir = path.join(tmpDir, "agents");
    fs.mkdirSync(channelsDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
    for (const id of ["alice", "bob", "charlie"]) {
      fs.mkdirSync(path.join(agentsDir, id), { recursive: true });
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects create when fewer than two unique agent members would be present", async () => {
    const tool = createChannelTool({
      channelsDir,
      agentsDir,
      agentId: "alice",
      listAgents: () => [],
      isEnabled: () => true,
    });

    const result = await tool.execute("call-1", {
      action: "create",
      name: "solo",
      members: ["alice"],
    });

    expect(result.details).toMatchObject({
      action: "create",
      error: expect.stringMatching(/at least 2/i),
    });
    expect(fs.readdirSync(channelsDir)).toEqual([]);
  });

  it("rejects read when the agent is not a channel member", async () => {
    const { id } = await createChannel(channelsDir, {
      id: "team",
      name: "Team",
      members: ["bob", "charlie"],
    });
    await appendMessage(path.join(channelsDir, `${id}.md`), "bob", "secret");

    const tool = createChannelTool({
      channelsDir,
      agentsDir,
      agentId: "alice",
      listAgents: () => [],
      isEnabled: () => true,
    });

    const result = await tool.execute("call-2", {
      action: "read",
      channel: id,
    });

    expect(result.details).toMatchObject({
      action: "read",
      error: "not a member",
    });
    expect(result.content[0].text).not.toContain("secret");
  });
});
