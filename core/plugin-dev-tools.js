function toolOk(message, details = {}) {
  return {
    content: [{ type: "text", text: message }],
    details,
  };
}

function toolError(message, details = {}) {
  return {
    content: [{ type: "text", text: message }],
    details: { ok: false, ...details },
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function findRuntimeCtx(args) {
  for (let i = args.length - 1; i >= 2; i -= 1) {
    const value = args[i];
    if (value && typeof value === "object" && (value.sessionManager || value.sessionPath || value.agentId || value.model)) {
      return value;
    }
  }
  return null;
}

function getSessionPath(params, runtimeCtx) {
  return params.sessionPath
    || runtimeCtx?.sessionManager?.getSessionFile?.()
    || runtimeCtx?.sessionPath
    || null;
}

function createSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function createPluginDevTool({ name, description, parameters, service, handler }) {
  return {
    name,
    description,
    parameters,
    metadata: { pluginDevTool: true },
    execute: async (...args) => {
      const params = args[1] || {};
      const runtimeCtx = findRuntimeCtx(args);
      try {
        const result = await handler({ params, runtimeCtx, service });
        return toolOk(safeJson(result), result);
      } catch (err) {
        return toolError(err?.message || String(err), {
          errorCode: err?.code || "PLUGIN_DEV_TOOL_ERROR",
          status: err?.status || 500,
        });
      }
    },
  };
}

export function createPluginDevTools({ pluginDevService, getAgentId } = {}) {
  if (!pluginDevService) return [];
  return [
    createPluginDevTool({
      name: "plugin_dev_install",
      description: "Install a Hana plugin source directory into the isolated development plugin slot. Requires the Agent plugin dev tools setting to be enabled by the user.",
      service: pluginDevService,
      parameters: createSchema({
        sourcePath: { type: "string", description: "Absolute path to the plugin source directory." },
        pluginId: { type: "string", description: "Optional expected plugin id from manifest.json." },
        allowFullAccess: { type: "boolean", description: "Temporarily allow full-access while this dev slot is loaded." },
      }, ["sourcePath"]),
      handler: ({ params, service }) => service.installFromSource({
        sourcePath: params.sourcePath,
        pluginId: params.pluginId,
        allowFullAccess: params.allowFullAccess === true,
      }),
    }),
    createPluginDevTool({
      name: "plugin_dev_reload",
      description: "Reload a previously installed development plugin from its remembered source slot.",
      service: pluginDevService,
      parameters: createSchema({
        pluginId: { type: "string" },
        devRunId: { type: "string", description: "Optional active dev run id guard." },
        allowFullAccess: { type: "boolean" },
      }, ["pluginId"]),
      handler: ({ params, service }) => service.reloadPlugin(params.pluginId, {
        devRunId: params.devRunId,
        allowFullAccess: params.allowFullAccess,
      }),
    }),
    createPluginDevTool({
      name: "plugin_dev_enable",
      description: "Enable a development plugin without changing normal plugin preferences.",
      service: pluginDevService,
      parameters: createSchema({
        pluginId: { type: "string" },
        devRunId: { type: "string", description: "Optional active dev run id guard." },
        allowFullAccess: { type: "boolean" },
      }, ["pluginId"]),
      handler: ({ params, service }) => service.enablePlugin(params.pluginId, {
        devRunId: params.devRunId,
        allowFullAccess: params.allowFullAccess,
      }),
    }),
    createPluginDevTool({
      name: "plugin_dev_disable",
      description: "Disable a development plugin without changing normal plugin preferences.",
      service: pluginDevService,
      parameters: createSchema({
        pluginId: { type: "string" },
        devRunId: { type: "string", description: "Optional active dev run id guard." },
      }, ["pluginId"]),
      handler: ({ params, service }) => service.disablePlugin(params.pluginId, {
        devRunId: params.devRunId,
      }),
    }),
    createPluginDevTool({
      name: "plugin_dev_reset",
      description: "Reset a development plugin by reloading it from its remembered source slot and creating a fresh dev run.",
      service: pluginDevService,
      parameters: createSchema({
        pluginId: { type: "string" },
        devRunId: { type: "string", description: "Optional active dev run id guard." },
        allowFullAccess: { type: "boolean" },
      }, ["pluginId"]),
      handler: ({ params, service }) => service.resetPlugin(params.pluginId, {
        devRunId: params.devRunId,
        allowFullAccess: params.allowFullAccess,
      }),
    }),
    createPluginDevTool({
      name: "plugin_dev_uninstall",
      description: "Uninstall a development plugin from the isolated dev plugin directory and forget its dev slot.",
      service: pluginDevService,
      parameters: createSchema({
        pluginId: { type: "string" },
        devRunId: { type: "string", description: "Optional active dev run id guard." },
      }, ["pluginId"]),
      handler: ({ params, service }) => service.uninstallPlugin(params.pluginId, {
        devRunId: params.devRunId,
      }),
    }),
    createPluginDevTool({
      name: "plugin_dev_invoke_tool",
      description: "Invoke one loaded development plugin tool with explicit input for smoke testing.",
      service: pluginDevService,
      parameters: createSchema({
        pluginId: { type: "string" },
        toolName: { type: "string" },
        input: { type: "object", additionalProperties: true },
        sessionPath: { type: "string" },
        agentId: { type: "string" },
      }, ["pluginId", "toolName"]),
      handler: ({ params, runtimeCtx, service }) => service.invokeTool({
        pluginId: params.pluginId,
        toolName: params.toolName,
        input: params.input || {},
        sessionPath: getSessionPath(params, runtimeCtx),
        agentId: params.agentId || runtimeCtx?.agentId || getAgentId?.(),
      }),
    }),
    createPluginDevTool({
      name: "plugin_dev_diagnostics",
      description: "Read development plugin slots, load status, logs, UI surfaces, and scenarios.",
      service: pluginDevService,
      parameters: createSchema({
        pluginId: { type: "string" },
      }),
      handler: ({ params, service }) => service.getDiagnostics(params.pluginId),
    }),
    createPluginDevTool({
      name: "plugin_dev_list_surfaces",
      description: "List page and widget surfaces exposed by development plugins.",
      service: pluginDevService,
      parameters: createSchema({
        pluginId: { type: "string" },
      }),
      handler: ({ params, service }) => service.listSurfaces(params.pluginId),
    }),
    createPluginDevTool({
      name: "plugin_dev_describe_surface",
      description: "Describe a plugin UI surface with an element-first debugging strategy.",
      service: pluginDevService,
      parameters: createSchema({
        pluginId: { type: "string" },
        kind: { type: "string" },
        route: { type: "string" },
      }, ["pluginId"]),
      handler: ({ params, service }) => service.describeSurfaceDebug(params),
    }),
    createPluginDevTool({
      name: "plugin_dev_run_scenario",
      description: "Run one manifest.dev.scenarios smoke test for a development plugin.",
      service: pluginDevService,
      parameters: createSchema({
        pluginId: { type: "string" },
        scenarioId: { type: "string" },
        allowDestructive: { type: "boolean" },
      }, ["pluginId", "scenarioId"]),
      handler: ({ params, service }) => service.runScenario(params),
    }),
  ];
}
