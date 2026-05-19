const DEFAULT_WORKSPACE_HISTORY_LIMIT = 10;

export function normalizeWorkspacePath(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const slashed = trimmed.replace(/\\/g, "/");
  if (slashed === "/") return "/";
  if (/^[A-Za-z]:\/?$/.test(slashed)) return slashed.endsWith("/") ? slashed : `${slashed}/`;
  return slashed.replace(/\/+$/g, "");
}

export function mergeWorkspaceHistory(existing = [], additions = [], options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : DEFAULT_WORKSPACE_HISTORY_LIMIT;
  const next = [];
  const push = (value) => {
    const normalized = normalizeWorkspacePath(value);
    if (!normalized || next.includes(normalized)) return;
    next.push(normalized);
  };
  for (const value of [...additions].reverse()) push(value);
  for (const value of existing) push(value);
  return next.slice(0, Math.max(0, limit));
}

export function buildWorkspacePickerItems({ selectedFolder, homeFolder, cwdHistory } = {}) {
  const items = [];
  const push = (value) => {
    const normalized = normalizeWorkspacePath(value);
    if (!normalized || items.includes(normalized)) return;
    items.push(normalized);
  };
  push(selectedFolder);
  push(homeFolder);
  for (const value of Array.isArray(cwdHistory) ? cwdHistory : []) push(value);
  return items;
}

export function workspaceDisplayName(value, fallback = "") {
  const normalized = normalizeWorkspacePath(value);
  if (!normalized) return fallback;
  if (normalized === "/") return "/";
  const trimmed = normalized.replace(/\/+$/g, "");
  const parts = trimmed.split("/");
  return parts[parts.length - 1] || normalized;
}
