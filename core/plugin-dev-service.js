import fs from "fs";
import path from "path";
import crypto from "crypto";

const DEFAULT_LOG_LIMIT = 200;
const SAFE_PLUGIN_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const REDACT_KEY_RE = /api[-_]?key|token|secret|password|authorization|credential/i;
const OBJECT_SCHEMA = Object.freeze({ type: "object", additionalProperties: true });

export const PLUGIN_DEV_EVENT_BUS_CAPABILITIES = Object.freeze([
  {
    type: "plugin.dev.install",
    title: "Install dev plugin",
    description: "Copy a plugin source directory into the dev plugin install slot and load it.",
    inputSchema: {
      type: "object",
      properties: {
        sourcePath: { type: "string" },
        path: { type: "string" },
        pluginId: { type: "string" },
        allowFullAccess: { type: "boolean" },
      },
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.write",
    errors: ["NO_HANDLER", "TIMEOUT", "INVALID_PAYLOAD", "FORBIDDEN", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "plugin.dev.reload",
    title: "Reload dev plugin",
    description: "Reload a previously installed dev plugin from its registered source slot.",
    inputSchema: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        devRunId: { type: "string" },
        allowFullAccess: { type: "boolean" },
      },
      required: ["pluginId"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "plugin.dev.disable",
    title: "Disable dev plugin",
    description: "Disable a loaded dev plugin without writing to the user's normal plugin preferences.",
    inputSchema: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        devRunId: { type: "string" },
      },
      required: ["pluginId"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "CONFLICT", "FORBIDDEN", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "plugin.dev.enable",
    title: "Enable dev plugin",
    description: "Enable a dev plugin from its remembered dev slot without writing normal plugin preferences.",
    inputSchema: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        devRunId: { type: "string" },
        allowFullAccess: { type: "boolean" },
      },
      required: ["pluginId"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "CONFLICT", "FORBIDDEN", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "plugin.dev.reset",
    title: "Reset dev plugin",
    description: "Reload a dev plugin from its remembered source slot and create a fresh dev run.",
    inputSchema: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        devRunId: { type: "string" },
        allowFullAccess: { type: "boolean" },
      },
      required: ["pluginId"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "CONFLICT", "FORBIDDEN", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "plugin.dev.uninstall",
    title: "Uninstall dev plugin",
    description: "Remove a dev plugin from the dev plugin directory and forget its dev slot.",
    inputSchema: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        devRunId: { type: "string" },
      },
      required: ["pluginId"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.write",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "CONFLICT", "FORBIDDEN", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "plugin.dev.invokeTool",
    title: "Invoke dev plugin tool",
    description: "Invoke one loaded plugin tool with explicit input for debug loops.",
    inputSchema: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        toolName: { type: "string" },
        input: { type: "object" },
        sessionPath: { type: "string" },
        agentId: { type: "string" },
      },
      required: ["pluginId", "toolName"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.execute",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "plugin.dev.diagnostics",
    title: "Read dev plugin diagnostics",
    description: "Read dev slots, plugin diagnostics, logs, and surfaces.",
    inputSchema: {
      type: "object",
      properties: { pluginId: { type: "string" } },
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.read",
    errors: ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "plugin.dev.listSurfaces",
    title: "List plugin UI surfaces",
    description: "List page and widget surfaces available for plugin UI debugging.",
    inputSchema: {
      type: "object",
      properties: { pluginId: { type: "string" } },
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.read",
    errors: ["NO_HANDLER", "TIMEOUT", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "plugin.dev.describeSurfaceDebug",
    title: "Describe plugin UI debug surface",
    description: "Return an element-first debug descriptor for one plugin UI surface.",
    inputSchema: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        kind: { type: "string" },
        route: { type: "string" },
      },
      required: ["pluginId"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.read",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "plugin.dev.getScenarios",
    title: "List dev scenarios",
    description: "List manifest-declared dev scenarios for a plugin.",
    inputSchema: {
      type: "object",
      properties: { pluginId: { type: "string" } },
      required: ["pluginId"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.read",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
  {
    type: "plugin.dev.runScenario",
    title: "Run dev scenario",
    description: "Run one manifest-declared dev scenario.",
    inputSchema: {
      type: "object",
      properties: {
        pluginId: { type: "string" },
        scenarioId: { type: "string" },
        allowDestructive: { type: "boolean" },
      },
      required: ["pluginId", "scenarioId"],
      additionalProperties: false,
    },
    outputSchema: OBJECT_SCHEMA,
    permission: "plugin.dev.execute",
    errors: ["NO_HANDLER", "TIMEOUT", "NOT_FOUND", "FORBIDDEN", "INTERNAL_ERROR"],
    stability: "experimental",
    owner: "system",
  },
]);

function createDevError(message, status = 400, code = "PLUGIN_DEV_ERROR") {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function safeJsonClone(value) {
  if (value == null || typeof value !== "object") return value;
  try {
    return JSON.parse(JSON.stringify(value, (_key, item) => {
      if (typeof item === "bigint") return item.toString();
      if (typeof item === "function") return `[Function ${item.name || "anonymous"}]`;
      if (typeof item === "symbol") return item.toString();
      if (item instanceof Error) {
        return { name: item.name, message: item.message, stack: item.stack };
      }
      return item;
    }));
  } catch {
    return String(value);
  }
}

function redactValue(value, key = "") {
  if (REDACT_KEY_RE.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [childKey, redactValue(childValue, childKey)]),
  );
}

function serializeLogArg(arg) {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (arg == null) return String(arg);
  if (typeof arg === "object") return JSON.stringify(redactValue(safeJsonClone(arg)));
  return String(arg);
}

function summarizePlugin(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    source: entry.source || "community",
    trust: entry.trust || "restricted",
    status: entry.status,
    error: entry.error || null,
    activationState: entry.activationState || null,
    activationError: entry.activationError || null,
    contributions: Array.isArray(entry.contributions) ? [...entry.contributions] : [],
    accessLevel: entry.accessLevel || null,
    pluginDir: entry.pluginDir,
  };
}

function shouldCopyPath(src, sourceRoot) {
  const rel = path.relative(sourceRoot, src);
  if (!rel) return true;
  const parts = rel.split(path.sep);
  return !parts.some((part) => (
    part === "node_modules"
    || part === ".git"
    || part === ".DS_Store"
    || part === ".cache"
  ));
}

function extractToolResultText(invocation) {
  const result = invocation?.result;
  if (Array.isArray(result?.content)) {
    return result.content
      .map((block) => {
        if (typeof block?.text === "string") return block.text;
        if (typeof block === "string") return block;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof result === "string") return result;
  return JSON.stringify(result ?? "");
}

function assertInsideDir(childPath, parentDir) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentDir);
  const parentWithSep = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child === parent || child.startsWith(parentWithSep);
}

export class PluginDevService {
  constructor({
    pluginManager,
    devPluginsDir,
    runDataDir,
    allowedSourceRoots = [],
    syncPluginExtensions,
    logLimit = DEFAULT_LOG_LIMIT,
  }) {
    if (!pluginManager) throw new Error("PluginDevService requires pluginManager");
    if (!devPluginsDir) throw new Error("PluginDevService requires devPluginsDir");
    if (!runDataDir) throw new Error("PluginDevService requires runDataDir");
    this._pluginManager = pluginManager;
    this._devPluginsDir = path.resolve(devPluginsDir);
    this._runDataDir = path.resolve(runDataDir);
    this._syncPluginExtensions = typeof syncPluginExtensions === "function"
      ? syncPluginExtensions
      : async () => {};
    this._slots = new Map();
    this._logs = [];
    this._logLimit = Number.isFinite(logLimit) && logLimit > 0 ? logLimit : DEFAULT_LOG_LIMIT;
    this._allowedSourceRoots = allowedSourceRoots.map((root) => this._normalizeRoot(root));
    this._eventBusDisposers = [];
  }

  _normalizeRoot(root) {
    const abs = path.resolve(String(root || ""));
    if (!fs.existsSync(abs)) return abs;
    return fs.realpathSync(abs);
  }

  _resolveAllowedSourceDir(sourcePath) {
    if (!sourcePath || typeof sourcePath !== "string") {
      throw createDevError("sourcePath is required", 400, "PLUGIN_DEV_SOURCE_REQUIRED");
    }
    const abs = path.resolve(sourcePath);
    if (!fs.existsSync(abs)) {
      throw createDevError(`Plugin source path does not exist: ${abs}`, 404, "PLUGIN_DEV_SOURCE_NOT_FOUND");
    }
    const real = fs.realpathSync(abs);
    const stat = fs.statSync(real);
    if (!stat.isDirectory()) {
      throw createDevError("Plugin dev source must be a directory", 400, "PLUGIN_DEV_SOURCE_NOT_DIRECTORY");
    }
    const allowed = this._allowedSourceRoots.some((root) => {
      const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
      return real === root || real.startsWith(rootWithSep);
    });
    if (!allowed) {
      throw createDevError(
        `Plugin source path is outside allowed plugin dev roots: ${real}`,
        403,
        "PLUGIN_DEV_SOURCE_OUTSIDE_ALLOWED_ROOTS",
      );
    }
    return real;
  }

  _readAndValidateDescriptor(sourcePath, expectedPluginId) {
    const manifestPath = path.join(sourcePath, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      throw createDevError("Plugin dev source requires manifest.json", 400, "PLUGIN_DEV_MANIFEST_REQUIRED");
    }
    const desc = this._pluginManager.readPluginDescriptor(sourcePath, path.basename(sourcePath));
    if (!SAFE_PLUGIN_ID_RE.test(desc.id)) {
      throw createDevError(`Invalid plugin id for dev install: ${desc.id}`, 400, "PLUGIN_DEV_INVALID_ID");
    }
    if (expectedPluginId && desc.id !== expectedPluginId) {
      throw createDevError(
        `Plugin source id "${desc.id}" does not match requested plugin "${expectedPluginId}"`,
        400,
        "PLUGIN_DEV_ID_MISMATCH",
      );
    }
    return desc;
  }

  _copySourceToDevTarget(sourcePath, pluginId) {
    fs.mkdirSync(this._devPluginsDir, { recursive: true });
    const targetDir = path.join(this._devPluginsDir, pluginId);
    const tempDir = path.join(
      this._devPluginsDir,
      `.${pluginId}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.installing`,
    );
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.cpSync(sourcePath, tempDir, {
      recursive: true,
      filter: (src) => shouldCopyPath(src, sourcePath),
    });
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(tempDir, targetDir);
    return targetDir;
  }

  _writeRunRecord(record) {
    const runDir = path.join(this._runDataDir, record.pluginId);
    fs.mkdirSync(runDir, { recursive: true });
    const runPath = path.join(runDir, `${record.devRunId}.json`);
    fs.writeFileSync(runPath, JSON.stringify(record, null, 2));
    return runPath;
  }

  _rememberSlot(pluginId, slot) {
    this._slots.set(pluginId, {
      pluginId,
      sourcePath: slot.sourcePath,
      targetDir: slot.targetDir,
      allowFullAccess: !!slot.allowFullAccess,
      lastDevRunId: slot.lastDevRunId,
      updatedAt: slot.updatedAt,
    });
  }

  _forgetSlot(pluginId) {
    this._slots.delete(pluginId);
  }

  _requireDevSlot(pluginId, options = {}) {
    if (!pluginId) throw createDevError("pluginId is required", 400, "PLUGIN_DEV_PLUGIN_ID_REQUIRED");
    const slot = this._slots.get(pluginId);
    if (!slot) {
      throw createDevError(`No dev source slot registered for plugin "${pluginId}"`, 404, "PLUGIN_DEV_SLOT_NOT_FOUND");
    }
    if (options.devRunId && slot.lastDevRunId !== options.devRunId) {
      throw createDevError(
        `devRunId does not match the active dev slot for plugin "${pluginId}"`,
        409,
        "PLUGIN_DEV_RUN_ID_MISMATCH",
      );
    }
    const entry = this._pluginManager.getPlugin(pluginId);
    if (!entry) {
      throw createDevError(`Plugin "${pluginId}" not found`, 404, "PLUGIN_DEV_PLUGIN_NOT_FOUND");
    }
    if (entry.source !== "dev") {
      throw createDevError(`Plugin "${pluginId}" is not a dev plugin`, 403, "PLUGIN_DEV_NOT_DEV_PLUGIN");
    }
    if (!entry.pluginDir || !assertInsideDir(entry.pluginDir, this._devPluginsDir)) {
      throw createDevError(
        `Plugin "${pluginId}" is outside the dev plugin directory`,
        403,
        "PLUGIN_DEV_TARGET_OUTSIDE_DEV_DIR",
      );
    }
    if (!slot.targetDir || !assertInsideDir(slot.targetDir, this._devPluginsDir)) {
      throw createDevError(
        `Plugin "${pluginId}" dev slot points outside the dev plugin directory`,
        403,
        "PLUGIN_DEV_SLOT_OUTSIDE_DEV_DIR",
      );
    }
    return { slot, entry };
  }

  async _installDescriptor({ sourcePath, desc, allowFullAccess = false }) {
    const devRunId = `dev_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
    const startedAt = new Date().toISOString();
    const targetDir = this._copySourceToDevTarget(sourcePath, desc.id);
    const entry = await this._pluginManager.installPlugin(targetDir, {
      source: "dev",
      pluginId: desc.id,
      allowFullAccess: !!allowFullAccess,
    });
    await this._syncPluginExtensions();
    const completedAt = new Date().toISOString();
    const record = {
      devRunId,
      pluginId: entry.id,
      sourcePath,
      targetDir,
      status: entry.status,
      version: entry.version,
      allowFullAccess: !!allowFullAccess,
      startedAt,
      completedAt,
      error: entry.error || null,
    };
    const runPath = this._writeRunRecord(record);
    this._rememberSlot(entry.id, {
      sourcePath,
      targetDir,
      allowFullAccess,
      lastDevRunId: devRunId,
      updatedAt: completedAt,
    });
    return {
      ok: entry.status === "loaded",
      devRunId,
      runPath,
      plugin: summarizePlugin(entry),
      slot: this.getDevSlot(entry.id),
    };
  }

  async installFromSource({ sourcePath, allowFullAccess = false, pluginId } = {}) {
    const realSourcePath = this._resolveAllowedSourceDir(sourcePath);
    const desc = this._readAndValidateDescriptor(realSourcePath, pluginId);
    return this._installDescriptor({
      sourcePath: realSourcePath,
      desc,
      allowFullAccess,
    });
  }

  async reloadPlugin(pluginId, options = {}) {
    const { slot } = this._requireDevSlot(pluginId, options);
    const realSourcePath = this._resolveAllowedSourceDir(slot.sourcePath);
    const desc = this._readAndValidateDescriptor(realSourcePath, pluginId);
    return this._installDescriptor({
      sourcePath: realSourcePath,
      desc,
      allowFullAccess: options.allowFullAccess ?? slot.allowFullAccess,
    });
  }

  async disablePlugin(pluginId, options = {}) {
    this._requireDevSlot(pluginId, options);
    await this._pluginManager.disablePlugin(pluginId, { persist: false });
    await this._syncPluginExtensions();
    return {
      ok: true,
      pluginId,
      plugin: summarizePlugin(this._pluginManager.getPlugin(pluginId)),
      slot: this.getDevSlot(pluginId),
    };
  }

  async enablePlugin(pluginId, options = {}) {
    const { slot } = this._requireDevSlot(pluginId, options);
    await this._pluginManager.enablePlugin(pluginId, {
      persist: false,
      allowFullAccess: options.allowFullAccess ?? slot.allowFullAccess,
    });
    await this._syncPluginExtensions();
    return {
      ok: this._pluginManager.getPlugin(pluginId)?.status === "loaded",
      pluginId,
      plugin: summarizePlugin(this._pluginManager.getPlugin(pluginId)),
      slot: this.getDevSlot(pluginId),
    };
  }

  async resetPlugin(pluginId, options = {}) {
    this._requireDevSlot(pluginId, options);
    return this.reloadPlugin(pluginId, options);
  }

  async uninstallPlugin(pluginId, options = {}) {
    const { slot } = this._requireDevSlot(pluginId, options);
    const pluginDir = await this._pluginManager.removePlugin(pluginId, { persist: false });
    const removeTarget = slot.targetDir || pluginDir;
    if (removeTarget && assertInsideDir(removeTarget, this._devPluginsDir)) {
      fs.rmSync(removeTarget, { recursive: true, force: true });
    }
    this._forgetSlot(pluginId);
    await this._syncPluginExtensions();
    return {
      ok: true,
      pluginId,
      removedDir: removeTarget,
    };
  }

  async invokeTool({ pluginId, toolName, input = {}, sessionPath, agentId } = {}) {
    if (!pluginId) throw createDevError("pluginId is required", 400, "PLUGIN_DEV_PLUGIN_ID_REQUIRED");
    if (!toolName) throw createDevError("toolName is required", 400, "PLUGIN_DEV_TOOL_NAME_REQUIRED");
    const entry = this._pluginManager.getPlugin(pluginId);
    if (!entry) throw createDevError(`Plugin "${pluginId}" not found`, 404, "PLUGIN_DEV_PLUGIN_NOT_FOUND");
    if (entry.status !== "loaded") {
      throw createDevError(`Plugin "${pluginId}" is not loaded`, 409, "PLUGIN_DEV_PLUGIN_NOT_LOADED");
    }
    const fullToolName = toolName.includes("_") ? toolName : `${pluginId}_${toolName}`;
    const tool = this._pluginManager.getAllTools().find((candidate) => (
      candidate._pluginId === pluginId
      && (candidate.name === fullToolName || candidate.name === toolName)
    ));
    if (!tool) {
      throw createDevError(`Tool "${toolName}" not found for plugin "${pluginId}"`, 404, "PLUGIN_DEV_TOOL_NOT_FOUND");
    }
    const startedAt = Date.now();
    const runtimeCtx = {
      pluginDev: true,
      ...(agentId ? { agentId } : {}),
      ...(sessionPath ? {
        sessionPath,
        sessionManager: { getSessionFile: () => sessionPath },
      } : {}),
    };
    const result = await tool.execute(`plugin-dev-${startedAt}`, input, runtimeCtx);
    return {
      pluginId,
      toolName: tool.name,
      durationMs: Date.now() - startedAt,
      result,
    };
  }

  listSurfaces(pluginId) {
    const include = (item) => !pluginId || item.pluginId === pluginId;
    return [
      ...this._pluginManager.getPages().filter(include).map((item) => ({
        kind: "page",
        pluginId: item.pluginId,
        title: item.title,
        route: item.route,
        routeUrl: `/api/plugins/${item.pluginId}${item.route}`,
        hostCapabilities: [...(item.hostCapabilities || [])],
      })),
      ...this._pluginManager.getWidgets().filter(include).map((item) => ({
        kind: "widget",
        pluginId: item.pluginId,
        title: item.title,
        route: item.route,
        routeUrl: `/api/plugins/${item.pluginId}${item.route}`,
        hostCapabilities: [...(item.hostCapabilities || [])],
      })),
    ];
  }

  describeSurfaceDebug({ pluginId, kind, route } = {}) {
    const surfaces = this.listSurfaces(pluginId);
    const surface = surfaces.find((item) => (
      (!kind || item.kind === kind)
      && (!route || item.route === route)
    ));
    if (!surface) {
      throw createDevError("Plugin UI surface not found", 404, "PLUGIN_DEV_SURFACE_NOT_FOUND");
    }
    return {
      surface,
      strategy: "element-first",
      elementBridge: {
        preferred: true,
        purpose: "Inspect accessible elements and operate controls directly before using visual screenshots.",
        operations: ["describeElements", "clickElement", "typeIntoElement", "pressElementKey", "readElementText"],
      },
      screenshot: {
        role: "visual confirmation and fallback when the element tree cannot explain a rendering issue",
      },
    };
  }

  getScenarios({ pluginId } = {}) {
    if (!pluginId) throw createDevError("pluginId is required", 400, "PLUGIN_DEV_PLUGIN_ID_REQUIRED");
    const entry = this._pluginManager.getPlugin(pluginId);
    if (!entry) throw createDevError(`Plugin "${pluginId}" not found`, 404, "PLUGIN_DEV_PLUGIN_NOT_FOUND");
    const scenarios = Array.isArray(entry.manifest?.dev?.scenarios)
      ? entry.manifest.dev.scenarios
      : [];
    return scenarios
      .filter((item) => item && typeof item.id === "string" && Array.isArray(item.steps))
      .map((item) => ({
        id: item.id,
        title: item.title || item.id,
        destructive: item.destructive === true,
        surface: item.surface || null,
        steps: safeJsonClone(item.steps),
      }));
  }

  async runScenario({ pluginId, scenarioId, allowDestructive = false } = {}) {
    if (!scenarioId) throw createDevError("scenarioId is required", 400, "PLUGIN_DEV_SCENARIO_ID_REQUIRED");
    const scenario = this.getScenarios({ pluginId }).find((item) => item.id === scenarioId);
    if (!scenario) {
      throw createDevError(
        `Scenario "${scenarioId}" not found for plugin "${pluginId}"`,
        404,
        "PLUGIN_DEV_SCENARIO_NOT_FOUND",
      );
    }
    if (scenario.destructive && !allowDestructive) {
      throw createDevError(
        `Scenario "${scenarioId}" is destructive and requires explicit approval`,
        403,
        "PLUGIN_DEV_SCENARIO_DESTRUCTIVE",
      );
    }

    const steps = [];
    let lastToolInvocation = null;
    for (let index = 0; index < scenario.steps.length; index += 1) {
      const step = scenario.steps[index];
      if (step?.invokeTool) {
        const invocation = await this.invokeTool({
          pluginId,
          toolName: step.invokeTool.name,
          input: step.invokeTool.input || {},
          sessionPath: step.invokeTool.sessionPath,
          agentId: step.invokeTool.agentId,
        });
        lastToolInvocation = invocation;
        steps.push({
          index,
          type: "invokeTool",
          status: "passed",
          toolName: invocation.toolName,
          result: invocation.result,
        });
        continue;
      }
      if (typeof step?.expectToolText === "string") {
        const actual = extractToolResultText(lastToolInvocation);
        if (!actual.includes(step.expectToolText)) {
          steps.push({
            index,
            type: "expectToolText",
            status: "failed",
            expected: step.expectToolText,
            actual,
          });
          return { pluginId, scenarioId, status: "failed", steps };
        }
        steps.push({
          index,
          type: "expectToolText",
          status: "passed",
          expected: step.expectToolText,
        });
        continue;
      }
      if (step?.openSurface) {
        const requested = String(step.openSurface);
        const surface = this.listSurfaces(pluginId).find((item) => (
          item.route === requested
          || item.routeUrl === requested
          || `${item.kind}:${item.route}` === requested
        ));
        if (!surface) {
          steps.push({
            index,
            type: "openSurface",
            status: "failed",
            expected: requested,
          });
          return { pluginId, scenarioId, status: "failed", steps };
        }
        steps.push({
          index,
          type: "openSurface",
          status: "passed",
          surface,
          debug: this.describeSurfaceDebug({ pluginId, kind: surface.kind, route: surface.route }),
        });
        continue;
      }
      steps.push({ index, type: "unknown", status: "failed", step: safeJsonClone(step) });
      return { pluginId, scenarioId, status: "failed", steps };
    }
    return { pluginId, scenarioId, status: "passed", steps };
  }

  recordLog(entry = {}) {
    const args = Array.isArray(entry.args) ? entry.args : [];
    const log = {
      ts: entry.ts || new Date().toISOString(),
      pluginId: entry.pluginId || "unknown",
      level: entry.level || "info",
      message: entry.message || args.map(serializeLogArg).join(" "),
      args: redactValue(safeJsonClone(args)),
    };
    this._logs.push(log);
    if (this._logs.length > this._logLimit) {
      this._logs.splice(0, this._logs.length - this._logLimit);
    }
    return log;
  }

  getLogs(pluginId) {
    return this._logs.filter((log) => !pluginId || log.pluginId === pluginId);
  }

  getDevSlot(pluginId) {
    const slot = this._slots.get(pluginId);
    return slot ? { ...slot } : null;
  }

  getDiagnostics(pluginId) {
    const plugins = typeof this._pluginManager.getDiagnostics === "function"
      ? this._pluginManager.getDiagnostics()
      : [];
    const scenarios = pluginId && this._pluginManager.getPlugin(pluginId)
      ? this.getScenarios({ pluginId }).map(({ steps: _steps, ...scenario }) => scenario)
      : [];
    return {
      devSlots: [...this._slots.values()].filter((slot) => !pluginId || slot.pluginId === pluginId),
      plugins: plugins.filter((plugin) => !pluginId || plugin.id === pluginId),
      logs: this.getLogs(pluginId),
      surfaces: this.listSurfaces(pluginId),
      scenarios,
    };
  }

  registerEventBusHandlers(bus) {
    if (!bus || typeof bus.handle !== "function") {
      throw new Error("PluginDevService.registerEventBusHandlers requires EventBus.handle");
    }
    this.unregisterEventBusHandlers();
    const handlers = [
      ["plugin.dev.install", (payload = {}) => this.installFromSource({
        sourcePath: payload.sourcePath || payload.path,
        pluginId: payload.pluginId,
        allowFullAccess: !!payload.allowFullAccess,
      })],
      ["plugin.dev.reload", (payload = {}) => this.reloadPlugin(payload.pluginId, {
        devRunId: payload.devRunId,
        allowFullAccess: payload.allowFullAccess,
      })],
      ["plugin.dev.disable", (payload = {}) => this.disablePlugin(payload.pluginId, {
        devRunId: payload.devRunId,
      })],
      ["plugin.dev.enable", (payload = {}) => this.enablePlugin(payload.pluginId, {
        devRunId: payload.devRunId,
        allowFullAccess: payload.allowFullAccess,
      })],
      ["plugin.dev.reset", (payload = {}) => this.resetPlugin(payload.pluginId, {
        devRunId: payload.devRunId,
        allowFullAccess: payload.allowFullAccess,
      })],
      ["plugin.dev.uninstall", (payload = {}) => this.uninstallPlugin(payload.pluginId, {
        devRunId: payload.devRunId,
      })],
      ["plugin.dev.invokeTool", (payload = {}) => this.invokeTool(payload)],
      ["plugin.dev.diagnostics", (payload = {}) => this.getDiagnostics(payload.pluginId)],
      ["plugin.dev.listSurfaces", (payload = {}) => this.listSurfaces(payload.pluginId)],
      ["plugin.dev.describeSurfaceDebug", (payload = {}) => this.describeSurfaceDebug(payload)],
      ["plugin.dev.getScenarios", (payload = {}) => this.getScenarios(payload)],
      ["plugin.dev.runScenario", (payload = {}) => this.runScenario(payload)],
    ];
    const capabilityByType = new Map(PLUGIN_DEV_EVENT_BUS_CAPABILITIES.map((capability) => [capability.type, capability]));
    this._eventBusDisposers = handlers.map(([type, handler]) => (
      bus.handle(type, handler, { capability: capabilityByType.get(type) })
    ));
    return () => this.unregisterEventBusHandlers();
  }

  unregisterEventBusHandlers() {
    for (const dispose of this._eventBusDisposers.splice(0)) {
      try { dispose(); } catch {}
    }
  }
}
