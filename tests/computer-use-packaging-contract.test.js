import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const fixModules = require("../scripts/fix-modules.cjs").default;

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-computer-use-packaging-"));
  tempDirs.push(dir);
  return dir;
}

function makeMacAfterPackContext(appOutDir) {
  return {
    appOutDir,
    arch: 3,
    packager: {
      platform: { name: "mac" },
      appInfo: { productFilename: "Hanako" },
    },
  };
}

function resourcesDir(appOutDir) {
  return path.join(appOutDir, "Hanako.app", "Contents", "Resources");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Computer Use packaging contract", () => {
  it("fails macOS afterPack when the helper binary is missing from app resources", async () => {
    const appOutDir = makeTempDir();
    fs.mkdirSync(resourcesDir(appOutDir), { recursive: true });

    await expect(fixModules(makeMacAfterPackContext(appOutDir))).rejects.toThrow(
      /Computer Use helper missing/,
    );
  });

  it("runs the helper build before electron-builder in the GitHub macOS release workflow", () => {
    const workflow = fs.readFileSync(path.resolve(".github", "workflows", "build.yml"), "utf8");
    const helperBuild = workflow.indexOf("node scripts/build-computer-use-helper.mjs");
    const macBuilder = workflow.indexOf("npx electron-builder --mac");

    expect(helperBuild).toBeGreaterThanOrEqual(0);
    expect(helperBuild).toBeLessThan(macBuilder);
    expect(workflow).toContain("HANA_COMPUTER_USE_HELPER_ARCH=${{ matrix.arch }}");
  });
});
