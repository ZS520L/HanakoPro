import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildExternalPackage,
  verifyExternalEntrypoints,
} from "../scripts/build-server-deps.mjs";

const tempDirs = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-build-server-deps-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("build-server external dependency packaging", () => {
  it("pins server externals and selected runtime transitives to the root lock versions", () => {
    const rootPkg = {
      name: "hanako",
      version: "1.0.1",
    };
    const rootLock = {
      name: "hanako",
      version: "1.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": {
          name: "hanako",
          version: "1.0.0",
          dependencies: {
            jsdom: "^29.0.2",
            vite: "^7.0.0",
          },
          devDependencies: {
            vite: "^7.0.0",
          },
        },
        "node_modules/jsdom": {
          version: "29.0.2",
          dependencies: {
            "lru-cache": "^11.2.7",
          },
        },
        "node_modules/lru-cache": {
          version: "11.2.7",
        },
        "node_modules/vite": {
          version: "7.3.0",
          dev: true,
        },
      },
    };

    const serverPkg = buildExternalPackage(
      rootPkg,
      {
        jsdom: "^29.0.2",
      },
      {
        rootLock,
        pinnedTransitiveDeps: ["lru-cache"],
      },
    );

    expect(serverPkg).toEqual({
      name: "hanako-server",
      version: "1.0.1",
      type: "module",
      dependencies: {
        jsdom: "29.0.2",
        "lru-cache": "11.2.7",
      },
    });
  });

  it("fails fast when an installed external package export resolves to a missing file", () => {
    const outDir = makeTempDir();
    const packageDir = path.join(outDir, "node_modules", "bad-export-package");
    fs.mkdirSync(path.join(packageDir, "dist", "commonjs"), { recursive: true });
    fs.writeFileSync(path.join(outDir, "package.json"), JSON.stringify({ type: "module" }));
    fs.writeFileSync(path.join(packageDir, "dist", "commonjs", "index.min.js"), "module.exports = {};\n");
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
      name: "bad-export-package",
      version: "1.0.0",
      exports: {
        ".": {
          require: {
            node: {
              default: "./dist/commonjs/node/index.min.js",
            },
            default: "./dist/commonjs/index.min.js",
          },
        },
      },
    }));

    expect(() => verifyExternalEntrypoints(outDir, ["bad-export-package"])).toThrow(
      /bad-export-package.*dist\/commonjs\/node\/index\.min\.js/s,
    );
  });

  it("accepts import-only package exports when the runtime target exists", () => {
    const outDir = makeTempDir();
    const packageDir = path.join(outDir, "node_modules", "esm-only-package");
    fs.mkdirSync(path.join(packageDir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(packageDir, "dist", "index.js"), "export const ok = true;\n");
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
      name: "esm-only-package",
      version: "1.0.0",
      type: "module",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          import: "./dist/index.js",
        },
      },
    }));

    expect(() => verifyExternalEntrypoints(outDir, ["esm-only-package"])).not.toThrow();
  });
});
