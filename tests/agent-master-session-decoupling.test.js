/**
 * 验证 master 与 per-session 开关在 agent.systemPrompt 缓存上的解耦契约。
 *
 * 设计原则（用户口径）：
 *  - master 开关（设置页中的「记忆」总闸）才控制非 session 路径
 *    （巡检/cron/频道/DM/bridge owner 新建快照）是否带记忆
 *  - per-session 开关只管"该 session 自己的对话窗口"，不应该污染所有
 *    非 session 路径共享的全局 prompt cache
 *
 * 这条契约破了的话，用户在某个对话里关掉记忆开关会让巡检也跟着不带记忆。
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/memory/memory-ticker.js", () => ({
  createMemoryTicker: () => ({
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    tick: vi.fn().mockResolvedValue(undefined),
    triggerNow: vi.fn(),
    notifyTurn: vi.fn(),
    notifySessionEnd: vi.fn().mockResolvedValue(undefined),
    notifyPromoted: vi.fn().mockResolvedValue(undefined),
    flushSession: vi.fn().mockResolvedValue(undefined),
    getHealthStatus: vi.fn().mockReturnValue({}),
    isAutomaticEnabled: vi.fn().mockReturnValue(false),
  }),
}));

import { Agent } from "../core/agent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function bootstrapAgentDir(rootDir) {
  const agentsDir = path.join(rootDir, "agents");
  const agentDir = path.join(agentsDir, "test-agent");
  fs.mkdirSync(path.join(agentDir, "memory", "summaries"), { recursive: true });
  fs.mkdirSync(path.join(agentDir, "desk"), { recursive: true });
  fs.mkdirSync(path.join(agentDir, "sessions"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "user"), { recursive: true });

  fs.writeFileSync(
    path.join(agentDir, "config.yaml"),
    [
      "agent:",
      "  name: TestAgent",
      "  yuan: hanako",
      "user:",
      "  name: Tester",
      "locale: en",
      "memory:",
      "  enabled: true",
      "models:",
      "  chat:",
      "    id: gpt-4",
      "    provider: openai",
      "promptComposer:",
      "  enabled: true",
      "  mode: simple",
      '  simpleContent: "{{pinnedMemory}}"',
    ].join("\n"),
    "utf-8",
  );
  fs.writeFileSync(path.join(agentDir, "identity.md"), "I am the test agent.\n", "utf-8");
  fs.writeFileSync(path.join(agentDir, "ishiki.md"), "ishiki body\n", "utf-8");
  fs.writeFileSync(path.join(agentDir, "pinned.md"), "PINNED_MEMORY_BEACON\n", "utf-8");
  fs.writeFileSync(path.join(agentDir, "memory", "memory.md"), "MEMORY_MD_BEACON\n", "utf-8");
  fs.writeFileSync(path.join(rootDir, "user", "user.md"), "user profile\n", "utf-8");
  return { agentDir, agentsDir };
}

function makeAgent(agentsDir, rootDir) {
  return new Agent({
    id: "test-agent",
    agentsDir,
    userDir: path.join(rootDir, "user"),
    productDir: path.resolve(__dirname, "..", "lib"),
  });
}

describe("agent.systemPrompt: master / per-session 解耦", () => {
  let tmpDir;
  let agentsDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-master-decouple-"));
    ({ agentsDir } = bootstrapAgentDir(tmpDir));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("setMemoryEnabled(false) 不修改 agent.systemPrompt 缓存（per-session 不污染全局）", async () => {
    const agent = makeAgent(agentsDir, tmpDir);
    await agent.init(() => {});
    const before = agent.systemPrompt;
    expect(before).not.toContain("MEMORY_MD_BEACON");
    expect(before).toContain("PINNED_MEMORY_BEACON");

    agent.setMemoryEnabled(false);
    expect(agent.sessionMemoryEnabled).toBe(false);
    // 关键：setMemoryEnabled 不应该重建 _systemPrompt
    expect(agent.systemPrompt).toBe(before);
    expect(agent.systemPrompt).toContain("PINNED_MEMORY_BEACON");

    await agent.dispose();
  });

  it("setMemoryMasterEnabled(false) 让 systemPrompt 反映「不带记忆」", async () => {
    const agent = makeAgent(agentsDir, tmpDir);
    await agent.init(() => {});
    expect(agent.systemPrompt).not.toContain("MEMORY_MD_BEACON");
    expect(agent.systemPrompt).toContain("PINNED_MEMORY_BEACON");

    agent.setMemoryMasterEnabled(false);
    expect(agent.memoryMasterEnabled).toBe(false);
    expect(agent.systemPrompt).not.toContain("MEMORY_MD_BEACON");
    expect(agent.systemPrompt).not.toContain("PINNED_MEMORY_BEACON");

    agent.setMemoryMasterEnabled(true);
    expect(agent.systemPrompt).not.toContain("MEMORY_MD_BEACON");
    expect(agent.systemPrompt).toContain("PINNED_MEMORY_BEACON");

    await agent.dispose();
  });

  it("master 开着、session 关着时，agent.systemPrompt 仍按 master 带记忆（巡检/cron 不被 session 污染）", async () => {
    const agent = makeAgent(agentsDir, tmpDir);
    await agent.init(() => {});

    agent.setMemoryEnabled(false); // session 关
    expect(agent.memoryMasterEnabled).toBe(true);
    expect(agent.sessionMemoryEnabled).toBe(false);

    // 这是核心：非 session 路径拿的就是 systemPrompt cache
    expect(agent.systemPrompt).not.toContain("MEMORY_MD_BEACON");
    expect(agent.systemPrompt).toContain("PINNED_MEMORY_BEACON");

    await agent.dispose();
  });

  it("session 路径仍能用 buildSystemPrompt({ forceMemoryEnabled }) 自己构建带/不带记忆的快照", async () => {
    const agent = makeAgent(agentsDir, tmpDir);
    await agent.init(() => {});

    const onSnapshot = agent.buildSystemPrompt({ forceMemoryEnabled: true });
    const offSnapshot = agent.buildSystemPrompt({ forceMemoryEnabled: false });

    expect(onSnapshot).not.toContain("MEMORY_MD_BEACON");
    expect(onSnapshot).toContain("PINNED_MEMORY_BEACON");
    expect(offSnapshot).not.toContain("MEMORY_MD_BEACON");
    expect(offSnapshot).not.toContain("PINNED_MEMORY_BEACON");

    await agent.dispose();
  });

  it("does not inject compiled memory into system prompt", async () => {
    const agent = makeAgent(agentsDir, tmpDir);
    fs.writeFileSync(
      path.join(agent.agentDir, "memory", "memory.md"),
      [
        "## Key facts",
        "",
        "NON_PINNED_MEMORY_BEACON",
        "",
        "## Today",
        "",
        "- 今天的非置顶记忆",
        "",
        "## Earlier this week",
        "",
        "- 本周的非置顶记忆",
        "",
        "## Long-term context",
        "",
        "- 长期的非置顶记忆",
        "",
      ].join("\n"),
      "utf-8",
    );

    await agent.init(() => {});

    expect(agent.systemPrompt).toContain("PINNED_MEMORY_BEACON");
    expect(agent.systemPrompt).not.toContain("NON_PINNED_MEMORY_BEACON");
    expect(agent.systemPrompt).not.toContain("The following are memories accumulated from past conversations.");
    expect(agent.systemPrompt).not.toContain("## Key facts");
    expect(agent.systemPrompt).not.toContain("## Today");
    expect(agent.systemPrompt).not.toContain("## Earlier this week");
    expect(agent.systemPrompt).not.toContain("## Long-term context");

    await agent.dispose();
  });

  it("workspace 模板变量展开为 cwd 上下文", async () => {
    const agent = makeAgent(agentsDir, tmpDir);
    await agent.init(() => {});
    agent._config.locale = "zh-CN";

    const prompt = agent.buildSystemPrompt({
      forceMemoryEnabled: false,
      cwdOverride: "/workspace/Desktop/project-hana",
      promptComposer: {
        enabled: true,
        mode: "simple",
        simpleContent: "{{workspace}}",
      },
    });

    expect(prompt).toContain("当前工作目录：/workspace/Desktop/project-hana");
    expect(prompt).toContain("用户提到的文件、目录默认在当前工作目录下查找。");
    expect(prompt).not.toContain("## 工作空间");
    expect(prompt).not.toContain("## 书桌");
    expect(prompt).not.toContain("系统桌面");

    await agent.dispose();
  });

  it("mood 模板变量只在显式引用时进入 system prompt", async () => {
    const agent = makeAgent(agentsDir, tmpDir);
    await agent.init(() => {});

    expect(agent.systemPrompt).not.toContain("<mood>");

    const prompt = agent.buildSystemPrompt({
      promptComposer: {
        enabled: true,
        mode: "simple",
        simpleContent: "{{mood}}",
      },
    });

    expect(prompt).toContain("MOOD");
    expect(prompt).toContain("<mood>");
    expect(prompt).toContain("Vibe:");
    expect(prompt).toContain("Sparks:");

    await agent.dispose();
  });

  it("Computer Use 开启时，system prompt 引导桌面应用控制不要绕去 shell", async () => {
    const agent = makeAgent(agentsDir, tmpDir);
    agent.setCallbacks({
      getEngine: () => ({
        getComputerUseSettings: () => ({ enabled: true }),
        getPrimaryAgentId: () => "test-agent",
      }),
      getLearnSkills: () => ({}),
      isChannelsEnabled: () => false,
    });
    await agent.init(() => {});

    const prompt = agent.buildSystemPrompt({ forceMemoryEnabled: false, promptComposer: { enabled: true, mode: "blocks" } });

    expect(prompt).toContain("Desktop App Control");
    expect(prompt).toContain("computer");
    expect(prompt).toContain("AppleScript");
    expect(prompt).toContain("osascript");

    await agent.dispose();
  });

  it("Computer Use 在不支持的平台上不进入工具快照和 system prompt", async () => {
    const agent = makeAgent(agentsDir, tmpDir);
    agent.setCallbacks({
      getEngine: () => ({
        getComputerUseSettings: () => ({ enabled: true }),
        getPrimaryAgentId: () => "test-agent",
        isComputerUseSupported: () => false,
      }),
      getLearnSkills: () => ({}),
      isChannelsEnabled: () => false,
    });
    await agent.init(() => {});

    const toolNames = agent.getToolsSnapshot({ forceMemoryEnabled: false }).map((tool) => tool.name);
    const prompt = agent.buildSystemPrompt({ forceMemoryEnabled: false, promptComposer: { enabled: true, mode: "blocks" } });

    expect(toolNames).not.toContain("computer");
    expect(prompt).not.toContain("Desktop App Control");

    await agent.dispose();
  });
});
