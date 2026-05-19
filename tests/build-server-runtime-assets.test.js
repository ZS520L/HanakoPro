import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  copyServerRuntimeAssets,
  SERVER_RUNTIME_ASSET_DIRS,
  SERVER_RUNTIME_ASSET_FILES,
} from "../scripts/build-server-runtime-assets.mjs";

describe("server runtime assets", () => {
  let tempDir;
  let rootDir;
  let outDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-server-assets-"));
    rootDir = path.join(tempDir, "root");
    outDir = path.join(tempDir, "dist-server", "mac-arm64");
    const assetsDir = path.join(rootDir, "desktop", "src", "assets");
    fs.mkdirSync(assetsDir, { recursive: true });
    for (const fileName of SERVER_RUNTIME_ASSET_FILES) {
      fs.writeFileSync(path.join(assetsDir, fileName), `${fileName}\n`);
    }
    for (const dirName of SERVER_RUNTIME_ASSET_DIRS) {
      const dir = path.join(assetsDir, dirName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "yuan-hanako-card-back.png"), "card-back\n");
      fs.writeFileSync(path.join(dir, "yuan-hanako-emblem.png"), "emblem\n");
    }
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("copies character-card fallback assets into the bundled server root", () => {
    const copied = copyServerRuntimeAssets({ rootDir, outDir });

    for (const fileName of SERVER_RUNTIME_ASSET_FILES) {
      expect(fs.readFileSync(path.join(outDir, "desktop", "src", "assets", fileName), "utf-8"))
        .toBe(`${fileName}\n`);
    }
    expect(fs.readFileSync(
      path.join(outDir, "desktop", "src", "assets", "character-cards", "yuan-hanako-card-back.png"),
      "utf-8",
    )).toBe("card-back\n");
    expect(fs.readFileSync(
      path.join(outDir, "desktop", "src", "assets", "character-cards", "yuan-hanako-emblem.png"),
      "utf-8",
    )).toBe("emblem\n");
    expect(copied).toEqual(expect.arrayContaining([
      path.join("desktop", "src", "assets", "Hanako.png"),
      path.join("desktop", "src", "assets", "character-cards") + path.sep,
    ]));
  });

  it("fails the build when a required fallback asset is missing", () => {
    fs.unlinkSync(path.join(rootDir, "desktop", "src", "assets", "Butter.png"));

    expect(() => copyServerRuntimeAssets({ rootDir, outDir }))
      .toThrow(/required runtime asset missing: .*Butter\.png/);
  });
});
