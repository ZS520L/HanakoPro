import path from "path";

function cleanPath(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return path.resolve(trimmed);
}

export function normalizeWorkspaceScope({ primaryCwd, workspaceFolders } = {}) {
  const primary = cleanPath(primaryCwd);
  const seen = new Set(primary ? [primary] : []);
  const folders = [];

  for (const raw of Array.isArray(workspaceFolders) ? workspaceFolders : []) {
    const folder = cleanPath(raw);
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);
    folders.push(folder);
  }

  return {
    primaryCwd: primary,
    workspaceFolders: folders,
  };
}

export function workspaceRootsForSandbox(primaryCwd, workspaceFolders) {
  const scope = normalizeWorkspaceScope({ primaryCwd, workspaceFolders });
  return [
    scope.primaryCwd,
    ...scope.workspaceFolders,
  ].filter(Boolean);
}

export function formatWorkspaceScopePrompt({ primaryCwd, workspaceFolders, locale } = {}) {
  const scope = normalizeWorkspaceScope({ primaryCwd, workspaceFolders });
  if (!scope.primaryCwd && scope.workspaceFolders.length === 0) return "";
  const isZh = String(locale || "").startsWith("zh");

  if (isZh) {
    const lines = [
      "## 工作区范围",
      "",
      scope.primaryCwd
        ? `当前工作目录：${scope.primaryCwd}`
        : "当前工作目录：未设置",
      "相对路径默认按当前工作目录解析。",
    ];
    if (scope.workspaceFolders.length > 0) {
      lines.push("额外文件夹：");
      for (const folder of scope.workspaceFolders) lines.push(`- ${folder}`);
      lines.push("这些文件夹也在本次会话的沙盒授权范围内；引用它们时使用绝对路径。");
    }
    return lines.join("\n");
  }

  const lines = [
    "## Workspace Scope",
    "",
    scope.primaryCwd
      ? `Current working directory: ${scope.primaryCwd}`
      : "Current working directory: not set",
    "Relative paths resolve against the current working directory.",
  ];
  if (scope.workspaceFolders.length > 0) {
    lines.push("Extra folders:");
    for (const folder of scope.workspaceFolders) lines.push(`- ${folder}`);
    lines.push("These folders are also authorized for this session; use absolute paths when referring to them.");
  }
  return lines.join("\n");
}
