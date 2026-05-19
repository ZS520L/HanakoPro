/**
 * current-status-tool.js — 渐进式查询当前运行环境
 *
 * 这是给 Agent 的轻量环境感知入口，不是 debug 面板。工具本身只暴露
 * list/get 协议；每个状态项由独立 provider 负责，后续扩展只加 provider。
 */

import { StringEnum, Type } from "../pi-sdk/index.js";
import { getToolSessionPath } from "./tool-session.js";
import { toolError, toolOk } from "./tool-result.js";

const DAY_BOUNDARY_HOUR = 4;

const DEFAULT_USAGE =
  "Call action=list to discover available status keys. Then call action=get with the smallest necessary key.";

function resolveTimezone(raw) {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const candidate = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return fallback;
  }
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(parts) {
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getUtcOffset(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const value = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
  if (value === "GMT") return "+00:00";
  return value.replace(/^GMT/, "");
}

function getLogicalDate(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  let year = Number(parts.year);
  let month = Number(parts.month);
  let day = Number(parts.day);

  if (Number(parts.hour) < DAY_BOUNDARY_HOUR) {
    const previous = new Date(Date.UTC(year, month - 1, day));
    previous.setUTCDate(previous.getUTCDate() - 1);
    year = previous.getUTCFullYear();
    month = previous.getUTCMonth() + 1;
    day = previous.getUTCDate();
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function modelSummary(model) {
  if (!model) {
    return { id: null, provider: null, name: null };
  }
  return {
    id: model.id || null,
    provider: model.provider || null,
    name: model.name || model.id || null,
  };
}

function agentSummary(agent) {
  if (!agent) {
    return { id: null, name: null };
  }
  return {
    id: agent.id || null,
    name: agent.agentName || agent.config?.agent?.name || agent.id || null,
  };
}

function provider(key, description, get) {
  return { key, description, get };
}

function normalizeUiContext(value) {
  const ctx = value && typeof value === "object" ? value : {};
  return {
    currentViewed: typeof ctx.currentViewed === "string" && ctx.currentViewed ? ctx.currentViewed : null,
    activeFile: typeof ctx.activeFile === "string" && ctx.activeFile ? ctx.activeFile : null,
    activePreview: typeof ctx.activePreview === "string" && ctx.activePreview ? ctx.activePreview : null,
    pinnedFiles: Array.isArray(ctx.pinnedFiles)
      ? ctx.pinnedFiles.filter((item) => typeof item === "string" && item)
      : [],
  };
}

function nullableString(value) {
  return typeof value === "string" && value ? value : null;
}

function nullableNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeOperations(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item)
    : [];
}

function normalizeSessionFile(file) {
  const source = file && typeof file === "object" ? file : {};
  return {
    fileId: nullableString(source.fileId || source.id),
    label: nullableString(source.label || source.displayName || source.filename || source.filePath),
    displayName: nullableString(source.displayName),
    filename: nullableString(source.filename),
    ext: nullableString(source.ext),
    kind: nullableString(source.kind),
    mime: nullableString(source.mime),
    size: nullableNumber(source.size),
    origin: nullableString(source.origin),
    operations: normalizeOperations(source.operations),
    storageKind: nullableString(source.storageKind),
    status: nullableString(source.status) || "available",
    missingAt: nullableNumber(source.missingAt),
    createdAt: nullableNumber(source.createdAt),
    isDirectory: source.isDirectory === true,
    filePath: nullableString(source.filePath),
    realPath: nullableString(source.realPath),
  };
}

function sessionFilesStatus(sessionPath, deps) {
  if (typeof deps.listSessionFiles !== "function") {
    return {
      session_files: {
        sessionPath: sessionPath || null,
        registryAvailable: false,
        files: [],
        error: "session file registry unavailable",
      },
    };
  }
  if (!sessionPath) {
    return {
      session_files: {
        sessionPath: null,
        registryAvailable: true,
        files: [],
      },
    };
  }
  return {
    session_files: {
      sessionPath,
      registryAvailable: true,
      files: deps.listSessionFiles(sessionPath).map(normalizeSessionFile),
    },
  };
}

function normalizeProvider(item) {
  if (!item || typeof item !== "object") return null;
  if (typeof item.key !== "string" || !item.key.trim()) return null;
  if (typeof item.get !== "function") return null;
  return {
    key: item.key.trim(),
    description: typeof item.description === "string" ? item.description : "",
    get: item.get,
  };
}

export function createCurrentStatusRegistry(deps = {}) {
  const getNow = () => {
    const value = deps.now?.();
    return value instanceof Date ? value : new Date();
  };
  const getTimezone = () => resolveTimezone(deps.getTimezone?.());

  const providers = [
    provider(
      "time",
      "Current real time, configured timezone, local datetime, and UTC offset.",
      async () => {
        const now = getNow();
        const timeZone = getTimezone();
        return {
          time: {
            iso: now.toISOString(),
            timezone: timeZone,
            localDateTime: formatLocalDateTime(zonedParts(now, timeZone)),
            utcOffset: getUtcOffset(now, timeZone),
          },
        };
      },
    ),
    provider(
      "logical_date",
      "Logical date. The day starts at 04:00 in the configured timezone.",
      async () => {
        const now = getNow();
        const timeZone = getTimezone();
        return {
          logical_date: {
            date: getLogicalDate(now, timeZone),
            timezone: timeZone,
            dayBoundaryHour: DAY_BOUNDARY_HOUR,
          },
        };
      },
    ),
    provider(
      "agent",
      "Current agent identity: stable id and display name.",
      async () => ({ agent: agentSummary(deps.getAgent?.()) }),
    ),
    provider(
      "model",
      "Current session model when available; otherwise the current selected chat model.",
      async ({ sessionPath }) => ({
        model: modelSummary(
          (sessionPath ? deps.getSessionModel?.(sessionPath) : null)
            || deps.getCurrentModel?.()
            || null,
        ),
      }),
    ),
    provider(
      "ui_context",
      "User's current visible UI context for resolving references to what they are looking at. Returns the current viewed folder, active file or preview title, and pinned viewer files. Call this before working on requests that mention this file, here, current, open, visible, selected, pinned, current file, or current folder.",
      async ({ sessionPath }) => ({
        ui_context: normalizeUiContext(deps.getUiContext?.(sessionPath) || null),
      }),
    ),
    provider(
      "session_files",
      "Current session's registered files. Use this before reusing screenshots, uploads, plugin outputs, or other files produced in the conversation; it returns file ids, labels, lifecycle metadata, and local paths.",
      async ({ sessionPath }) => sessionFilesStatus(sessionPath, deps),
    ),
  ];

  for (const extra of deps.providers || []) {
    const normalized = normalizeProvider(extra);
    if (!normalized) continue;
    const index = providers.findIndex((item) => item.key === normalized.key);
    if (index === -1) providers.push(normalized);
    else providers[index] = normalized;
  }

  return new Map(providers.map((item) => [item.key, item]));
}

export function createCurrentStatusTool(deps = {}) {
  const registry = createCurrentStatusRegistry(deps);
  return {
    name: "current_status",
    label: "Current Status",
    description:
      "Lightweight current-environment status. Use it to check fresh state such as time, logical date, agent identity, model identity, and the user's visible UI context. IMPORTANT: The date/time shown in the system prompt is a snapshot from when the session was created and may be outdated. For precise current time, scheduling, reminders, date calculations that need clock time, greetings, or any case where hour/minute matters, call this tool with action=\"get\", key=\"time\". Use key=\"logical_date\" only when you need to know which calendar day Hana should treat as today under the 4:00 boundary; it does not return hour/minute/second. When the user refers to this file, here, the current/open/visible/selected item, the pinned window, or the current folder, call this tool first to resolve the reference.",
    parameters: Type.Object({
      action: StringEnum(["list", "get"], {
        description: "list returns available status keys; get returns one status key value.",
      }),
      key: Type.Optional(Type.String({
        description: "Status key to fetch when action=get. Common keys: time, logical_date, agent, model, ui_context, session_files. Use ui_context for references to the user's visible workspace and session_files for files registered in the current conversation.",
      })),
    }),
    execute: async (_toolCallId, params = {}, _signal, _onUpdate, ctx) => {
      const action = params.action || "list";
      if (action === "list") {
        return toolOk(JSON.stringify({
          available: [...registry.values()].map((item) => ({
            key: item.key,
            description: item.description,
          })),
          usage: DEFAULT_USAGE,
        }, null, 2));
      }

      const key = typeof params.key === "string" ? params.key.trim() : "";
      if (!key) {
        return toolError("current_status get requires a key. Call action=list to see available keys.", {
          errorCode: "STATUS_KEY_REQUIRED",
        });
      }
      const item = registry.get(key);
      if (!item) {
        return toolError(`Unknown status key: ${key}. Call action=list to see available keys.`, {
          errorCode: "UNKNOWN_STATUS_KEY",
          key,
        });
      }

      const sessionPath = getToolSessionPath(ctx);
      const payload = await item.get({ sessionPath, ctx });
      return toolOk(JSON.stringify(payload, null, 2), { action, key });
    },
  };
}
