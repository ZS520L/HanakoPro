import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { resolveTrashItemPath } = require("../desktop/src/shared/trash-item-path.cjs");

describe("trash item path resolution", () => {
  it("normalizes slash-separated Windows absolute paths to Windows separators", () => {
    expect(resolveTrashItemPath("C:/Users/Alice/workspace/notes/chapter.md", "win32"))
      .toBe("C:\\Users\\Alice\\workspace\\notes\\chapter.md");
  });

  it("normalizes Windows UNC paths without losing the share root", () => {
    expect(resolveTrashItemPath("//server/share/workspace/notes.md", "win32"))
      .toBe("\\\\server\\share\\workspace\\notes.md");
  });

  it("keeps POSIX absolute paths in POSIX form", () => {
    expect(resolveTrashItemPath("/Users/alice/workspace/notes/chapter.md", "darwin"))
      .toBe("/Users/alice/workspace/notes/chapter.md");
  });

  it("rejects relative or empty paths instead of resolving them against cwd", () => {
    expect(resolveTrashItemPath("notes/chapter.md", "darwin")).toBeNull();
    expect(resolveTrashItemPath("", "darwin")).toBeNull();
    expect(resolveTrashItemPath(null, "darwin")).toBeNull();
  });
});
