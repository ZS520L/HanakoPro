import fs from "node:fs";

export const PI_BUILTIN_TOOL_NAMES = Object.freeze([
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
]);

function readPiCodingAgentVersion() {
  let dir = new URL("./", import.meta.resolve("@mariozechner/pi-coding-agent"));
  while (dir.href !== new URL("../", dir).href) {
    const pkgUrl = new URL("package.json", dir);
    if (fs.existsSync(pkgUrl)) {
      const pkg = JSON.parse(fs.readFileSync(pkgUrl, "utf8"));
      if (pkg.name === "@mariozechner/pi-coding-agent" && typeof pkg.version === "string") {
        return pkg.version;
      }
    }
    dir = new URL("../", dir);
  }
  throw new Error("Unable to resolve @mariozechner/pi-coding-agent package version");
}

export const PI_CODING_AGENT_VERSION = readPiCodingAgentVersion();

export function getPiCodingAgentVersion() {
  return PI_CODING_AGENT_VERSION;
}

export function isPiSdkNameAllowlistVersion(version = getPiCodingAgentVersion()) {
  const [major, minor] = String(version).split(".").map(part => Number.parseInt(part, 10));
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    throw new Error(`Unsupported @mariozechner/pi-coding-agent version: ${version}`);
  }
  return major > 0 || (major === 0 && minor >= 68);
}

export function assertAgentTool(tool, owner = "createAgentSession.tools") {
  if (!tool || typeof tool !== "object") {
    throw new TypeError(`${owner} must contain tool objects`);
  }
  if (typeof tool.name !== "string" || tool.name.length === 0) {
    throw new TypeError(`${owner} contains a tool without a non-empty string name`);
  }
  if (typeof tool.execute !== "function") {
    throw new TypeError(`${owner}.${tool.name} must have an execute function`);
  }
}

export function getToolDefinitionName(tool, owner = "createAgentSession.customTools") {
  if (!tool || typeof tool !== "object") {
    throw new TypeError(`${owner} must contain tool definition objects`);
  }
  if (typeof tool.name !== "string" || tool.name.length === 0) {
    throw new TypeError(`${owner} contains a tool without a non-empty string name`);
  }
  return tool.name;
}

export function agentToolToToolDefinition(tool) {
  assertAgentTool(tool);
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    prepareArguments: tool.prepareArguments,
    executionMode: tool.executionMode,
    renderCall: tool.renderCall,
    renderResult: tool.renderResult,
    renderShell: tool.renderShell,
    promptSnippet: tool.promptSnippet,
    promptGuidelines: tool.promptGuidelines,
    execute: async (toolCallId, params, signal, onUpdate, ctx) =>
      tool.execute(toolCallId, params, signal, onUpdate, ctx),
  };
}

export function uniqueToolNames(names) {
  return [...new Set(
    names.filter(name => typeof name === "string" && name.length > 0),
  )];
}

export function normalizeCreateAgentSessionOptions(options, version = getPiCodingAgentVersion()) {
  if (!options || typeof options !== "object") {
    return options;
  }

  if (!isPiSdkNameAllowlistVersion(version)) {
    return options;
  }

  const rawTools = Array.isArray(options.tools) ? options.tools : [];
  const rawCustomTools = Array.isArray(options.customTools) ? options.customTools : [];

  for (const tool of rawTools) assertAgentTool(tool);
  const convertedBaseTools = rawTools.map(agentToolToToolDefinition);
  const allowedNames = uniqueToolNames([
    ...rawTools.map(tool => tool.name),
    ...rawCustomTools.map(tool => getToolDefinitionName(tool)),
  ]);

  return {
    ...options,
    tools: allowedNames,
    customTools: [
      ...convertedBaseTools,
      ...rawCustomTools,
    ],
  };
}
