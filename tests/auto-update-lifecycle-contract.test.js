import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const root = process.cwd();

describe("auto-update lifecycle contract", () => {
  it("does not install a downloaded update implicitly from the app quit path", () => {
    const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf-8");

    expect(mainSource).not.toContain('installDownloadedUpdate("app-quit")');
    expect(mainSource).not.toContain("getUpdateState().status === \"downloaded\"");
  });
});
