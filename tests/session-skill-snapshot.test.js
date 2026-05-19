import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveSessionSkillsForRuntime,
  snapshotSkillsForSession,
} from "../lib/skills/session-skill-snapshot.js";

describe("session skill snapshot identity", () => {
  let tmpDir = null;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  function makeTempRoot() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-skill-snapshot-"));
    return tmpDir;
  }

  it("stores runtime skill pointers without copying the source directory", async () => {
    const root = makeTempRoot();
    const sessionPath = path.join(root, "agents", "hana", "sessions", "main.jsonl");
    const sourceBaseDir = path.join(root, "workspace", ".agents", "skills", "demo-skill");
    const sourceFilePath = path.join(sourceBaseDir, "SKILL.md");
    const sourceAssetPath = path.join(sourceBaseDir, "assets", "note.txt");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.mkdirSync(path.dirname(sourceAssetPath), { recursive: true });
    fs.writeFileSync(sessionPath, "{}\n", "utf-8");
    fs.writeFileSync(sourceFilePath, "---\nname: demo-skill\n---\n# Demo\n", "utf-8");
    fs.writeFileSync(sourceAssetPath, "asset\n", "utf-8");

    const result = await snapshotSkillsForSession({
      skills: [{
        name: "demo-skill",
        description: "Demo skill.",
        filePath: sourceFilePath,
        baseDir: sourceBaseDir,
        source: "external",
        _workspaceSkill: true,
      }],
      diagnostics: [],
    }, sessionPath);

    const snapshotSkill = result.skills[0];
    expect(snapshotSkill.filePath).toBe(sourceFilePath);
    expect(snapshotSkill.baseDir).toBe(sourceBaseDir);
    expect(snapshotSkill.runtimeIdentity).toMatchObject({
      kind: "skill_pointer",
      filePath: sourceFilePath,
      baseDir: sourceBaseDir,
      readonly: true,
    });
    expect(snapshotSkill.sourceIdentity).toEqual({
      kind: "skill_source",
      owner: "workspace",
      skillName: "demo-skill",
      filePath: sourceFilePath,
      baseDir: sourceBaseDir,
      editable: true,
      readonly: false,
    });

    expect(fs.existsSync(path.join(path.dirname(sessionPath), ".skill-snapshots"))).toBe(false);
  });

  it("omits pointer skills whose source file was removed", async () => {
    const root = makeTempRoot();
    const sessionPath = path.join(root, "agents", "hana", "sessions", "main.jsonl");
    const sourceBaseDir = path.join(root, "skills", "demo-skill");
    const sourceFilePath = path.join(sourceBaseDir, "SKILL.md");
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.mkdirSync(sourceBaseDir, { recursive: true });
    fs.writeFileSync(sessionPath, "{}\n", "utf-8");
    fs.writeFileSync(sourceFilePath, "---\nname: demo-skill\n---\n# Demo\n", "utf-8");

    const result = await snapshotSkillsForSession({
      skills: [{
        name: "demo-skill",
        description: "Demo skill.",
        filePath: sourceFilePath,
        baseDir: sourceBaseDir,
        source: "user",
      }],
      diagnostics: [],
    }, sessionPath);

    fs.rmSync(sourceBaseDir, { recursive: true, force: true });
    const runtime = resolveSessionSkillsForRuntime(result);

    expect(runtime.skills).toEqual([]);
    expect(runtime.diagnostics).toEqual([
      expect.objectContaining({
        type: "warning",
        message: 'skill "demo-skill" source is no longer available',
        path: sourceFilePath,
      }),
    ]);
  });
});
