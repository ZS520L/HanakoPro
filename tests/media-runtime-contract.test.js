import { describe, expect, it } from "vitest";
import {
  buildCliArgs,
  validateCliCommandSpec,
} from "../core/media-runtime-contract.js";

describe("media runtime CLI contract", () => {
  it("rejects raw shell command strings", () => {
    expect(() => validateCliCommandSpec("opencli jimeng generate --prompt hi"))
      .toThrow(/structured CLI command spec/i);
  });

  it("binds CLI arguments structurally", () => {
    const spec = {
      executable: "opencli",
      args: [
        { literal: "jimeng" },
        { literal: "generate" },
        { option: "--prompt", from: "prompt" },
        { option: "--model", from: "modelId" },
        { option: "--output", from: "outputDir" },
      ],
      timeoutMs: 120000,
      output: { kind: "file_glob", directory: "outputDir", pattern: "*.png" },
    };

    expect(validateCliCommandSpec(spec)).toEqual(spec);
    expect(buildCliArgs(spec, {
      prompt: "一只猫",
      modelId: "high_aes_general_v50",
      outputDir: "/tmp/out",
    })).toEqual([
      "jimeng",
      "generate",
      "--prompt",
      "一只猫",
      "--model",
      "high_aes_general_v50",
      "--output",
      "/tmp/out",
    ]);
  });
});
