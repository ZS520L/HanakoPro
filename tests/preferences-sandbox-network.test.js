import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { PreferencesManager } from "../core/preferences-manager.js";

function makePrefs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hana-prefs-sandbox-network-"));
  return new PreferencesManager({
    userDir: path.join(root, "user"),
    agentsDir: path.join(root, "agents"),
  });
}

describe("PreferencesManager sandbox network preference", () => {
  it("defaults sandbox networking to disabled", () => {
    const prefs = makePrefs();

    expect(prefs.getSandboxNetwork()).toBe(false);
  });

  it("stores sandbox networking as an explicit boolean", () => {
    const prefs = makePrefs();

    prefs.setSandboxNetwork("true");
    expect(prefs.getSandboxNetwork()).toBe(true);
    expect(prefs.getPreferences().sandbox_network).toBe(true);

    prefs.setSandboxNetwork(false);
    expect(prefs.getSandboxNetwork()).toBe(false);
    expect(prefs.getPreferences().sandbox_network).toBe(false);
  });
});
