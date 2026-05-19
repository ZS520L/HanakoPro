import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { afterEach, describe, expect, it } from "vitest";

const rootDir = process.cwd();
const scriptPath = path.join(rootDir, "scripts", "merge-latest-mac-yml.cjs");
const workflowPath = path.join(rootDir, ".github", "workflows", "build.yml");

let tmpDir;

function makeTmpDir() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-mac-update-metadata-"));
  return tmpDir;
}

function writeMacMetadata(artifactsDir, arch, { fileName = "latest-mac.yml" } = {}) {
  const version = "0.171.5";
  const dir = path.join(artifactsDir, `installer-macos-latest-${arch}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, fileName),
    yaml.dump({
      version,
      files: [
        {
          url: `Hanako-${version}-macOS-${arch}.zip`,
          sha512: `${arch}-zip-sha512`,
          size: arch === "arm64" ? 265_000_001 : 273_000_001,
        },
        {
          url: `Hanako-${version}-macOS-${arch}.dmg`,
          sha512: `${arch}-dmg-sha512`,
          size: arch === "arm64" ? 271_000_001 : 280_000_001,
        },
      ],
      path: `Hanako-${version}-macOS-${arch}.zip`,
      sha512: `${arch}-zip-sha512`,
      releaseDate: "2026-05-09T12:52:00.000Z",
    }),
  );
}

function mergeLatestMac(artifactsDir, outputPath) {
  execFileSync(process.execPath, [scriptPath, artifactsDir, outputPath], {
    cwd: rootDir,
    stdio: "pipe",
  });
  return yaml.load(fs.readFileSync(outputPath, "utf8"));
}

function mergeLatestMacWithoutYamlDependency(artifactsDir, outputPath, hookPath) {
  execFileSync(process.execPath, ["--require", hookPath, scriptPath, artifactsDir, outputPath], {
    cwd: rootDir,
    stdio: "pipe",
  });
  return yaml.load(fs.readFileSync(outputPath, "utf8"));
}

describe("macOS update metadata release contract", () => {
  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it("merges arm64 and x64 metadata even when electron-builder emits an arch-suffixed arm64 file", () => {
    const dir = makeTmpDir();
    const artifactsDir = path.join(dir, "artifacts");
    const outputPath = path.join(dir, "latest-mac.yml");

    writeMacMetadata(artifactsDir, "arm64", { fileName: "latest-mac-arm64.yml" });
    writeMacMetadata(artifactsDir, "x64");

    const merged = mergeLatestMac(artifactsDir, outputPath);
    const urls = merged.files.map((file) => file.url);

    expect(urls).toEqual([
      "Hanako-0.171.5-macOS-arm64.zip",
      "Hanako-0.171.5-macOS-arm64.dmg",
      "Hanako-0.171.5-macOS-x64.zip",
      "Hanako-0.171.5-macOS-x64.dmg",
    ]);
    expect(merged.path).toBe("Hanako-0.171.5-macOS-arm64.zip");
    expect(merged.sha512).toBe("arm64-zip-sha512");
  });

  it("fails instead of publishing x64-only latest-mac.yml when arm64 metadata is missing", () => {
    const dir = makeTmpDir();
    const artifactsDir = path.join(dir, "artifacts");
    const outputPath = path.join(dir, "latest-mac.yml");

    writeMacMetadata(artifactsDir, "x64");

    expect(() => mergeLatestMac(artifactsDir, outputPath)).toThrow(/Missing macOS update metadata for arm64/);
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("runs in the release job without external YAML parser dependencies", () => {
    const dir = makeTmpDir();
    const artifactsDir = path.join(dir, "artifacts");
    const outputPath = path.join(dir, "latest-mac.yml");
    const hookPath = path.join(dir, "block-js-yaml.cjs");

    writeMacMetadata(artifactsDir, "arm64", { fileName: "latest-mac-arm64.yml" });
    writeMacMetadata(artifactsDir, "x64");
    fs.writeFileSync(
      hookPath,
      [
        'const Module = require("node:module");',
        "const originalLoad = Module._load;",
        "Module._load = function blockYamlParser(request, parent, isMain) {",
        '  if (request === "js-yaml") throw new Error("blocked external YAML dependency");',
        "  return originalLoad.call(this, request, parent, isMain);",
        "};",
        "",
      ].join("\n"),
    );

    const merged = mergeLatestMacWithoutYamlDependency(artifactsDir, outputPath, hookPath);

    expect(merged.files).toHaveLength(4);
    expect(merged.path).toBe("Hanako-0.171.5-macOS-arm64.zip");
  });

  it("routes the GitHub release workflow through the checked merge script", () => {
    const workflow = fs.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("node scripts/merge-latest-mac-yml.cjs artifacts latest-mac.yml");
    expect(workflow).not.toContain("Only x64 yml found, using as-is");
    expect(workflow).not.toContain("Only arm64 yml found, using as-is");
  });
});
