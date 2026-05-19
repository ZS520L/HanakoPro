import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCharacterCardService } from "../lib/character-cards/service.js";
import { createCharacterCardsRoute } from "../server/routes/character-cards.js";
import { extractZip } from "../lib/extract-zip.js";
import { writeCompiledMemorySnapshot } from "../lib/memory/compiled-memory-snapshot.js";

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function writeSkill(root, relativeDir, name, body = "# Skill\n") {
  const dir = path.join(root, relativeDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n${body}`, "utf-8");
  return dir;
}

function expectAppEvent(emitEvent, type, payload) {
  expect(emitEvent).toHaveBeenCalledWith({
    type: "app_event",
    event: {
      type,
      payload,
      source: "server",
    },
  }, null);
}

describe("character-card import service", () => {
  let tempDir;
  let packageDir;
  let skillsDir;
  let agentsDir;
  let factStore;
  let engine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-character-card-"));
    packageDir = path.join(tempDir, "package");
    skillsDir = path.join(tempDir, "skills");
    agentsDir = path.join(tempDir, "agents");
    fs.mkdirSync(packageDir, { recursive: true });
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });

    factStore = { importAll: vi.fn() };
    engine = {
      hanakoHome: tempDir,
      agentsDir,
      userSkillsDir: skillsDir,
      skillsDir,
      cwd: tempDir,
      reloadSkills: vi.fn().mockResolvedValue(undefined),
      createAgent: vi.fn(async ({ id, name, initialMemory }) => {
        const agentDir = path.join(agentsDir, id);
        fs.mkdirSync(path.join(agentDir, "memory"), { recursive: true });
        if (initialMemory?.compiled) {
          writeCompiledMemorySnapshot(path.join(agentDir, "memory"), initialMemory.compiled, {
            sourceId: initialMemory.sourceId,
            sourcePackage: initialMemory.sourcePackage,
          });
        }
        return { id, name };
      }),
      getAgent: vi.fn(() => ({ factStore })),
      getAllSkills: vi.fn(() => []),
      invalidateAgentListCache: vi.fn(),
      emitEvent: vi.fn(),
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a suffixed public skill copy when a packaged skill name already exists", async () => {
    writeSkill(skillsDir, "code-writer", "code-writer", "existing");
    writeSkill(packageDir, "skills/code-writer", "code-writer", "imported");
    writeJson(path.join(packageDir, "card.json"), {
      kind: "CharacterCard",
      agent: { name: "Ming", id: "明", yuan: "ming" },
      skills: {
        bundles: [
          { name: "Coding Bundle", skills: [{ path: "skills/code-writer" }] },
        ],
      },
    });

    const service = createCharacterCardService(engine);
    const plan = await service.createImportPlanFromPath(packageDir);
    expect(plan.assets).toMatchObject({
      avatar: true,
      cardFront: true,
      cardBack: true,
      yuanIcon: true,
    });
    const result = await service.commitImportPlan(plan.token, { importMemory: false });

    expect(result.agent).toEqual({ id: "明", name: "Ming" });
    expect(fs.readFileSync(path.join(skillsDir, "code-writer", "SKILL.md"), "utf-8")).toContain("existing");

    const importedName = result.installedSkills[0].name;
    expect(importedName).toMatch(/^code-writer-[a-z0-9]{6}$/);
    expect(fs.existsSync(path.join(skillsDir, importedName, "SKILL.md"))).toBe(true);
    expect(fs.readFileSync(path.join(skillsDir, importedName, "SKILL.md"), "utf-8"))
      .toContain(`name: ${importedName}`);
    expect(engine.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      name: "Ming",
      id: "明",
      yuan: "ming",
      enabledSkills: [importedName],
    }));
    expect(engine.reloadSkills).toHaveBeenCalledTimes(1);

    const bundleStore = JSON.parse(fs.readFileSync(path.join(tempDir, "skill-bundles.json"), "utf-8"));
    expect(bundleStore.bundles).toHaveLength(1);
    expect(bundleStore.bundles[0]).toMatchObject({
      name: "Coding Bundle",
      source: "character-card-import",
      agentId: "明",
      skillNames: [importedName],
    });
  });

  it("does not create skill bundle metadata for character cards without skills", async () => {
    writeJson(path.join(packageDir, "card.json"), {
      kind: "CharacterCard",
      agent: { name: "No Skill Hana", id: "no-skill-hana", yuan: "hanako" },
    });

    const service = createCharacterCardService(engine);
    const plan = await service.createImportPlanFromPath(packageDir);
    expect(plan.memory.preview).toBe("无记忆");
    const result = await service.commitImportPlan(plan.token, {});

    expect(result.installedSkills).toEqual([]);
    expect(fs.existsSync(path.join(tempDir, "skill-bundles.json"))).toBe(false);
  });

  it("imports memory facts only when the commit option enables memory import", async () => {
    writeJson(path.join(packageDir, "card.json"), {
      kind: "CharacterCard",
      agent: { name: "Hana Writer", id: "hana-writer", yuan: "hanako" },
      memory: {
        facts: [
          { fact: "喜欢把章节标题写得短一点", tags: ["writing"], time: "2026-05-14" },
        ],
      },
    });

    const service = createCharacterCardService(engine);
    const plan = await service.createImportPlanFromPath(packageDir);

    await service.commitImportPlan(plan.token, { importMemory: false });
    expect(factStore.importAll).not.toHaveBeenCalled();

    const secondPlan = await service.createImportPlanFromPath(packageDir);
    await service.commitImportPlan(secondPlan.token, { importMemory: true });
    expect(factStore.importAll).toHaveBeenCalledWith([
      {
        fact: "喜欢把章节标题写得短一点",
        tags: ["writing"],
        time: "2026-05-14",
        session_id: "character-card-import",
      },
    ]);
  });

  it("imports packaged compiled memory before agent init can run memory tick", async () => {
    writeJson(path.join(packageDir, "card.json"), {
      kind: "CharacterCard",
      agent: { name: "Today Hana", id: "today-hana", yuan: "hanako" },
      memory: {
        compiled: {
          facts: "用户喜欢短句。",
          today: "今天正在调试角色卡记忆预览。",
          week: "这周在推进角色卡导入导出。",
          longterm: "用户长期关注 Project Hana 的记忆系统。",
        },
      },
    });

    const service = createCharacterCardService(engine);
    const plan = await service.createImportPlanFromPath(packageDir);

    expect(plan.memory).toEqual({
      available: true,
      count: 4,
      preview: "用户喜欢短句。",
      compiled: {
        facts: "用户喜欢短句。",
        today: "今天正在调试角色卡记忆预览。",
        week: "这周在推进角色卡导入导出。",
        longterm: "用户长期关注 Project Hana 的记忆系统。",
      },
    });

    const result = await service.commitImportPlan(plan.token, { importMemory: true });
    const memoryDir = path.join(agentsDir, result.agent.id, "memory");
    const seed = JSON.parse(fs.readFileSync(path.join(memoryDir, "summaries", `character-card-import-${plan.token}.json`), "utf-8"));

    expect(result.importedMemory).toBe(0);
    expect(result.importedCompiledMemory).toBe(true);
    expect(seed.snapshot).toBe(seed.summary);
    expect(seed.summary).toContain("### 重要事实");
    expect(seed.summary).toContain("#### 本周早些时候");
    expect(fs.readFileSync(path.join(memoryDir, "facts.md"), "utf-8")).toBe("用户喜欢短句。");
    expect(fs.readFileSync(path.join(memoryDir, "today.md"), "utf-8")).toBe("今天正在调试角色卡记忆预览。");
    expect(fs.readFileSync(path.join(memoryDir, "week.md"), "utf-8")).toBe("这周在推进角色卡导入导出。");
    expect(fs.readFileSync(path.join(memoryDir, "longterm.md"), "utf-8")).toBe("用户长期关注 Project Hana 的记忆系统。");
    expect(fs.readFileSync(path.join(memoryDir, "memory.md"), "utf-8")).toContain("今天正在调试角色卡记忆预览。");
  });

  it("shows a 20 character important-facts memory preview in preview plans", async () => {
    writeJson(path.join(packageDir, "card.json"), {
      kind: "CharacterCard",
      agent: { name: "Memory Hana", id: "memory-hana", yuan: "hanako" },
      memory: {
        compiled: {
          facts: "重要事实内容用于角色卡预览摘要，应该优先于今天记忆显示。",
          today: "今天围绕角色卡预览做了视觉和导入边界确认，需要继续打磨细节。",
        },
        facts: [
          { fact: "这是一个很长的记忆内容用来测试角色卡预览省略显示", tags: ["preview"] },
        ],
      },
    });

    const service = createCharacterCardService(engine);
    const plan = await service.createImportPlanFromPath(packageDir);

    expect(plan.memory).toEqual({
      available: true,
      count: 3,
      preview: "重要事实内容用于角色卡预览摘要，应该优先...",
      compiled: {
        facts: "重要事实内容用于角色卡预览摘要，应该优先于今天记忆显示。",
        today: "今天围绕角色卡预览做了视觉和导入边界确认，需要继续打磨细节。",
        week: "",
        longterm: "",
      },
    });
  });

  it("exposes identity and ishiki text in preview plans without exposing the local agent id", async () => {
    writeJson(path.join(packageDir, "card.json"), {
      kind: "CharacterCard",
      agent: {
        name: "Ishiki Hana",
        id: "local-only-id",
        yuan: "hanako",
        description: "花名册里的描述",
      },
      identity: { summary: "沉静的手账写作者", content: "Identity full text" },
      prompts: {
        identity: "Identity prompt text",
        ishiki: "Ishiki prompt text",
        publicIshiki: "Public ishiki text",
      },
    });

    const service = createCharacterCardService(engine);
    const plan = await service.createImportPlanFromPath(packageDir);

    expect(plan.agent).toEqual({
      name: "Ishiki Hana",
      yuan: "hanako",
      description: "花名册里的描述",
      identitySummary: "沉静的手账写作者",
    });
    expect(plan.prompts).toEqual({
      identity: "Identity prompt text",
      ishiki: "Ishiki prompt text",
      publicIshiki: "Public ishiki text",
    });
  });

  it("imports the same character card twice by allocating a new agent id", async () => {
    writeJson(path.join(packageDir, "card.json"), {
      kind: "CharacterCard",
      agent: { name: "Ming", id: "ming", yuan: "ming" },
    });

    const service = createCharacterCardService(engine);
    const firstPlan = await service.createImportPlanFromPath(packageDir);
    const first = await service.commitImportPlan(firstPlan.token, {});
    const secondPlan = await service.createImportPlanFromPath(packageDir);
    const second = await service.commitImportPlan(secondPlan.token, {});

    expect(first.agent).toEqual({ id: "ming", name: "Ming" });
    expect(second.agent.id).toMatch(/^ming-[a-f0-9]{6}$/);
    expect(second.agent.name).toBe("Ming");
  });

  it("plans and commits through the route, then emits agent and skill events", async () => {
    writeSkill(packageDir, "skills/research", "research");
    writeJson(path.join(packageDir, "card.json"), {
      kind: "CharacterCard",
      agent: { name: "Research Hana", id: "research-hana", yuan: "hanako" },
      skills: [{ path: "skills/research" }],
    });

    const app = new Hono();
    app.route("/api", createCharacterCardsRoute(engine));

    const planRes = await app.request("/api/character-cards/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: packageDir }),
    });
    const planData = await planRes.json();
    expect(planRes.status).toBe(200);
    expect(planData.plan).toMatchObject({
      packageName: "package",
      agent: { name: "Research Hana", yuan: "hanako" },
      skills: { count: 1 },
    });
    expect(planData.plan.agent.id).toBeUndefined();

    const importRes = await app.request("/api/character-cards/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: planData.plan.token }),
    });
    const importData = await importRes.json();
    expect(importRes.status).toBe(200);
    expect(importData.agent).toEqual({ id: "research-hana", name: "Research Hana" });
    expectAppEvent(engine.emitEvent, "agent-created", { agentId: "research-hana", name: "Research Hana" });
    expectAppEvent(engine.emitEvent, "skills-changed", { agentId: "research-hana" });
  });

  it("exports the selected agent as a card package with enabled skills and optional memory", async () => {
    const agentDir = path.join(agentsDir, "hana");
    fs.mkdirSync(path.join(agentDir, "memory"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "config.yaml"), [
      "agent:",
      "  name: Hana",
      "  yuan: hanako",
      "skills:",
      "  enabled:",
      "    - writer",
    ].join("\n"), "utf-8");
    fs.writeFileSync(path.join(agentDir, "identity.md"), "Writer identity", "utf-8");
    fs.writeFileSync(path.join(agentDir, "ishiki.md"), "Writer ishiki", "utf-8");
    fs.writeFileSync(path.join(agentDir, "public-ishiki.md"), "Public writer", "utf-8");
    fs.writeFileSync(path.join(agentDir, "description.md"), "<!-- sourceHash: abc -->\n<mood>\nVibe: 平静专注\n</mood>\n花名册描述", "utf-8");
    fs.writeFileSync(path.join(agentDir, "memory", "facts.md"), "用户喜欢短句。", "utf-8");
    fs.writeFileSync(path.join(agentDir, "memory", "today.md"), "今天写好了角色卡导出预览和技能包结构。", "utf-8");
    fs.writeFileSync(path.join(agentDir, "memory", "week.md"), "本周持续推进角色卡和 Skill Bundle。", "utf-8");
    fs.writeFileSync(path.join(agentDir, "memory", "longterm.md"), "用户长期关注本地优先的 Agent 迁移体验。", "utf-8");
    writeSkill(skillsDir, "writer", "writer", "exported skill");
    const exportFactStore = {
      exportAll: vi.fn(() => [
        { fact: "喜欢短句", tags: ["writing"], time: "2026-05-14", session_id: "s1" },
      ]),
    };
    engine.getAgent = vi.fn((id) => id === "hana"
      ? { id: "hana", agentDir, factStore: exportFactStore }
      : null);
    engine.getAllSkills = vi.fn(() => [
      {
        name: "writer",
        enabled: true,
        baseDir: path.join(skillsDir, "writer"),
        filePath: path.join(skillsDir, "writer", "SKILL.md"),
        source: "user",
      },
      {
        name: "reader",
        enabled: false,
        baseDir: path.join(skillsDir, "reader"),
        filePath: path.join(skillsDir, "reader", "SKILL.md"),
        source: "user",
      },
    ]);

    const service = createCharacterCardService(engine);
    const preview = await service.createExportPreview("hana");
    expect(preview).toMatchObject({
      mode: "export",
      agentId: "hana",
      packageName: "hana-charactercard.zip",
      agent: { name: "Hana", yuan: "hanako", description: "花名册描述" },
      memory: {
        available: true,
        count: 5,
        preview: "用户喜欢短句。",
        compiled: {
          facts: "用户喜欢短句。",
          today: "今天写好了角色卡导出预览和技能包结构。",
          week: "本周持续推进角色卡和 Skill Bundle。",
          longterm: "用户长期关注本地优先的 Agent 迁移体验。",
        },
      },
      skills: { count: 1 },
      assets: { avatar: true, cardBack: true },
    });
    expect(preview.token).toBeUndefined();
    expect(fs.existsSync(path.join(tempDir, ".ephemeral", "character-card-imports"))).toBe(false);

    fs.writeFileSync(path.join(agentDir, "memory", "today.md"), "今天导出前更新过。", "utf-8");

    const exported = await service.exportAgentPackage("hana", {
      exportMemory: true,
      targetDir: tempDir,
    });
    expect(exported.filePath).toBe(path.join(tempDir, "hana-charactercard.zip"));
    expect(fs.existsSync(exported.filePath)).toBe(true);
    const secondExport = await service.exportAgentPackage("hana", {
      exportMemory: false,
      targetDir: tempDir,
    });
    expect(secondExport.filePath).toBe(path.join(tempDir, "hana-charactercard-2.zip"));

    const outDir = path.join(tempDir, "unzipped-export");
    fs.mkdirSync(outDir);
    await extractZip(exported.filePath, outDir);
    const card = JSON.parse(fs.readFileSync(path.join(outDir, "card.json"), "utf-8"));
    expect(card.agent).toEqual({ name: "Hana", yuan: "hanako", description: "花名册描述" });
    expect(card.prompts).toMatchObject({
      identity: "Writer identity",
      ishiki: "Writer ishiki",
      publicIshiki: "Public writer",
    });
    expect(card.memory.facts).toEqual([
      { fact: "喜欢短句", tags: ["writing"], time: "2026-05-14", session_id: "s1" },
    ]);
    expect(card.memory.compiled).toEqual({
      facts: "用户喜欢短句。",
      today: "今天导出前更新过。",
      week: "本周持续推进角色卡和 Skill Bundle。",
      longterm: "用户长期关注本地优先的 Agent 迁移体验。",
    });
    expect(card.skills.bundles[0].skills).toEqual([{ name: "writer", path: "skills/writer" }]);
    expect(fs.readFileSync(path.join(outDir, "skills/writer/SKILL.md"), "utf-8")).toContain("exported skill");
    expect(fs.existsSync(path.join(outDir, "assets/avatar.png"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "assets/card-back.png"))).toBe(true);
  });

  it("defaults export output to the assistant desk directory and avoids overwriting existing cards", async () => {
    const agentDir = path.join(agentsDir, "hana");
    const deskDir = path.join(tempDir, "assistant-desk");
    const processDir = path.join(tempDir, "process-cwd");
    fs.mkdirSync(path.join(agentDir, "memory"), { recursive: true });
    fs.mkdirSync(deskDir, { recursive: true });
    fs.mkdirSync(processDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "config.yaml"), [
      "agent:",
      "  name: Hana",
      "  yuan: hanako",
    ].join("\n"), "utf-8");
    fs.writeFileSync(path.join(agentDir, "identity.md"), "Writer identity", "utf-8");
    fs.writeFileSync(path.join(deskDir, "hana-charactercard.zip"), "existing", "utf-8");
    engine.cwd = processDir;
    engine.deskCwd = deskDir;
    engine.getAgent = vi.fn((id) => id === "hana"
      ? { id: "hana", agentDir, factStore: { exportAll: vi.fn(() => []) } }
      : null);

    const service = createCharacterCardService(engine);
    const exported = await service.exportAgentPackage("hana");

    expect(exported.filePath).toBe(path.join(deskDir, "hana-charactercard-2.zip"));
    expect(fs.existsSync(path.join(processDir, "hana-charactercard.zip"))).toBe(false);
  });

  it("exports compiled memory from memory.md when section files are missing", async () => {
    const agentDir = path.join(agentsDir, "hana");
    fs.mkdirSync(path.join(agentDir, "memory"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "config.yaml"), [
      "agent:",
      "  name: Hana",
      "  yuan: hanako",
    ].join("\n"), "utf-8");
    fs.writeFileSync(path.join(agentDir, "identity.md"), "Writer identity", "utf-8");
    fs.writeFileSync(path.join(agentDir, "memory", "memory.md"), [
      "## 重要事实",
      "",
      "用户喜欢短句。",
      "",
      "## 今天",
      "",
      "（暂无）",
      "",
      "## 本周早些时候",
      "",
      "本周持续推进角色卡。",
      "",
      "## 长期情况",
      "",
      "用户长期关注本地优先的 Agent 迁移体验。",
      "",
    ].join("\n"), "utf-8");
    engine.getAgent = vi.fn((id) => id === "hana"
      ? { id: "hana", agentDir, factStore: { exportAll: vi.fn(() => []) } }
      : null);
    engine.getAllSkills = vi.fn(() => []);

    const service = createCharacterCardService(engine);
    const plan = await service.createExportPreview("hana");

    expect(plan.memory).toEqual({
      available: true,
      count: 3,
      preview: "用户喜欢短句。",
      compiled: {
        facts: "用户喜欢短句。",
        today: "",
        week: "本周持续推进角色卡。",
        longterm: "用户长期关注本地优先的 Agent 迁移体验。",
      },
    });
  });

  it("omits the skills section from exported packages when the agent has no enabled exportable skills", async () => {
    const agentDir = path.join(agentsDir, "quiet");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, "config.yaml"), [
      "agent:",
      "  name: Quiet",
      "  yuan: ming",
      "skills:",
      "  enabled: []",
    ].join("\n"), "utf-8");
    engine.getAgent = vi.fn((id) => id === "quiet"
      ? { id: "quiet", agentDir, factStore: { exportAll: vi.fn(() => []) } }
      : null);
    engine.getAllSkills = vi.fn(() => []);

    const service = createCharacterCardService(engine);
    const plan = await service.createExportPreview("quiet");
    expect(plan.skills).toEqual({ count: 0, bundles: [] });

    const exported = await service.exportAgentPackage("quiet", {
      exportMemory: false,
      targetDir: tempDir,
    });
    const outDir = path.join(tempDir, "unzipped-export-empty-skills");
    fs.mkdirSync(outDir);
    await extractZip(exported.filePath, outDir);
    const card = JSON.parse(fs.readFileSync(path.join(outDir, "card.json"), "utf-8"));

    expect(card.skills).toBeUndefined();
    expect(fs.existsSync(path.join(outDir, "skills"))).toBe(false);
  });

  it("exports through the route by rereading the live agent instead of a preview token", async () => {
    const agentDir = path.join(agentsDir, "hana");
    fs.mkdirSync(path.join(agentDir, "memory"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "config.yaml"), [
      "agent:",
      "  name: Hana",
      "  yuan: hanako",
    ].join("\n"), "utf-8");
    fs.writeFileSync(path.join(agentDir, "identity.md"), "Writer identity", "utf-8");
    engine.getAgent = vi.fn((id) => id === "hana"
      ? { id: "hana", agentDir, factStore: { exportAll: vi.fn(() => []) } }
      : null);
    engine.getAllSkills = vi.fn(() => []);

    const app = new Hono();
    app.route("/api", createCharacterCardsRoute(engine));

    const previewRes = await app.request("/api/character-cards/export/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "hana" }),
    });
    const previewData = await previewRes.json();
    expect(previewRes.status).toBe(200);
    expect(previewData.plan.token).toBeUndefined();
    expect(previewData.plan.memory.available).toBe(false);

    fs.writeFileSync(path.join(agentDir, "memory", "facts.md"), "用户在确认导出链路。", "utf-8");

    const exportRes = await app.request("/api/character-cards/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "hana", exportMemory: true }),
    });
    const exportData = await exportRes.json();
    expect(exportRes.status).toBe(200);
    expect(exportData.filePath).toBe(path.join(tempDir, "hana-charactercard.zip"));

    const outDir = path.join(tempDir, "unzipped-route-export");
    fs.mkdirSync(outDir);
    await extractZip(exportData.filePath, outDir);
    const card = JSON.parse(fs.readFileSync(path.join(outDir, "card.json"), "utf-8"));
    expect(card.memory.compiled).toEqual({ facts: "用户在确认导出链路。" });
  });
});
