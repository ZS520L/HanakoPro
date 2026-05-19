import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = process.cwd();

function selectFilesDialogProperties(source) {
  const match = source.match(/wrapIpcBestEffortHandler\("select-files"[\s\S]*?properties:\s*\[([^\]]+)\]/);
  if (!match) throw new Error("select-files dialog properties not found");
  return match[1];
}

describe("select-files dialog contract", () => {
  it("opens a file picker without directory mode for Windows compatibility", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");
    const properties = selectFilesDialogProperties(mainSource);

    expect(properties).toContain('"openFile"');
    expect(properties).toContain('"multiSelections"');
    expect(properties).not.toContain('"openDirectory"');
  });
});
