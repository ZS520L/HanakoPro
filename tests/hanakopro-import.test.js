import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  DECLINED_MARKER,
  IMPORTED_MARKER,
  hasRealTargetData,
  promptAndImportOfficialHanakoData,
  shouldOfferOfficialImport,
} from "../desktop/src/shared/hanakopro-import.cjs";

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanakopro-import-"));
}

function write(filePath, content = "x") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

describe("HanakoPro official data import", () => {
  it("offers import only when the target has no real user data", () => {
    const root = makeTempRoot();
    const source = path.join(root, ".hanako");
    const target = path.join(root, ".hanakopro");
    write(path.join(source, "user", "preferences.json"), "{}");
    fs.mkdirSync(path.join(target, ".pi", "agent"), { recursive: true });

    expect(hasRealTargetData(target)).toBe(false);
    expect(shouldOfferOfficialImport({ sourceHome: source, targetHome: target })).toEqual({ offer: true, reason: "available" });

    write(path.join(target, "user", "preferences.json"), "{}");
    expect(hasRealTargetData(target)).toBe(true);
    expect(shouldOfferOfficialImport({ sourceHome: source, targetHome: target })).toEqual({ offer: false, reason: "target-has-data" });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("copies official config and history without copying runtime-only files", async () => {
    const root = makeTempRoot();
    const source = path.join(root, ".hanako");
    const target = path.join(root, ".hanakopro");
    write(path.join(source, "user", "preferences.json"), JSON.stringify({ setupComplete: true }));
    write(path.join(source, "agents", "hanako", "sessions", "s1.jsonl"), "{}");
    write(path.join(source, "server-info.json"), "stale");
    write(path.join(source, "logs", "server.log"), "log");
    write(path.join(source, ".pi", "agent", "cache"), "pi");

    const dialog = { showMessageBox: async () => ({ response: 0 }) };
    const result = await promptAndImportOfficialHanakoData({ dialog, sourceHome: source, targetHome: target });

    expect(result).toMatchObject({ prompted: true, imported: true, reason: "imported" });
    expect(fs.readFileSync(path.join(target, "user", "preferences.json"), "utf-8")).toContain("setupComplete");
    expect(fs.existsSync(path.join(target, "agents", "hanako", "sessions", "s1.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(target, "server-info.json"))).toBe(false);
    expect(fs.existsSync(path.join(target, "logs", "server.log"))).toBe(false);
    expect(fs.existsSync(path.join(target, ".pi", "agent", "cache"))).toBe(false);
    expect(fs.existsSync(path.join(target, IMPORTED_MARKER))).toBe(true);
    expect(fs.existsSync(path.join(source, "user", "preferences.json"))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("records a decline marker and does not prompt again", async () => {
    const root = makeTempRoot();
    const source = path.join(root, ".hanako");
    const target = path.join(root, ".hanakopro");
    write(path.join(source, "agents", "hanako", "config.yaml"), "name: Hanako");
    const dialog = { showMessageBox: async () => ({ response: 1 }) };

    const result = await promptAndImportOfficialHanakoData({ dialog, sourceHome: source, targetHome: target });

    expect(result).toMatchObject({ prompted: true, imported: false, reason: "declined" });
    expect(fs.existsSync(path.join(target, DECLINED_MARKER))).toBe(true);
    expect(shouldOfferOfficialImport({ sourceHome: source, targetHome: target })).toEqual({ offer: false, reason: "declined" });
    fs.rmSync(root, { recursive: true, force: true });
  });
});
