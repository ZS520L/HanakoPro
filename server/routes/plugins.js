import { Hono } from "hono";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { extractZip } from "../../lib/extract-zip.js";
import { resolveAgent } from "../utils/resolve-agent.js";
import { fromRoot } from "../../shared/hana-root.js";
import { DEFAULT_THEME } from "../../desktop/src/shared/theme-registry.cjs";
import { registerSessionFileFromRequest } from "../../lib/session-files/session-file-response.js";
import {
  createDefaultPluginMarketplace,
  getMarketplacePluginVersionState,
} from "../../lib/plugin-marketplace.js";
import { comparePluginVersions } from "../../lib/plugin-versioning.js";
import {
  createPluginInstallBackup,
  restorePluginInstallBackup,
} from "../../lib/plugin-install-backups.js";

const MAX_PLUGIN_RELEASE_PACKAGE_SIZE = 50 * 1024 * 1024;

/**
 * 代理分发：将 /plugins/:pluginId/* 的请求转发到对应 plugin 子 app。
 * @param {import("hono").Context} c
 * @param {import("hono").Hono} pluginApp
 * @param {string} pluginId
 * @param {string} [agentId] - 当前 agent id，注入到子请求的 X-Hana-Agent-Id header
 */
async function proxyToPlugin(c, pluginApp, pluginId, agentId) {
  const url = new URL(c.req.url);
  const prefix = `/plugins/${pluginId}`;
  const prefixIndex = url.pathname.indexOf(prefix);
  const subPath = prefixIndex !== -1
    ? url.pathname.slice(prefixIndex + prefix.length) || "/"
    : "/";
  url.pathname = subPath;

  const headers = new Headers(c.req.raw.headers);
  if (agentId) headers.set("X-Hana-Agent-Id", agentId);

  const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";
  const subReq = new Request(url.toString(), {
    method: c.req.method,
    headers,
    body: hasBody ? c.req.raw.body : undefined,
    ...(hasBody ? { duplex: "half" } : {}),
  });
  return pluginApp.fetch(subReq);
}

/**
 * Standalone route proxy (for tests).
 * @param {Map<string, import("hono").Hono>} routeRegistry
 */
export function createPluginProxyRoute(routeRegistry) {
  const route = new Hono();
  route.all("/plugins/:pluginId/*", async (c) => {
    const pluginId = c.req.param("pluginId");
    const pluginApp = routeRegistry.get(pluginId);
    if (!pluginApp) return c.json({ error: `Plugin "${pluginId}" not found` }, 404);
    return proxyToPlugin(c, pluginApp, pluginId);
  });
  return route;
}

function safePathSegment(value, fallback) {
  const text = String(value || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return text || fallback;
}

function createPluginRouteError(message, status = 400, code = "PLUGIN_ERROR") {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function assertInsideDir(childPath, parentDir) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentDir);
  const parentWithSep = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  if (child !== parent && !child.startsWith(parentWithSep)) {
    throw createPluginRouteError("Plugin install target escaped plugins directory", 400, "PLUGIN_INSTALL_PATH_INVALID");
  }
}

function readPluginDescriptorForInstall(pm, pluginDir) {
  if (typeof pm.readPluginDescriptor === "function") {
    return pm.readPluginDescriptor(pluginDir, path.basename(pluginDir));
  }
  const manifestPath = path.join(pluginDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw createPluginRouteError("Not a valid plugin directory", 400, "PLUGIN_INVALID");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const id = manifest?.id || path.basename(pluginDir);
  return {
    id,
    name: manifest?.name || id,
    version: manifest?.version || "0.0.0",
    manifest,
    pluginDir,
  };
}

function findInstalledPlugin(pm, pluginId, candidateDir) {
  const plugins = typeof pm.listPlugins === "function" ? pm.listPlugins() : [];
  return plugins.find((plugin) => (
    plugin.id === pluginId
    || (candidateDir && plugin.pluginDir && path.resolve(plugin.pluginDir) === path.resolve(candidateDir))
  )) || null;
}

function readInstalledVersion(pm, pluginId, targetDir) {
  const existing = findInstalledPlugin(pm, pluginId, targetDir);
  if (existing?.version) return existing.version;
  const manifestPath = path.join(targetDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return manifest?.version || null;
  } catch {
    return null;
  }
}

function getInstallTargetDir(pm, desc, stagedDir, userPluginsDir) {
  const idSegment = safePathSegment(desc.id, path.basename(stagedDir));
  const defaultTarget = path.join(userPluginsDir, idSegment);
  const existing = findInstalledPlugin(pm, desc.id, defaultTarget);
  const targetDir = existing?.pluginDir || defaultTarget;
  assertInsideDir(targetDir, userPluginsDir);
  return targetDir;
}

async function stagePluginSource({ pm, sourcePath, userPluginsDir }) {
  const stat = fs.statSync(sourcePath);
  const cleanupPaths = [];
  fs.mkdirSync(userPluginsDir, { recursive: true });
  const tmpTarget = fs.mkdtempSync(path.join(userPluginsDir, ".installing-"));
  cleanupPaths.push(tmpTarget);

  let pluginSrc = null;
  if (sourcePath.endsWith(".zip")) {
    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-install-"));
    cleanupPaths.push(extractDir);
    await extractZip(sourcePath, extractDir);
    const entries = fs.readdirSync(extractDir, { withFileTypes: true });
    pluginSrc = entries.length === 1 && entries[0].isDirectory()
      ? path.join(extractDir, entries[0].name)
      : extractDir;
  } else if (stat.isDirectory()) {
    pluginSrc = sourcePath;
  } else {
    throw createPluginRouteError("Path must be a .zip file or directory", 400, "PLUGIN_INSTALL_SOURCE_INVALID");
  }

  fs.cpSync(pluginSrc, tmpTarget, { recursive: true });
  if (!pm.isValidPluginDir(tmpTarget)) {
    throw createPluginRouteError("Not a valid plugin directory", 400, "PLUGIN_INVALID");
  }
  return { stagedDir: tmpTarget, cleanupPaths };
}

function assertExpectedPlugin(desc, { expectedPluginId, expectedVersion }) {
  if (expectedPluginId && desc.id !== expectedPluginId) {
    throw createPluginRouteError(
      `Marketplace package id mismatch: expected "${expectedPluginId}", got "${desc.id}"`,
      409,
      "PLUGIN_PACKAGE_ID_MISMATCH",
    );
  }
  if (expectedVersion && comparePluginVersions(desc.version, expectedVersion) !== 0) {
    throw createPluginRouteError(
      `Marketplace package version mismatch: expected v${expectedVersion}, got v${desc.version}`,
      409,
      "PLUGIN_PACKAGE_VERSION_MISMATCH",
    );
  }
}

function assertInstallEntryHealthy(entry) {
  if (!entry) {
    throw createPluginRouteError("Plugin install failed", 500, "PLUGIN_INSTALL_FAILED");
  }
  if (entry.status === "failed") {
    throw createPluginRouteError(entry.error || "Plugin install failed", 500, "PLUGIN_INSTALL_FAILED");
  }
  if (entry.status === "incompatible") {
    throw createPluginRouteError(entry.error || "Plugin is incompatible with this app version", 409, "PLUGIN_VERSION_INCOMPATIBLE");
  }
}

async function restoreAfterFailedInstall({ engine, pm, backup, targetDir, desc }) {
  if (backup && restorePluginInstallBackup(backup, targetDir)) {
    try {
      await pm.installPlugin(targetDir);
      await engine.syncPluginExtensions();
    } catch (restoreErr) {
      console.warn(`[plugin-install] failed to reload restored plugin "${desc.id}":`, restoreErr.message);
    }
    return;
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  if (desc?.id && typeof pm.removePlugin === "function") {
    try {
      await pm.removePlugin(desc.id, { persist: false });
    } catch {
      // The failed install may not have reached the plugin registry.
    }
  }
}

async function installPluginFromPath({
  engine,
  pm,
  sourcePath,
  sessionPath,
  expectedPluginId,
  expectedVersion,
  allowDowngrade = false,
  installRecord = {},
} = {}) {
  fs.statSync(sourcePath);
  const sourceFile = registerSessionFileFromRequest(engine, {
    sessionPath,
    filePath: sourcePath,
    label: path.basename(sourcePath),
    origin: "plugin_install_source",
    storageKind: "install_source",
  });
  const userPluginsDir = pm.getUserPluginsDir();
  const { stagedDir, cleanupPaths } = await stagePluginSource({ pm, sourcePath, userPluginsDir });
  let desc = null;
  let targetDir = null;
  let backup = null;

  try {
    desc = readPluginDescriptorForInstall(pm, stagedDir);
    assertExpectedPlugin(desc, { expectedPluginId, expectedVersion });
    targetDir = getInstallTargetDir(pm, desc, stagedDir, userPluginsDir);
    const installedVersion = readInstalledVersion(pm, desc.id, targetDir);
    if (installedVersion && comparePluginVersions(desc.version, installedVersion) < 0 && !allowDowngrade) {
      throw createPluginRouteError(
        `Installing v${desc.version} would downgrade installed v${installedVersion}`,
        409,
        "PLUGIN_VERSION_DOWNGRADE",
      );
    }

    backup = createPluginInstallBackup({
      hanakoHome: engine.hanakoHome,
      pluginId: desc.id,
      pluginDir: targetDir,
      version: installedVersion,
    });
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.renameSync(stagedDir, targetDir);

    let entry;
    try {
      entry = await pm.installPlugin(targetDir);
      assertInstallEntryHealthy(entry);
      await engine.syncPluginExtensions();
    } catch (err) {
      await restoreAfterFailedInstall({ engine, pm, backup, targetDir, desc });
      throw err;
    }

    engine.recordPluginInstall?.({
      pluginId: entry.id || desc.id,
      installedVersion: entry.version || desc.version,
      source: "local",
      sourcePath,
      ...installRecord,
    });

    return {
      ...entry,
      ...(sourceFile ? { sourceFile } : {}),
    };
  } finally {
    for (const cleanupPath of cleanupPaths) {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
    }
  }
}

function decodeHttpConfigValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return {};
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value === null ? undefined : value]),
  );
}

function decodeHttpConfigBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { values: {}, scope: "global", agentId: undefined, sessionPath: undefined };
  }
  const hasValuesEnvelope = Object.prototype.hasOwnProperty.call(body, "values");
  const rawValues = hasValuesEnvelope
    ? body.values
    : Object.fromEntries(
        Object.entries(body).filter(([key]) => !["scope", "agentId", "sessionPath"].includes(key)),
      );
  return {
    values: decodeHttpConfigValues(rawValues),
    scope: body.scope || "global",
    agentId: body.agentId,
    sessionPath: body.sessionPath,
  };
}

async function downloadMarketplaceRelease({ engine, plugin }) {
  const dist = plugin?.distribution;
  if (!dist || dist.kind !== "release") {
    const err = new Error("Plugin has no release distribution");
    err.status = 400;
    throw err;
  }
  if (!dist.packageUrl || !dist.sha256) {
    const err = new Error("Plugin release distribution is missing packageUrl or sha256");
    err.status = 400;
    throw err;
  }

  const expectedSha256 = String(dist.sha256).trim();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    const err = new Error("Plugin release sha256 must be 64 lowercase hex characters");
    err.status = 400;
    throw err;
  }

  const packageUrl = new URL(dist.packageUrl);
  if (packageUrl.protocol !== "https:") {
    const err = new Error("Plugin release packageUrl must use https");
    err.status = 400;
    throw err;
  }

  const fetchImpl = engine.fetch || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    const err = new Error("fetch is unavailable");
    err.status = 500;
    throw err;
  }
  if (!engine.hanakoHome) {
    const err = new Error("HANA_HOME is unavailable for plugin release installation");
    err.status = 500;
    throw err;
  }

  const res = await fetchImpl(packageUrl.toString());
  if (!res.ok) {
    const err = new Error(`Plugin release download failed: ${res.status}`);
    err.status = 502;
    throw err;
  }
  const contentLength = Number(res.headers?.get?.("content-length") || 0);
  if (contentLength > MAX_PLUGIN_RELEASE_PACKAGE_SIZE) {
    const err = new Error("Plugin release package is too large");
    err.status = 413;
    throw err;
  }

  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > MAX_PLUGIN_RELEASE_PACKAGE_SIZE) {
    const err = new Error("Plugin release package is too large");
    err.status = 413;
    throw err;
  }
  const actualSha256 = crypto.createHash("sha256").update(body).digest("hex");
  if (actualSha256 !== expectedSha256) {
    const err = new Error("Plugin release sha256 mismatch");
    err.status = 502;
    throw err;
  }

  const pluginId = safePathSegment(plugin.id, "plugin");
  const version = safePathSegment(plugin.version, "0.0.0");
  const downloadsDir = path.join(engine.hanakoHome, "plugin-install-sources", pluginId, version);
  fs.mkdirSync(downloadsDir, { recursive: true });
  const packagePath = path.join(downloadsDir, `${pluginId}-${version}.zip`);
  fs.writeFileSync(packagePath, body);
  return packagePath;
}

function isMarketplacePluginInstallable(plugin, marketplace) {
  if (plugin.distribution?.kind === "source") {
    return !!marketplace.resolveSourceDistribution(plugin);
  }
  if (plugin.distribution?.kind === "release") {
    return !!(plugin.distribution.packageUrl && plugin.distribution.sha256);
  }
  return false;
}

function marketplacePluginForVersion(plugin, versionState) {
  return {
    ...plugin,
    version: versionState.selectedVersion || plugin.version,
    compatibility: versionState.selectedCompatibility || plugin.compatibility || {},
    distribution: versionState.selectedDistribution || null,
  };
}

function getEngineAppVersion(engine) {
  if (typeof engine.getAppVersion === "function") return engine.getAppVersion();
  return engine.appVersion || "0.0.0";
}

function pluginDevServiceOrError(engine, c) {
  const service = engine.pluginDevService;
  if (!service) {
    return {
      errorResponse: c.json({
        error: "Plugin dev service not available",
        code: "PLUGIN_DEV_SERVICE_UNAVAILABLE",
      }, 500),
    };
  }
  return { service };
}

function pluginDevErrorResponse(c, err) {
  return c.json({
    error: err?.message || String(err),
    ...(err?.code ? { code: err.code } : {}),
  }, err?.status || 500);
}

function sanitizeMarketplacePluginForClient(plugin) {
  const {
    readme: _readme,
    readmePath: _readmePath,
    distribution,
    versions,
    ...rest
  } = plugin;
  return {
    ...rest,
    distribution: distribution
      ? {
          kind: distribution.kind,
          ...(distribution.path ? { path: distribution.path } : {}),
          ...(distribution.packageUrl ? { packageUrl: distribution.packageUrl } : {}),
          ...(distribution.sha256 ? { sha256: distribution.sha256 } : {}),
        }
      : null,
    versions: Array.isArray(versions)
      ? versions.map((item) => ({
          version: item.version,
          compatibility: item.compatibility || {},
          distribution: item.distribution
            ? {
                kind: item.distribution.kind,
                ...(item.distribution.path ? { path: item.distribution.path } : {}),
                ...(item.distribution.packageUrl ? { packageUrl: item.distribution.packageUrl } : {}),
                ...(item.distribution.sha256 ? { sha256: item.distribution.sha256 } : {}),
              }
            : null,
        }))
      : [],
  };
}

/**
 * Plugin management REST API + route proxy (combined).
 * @param {import('../../core/engine.js').HanaEngine} engine
 */
export function createPluginsRoute(engine) {
  const route = new Hono();

  /**
   * 可见插件过滤 + 序列化（单一出口，所有返回插件列表的端点共用）。
   * hidden 插件（系统插件）永远不暴露给前端管理页。
   * @param {object} [opts]
   * @param {string} [opts.source] - 按 source 过滤（"community" | "builtin"）
   */
  function visiblePlugins(pm, opts = {}) {
    let plugins = pm.listPlugins().filter(p => !p.hidden);
    if (opts.source) plugins = plugins.filter(p => p.source === opts.source);
    return plugins.map(p => ({
      id: p.id, name: p.name, version: p.version,
      description: p.description, status: p.status,
      activationState: p.activationState || null,
      activationEvents: Array.isArray(p.activationEvents) ? p.activationEvents : [],
      activationError: p.activationError || null,
      source: p.source || "community", trust: p.trust || "restricted",
      contributions: p.contributions,
      error: p.error || null,
    }));
  }

  // ── Management API (specific routes first) ──

  route.get("/plugins", (c) => {
    const pm = engine.pluginManager;
    if (!pm) return c.json([]);
    return c.json(visiblePlugins(pm, { source: c.req.query("source") }));
  });

  route.get("/plugins/config-schemas", (c) => {
    const pm = engine.pluginManager;
    return c.json(pm?.getAllConfigSchemas() || []);
  });

  route.get("/plugins/event-bus/capabilities", (c) => {
    const bus = engine.getEventBus?.() || engine.eventBus || null;
    const capabilities = typeof bus?.listCapabilities === "function"
      ? bus.listCapabilities()
      : [];
    return c.json(capabilities);
  });

  route.get("/plugins/diagnostics", (c) => {
    const pm = engine.pluginManager;
    const bus = engine.getEventBus?.() || engine.eventBus || null;
    return c.json({
      plugins: typeof pm?.getDiagnostics === "function"
        ? pm.getDiagnostics().filter(p => !p.hidden)
        : [],
      eventBus: typeof bus?.listCapabilities === "function" ? bus.listCapabilities() : [],
      tasks: typeof engine.taskRegistry?.listAll === "function" ? engine.taskRegistry.listAll() : [],
      schedules: typeof engine.taskRegistry?.listSchedules === "function" ? engine.taskRegistry.listSchedules() : [],
    });
  });

  // ── Plugin dev loop endpoints ──

  route.post("/plugins/dev/install", async (c) => {
    const { service, errorResponse } = pluginDevServiceOrError(engine, c);
    if (errorResponse) return errorResponse;
    const body = await c.req.json().catch(() => ({}));
    const sourcePath = body.sourcePath || body.path;
    try {
      return c.json(await service.installFromSource({
        sourcePath,
        pluginId: body.pluginId,
        allowFullAccess: !!body.allowFullAccess,
      }));
    } catch (err) {
      return pluginDevErrorResponse(c, err);
    }
  });

  route.post("/plugins/dev/:id/reload", async (c) => {
    const { service, errorResponse } = pluginDevServiceOrError(engine, c);
    if (errorResponse) return errorResponse;
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(await service.reloadPlugin(c.req.param("id"), {
        devRunId: body.devRunId,
        allowFullAccess: body.allowFullAccess,
      }));
    } catch (err) {
      return pluginDevErrorResponse(c, err);
    }
  });

  route.put("/plugins/dev/:id/enabled", async (c) => {
    const { service, errorResponse } = pluginDevServiceOrError(engine, c);
    if (errorResponse) return errorResponse;
    const body = await c.req.json().catch(() => ({}));
    try {
      const result = body.enabled === false
        ? await service.disablePlugin(c.req.param("id"), { devRunId: body.devRunId })
        : await service.enablePlugin(c.req.param("id"), {
            devRunId: body.devRunId,
            allowFullAccess: body.allowFullAccess,
          });
      return c.json(result);
    } catch (err) {
      return pluginDevErrorResponse(c, err);
    }
  });

  route.post("/plugins/dev/:id/reset", async (c) => {
    const { service, errorResponse } = pluginDevServiceOrError(engine, c);
    if (errorResponse) return errorResponse;
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(await service.resetPlugin(c.req.param("id"), {
        devRunId: body.devRunId,
        allowFullAccess: body.allowFullAccess,
      }));
    } catch (err) {
      return pluginDevErrorResponse(c, err);
    }
  });

  route.delete("/plugins/dev/:id", async (c) => {
    const { service, errorResponse } = pluginDevServiceOrError(engine, c);
    if (errorResponse) return errorResponse;
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(await service.uninstallPlugin(c.req.param("id"), {
        devRunId: body.devRunId,
      }));
    } catch (err) {
      return pluginDevErrorResponse(c, err);
    }
  });

  route.get("/plugins/dev/:id/scenarios", (c) => {
    const { service, errorResponse } = pluginDevServiceOrError(engine, c);
    if (errorResponse) return errorResponse;
    const pluginId = c.req.param("id");
    try {
      return c.json({
        pluginId,
        scenarios: service.getScenarios({ pluginId }),
      });
    } catch (err) {
      return pluginDevErrorResponse(c, err);
    }
  });

  route.post("/plugins/dev/:id/scenarios/:scenarioId/run", async (c) => {
    const { service, errorResponse } = pluginDevServiceOrError(engine, c);
    if (errorResponse) return errorResponse;
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(await service.runScenario({
        pluginId: c.req.param("id"),
        scenarioId: c.req.param("scenarioId"),
        allowDestructive: body.allowDestructive === true,
      }));
    } catch (err) {
      return pluginDevErrorResponse(c, err);
    }
  });

  route.post("/plugins/dev/:id/tools/:toolName/invoke", async (c) => {
    const { service, errorResponse } = pluginDevServiceOrError(engine, c);
    if (errorResponse) return errorResponse;
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(await service.invokeTool({
        pluginId: c.req.param("id"),
        toolName: c.req.param("toolName"),
        input: body.input || {},
        sessionPath: body.sessionPath,
        agentId: body.agentId,
      }));
    } catch (err) {
      return pluginDevErrorResponse(c, err);
    }
  });

  route.get("/plugins/dev/diagnostics", (c) => {
    const { service, errorResponse } = pluginDevServiceOrError(engine, c);
    if (errorResponse) return errorResponse;
    return c.json(service.getDiagnostics(c.req.query("pluginId") || undefined));
  });

  route.get("/plugins/dev/surfaces", (c) => {
    const { service, errorResponse } = pluginDevServiceOrError(engine, c);
    if (errorResponse) return errorResponse;
    return c.json(service.listSurfaces(c.req.query("pluginId") || undefined));
  });

  route.post("/plugins/dev/surfaces/describe", async (c) => {
    const { service, errorResponse } = pluginDevServiceOrError(engine, c);
    if (errorResponse) return errorResponse;
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(service.describeSurfaceDebug(body));
    } catch (err) {
      return pluginDevErrorResponse(c, err);
    }
  });

  function getMarketplace() {
    return engine.pluginMarketplace || createDefaultPluginMarketplace({
      hanakoHome: engine.hanakoHome,
      fetchImpl: engine.fetch,
    });
  }

  route.get("/plugins/marketplace", async (c) => {
    const pm = engine.pluginManager;
    const marketplace = getMarketplace();
    const data = await marketplace.load();
    const appVersion = getEngineAppVersion(engine);
    const installed = new Map((pm?.listPlugins?.() || []).map((plugin) => [plugin.id, plugin]));
    return c.json({
      ...data,
      plugins: data.plugins.map((plugin) => {
        const installedPlugin = installed.get(plugin.id);
        const installedVersion = installedPlugin?.version || engine.getPluginInstallRecord?.(plugin.id)?.installedVersion || null;
        const versionState = getMarketplacePluginVersionState(plugin, {
          appVersion,
          installedVersion,
        });
        const installCandidate = marketplacePluginForVersion(plugin, versionState);
        return {
          ...sanitizeMarketplacePluginForClient(plugin),
          installed: !!installedPlugin,
          ...versionState,
          canInstall: versionState.canInstall && isMarketplacePluginInstallable(installCandidate, marketplace),
        };
      }),
    });
  });

  route.get("/plugins/marketplace/:id/readme", async (c) => {
    const marketplace = getMarketplace();
    try {
      const readme = await marketplace.getReadme(c.req.param("id"));
      if (readme === null) return c.json({ error: "not found" }, 404);
      return c.json({ pluginId: c.req.param("id"), markdown: readme });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/plugins/marketplace/:id/install", async (c) => {
    const pm = engine.pluginManager;
    if (!pm) return c.json({ error: "Plugin manager not available" }, 500);
    const marketplace = getMarketplace();
    const marketplaceData = await marketplace.load();
    const plugin = marketplaceData.plugins.find((item) => item.id === c.req.param("id")) || null;
    if (!plugin) return c.json({ error: "not found" }, 404);
    const {
      sessionPath,
      version: targetVersion,
      allowDowngrade = false,
    } = await c.req.json().catch(() => ({}));
    try {
      const installedPlugin = (pm.listPlugins?.() || []).find((item) => item.id === plugin.id);
      const installedVersion = installedPlugin?.version || engine.getPluginInstallRecord?.(plugin.id)?.installedVersion || null;
      const versionState = getMarketplacePluginVersionState(plugin, {
        appVersion: getEngineAppVersion(engine),
        installedVersion,
        targetVersion,
      });
      if (!versionState.compatible || !versionState.selectedVersion) {
        throw createPluginRouteError("Plugin is incompatible with this app version", 409, "PLUGIN_VERSION_INCOMPATIBLE");
      }
      if (versionState.downgrade && allowDowngrade !== true) {
        throw createPluginRouteError(
          `Installing v${versionState.selectedVersion} would downgrade installed v${installedVersion}`,
          409,
          "PLUGIN_VERSION_DOWNGRADE",
        );
      }
      const installCandidate = marketplacePluginForVersion(plugin, versionState);
      const sourcePath = marketplace.resolveSourceDistribution(installCandidate);
      const installPath = sourcePath || await downloadMarketplaceRelease({ engine, plugin: installCandidate });
      const entry = await installPluginFromPath({
        engine,
        pm,
        sourcePath: installPath,
        sessionPath,
        expectedPluginId: plugin.id,
        expectedVersion: versionState.selectedVersion,
        allowDowngrade: allowDowngrade === true,
        installRecord: {
          source: "marketplace",
          marketplaceId: plugin.id,
          marketplaceSource: marketplaceData.source?.url || marketplaceData.source?.path || null,
          distributionKind: installCandidate.distribution?.kind || null,
          packageUrl: installCandidate.distribution?.packageUrl || null,
          sha256: installCandidate.distribution?.sha256 || null,
        },
      });
      return c.json(entry);
    } catch (err) {
      return c.json({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      }, err.status || 500);
    }
  });

  route.get("/plugins/:id/config-schema", (c) => {
    const pm = engine.pluginManager;
    const schema = pm?.getConfigSchema(c.req.param("id"));
    if (!schema) return c.json({ error: "not found" }, 404);
    return c.json(schema);
  });

  route.get("/plugins/:id/config", (c) => {
    const pm = engine.pluginManager;
    const config = pm?.getConfig(c.req.param("id"), {
      scope: c.req.query("scope") || "global",
      agentId: c.req.query("agentId") || undefined,
      sessionPath: c.req.query("sessionPath") || undefined,
    });
    if (!config) return c.json({ error: "not found" }, 404);
    return c.json(config);
  });

  route.put("/plugins/:id/config", async (c) => {
    const pm = engine.pluginManager;
    if (!pm) return c.json({ error: "Plugin manager not available" }, 500);
    const body = await c.req.json();
    try {
      const { values, scope, agentId, sessionPath } = decodeHttpConfigBody(body);
      const config = pm.setConfig(c.req.param("id"), values, {
        scope,
        agentId,
        sessionPath,
      });
      const { rawValues: _rawValues, ...safeConfig } = config;
      return c.json(safeConfig);
    } catch (err) {
      if (err?.code === "PLUGIN_CONFIG_INVALID") {
        return c.json({ error: err.message, code: err.code, fields: err.errors || [] }, 400);
      }
      return c.json({ error: err.message }, 404);
    }
  });

  // ── Plugin install ──
  route.post("/plugins/install", async (c) => {
    const pm = engine.pluginManager;
    if (!pm) return c.json({ error: "Plugin manager not available" }, 500);
    const { path: sourcePath, sessionPath, allowDowngrade = false } = await c.req.json();
    if (!sourcePath) return c.json({ error: "path is required" }, 400);

    try {
      return c.json(await installPluginFromPath({ engine, pm, sourcePath, sessionPath, allowDowngrade }));
    } catch (err) {
      return c.json({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      }, err.status || 500);
    }
  });

  // ── Plugin delete ──
  route.delete("/plugins/:id", async (c) => {
    const pm = engine.pluginManager;
    if (!pm) return c.json({ error: "Plugin manager not available" }, 500);
    const id = c.req.param("id");
    try {
      const pluginDir = await pm.removePlugin(id);
      await engine.syncPluginExtensions();
      if (pluginDir && fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      }
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err.message }, 404);
    }
  });

  // ── Plugin enable/disable ──
  route.put("/plugins/:id/enabled", async (c) => {
    const pm = engine.pluginManager;
    if (!pm) return c.json({ error: "Plugin manager not available" }, 500);
    const id = c.req.param("id");
    const { enabled } = await c.req.json();
    try {
      if (enabled) {
        await pm.enablePlugin(id);
      } else {
        await pm.disablePlugin(id);
      }
      await engine.syncPluginExtensions();
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err.message }, 404);
    }
  });

  // ── Global plugin settings ──
  route.get("/plugins/settings", (c) => {
    const pm = engine.pluginManager;
    return c.json({
      allow_full_access: pm?.getAllowFullAccess() || false,
      plugin_dev_tools_enabled: typeof engine.getPluginDevToolsEnabled === "function"
        ? engine.getPluginDevToolsEnabled()
        : false,
      plugins_dir: pm?.getUserPluginsDir() || "",
    });
  });

  route.put("/plugins/settings", async (c) => {
    const pm = engine.pluginManager;
    if (!pm) return c.json({ error: "Plugin manager not available" }, 500);
    const { allow_full_access, plugin_dev_tools_enabled } = await c.req.json();
    if (typeof allow_full_access === "boolean") {
      await pm.setFullAccess(allow_full_access);
      await engine.syncPluginExtensions();
    }
    if (typeof plugin_dev_tools_enabled === "boolean" && typeof engine.setPluginDevToolsEnabled === "function") {
      engine.setPluginDevToolsEnabled(plugin_dev_tools_enabled);
    }
    return c.json(visiblePlugins(pm, { source: "community" }));
  });

  // ── Plugin UI panel endpoints ──

  route.get("/plugins/pages", (c) => {
    const pm = engine.pluginManager;
    if (!pm) return c.json([]);
    const pages = pm.getPages().map(p => ({
      pluginId: p.pluginId,
      title: p.title,
      icon: p.icon,
      routeUrl: `/api/plugins/${p.pluginId}${p.route}`,
      hostCapabilities: Array.isArray(p.hostCapabilities) ? p.hostCapabilities : [],
    }));
    return c.json(pages);
  });

  route.get("/plugins/widgets", (c) => {
    const pm = engine.pluginManager;
    if (!pm) return c.json([]);
    const widgets = pm.getWidgets().map(w => ({
      pluginId: w.pluginId,
      title: w.title,
      icon: w.icon,
      routeUrl: `/api/plugins/${w.pluginId}${w.route}`,
      hostCapabilities: Array.isArray(w.hostCapabilities) ? w.hostCapabilities : [],
    }));
    return c.json(widgets);
  });

  route.get("/plugins/ui-host-capabilities", (c) => {
    const pm = engine.pluginManager;
    if (!pm) return c.json([]);
    return c.json(pm.getUiHostCapabilityGrants?.() || []);
  });

  route.get("/plugins/settings-tabs", (c) => {
    const pm = engine.pluginManager;
    if (!pm) return c.json([]);
    const tabs = pm.getSettingsTabs().map(t => ({
      pluginId: t.pluginId,
      id: t.id,
      title: t.title,
      icon: t.icon,
      nativeComponent: t.nativeComponent,
    }));
    return c.json(tabs);
  });

  route.get("/plugins/theme.css", (c) => {
    const theme = c.req.query("theme") || DEFAULT_THEME;
    // Sanitize theme name to prevent path traversal
    const safeName = path.basename(theme).replace(/[^a-zA-Z0-9_-]/g, "");
    const candidates = [
      fromRoot("desktop", "src", "themes", `${safeName}.css`),
      fromRoot("desktop", "dist-renderer", "themes", `${safeName}.css`),
    ];
    const found = candidates.find(p => fs.existsSync(p));
    if (!found) {
      c.header("Content-Type", "text/css");
      return c.body("/* theme not found */");
    }
    let css = fs.readFileSync(found, "utf-8");
    // Flatten selectors for iframe consumption:
    // [data-theme="xxx"], :root:not([data-theme]) → :root
    // [data-theme="xxx"] → :root
    css = css.replace(/\[data-theme="[^"]*"\](?:,\s*:root:not\(\[data-theme\]\))?/g, ":root");
    c.header("Content-Type", "text/css");
    c.header("Cache-Control", "public, max-age=300");
    return c.body(css);
  });

  // ── Plugin route proxy (catch-all last) ──

  route.all("/plugins/:pluginId/*", async (c) => {
    const pluginId = c.req.param("pluginId");
    const pluginApp = engine.pluginManager?.getRouteApp(pluginId);
    if (!pluginApp) return c.json({ error: `Plugin "${pluginId}" not found` }, 404);
    const url = new URL(c.req.url);
    const prefix = `/plugins/${pluginId}`;
    const prefixIndex = url.pathname.indexOf(prefix);
    const subPath = prefixIndex !== -1
      ? url.pathname.slice(prefixIndex + prefix.length) || "/"
      : "/";
    await engine.pluginManager?.activatePluginRoute?.(pluginId, subPath);
    const agent = resolveAgent(engine, c);
    const agentId = agent?.id || null;
    return proxyToPlugin(c, pluginApp, pluginId, agentId);
  });

  return route;
}
