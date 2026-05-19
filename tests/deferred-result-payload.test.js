import { describe, expect, it } from "vitest";
import { normalizeDeferredResolveResult } from "../lib/deferred-result-payload.js";

describe("normalizeDeferredResolveResult", () => {
  it("preserves sessionFiles when a deferred media task resolves with files", () => {
    const sessionFile = {
      fileId: "sf_generated",
      sessionPath: "/sessions/test.jsonl",
      filePath: "/tmp/generated.png",
      mime: "image/png",
      kind: "image",
    };

    expect(normalizeDeferredResolveResult({
      files: ["generated.png"],
      sessionFiles: [sessionFile],
    })).toEqual({
      files: ["generated.png"],
      sessionFiles: [sessionFile],
    });
  });

  it("keeps legacy file-array payloads when no sessionFiles are present", () => {
    expect(normalizeDeferredResolveResult({
      files: ["generated.png"],
    })).toEqual(["generated.png"]);
  });
});
