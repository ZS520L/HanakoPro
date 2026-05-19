import { describe, expect, it, vi } from "vitest";
import {
  PI_BUILTIN_TOOL_NAMES,
  agentToolToToolDefinition,
  normalizeCreateAgentSessionOptions,
  uniqueToolNames,
} from "../lib/pi-sdk/session-options.js";

function makeAgentTool(name) {
  return {
    name,
    label: `${name} label`,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
    prepareArguments: vi.fn(args => args),
    executionMode: "foreground",
    renderCall: vi.fn(),
    renderResult: vi.fn(),
    execute: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
  };
}

describe("Pi SDK session option normalization", () => {
  it("exposes stable Hana built-in tool names without SDK prebuilt objects", () => {
    expect(PI_BUILTIN_TOOL_NAMES).toEqual(["read", "write", "edit", "bash", "grep", "find", "ls"]);
    expect(Object.isFrozen(PI_BUILTIN_TOOL_NAMES)).toBe(true);
  });

  it("converts AgentTool objects into SDK ToolDefinition objects", async () => {
    const read = makeAgentTool("read");
    const definition = agentToolToToolDefinition(read);

    expect(definition).toMatchObject({
      name: "read",
      label: "read label",
      description: "read description",
      parameters: { type: "object", properties: {} },
      executionMode: "foreground",
    });

    const result = await definition.execute("call-1", { path: "a.txt" }, "signal", "update", { session: true });
    expect(read.execute).toHaveBeenCalledWith("call-1", { path: "a.txt" }, "signal", "update", { session: true });
    expect(result.content[0].text).toBe("ok");
  });

  it("normalizes Hana Tool[] plus customTools into Pi 0.68+ name allowlist and SDK custom tools", () => {
    const read = makeAgentTool("read");
    const bash = makeAgentTool("bash");
    const custom = {
      name: "web_search",
      description: "search",
      parameters: { type: "object", properties: {} },
      execute: vi.fn(),
    };

    const normalized = normalizeCreateAgentSessionOptions({
      cwd: "/tmp/project",
      tools: [read, bash],
      customTools: [custom],
      model: { id: "m" },
    }, "0.70.2");

    expect(normalized.tools).toEqual(["read", "bash", "web_search"]);
    expect(normalized.customTools.map(t => t.name)).toEqual(["read", "bash", "web_search"]);
    expect(normalized.customTools[0]).not.toBe(read);
    expect(normalized.customTools[2]).toBe(custom);
    expect(normalized.model).toEqual({ id: "m" });
  });

  it("keeps empty tools empty for explicit no-tools sessions", () => {
    const normalized = normalizeCreateAgentSessionOptions({
      tools: [],
      customTools: [],
    }, "0.70.2");

    expect(normalized.tools).toEqual([]);
    expect(normalized.customTools).toEqual([]);
  });

  it("deduplicates active names while preserving first occurrence order", () => {
    expect(uniqueToolNames(["read", "bash", "read", "", null, "web_search"])).toEqual([
      "read",
      "bash",
      "web_search",
    ]);
  });

  it("keeps same-name custom definitions after converted base tools so SDK override order remains explicit", () => {
    const read = makeAgentTool("read");
    const customRead = {
      name: "read",
      description: "custom read",
      parameters: { type: "object", properties: {} },
      execute: vi.fn(),
    };

    const normalized = normalizeCreateAgentSessionOptions({
      tools: [read],
      customTools: [customRead],
    }, "0.70.2");

    expect(normalized.tools).toEqual(["read"]);
    expect(normalized.customTools.map(t => t.name)).toEqual(["read", "read"]);
    expect(normalized.customTools[1]).toBe(customRead);
  });

  it("throws a clear error for malformed base tools in Pi 0.68+ mode", () => {
    expect(() => normalizeCreateAgentSessionOptions({
      tools: [{ name: "read" }],
      customTools: [],
    }, "0.70.2")).toThrow("createAgentSession.tools.read must have an execute function");
  });

  it("throws a clear error for malformed custom tools in Pi 0.68+ mode", () => {
    const read = makeAgentTool("read");
    expect(() => normalizeCreateAgentSessionOptions({
      tools: [read],
      customTools: [{}],
    }, "0.70.2")).toThrow("createAgentSession.customTools contains a tool without a non-empty string name");
  });

  it("preserves old SDK options for pre-0.68 compatibility", () => {
    const read = makeAgentTool("read");
    const options = { tools: [read], customTools: [] };
    expect(normalizeCreateAgentSessionOptions(options, "0.67.68")).toBe(options);
  });
});
