import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCAN_DIRS = ["core", "server", "lib", "hub"];
const ADAPTER_DIR = path.join(ROOT, "lib", "pi-sdk");

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full, files);
    } else if (/\.(js|mjs|cjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function findDirectImports(modulePattern) {
  const leaks = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      if (file.startsWith(ADAPTER_DIR)) continue;
      const content = fs.readFileSync(file, "utf8");
      if (modulePattern.test(content)) {
        leaks.push(path.relative(ROOT, file));
      }
    }
  }
  return leaks;
}

describe("Pi SDK import boundary", () => {
  it("keeps production @mariozechner imports inside lib/pi-sdk", () => {
    const pattern = /(?:from\s+["']@mariozechner\/|import\s*\(\s*["']@mariozechner\/|require\s*\(\s*["']@mariozechner\/)/;
    expect(findDirectImports(pattern)).toEqual([]);
  });

  it("keeps production typebox imports inside lib/pi-sdk", () => {
    const pattern = /(?:from\s+["']typebox["']|import\s*\(\s*["']typebox["']|require\s*\(\s*["']typebox["'])/;
    expect(findDirectImports(pattern)).toEqual([]);
  });
});
