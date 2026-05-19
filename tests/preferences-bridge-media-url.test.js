import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { PreferencesManager } from "../core/preferences-manager.js";

function makePrefs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-prefs-bridge-url-"));
  return new PreferencesManager({
    userDir: path.join(root, "user"),
    agentsDir: path.join(root, "agents"),
  });
}

describe("PreferencesManager bridge media public URL", () => {
  it("saves a normalized Bridge media public base URL", () => {
    const prefs = makePrefs();

    expect(prefs.setBridgeMediaPublicBaseUrl(" https://hana.example.com/ ")).toBe("https://hana.example.com");
    expect(prefs.getBridgeMediaPublicBaseUrl()).toBe("https://hana.example.com");
    expect(prefs.getPreferences().bridge.mediaPublicBaseUrl).toBe("https://hana.example.com");
  });

  it("clears the bridge key when the URL is empty", () => {
    const prefs = makePrefs();

    prefs.setBridgeReadOnly(true);
    prefs.setBridgeMediaPublicBaseUrl("https://hana.example.com");
    prefs.setBridgeMediaPublicBaseUrl("");

    expect(prefs.getBridgeMediaPublicBaseUrl()).toBe("");
    expect(prefs.getPreferences().bridge).toEqual({ readOnly: true });
  });

  it("rejects unsupported or malformed URLs", () => {
    const prefs = makePrefs();

    expect(() => prefs.setBridgeMediaPublicBaseUrl("ftp://hana.example.com")).toThrow(/http or https/);
    expect(() => prefs.setBridgeMediaPublicBaseUrl("not a url")).toThrow(/valid URL/);
    expect(() => prefs.setBridgeMediaPublicBaseUrl("https://hana.example.com?x=1")).toThrow(/query or hash/);
  });
});
