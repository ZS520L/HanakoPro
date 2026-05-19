import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readTextFileSnapshot,
  writeTextFileIfUnchanged,
} from "../desktop/file-text-io.cjs";

describe("file-text-io", () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-file-text-io-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to overwrite a file that changed after the caller snapshot", () => {
    const filePath = path.join(dir, "note.md");
    fs.writeFileSync(filePath, "version one", "utf-8");
    const snapshot = readTextFileSnapshot(filePath);

    fs.writeFileSync(filePath, "version two", "utf-8");
    const result = writeTextFileIfUnchanged(filePath, "late stale save", snapshot.version);

    expect(result).toMatchObject({ ok: false, conflict: true });
    expect(fs.readFileSync(filePath, "utf-8")).toBe("version two");
  });

  it("writes and returns a new snapshot version when the caller snapshot still matches", () => {
    const filePath = path.join(dir, "note.md");
    fs.writeFileSync(filePath, "version one", "utf-8");
    const snapshot = readTextFileSnapshot(filePath);

    const result = writeTextFileIfUnchanged(filePath, "version two", snapshot.version);

    expect(result).toMatchObject({ ok: true });
    expect(result.version).toEqual(expect.objectContaining({
      mtimeMs: expect.any(Number),
      size: "version two".length,
    }));
    expect(fs.readFileSync(filePath, "utf-8")).toBe("version two");
  });
});
