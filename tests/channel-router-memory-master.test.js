import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callTextMock, factAddMock, factGetBySessionMock, factDeleteMock } = vi.hoisted(() => ({
  callTextMock: vi.fn(),
  factAddMock: vi.fn(),
  factGetBySessionMock: vi.fn(),
  factDeleteMock: vi.fn(),
}));

vi.mock("../core/llm-client.js", () => ({
  callText: callTextMock,
}));

vi.mock("../lib/memory/fact-store.js", () => ({
  FactStore: vi.fn(function FactStoreMock() {
    this.add = factAddMock;
    this.getBySession = factGetBySessionMock;
    this.delete = factDeleteMock;
    this.close = vi.fn();
  }),
}));

vi.mock("../lib/debug-log.js", () => ({
  debugLog: () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  createModuleLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ChannelRouter } from "../hub/channel-router.js";

let rootDir;

function writeAgentFixture(memoryEnabled) {
  const agentsDir = path.join(rootDir, "agents");
  const agentDir = path.join(agentsDir, "hana");
  const productDir = path.join(rootDir, "product");
  const userDir = path.join(rootDir, "user");
  fs.mkdirSync(path.join(agentDir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(productDir, "yuan"), { recursive: true });
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "config.yaml"),
    [
      "agent:",
      "  name: Hana",
      "  yuan: hanako",
      "memory:",
      `  enabled: ${memoryEnabled ? "true" : "false"}`,
    ].join("\n"),
    "utf-8",
  );
  fs.writeFileSync(path.join(agentDir, "identity.md"), "IDENTITY_FALLBACK_BEACON\n", "utf-8");
  fs.writeFileSync(path.join(agentDir, "ishiki.md"), "ISHIKI_FALLBACK_BEACON\n", "utf-8");
  fs.writeFileSync(path.join(agentDir, "memory", "memory.md"), "MEMORY_FALLBACK_BEACON\n", "utf-8");
  fs.writeFileSync(path.join(productDir, "yuan", "hanako.md"), "YUAN_FALLBACK_BEACON\n", "utf-8");
  fs.writeFileSync(path.join(userDir, "user.md"), "USER_PROFILE_BEACON\n", "utf-8");
  return { agentsDir, productDir, userDir };
}

function writeAgentConfig(agentsDir, agentId, name) {
  const agentDir = path.join(agentsDir, agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "config.yaml"),
    [
      "agent:",
      `  name: ${name}`,
      "memory:",
      "  enabled: true",
    ].join("\n"),
    "utf-8",
  );
}

function makeRouter(paths) {
  return new ChannelRouter({
    hub: {
      engine: {
        agentsDir: paths.agentsDir,
        channelsDir: path.join(rootDir, "channels"),
        productDir: paths.productDir,
        userDir: paths.userDir,
        userName: "黎",
        agents: undefined,
        getAgent: () => null,
        resolveUtilityConfig: () => ({
          utility: "test-model",
          utility_large: "test-model-large",
          api_key: "test-key",
          base_url: "https://test.api",
          api: "openai-completions",
          large_api_key: "test-key",
          large_base_url: "https://test.api",
          large_api: "openai-completions",
        }),
      },
      eventBus: { emit: vi.fn() },
    },
  });
}

describe("ChannelRouter memory master fallback", () => {
  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "channel-memory-master-"));
    callTextMock.mockReset();
    factAddMock.mockReset();
    factGetBySessionMock.mockReset();
    factDeleteMock.mockReset();
    factGetBySessionMock.mockReturnValue([]);
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it("uses config.yaml memory.enabled when summarizing channel memory without a live agent instance", async () => {
    const paths = writeAgentFixture(true);
    const router = makeRouter(paths);
    callTextMock.mockResolvedValue("summary");

    await router._memorySummarize(
      "hana",
      "general",
      "context",
    );

    expect(callTextMock).toHaveBeenCalledOnce();
    expect(factAddMock).toHaveBeenCalledWith(expect.objectContaining({
      fact: "[#general] summary",
      tags: expect.arrayContaining(["general"]),
      session_id: "channel-general",
    }));
  });

  it("skips memory summarization from config.yaml when no live agent instance exists", async () => {
    const paths = writeAgentFixture(false);
    const router = makeRouter(paths);
    callTextMock.mockResolvedValue("summary");

    await router._memorySummarize("hana", "general", "context");

    expect(callTextMock).not.toHaveBeenCalled();
    expect(factAddMock).not.toHaveBeenCalled();
  });

  it("resolves channel sender ids into display names before summarizing memory", async () => {
    const paths = writeAgentFixture(true);
    writeAgentConfig(paths.agentsDir, "butter", "Butter");
    writeAgentConfig(paths.agentsDir, "ming", "Ming");
    const router = makeRouter(paths);
    callTextMock.mockResolvedValue("Butter 提出先清洗摘要；Ming 补充了校验点；Hana 负责整理。");

    await router._memorySummarize("hana", "crew", {
      messages: [
        { sender: "user", timestamp: "2026-05-14 09:59:00", body: "请把摘要洗干净。" },
        { sender: "butter", timestamp: "2026-05-14 10:00:00", body: "先把摘要洗干净。" },
        { sender: "ming", timestamp: "2026-05-14 10:01:00", body: "还要补一个测试。" },
      ],
      replyContent: "我来整理这条链路。",
    });

    const request = callTextMock.mock.calls[0][0];
    expect(request.systemPrompt).toMatch(/谁做了什么|who did what/i);
    expect(request.systemPrompt).toContain("NO_MEMORY");
    expect(request.messages[0].content).toContain("黎: 请把摘要洗干净。");
    expect(request.messages[0].content).toContain("Butter: 先把摘要洗干净。");
    expect(request.messages[0].content).toContain("Ming: 还要补一个测试。");
    expect(request.messages[0].content).toContain("[我的回复] Hana: 我来整理这条链路。");
    expect(request.messages[0].content).not.toContain("user:");
    expect(request.messages[0].content).not.toContain("butter:");
    expect(request.messages[0].content).not.toContain("ming:");
  });

  it("replaces stale channel memory facts instead of accumulating messy summaries", async () => {
    const paths = writeAgentFixture(true);
    const router = makeRouter(paths);
    factGetBySessionMock.mockReturnValue([
      { id: 3, fact: "[#general] butter: 旧摘要里还残留 sender id。" },
      { id: 5, fact: "[#general] 有人说要改摘要，但主语很乱。" },
    ]);
    callTextMock.mockResolvedValue("Hana 确认频道摘要需要按角色行动记录。");

    await router._memorySummarize("hana", "general", {
      messages: [{ sender: "user", timestamp: "2026-05-14 10:00:00", body: "摘要要写角色做了什么。" }],
    });

    const request = callTextMock.mock.calls[0][0];
    expect(request.messages[0].content).toContain("已有频道记忆");
    expect(request.messages[0].content).toContain("butter: 旧摘要里还残留 sender id。");
    expect(factGetBySessionMock).toHaveBeenCalledWith("channel-general");
    expect(factDeleteMock).toHaveBeenCalledWith(3);
    expect(factDeleteMock).toHaveBeenCalledWith(5);
    expect(factAddMock).toHaveBeenCalledWith(expect.objectContaining({
      fact: "[#general] Hana 确认频道摘要需要按角色行动记录。",
      session_id: "channel-general",
    }));
  });

  it("clears stale channel memory facts when the summarizer finds no durable memory", async () => {
    const paths = writeAgentFixture(true);
    const router = makeRouter(paths);
    factGetBySessionMock.mockReturnValue([{ id: 8 }]);
    callTextMock.mockResolvedValue("NO_MEMORY");

    await router._memorySummarize("hana", "general", {
      messages: [{ sender: "user", timestamp: "2026-05-14 10:00:00", body: "嗯" }],
    });

    expect(factDeleteMock).toHaveBeenCalledWith(8);
    expect(factAddMock).not.toHaveBeenCalled();
  });
});
