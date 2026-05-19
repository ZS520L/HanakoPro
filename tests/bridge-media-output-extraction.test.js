import path from "path";
import { describe, expect, it } from "vitest";
import { splitMediaFromOutput } from "../lib/bridge/media-utils.js";

describe("Bridge reply media extraction", () => {
  it("extracts remote MEDIA URLs", () => {
    const result = splitMediaFromOutput("hello\nMEDIA:https://cdn.example.com/a.png\nbye");

    expect(result.text).toBe("hello\nbye");
    expect(result.mediaUrls).toEqual(["https://cdn.example.com/a.png"]);
  });

  it("does not extract local MEDIA paths because local files must be staged", () => {
    const localPath = path.join(path.parse(process.cwd()).root, "tmp", "hana-output.png");
    const result = splitMediaFromOutput(`before\nMEDIA:${localPath}\nafter`);

    expect(result.text).toBe("before\nafter");
    expect(result.mediaUrls).toEqual([]);
  });

  it("does not extract file URLs from MEDIA lines", () => {
    const result = splitMediaFromOutput("MEDIA:file:///tmp/hana-output.png");

    expect(result.text).toBe("");
    expect(result.mediaUrls).toEqual([]);
  });

  it("keeps local paths inside fenced code blocks", () => {
    const localPath = path.join(path.parse(process.cwd()).root, "tmp", "hana-output.png");
    const result = splitMediaFromOutput(`\`\`\`\nMEDIA:${localPath}\n\`\`\``);

    expect(result.text).toBe(`\`\`\`\nMEDIA:${localPath}\n\`\`\``);
    expect(result.mediaUrls).toEqual([]);
  });
});
