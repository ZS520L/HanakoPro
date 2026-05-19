import path from "path";
import { serializeSessionFile } from "../lib/session-files/session-file-response.js";
import { createPluginConfigStore } from "./plugin-config.js";

/**
 * Create a PluginContext for a plugin.
 * @param {{ pluginId: string, pluginDir: string, dataDir: string, bus: object, accessLevel?: "full-access" | "restricted", registerSessionFile?: Function, configSchema?: object, logSink?: Function }} opts
 */
export function createPluginContext({ pluginId, pluginDir, dataDir, bus, accessLevel, registerSessionFile: registerSessionFileImpl, configSchema, logSink }) {
  const config = createPluginConfigStore({ dataDir, schema: configSchema });

  const resolvedAccess = accessLevel || "restricted";
  const pluginBus = resolvedAccess === "full-access"
    ? bus
    : Object.freeze({
        emit: bus.emit.bind(bus),
        subscribe: bus.subscribe.bind(bus),
        request: bus.request.bind(bus),
        hasHandler: bus.hasHandler.bind(bus),
        listCapabilities: typeof bus.listCapabilities === "function" ? bus.listCapabilities.bind(bus) : () => [],
        getCapability: typeof bus.getCapability === "function" ? bus.getCapability.bind(bus) : () => null,
      });

  const prefix = `[plugin:${pluginId}]`;
  const recordLog = (level, args) => {
    if (typeof logSink !== "function") return;
    try {
      logSink({ pluginId, level, args, ts: new Date().toISOString() });
    } catch {
      // Logging must never break plugin execution.
    }
  };
  const log = {
    info: (...args) => { recordLog("info", args); console.log(prefix, ...args); },
    warn: (...args) => { recordLog("warn", args); console.warn(prefix, ...args); },
    error: (...args) => { recordLog("error", args); console.error(prefix, ...args); },
    debug: (...args) => { recordLog("debug", args); console.debug(prefix, ...args); },
  };

  function registerSessionFile(entry = {}) {
    if (typeof registerSessionFileImpl !== "function") {
      throw new Error("plugin session file registry unavailable");
    }
    const { sessionPath, filePath, label, origin = "plugin_output" } = entry;
    const storageKind = origin === "plugin_output" ? "plugin_data" : "external";
    if (!sessionPath) throw new Error("plugin registerSessionFile requires sessionPath");
    if (!filePath || !path.isAbsolute(filePath)) {
      throw new Error("plugin registerSessionFile requires an absolute filePath");
    }
    return serializeSessionFile(registerSessionFileImpl({
      sessionPath,
      filePath,
      label,
      origin,
      storageKind,
    }));
  }

  function toMediaItem(file) {
    return {
      type: "session_file",
      fileId: file.fileId || file.id,
      sessionPath: file.sessionPath,
      filePath: file.filePath,
      label: file.label || file.displayName || file.filename,
      ...(file.mime ? { mime: file.mime } : {}),
      ...(file.size !== undefined ? { size: file.size } : {}),
      ...(file.kind ? { kind: file.kind } : {}),
    };
  }

  function stageFile(entry = {}) {
    const { origin: _origin, storageKind: _storageKind, ...safeEntry } = entry;
    const file = registerSessionFile({ ...safeEntry, origin: "plugin_output" });
    return { file, mediaItem: toMediaItem(file) };
  }

  return { pluginId, pluginDir, dataDir, bus: pluginBus, config, log, registerSessionFile, stageFile };
}
