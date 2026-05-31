import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemorySearchTool } from "../lib/memory/memory-search.js";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-memory-search-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("search_memory pinned memory search", () => {
  it("searches pinned.md memories only", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "pinned.md"),
      [
        "- 用户爱叉叉，只是更准确地表达心意",
        "- 用户喜欢茉莉花茶",
      ].join("\n") + "\n",
      "utf-8",
    );

    const factStore = {
      get size() { throw new Error("facts.db should not be touched"); },
      searchByTags: vi.fn(() => { throw new Error("facts.db should not be touched"); }),
      searchFullText: vi.fn(() => { throw new Error("facts.db should not be touched"); }),
    };

    const tool = createMemorySearchTool(factStore, { agentDir: tmpDir });
    const result = await tool.execute("call-1", { query: "叉叉" });

    expect(result.details).toEqual({ resultCount: 1, source: "pinned" });
    expect(result.content[0].text).toContain("用户爱叉叉");
    expect(result.content[0].text).not.toContain("茉莉花茶");
  });

  it("returns empty when no pinned memory matches", async () => {
    fs.writeFileSync(path.join(tmpDir, "pinned.md"), "- 用户喜欢茉莉花茶\n", "utf-8");

    const tool = createMemorySearchTool(tmpDir);
    const result = await tool.execute("call-1", { query: "叉叉" });

    expect(result.details).toEqual({ resultCount: 0, source: "pinned" });
    expect(result.content[0].text).toBe("置顶记忆里没有找到相关内容。");
  });
});
