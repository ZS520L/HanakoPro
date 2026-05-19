import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8"));
}

function readYaml(relativePath) {
  return yaml.load(fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8"));
}

describe("quality gates", () => {
  it("typecheck covers app TypeScript, root TypeScript tests, and workspace package sources", () => {
    const tsconfig = readJson("tsconfig.json");

    expect(tsconfig.include).toEqual(expect.arrayContaining([
      "desktop/src/**/*.ts",
      "desktop/src/**/*.tsx",
      "tests/**/*.ts",
      "packages/*/src/**/*.ts",
      "packages/*/src/**/*.tsx",
    ]));
  });

  it("lint checks the repository through eslint.config.js instead of a hand-picked directory subset", () => {
    const packageJson = readJson("package.json");

    expect(packageJson.scripts.lint).toBe("eslint .");
  });

  it("package builds use the workspace graph instead of a hard-coded package list", () => {
    const packageJson = readJson("package.json");

    expect(packageJson.scripts["build:packages"]).toBe("npm run build --workspaces --if-present");
  });

  it("CI runs lint before build and tests can merge to main", () => {
    const ci = readYaml(".github/workflows/ci.yml");
    const runSteps = ci.jobs.test.steps
      .map((step) => step.run)
      .filter(Boolean);

    const lintIndex = runSteps.indexOf("npm run lint");
    const buildIndex = runSteps.indexOf("npm run build:renderer");
    const testIndex = runSteps.indexOf("npm test");

    expect(lintIndex).toBeGreaterThan(-1);
    expect(lintIndex).toBeLessThan(buildIndex);
    expect(lintIndex).toBeLessThan(testIndex);
  });
});
