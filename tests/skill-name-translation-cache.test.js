import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSkillNameTranslationCachePath,
  translateSkillNamesWithCache,
} from "../lib/skills/skill-name-translation-cache.js";

let tempRoot;

function writeSkill(root, name, description) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "SKILL.md");
  fs.writeFileSync(filePath, [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
  ].join("\n"), "utf-8");
  return {
    name,
    description,
    filePath,
    baseDir: dir,
  };
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-skill-translation-cache-"));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("skill name translation cache", () => {
  it("persists translations and reuses them when the skill file has not changed", async () => {
    const cachePath = getSkillNameTranslationCachePath(tempRoot);
    const skill = writeSkill(tempRoot, "literary-craft", "Chinese writing style system.");
    const translateMissing = vi.fn(async (names) => Object.fromEntries(
      names.map((name) => [name, "文笔"]),
    ));

    const first = await translateSkillNamesWithCache({
      cachePath,
      skills: [skill],
      names: ["literary-craft"],
      lang: "zh",
      translateMissing,
    });
    const second = await translateSkillNamesWithCache({
      cachePath,
      skills: [skill],
      names: ["literary-craft"],
      lang: "zh",
      translateMissing,
    });

    expect(first).toEqual({ "literary-craft": "文笔" });
    expect(second).toEqual({ "literary-craft": "文笔" });
    expect(translateMissing).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fs.readFileSync(cachePath, "utf-8")).translations.zh["literary-craft"].text)
      .toBe("文笔");
  });

  it("keeps cold entries after deletion and reuses them when the same named skill returns unchanged", async () => {
    const cachePath = getSkillNameTranslationCachePath(tempRoot);
    const skill = writeSkill(tempRoot, "quiet-musing", "Slow reasoning framework.");
    const translateMissing = vi.fn(async () => ({ "quiet-musing": "静思" }));

    await translateSkillNamesWithCache({
      cachePath,
      skills: [skill],
      names: ["quiet-musing"],
      lang: "zh",
      translateMissing,
    });

    fs.rmSync(skill.baseDir, { recursive: true, force: true });
    const reinstalled = writeSkill(tempRoot, "quiet-musing", "Slow reasoning framework.");

    const result = await translateSkillNamesWithCache({
      cachePath,
      skills: [reinstalled],
      names: ["quiet-musing"],
      lang: "zh",
      translateMissing,
    });

    expect(result).toEqual({ "quiet-musing": "静思" });
    expect(translateMissing).toHaveBeenCalledTimes(1);
  });

  it("retranslates a same named skill when SKILL.md changes", async () => {
    const cachePath = getSkillNameTranslationCachePath(tempRoot);
    const skill = writeSkill(tempRoot, "user-guide", "User manual.");
    const translateMissing = vi.fn()
      .mockResolvedValueOnce({ "user-guide": "指南" })
      .mockResolvedValueOnce({ "user-guide": "教程" });

    await translateSkillNamesWithCache({
      cachePath,
      skills: [skill],
      names: ["user-guide"],
      lang: "zh",
      translateMissing,
    });

    fs.writeFileSync(skill.filePath, [
      "---",
      "name: user-guide",
      "description: Hands-on tutorial.",
      "---",
      "",
    ].join("\n"), "utf-8");

    const result = await translateSkillNamesWithCache({
      cachePath,
      skills: [skill],
      names: ["user-guide"],
      lang: "zh",
      translateMissing,
    });

    expect(result).toEqual({ "user-guide": "教程" });
    expect(translateMissing).toHaveBeenCalledTimes(2);
  });
});
