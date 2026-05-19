import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChannel, appendMessage, updateChannelMeta } from "../lib/channels/channel-store.js";
import { createChannelTicker } from "../lib/channels/channel-ticker.js";

vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hana-channel-ticker-"));
}

describe("channel-ticker membership source", () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it("delivers unread channel messages to an agent listed in channel members even when its cursor projection is missing", async () => {
    tmpDir = mktemp();
    const channelsDir = path.join(tmpDir, "channels");
    const agentsDir = path.join(tmpDir, "agents");
    const agentDir = path.join(agentsDir, "hana");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "channels.md"), "# 频道\n\n", "utf-8");

    const { id: channelId } = await createChannel(channelsDir, {
      id: "ch_crew",
      name: "Crew",
      members: ["hana", "yui"],
    });
    await appendMessage(path.join(channelsDir, `${channelId}.md`), "user", "@Hana hello");

    const executeCheck = vi.fn(async () => ({ replied: false }));
    const onMemorySummarize = vi.fn();
    const ticker = createChannelTicker({
      channelsDir,
      agentsDir,
      getAgentOrder: () => ["hana"],
      executeCheck,
      onMemorySummarize,
    });

    ticker.start();
    try {
      await ticker.triggerImmediate(channelId);
    } finally {
      await ticker.stop();
    }

    expect(executeCheck).toHaveBeenCalledOnce();
    expect(executeCheck.mock.calls[0][0]).toBe("hana");
    expect(executeCheck.mock.calls[0][1]).toBe(channelId);
    expect(onMemorySummarize).toHaveBeenCalledWith(
      "hana",
      channelId,
      expect.objectContaining({
        messages: [expect.objectContaining({ sender: "user", body: "@Hana hello" })],
      }),
    );
  });

  it("delivers only each agent's unread group messages and loops until everyone is caught up", async () => {
    tmpDir = mktemp();
    const channelsDir = path.join(tmpDir, "channels");
    const agentsDir = path.join(tmpDir, "agents");
    for (const agentId of ["hana", "yui", "ming"]) {
      const agentDir = path.join(agentsDir, agentId);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "channels.md"), "# 频道\n\n", "utf-8");
    }

    const { id: channelId } = await createChannel(channelsDir, {
      id: "ch_crew",
      name: "Crew",
      members: ["hana", "yui", "ming"],
    });
    const channelFile = path.join(channelsDir, `${channelId}.md`);
    await appendMessage(channelFile, "user", "谁想接一下这个话题？");

    const seen = [];
    const decisions = [
      { replied: true, replyContent: "我先接一下。" },
      { replied: false },
      { replied: false },
    ];
    let decisionIndex = 0;
    const executeCheck = vi.fn(async (agentId, _channelName, newMessages) => {
      seen.push({ agentId, bodies: newMessages.map((message) => message.body) });
      const result = decisions[decisionIndex++] || { replied: false };
      if (result.replied) {
        await appendMessage(channelFile, agentId, result.replyContent);
      }
      return result;
    });
    const ticker = createChannelTicker({
      channelsDir,
      agentsDir,
      getAgentOrder: () => ["hana", "yui", "ming"],
      executeCheck,
      onMemorySummarize: vi.fn(),
    });

    ticker.start();
    try {
      await ticker.triggerImmediate(channelId);
    } finally {
      await ticker.stop();
    }

    expect(seen).toEqual([
      { agentId: "hana", bodies: ["谁想接一下这个话题？"] },
      { agentId: "yui", bodies: ["谁想接一下这个话题？", "我先接一下。"] },
      { agentId: "ming", bodies: ["谁想接一下这个话题？", "我先接一下。"] },
    ]);
  });

  it("prioritizes mentioned agents while still delivering mention context to other members", async () => {
    tmpDir = mktemp();
    const channelsDir = path.join(tmpDir, "channels");
    const agentsDir = path.join(tmpDir, "agents");
    for (const agentId of ["hana", "yui", "ming"]) {
      const agentDir = path.join(agentsDir, agentId);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "channels.md"), "# 频道\n\n", "utf-8");
    }

    const { id: channelId } = await createChannel(channelsDir, {
      id: "ch_crew",
      name: "Crew",
      members: ["hana", "yui", "ming"],
    });
    const channelFile = path.join(channelsDir, `${channelId}.md`);
    await appendMessage(channelFile, "user", "@Yui 可以先看一下吗？");

    const seen = [];
    const executeCheck = vi.fn(async (agentId, _channelName, _newMessages, _allUpdates, opts) => {
      seen.push({
        agentId,
        mentionedAgents: opts?.mentionedAgents,
        mentionTargeted: opts?.mentionTargeted,
      });
      return { replied: false, passed: true };
    });
    const ticker = createChannelTicker({
      channelsDir,
      agentsDir,
      getAgentOrder: () => ["hana", "yui", "ming"],
      executeCheck,
      onMemorySummarize: vi.fn(),
    });

    ticker.start();
    try {
      await ticker.triggerImmediate(channelId, { mentionedAgents: ["yui"] });
    } finally {
      await ticker.stop();
    }

    expect(seen).toEqual([
      { agentId: "yui", mentionedAgents: ["yui"], mentionTargeted: true },
      { agentId: "hana", mentionedAgents: ["yui"], mentionTargeted: false },
      { agentId: "ming", mentionedAgents: ["yui"], mentionTargeted: false },
    ]);
  });

  it("proactively reminds one random channel member with recent channel truth", async () => {
    tmpDir = mktemp();
    const channelsDir = path.join(tmpDir, "channels");
    const agentsDir = path.join(tmpDir, "agents");
    for (const agentId of ["hana", "yui", "ming"]) {
      const agentDir = path.join(agentsDir, agentId);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "channels.md"), "# 频道\n\n", "utf-8");
    }

    const { id: channelId } = await createChannel(channelsDir, {
      id: "ch_crew",
      name: "Crew",
      members: ["hana", "yui", "ming"],
    });
    const channelFile = path.join(channelsDir, `${channelId}.md`);
    await appendMessage(channelFile, "user", "频道最近的事实");

    const executeCheck = vi.fn(async () => ({ replied: false, passed: true }));
    const ticker = createChannelTicker({
      channelsDir,
      agentsDir,
      getAgentOrder: () => ["hana", "yui", "ming"],
      executeCheck,
      onMemorySummarize: vi.fn(),
      random: () => 0.6,
    });

    ticker.start();
    try {
      await ticker.triggerReminder(channelId);
    } finally {
      await ticker.stop();
    }

    expect(executeCheck).toHaveBeenCalledOnce();
    expect(executeCheck.mock.calls[0][0]).toBe("yui");
    expect(executeCheck.mock.calls[0][1]).toBe(channelId);
    expect(executeCheck.mock.calls[0][2].map((message) => message.body)).toEqual(["频道最近的事实"]);
    expect(executeCheck.mock.calls[0][4]).toMatchObject({ proactive: true });
  });

  it("does not proactively remind channel members when proactive initiation is disabled", async () => {
    tmpDir = mktemp();
    const channelsDir = path.join(tmpDir, "channels");
    const agentsDir = path.join(tmpDir, "agents");
    for (const agentId of ["hana", "yui", "ming"]) {
      const agentDir = path.join(agentsDir, agentId);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "channels.md"), "# 频道\n\n", "utf-8");
    }

    const { id: channelId } = await createChannel(channelsDir, {
      id: "ch_crew",
      name: "Crew",
      members: ["hana", "yui", "ming"],
    });
    const channelFile = path.join(channelsDir, `${channelId}.md`);
    await updateChannelMeta(channelFile, { agentPhoneProactiveEnabled: "false" });
    await appendMessage(channelFile, "user", "频道最近的事实");

    const executeCheck = vi.fn(async () => ({ replied: false, passed: true }));
    const ticker = createChannelTicker({
      channelsDir,
      agentsDir,
      getAgentOrder: () => ["hana", "yui", "ming"],
      executeCheck,
      onMemorySummarize: vi.fn(),
      random: () => 0.6,
    });

    ticker.start();
    try {
      await ticker.triggerReminder(channelId);
    } finally {
      await ticker.stop();
    }

    expect(executeCheck).not.toHaveBeenCalled();
  });

  it("expands proactive reminder into normal delivery when the starter posts", async () => {
    tmpDir = mktemp();
    const channelsDir = path.join(tmpDir, "channels");
    const agentsDir = path.join(tmpDir, "agents");
    for (const agentId of ["hana", "yui", "ming"]) {
      const agentDir = path.join(agentsDir, agentId);
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(agentDir, "channels.md"), "# 频道\n\n", "utf-8");
    }

    const { id: channelId } = await createChannel(channelsDir, {
      id: "ch_crew",
      name: "Crew",
      members: ["hana", "yui", "ming"],
    });
    const channelFile = path.join(channelsDir, `${channelId}.md`);
    await appendMessage(channelFile, "user", "频道最近的事实");

    const seen = [];
    const executeCheck = vi.fn(async (agentId, _channelName, newMessages, _allUpdates, opts) => {
      seen.push({
        agentId,
        proactive: opts?.proactive === true,
        bodies: newMessages.map((message) => message.body),
      });
      if (agentId === "yui" && opts?.proactive) {
        await appendMessage(channelFile, agentId, "我来开个头。");
        return { replied: true, replyContent: "我来开个头。" };
      }
      return { replied: false, passed: true };
    });
    const ticker = createChannelTicker({
      channelsDir,
      agentsDir,
      getAgentOrder: () => ["hana", "yui", "ming"],
      executeCheck,
      onMemorySummarize: vi.fn(),
      random: () => 0.6,
    });

    ticker.start();
    try {
      await ticker.triggerReminder(channelId);
    } finally {
      await ticker.stop();
    }

    expect(seen).toEqual([
      { agentId: "yui", proactive: true, bodies: ["频道最近的事实"] },
      { agentId: "hana", proactive: false, bodies: ["频道最近的事实", "我来开个头。"] },
      { agentId: "ming", proactive: false, bodies: ["频道最近的事实", "我来开个头。"] },
    ]);
  });
});
