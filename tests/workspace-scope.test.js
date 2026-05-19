import { describe, expect, it } from "vitest";
import {
  formatWorkspaceScopePrompt,
  normalizeWorkspaceScope,
} from "../shared/workspace-scope.js";

describe("workspace scope", () => {
  it("dedupes extra folders and excludes the primary cwd", () => {
    const scope = normalizeWorkspaceScope({
      primaryCwd: "/workspace/project",
      workspaceFolders: [
        "/workspace/reference",
        "/workspace/project",
        "",
        null,
        "/workspace/reference",
      ],
    });

    expect(scope).toEqual({
      primaryCwd: "/workspace/project",
      workspaceFolders: ["/workspace/reference"],
    });
  });

  it("formats extra folders into the assistant workspace prompt", () => {
    const prompt = formatWorkspaceScopePrompt({
      primaryCwd: "/workspace/project",
      workspaceFolders: ["/workspace/reference"],
      locale: "zh-CN",
    });

    expect(prompt).toContain("当前工作目录");
    expect(prompt).toContain("/workspace/project");
    expect(prompt).toContain("额外文件夹");
    expect(prompt).toContain("/workspace/reference");
  });
});
