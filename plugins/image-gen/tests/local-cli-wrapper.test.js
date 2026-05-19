import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLocalCliMedia } from "../lib/local-cli-wrapper.js";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-cli-wrapper-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("local CLI media wrapper", () => {
  it("executes a structured CLI command and collects generated files", async () => {
    const script = [
      "const fs = require('fs');",
      "const idx = process.argv.indexOf('--output');",
      "const out = process.argv[idx + 1];",
      "fs.writeFileSync(require('path').join(out, 'result.png'), 'png');",
    ].join(" ");

    const result = await runLocalCliMedia({
      executable: process.execPath,
      args: [
        { literal: "-e" },
        { literal: script },
        { literal: "--" },
        { option: "--output", from: "outputDir" },
      ],
      timeoutMs: 5000,
      output: { kind: "file_glob", directory: "outputDir", pattern: "*.png" },
    }, {
      outputDir: tmpDir,
    });

    expect(result.files).toEqual([path.join(tmpDir, "result.png")]);
  });
});
