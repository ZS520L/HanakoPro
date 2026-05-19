import { describe, expect, it } from "vitest";
import { classifySessionPermission } from "../core/session-permission-mode.js";
import { createCurrentStatusTool } from "../lib/tools/current-status-tool.js";

function textPayload(result) {
  return JSON.parse(result.content[0].text);
}

function makeCtx(sessionPath = "/tmp/agents/hana/sessions/s1.jsonl") {
  return {
    sessionManager: {
      getSessionFile: () => sessionPath,
    },
  };
}

describe("current_status tool", () => {
  it("describes time and logical_date as distinct lookup contracts", () => {
    const tool = createCurrentStatusTool();

    expect(tool.description).toContain('key="time"');
    expect(tool.description).toContain("hour/minute");
    expect(tool.description).toContain('key="logical_date"');
    expect(tool.description).toContain("does not return hour/minute/second");
  });

  it("lists available status keys without returning live status values", async () => {
    const tool = createCurrentStatusTool({
      now: () => new Date("2026-05-03T19:30:00.000Z"),
      getTimezone: () => "Asia/Shanghai",
      getAgent: () => ({ id: "hana", agentName: "Hana" }),
      getSessionModel: () => ({ id: "claude-sonnet-4-5", provider: "anthropic", name: "Claude Sonnet 4.5" }),
    });

    const payload = textPayload(await tool.execute("call_1", { action: "list" }));

    expect(payload.available.map((item) => item.key)).toEqual([
      "time",
      "logical_date",
      "agent",
      "model",
      "ui_context",
      "session_files",
    ]);
    expect(payload.usage).toContain("list");
    expect(payload.usage).toContain("get");
    expect(JSON.stringify(payload)).not.toContain("Hana");
    expect(JSON.stringify(payload)).not.toContain("claude-sonnet-4-5");
    expect(JSON.stringify(payload)).not.toContain("2026-05-03T19:30:00.000Z");
  });

  it("returns only time fields for get time", async () => {
    const tool = createCurrentStatusTool({
      now: () => new Date("2026-05-03T19:30:00.000Z"),
      getTimezone: () => "Asia/Shanghai",
      getAgent: () => ({ id: "hana", agentName: "Hana" }),
      getSessionModel: () => ({ id: "claude-sonnet-4-5", provider: "anthropic", name: "Claude Sonnet 4.5" }),
    });

    const payload = textPayload(await tool.execute("call_1", { action: "get", key: "time" }, null, null, makeCtx()));

    expect(payload).toEqual({
      time: {
        iso: "2026-05-03T19:30:00.000Z",
        timezone: "Asia/Shanghai",
        localDateTime: "2026-05-04 03:30:00",
        utcOffset: "+08:00",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("Hana");
    expect(JSON.stringify(payload)).not.toContain("claude-sonnet-4-5");
  });

  it("computes logical date in the configured timezone with the 4am boundary", async () => {
    const tool = createCurrentStatusTool({
      now: () => new Date("2026-05-03T19:30:00.000Z"),
      getTimezone: () => "Asia/Shanghai",
    });

    const payload = textPayload(await tool.execute("call_1", { action: "get", key: "logical_date" }));

    expect(payload).toEqual({
      logical_date: {
        date: "2026-05-03",
        timezone: "Asia/Shanghai",
        dayBoundaryHour: 4,
      },
    });
  });

  it("returns only agent fields for get agent", async () => {
    const tool = createCurrentStatusTool({
      getAgent: () => ({ id: "hana", agentName: "Hana" }),
      now: () => new Date("2026-05-03T19:30:00.000Z"),
    });

    const payload = textPayload(await tool.execute("call_1", { action: "get", key: "agent" }));

    expect(payload).toEqual({
      agent: {
        id: "hana",
        name: "Hana",
      },
    });
  });

  it("returns the current session model for get model", async () => {
    const tool = createCurrentStatusTool({
      getSessionModel: (sessionPath) => sessionPath.endsWith("s1.jsonl")
        ? { id: "claude-sonnet-4-5", provider: "anthropic", name: "Claude Sonnet 4.5" }
        : null,
      getCurrentModel: () => ({ id: "fallback", provider: "openai", name: "Fallback" }),
    });

    const payload = textPayload(await tool.execute("call_1", { action: "get", key: "model" }, null, null, makeCtx()));

    expect(payload).toEqual({
      model: {
        id: "claude-sonnet-4-5",
        provider: "anthropic",
        name: "Claude Sonnet 4.5",
      },
    });
  });

  it("returns passive UI context metadata for get ui_context", async () => {
    const tool = createCurrentStatusTool({
      getUiContext: (sessionPath) => sessionPath.endsWith("s1.jsonl")
        ? {
            currentViewed: "/workspace/notes",
            activeFile: "/workspace/notes/diary.md",
            activePreview: null,
            pinnedFiles: ["/workspace/spec.md"],
          }
        : null,
    });

    const payload = textPayload(await tool.execute("call_1", { action: "get", key: "ui_context" }, null, null, makeCtx()));

    expect(payload).toEqual({
      ui_context: {
        currentViewed: "/workspace/notes",
        activeFile: "/workspace/notes/diary.md",
        activePreview: null,
        pinnedFiles: ["/workspace/spec.md"],
      },
    });
  });

  it("returns an empty UI context shape when no visible UI context is stored", async () => {
    const tool = createCurrentStatusTool({
      getUiContext: () => null,
    });

    const payload = textPayload(await tool.execute("call_1", { action: "get", key: "ui_context" }, null, null, makeCtx()));

    expect(payload).toEqual({
      ui_context: {
        currentViewed: null,
        activeFile: null,
        activePreview: null,
        pinnedFiles: [],
      },
    });
  });

  it("returns normalized current session files for get session_files", async () => {
    const tool = createCurrentStatusTool({
      listSessionFiles: (sessionPath) => sessionPath.endsWith("s1.jsonl")
        ? [
            {
              id: "sf_browser",
              fileId: "sf_browser",
              sessionPath,
              filePath: "/tmp/session-files/browser-screenshot.jpg",
              realPath: "/private/tmp/session-files/browser-screenshot.jpg",
              label: "browser-screenshot.jpg",
              displayName: "Browser Screenshot",
              filename: "browser-screenshot.jpg",
              ext: "jpg",
              mime: "image/jpeg",
              kind: "image",
              size: 12345,
              origin: "browser_screenshot",
              operations: ["captured"],
              storageKind: "managed_cache",
              status: "available",
              missingAt: null,
              createdAt: 1778432852184,
              isDirectory: false,
              internalOnly: "must not leak",
            },
            {
              id: "sf_expired",
              sessionPath,
              filePath: "/tmp/session-files/old.png",
              label: "old.png",
              mime: "image/png",
              kind: "image",
              origin: "browser_screenshot",
              operations: ["captured"],
              storageKind: "managed_cache",
              status: "expired",
              missingAt: 1778432859999,
            },
          ]
        : [],
    });

    const payload = textPayload(await tool.execute("call_1", { action: "get", key: "session_files" }, null, null, makeCtx()));

    expect(payload).toEqual({
      session_files: {
        sessionPath: "/tmp/agents/hana/sessions/s1.jsonl",
        registryAvailable: true,
        files: [
          {
            fileId: "sf_browser",
            label: "browser-screenshot.jpg",
            displayName: "Browser Screenshot",
            filename: "browser-screenshot.jpg",
            ext: "jpg",
            kind: "image",
            mime: "image/jpeg",
            size: 12345,
            origin: "browser_screenshot",
            operations: ["captured"],
            storageKind: "managed_cache",
            status: "available",
            missingAt: null,
            createdAt: 1778432852184,
            isDirectory: false,
            filePath: "/tmp/session-files/browser-screenshot.jpg",
            realPath: "/private/tmp/session-files/browser-screenshot.jpg",
          },
          {
            fileId: "sf_expired",
            label: "old.png",
            displayName: null,
            filename: null,
            ext: null,
            kind: "image",
            mime: "image/png",
            size: null,
            origin: "browser_screenshot",
            operations: ["captured"],
            storageKind: "managed_cache",
            status: "expired",
            missingAt: 1778432859999,
            createdAt: null,
            isDirectory: false,
            filePath: "/tmp/session-files/old.png",
            realPath: null,
          },
        ],
      },
    });
    expect(JSON.stringify(payload)).not.toContain("internalOnly");
  });

  it("returns a clear error for unknown keys", async () => {
    const tool = createCurrentStatusTool();

    const result = await tool.execute("call_1", { action: "get", key: "session_path" });

    expect(result.content[0].text).toContain("Unknown status key");
    expect(result.details.errorCode).toBe("UNKNOWN_STATUS_KEY");
  });

  it("is allowed in read-only permission mode", () => {
    expect(classifySessionPermission({ mode: "read_only", toolName: "current_status" }))
      .toEqual({ action: "allow" });
  });
});
