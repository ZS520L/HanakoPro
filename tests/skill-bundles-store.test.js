import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createSkillBundle,
  deleteSkillBundle,
  detachAgentFromBundles,
  loadSkillBundleStore,
  removeSkillsFromBundles,
  reorderSkillBundles,
  updateSkillBundle,
} from "../lib/skill-bundles/store.js";

describe("skill bundle store", () => {
  let tempDir;
  let engine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-skill-bundles-"));
    engine = { hanakoHome: tempDir };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does not create an empty store when removing skills and no bundle store exists", () => {
    const store = removeSkillsFromBundles(engine, ["missing"]);

    expect(store).toEqual({ schemaVersion: 1, bundles: [] });
    expect(fs.existsSync(path.join(tempDir, "skill-bundles.json"))).toBe(false);
  });

  it("creates, updates, and deletes user-managed bundles without owning skills", () => {
    const bundle = createSkillBundle(engine, {
      name: "Coding Bundle",
      skillNames: ["writer", "writer", "reader"],
    });

    expect(bundle).toMatchObject({
      id: "coding-bundle",
      name: "Coding Bundle",
      skillNames: ["writer", "reader"],
      source: "user",
      agentId: null,
      sourcePackage: null,
    });

    const updated = updateSkillBundle(engine, bundle.id, {
      name: "Work Bundle",
      skillNames: ["reader", "debugger"],
    });
    expect(updated).toMatchObject({
      id: bundle.id,
      name: "Work Bundle",
      skillNames: ["reader", "debugger"],
    });

    const deleted = deleteSkillBundle(engine, bundle.id);
    expect(deleted).toBe(true);
    expect(loadSkillBundleStore(engine).bundles).toEqual([]);
  });

  it("supports empty manual bundles but removes bundles emptied by deleted skills", () => {
    const manual = createSkillBundle(engine, { name: "Empty Bundle" });
    expect(manual.skillNames).toEqual([]);
    expect(loadSkillBundleStore(engine).bundles).toHaveLength(1);

    const filled = updateSkillBundle(engine, manual.id, {
      skillNames: ["only-skill"],
    });
    expect(filled.skillNames).toEqual(["only-skill"]);

    const store = removeSkillsFromBundles(engine, ["only-skill"]);
    expect(store.bundles).toEqual([]);
  });

  it("detaches deleted agents from imported bundles while keeping bundle membership", () => {
    const bundle = createSkillBundle(engine, {
      name: "Hanako Bundle",
      skillNames: ["quiet-musing", "skill-creator"],
      source: "character-card-import",
      agentId: "hanako-2",
      sourcePackage: "hanako-charactercard.zip",
    });

    const store = detachAgentFromBundles(engine, "hanako-2");
    expect(store.bundles).toHaveLength(1);
    expect(store.bundles[0]).toMatchObject({
      id: bundle.id,
      agentId: null,
      skillNames: ["quiet-musing", "skill-creator"],
      source: "character-card-import",
      sourcePackage: "hanako-charactercard.zip",
    });
  });

  it("persists bundle order without changing bundle membership", () => {
    const first = createSkillBundle(engine, {
      name: "First Bundle",
      skillNames: ["writer"],
    });
    const second = createSkillBundle(engine, {
      name: "Second Bundle",
      skillNames: ["reader"],
    });

    const reordered = reorderSkillBundles(engine, [second.id, first.id]);

    expect(reordered.bundles.map(bundle => bundle.id)).toEqual([second.id, first.id]);
    expect(reordered.bundles.map(bundle => bundle.skillNames)).toEqual([["reader"], ["writer"]]);
    expect(loadSkillBundleStore(engine).bundles.map(bundle => bundle.id)).toEqual([second.id, first.id]);
  });
});
