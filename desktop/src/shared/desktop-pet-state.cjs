"use strict";

const VALID_MOODS = new Set(["idle", "thinking", "talking", "working", "happy", "error", "cute", "sad", "missing"]);

const DEFAULT_DESKTOP_PET_STATE = Object.freeze({
  enabled: true,
  visible: true,
  backgroundOnly: false,
  alwaysOnTop: true,
  clickThrough: false,
  scale: 1,
  x: null,
  y: null,
  width: 280,
  height: 380,
  mood: "idle",
  message: "",
  customImages: {},
});

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeDesktopPetState(raw = {}) {
  const state = { ...DEFAULT_DESKTOP_PET_STATE, ...(raw && typeof raw === "object" ? raw : {}) };
  const mood = VALID_MOODS.has(state.mood) ? state.mood : DEFAULT_DESKTOP_PET_STATE.mood;
  const customImages = {};
  const rawCustomImages = state.customImages && typeof state.customImages === "object" ? state.customImages : {};
  for (const [key, value] of Object.entries(rawCustomImages)) {
    if (VALID_MOODS.has(key) && typeof value === "string" && value.trim()) {
      customImages[key] = value.trim();
    }
  }
  return {
    enabled: state.enabled !== false,
    visible: state.visible !== false,
    backgroundOnly: state.backgroundOnly === true,
    alwaysOnTop: state.alwaysOnTop !== false,
    clickThrough: state.clickThrough === true,
    scale: clampNumber(state.scale, 0.6, 2, DEFAULT_DESKTOP_PET_STATE.scale),
    x: Number.isFinite(Number(state.x)) ? Math.round(Number(state.x)) : null,
    y: Number.isFinite(Number(state.y)) ? Math.round(Number(state.y)) : null,
    width: Math.round(clampNumber(state.width, 280, 480, DEFAULT_DESKTOP_PET_STATE.width)),
    height: Math.round(clampNumber(state.height, 380, 560, DEFAULT_DESKTOP_PET_STATE.height)),
    mood,
    message: typeof state.message === "string" ? state.message.slice(0, 160) : "",
    customImages,
  };
}

function mergeDesktopPetState(current, patch) {
  return normalizeDesktopPetState({ ...normalizeDesktopPetState(current), ...(patch || {}) });
}

function defaultDesktopPetBounds(workArea, width = DEFAULT_DESKTOP_PET_STATE.width, height = DEFAULT_DESKTOP_PET_STATE.height) {
  const area = workArea || { x: 0, y: 0, width: 1280, height: 720 };
  return {
    x: Math.round(area.x + Math.max(16, area.width - width - 32)),
    y: Math.round(area.y + Math.max(16, area.height - height - 48)),
    width,
    height,
  };
}

function intersectsAnyDisplay(bounds, workAreas) {
  if (!bounds || !Array.isArray(workAreas) || workAreas.length === 0) return false;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  return workAreas.some((area) => {
    const areaRight = area.x + area.width;
    const areaBottom = area.y + area.height;
    return bounds.x < areaRight && right > area.x && bounds.y < areaBottom && bottom > area.y;
  });
}

function containingOrNearestWorkArea(bounds, workAreas, fallback) {
  if (!bounds || !Array.isArray(workAreas) || workAreas.length === 0) return fallback;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const containing = workAreas.find((area) => (
    centerX >= area.x
    && centerX <= area.x + area.width
    && centerY >= area.y
    && centerY <= area.y + area.height
  ));
  if (containing) return containing;
  return workAreas[0] || fallback;
}

function clampBoundsToWorkArea(bounds, workArea) {
  const area = workArea || { x: 0, y: 0, width: 1280, height: 720 };
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: Math.round(Math.min(Math.max(bounds.x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - height)),
    width,
    height,
  };
}

function resolveDesktopPetBounds(state, workAreas, primaryWorkArea) {
  const normalized = normalizeDesktopPetState(state);
  const bounds = {
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
  };
  if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && intersectsAnyDisplay(bounds, workAreas)) {
    return clampBoundsToWorkArea(bounds, containingOrNearestWorkArea(bounds, workAreas, primaryWorkArea));
  }
  return defaultDesktopPetBounds(primaryWorkArea, normalized.width, normalized.height);
}

function compactToolName(name) {
  if (!name || typeof name !== "string") return "工具";
  return name.replace(/^mcp[_:.]/, "").replace(/[_.-]+/g, " ").trim().slice(0, 32) || "工具";
}

function desktopPetToolStatus(event) {
  const name = `${event.name || event.toolName || event.tool || event.action || ""}`.toLowerCase();
  if (event.type === "file_write_prepare" || /write|edit|patch|replace|create|delete|file|todo|notebook/.test(name)) return "编辑中";
  if (/bash|terminal|shell|command|run|exec/.test(name)) return "执行中";
  if (/browser|search|web|fetch|url|open/.test(name)) return "浏览中";
  if (/computer|screen|screenshot|vision|image|camera/.test(name)) return "观察中";
  return compactToolName(event.name) === "工具" ? "工作中" : "调用中";
}

function mapDesktopPetEventToState(event) {
  if (!event || typeof event.type !== "string") return null;
  switch (event.type) {
    case "status":
      return event.isStreaming ? { mood: "thinking", message: "思考中" } : { mood: "idle", message: "待机中" };
    case "thinking_start":
    case "thinking_delta":
      return { mood: "thinking", message: "思考中" };
    case "text_delta":
    case "mood_text":
      return { mood: "talking", message: "回复中" };
    case "vision_progress":
      return { mood: "working", message: "观察中" };
    case "file_write_prepare":
      return { mood: "working", message: "编辑中" };
    case "tool_start":
    case "tool_progress":
      return { mood: "working", message: desktopPetToolStatus(event) };
    case "tool_end":
      return event.success === false
        ? { mood: "error", message: "遇到问题" }
        : { mood: "happy", message: "完成啦" };
    case "turn_end":
      return { mood: "idle", message: "待机中" };
    default:
      return null;
  }
}

function durableDesktopPetState(state) {
  const normalized = normalizeDesktopPetState(state);
  return {
    enabled: normalized.enabled,
    visible: normalized.visible,
    backgroundOnly: normalized.backgroundOnly,
    alwaysOnTop: normalized.alwaysOnTop,
    clickThrough: normalized.clickThrough,
    scale: normalized.scale,
    x: normalized.x,
    y: normalized.y,
    width: normalized.width,
    height: normalized.height,
    customImages: normalized.customImages,
  };
}

module.exports = {
  DEFAULT_DESKTOP_PET_STATE,
  VALID_MOODS,
  normalizeDesktopPetState,
  mergeDesktopPetState,
  defaultDesktopPetBounds,
  resolveDesktopPetBounds,
  mapDesktopPetEventToState,
  durableDesktopPetState,
};
