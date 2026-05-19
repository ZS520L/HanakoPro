import fs from "fs";
import path from "path";
import {
  comparePluginVersions,
  isVersionCompatible,
  sortVersionRecordsDesc,
} from "./plugin-versioning.js";

const DEFAULT_EMPTY_MARKETPLACE = Object.freeze({ schemaVersion: 1, plugins: [] });
export const DEFAULT_OFFICIAL_PLUGIN_MARKETPLACE_URL = "https://raw.githubusercontent.com/liliMozi/OH-Plugins/main/marketplace.json";

export class PluginMarketplace {
  constructor(options = {}) {
    this.indexPath = normalizeOptionalText(options.indexPath);
    this.indexUrl = normalizeOptionalText(options.indexUrl);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  async load() {
    const source = this._resolveSource();
    if (!source) {
      return {
        source: { kind: "none", configured: false },
        schemaVersion: DEFAULT_EMPTY_MARKETPLACE.schemaVersion,
        plugins: [],
        warnings: [],
      };
    }

    try {
      const raw = source.kind === "file"
        ? JSON.parse(fs.readFileSync(source.path, "utf8"))
        : await this._fetchJson(source.url);
      const baseDir = source.kind === "file" ? path.dirname(source.path) : null;
      const baseUrl = source.kind === "url" ? source.url : null;
      const plugins = normalizeMarketplacePlugins(raw?.plugins, { baseDir, baseUrl, source });
      return {
        source: sanitizeSource(source),
        schemaVersion: raw?.schemaVersion || 1,
        plugins,
        warnings: [],
      };
    } catch (err) {
      return {
        source: sanitizeSource(source),
        schemaVersion: 1,
        plugins: [],
        warnings: [err.message],
      };
    }
  }

  async getPlugin(pluginId) {
    const marketplace = await this.load();
    return marketplace.plugins.find((plugin) => plugin.id === pluginId) || null;
  }

  async getReadme(pluginId) {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) return null;
    if (typeof plugin.readme === "string") return plugin.readme;
    if (plugin.readmePath) {
      return fs.readFileSync(plugin.readmePath, "utf8");
    }
    if (plugin.readmeUrl) {
      const res = await this.fetchImpl(plugin.readmeUrl);
      if (!res.ok) throw new Error(`README request failed: ${res.status}`);
      return await res.text();
    }
    return fallbackReadme(plugin);
  }

  resolveSourceDistribution(plugin) {
    if (!plugin?.distribution || plugin.distribution.kind !== "source") return null;
    if (plugin.distribution.resolvedPath) return plugin.distribution.resolvedPath;
    return null;
  }

  _resolveSource() {
    if (this.indexPath) {
      return { kind: "file", path: path.resolve(this.indexPath) };
    }
    if (this.indexUrl) {
      return { kind: "url", url: this.indexUrl };
    }
    return null;
  }

  async _fetchJson(url) {
    if (typeof this.fetchImpl !== "function") throw new Error("fetch is unavailable");
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`Marketplace request failed: ${res.status}`);
    return await res.json();
  }
}

export function createDefaultPluginMarketplace({ hanakoHome, env = process.env, fetchImpl } = {}) {
  const envPath = normalizeOptionalText(env.HANA_PLUGIN_MARKETPLACE_FILE);
  const envUrl = normalizeOptionalText(env.HANA_PLUGIN_MARKETPLACE_URL);
  const localIndex = hanakoHome ? path.join(hanakoHome, "plugin-marketplace", "marketplace.json") : null;
  return new PluginMarketplace({
    indexPath: envPath || (localIndex && fs.existsSync(localIndex) ? localIndex : null),
    indexUrl: envUrl || DEFAULT_OFFICIAL_PLUGIN_MARKETPLACE_URL,
    fetchImpl,
  });
}

function normalizeMarketplacePlugins(rawPlugins, { baseDir, baseUrl, source }) {
  if (!Array.isArray(rawPlugins)) return [];
  return rawPlugins
    .map((plugin) => normalizeMarketplacePlugin(plugin, { baseDir, baseUrl, source }))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeMarketplacePlugin(plugin, { baseDir, baseUrl, source }) {
  if (!plugin || typeof plugin !== "object") return null;
  const id = normalizeOptionalText(plugin.id);
  const name = normalizeOptionalText(plugin.name) || id;
  if (!id || !name) return null;
  const distribution = normalizeDistribution(plugin.distribution, { baseDir, source });
  const versions = normalizeMarketplaceVersions(plugin, { baseDir, source, fallbackDistribution: distribution });
  const latest = versions[0] || null;
  const readme = normalizeOptionalText(plugin.readme) || normalizeOptionalText(plugin.readmeMarkdown) || null;
  const readmePath = source?.kind === "file" ? resolveOptionalLocalPath(plugin.readmePath, baseDir) : null;
  const readmeUrl = normalizeOptionalText(plugin.readmeUrl) || resolveOptionalUrl(plugin.readmePath, baseUrl);
  return {
    schemaVersion: plugin.schemaVersion || 1,
    id,
    name,
    publisher: normalizeOptionalText(plugin.publisher) || "unknown",
    version: latest?.version || normalizeOptionalText(plugin.version) || "0.0.0",
    description: normalizeOptionalText(plugin.description) || "",
    license: normalizeOptionalText(plugin.license) || null,
    categories: normalizeStringArray(plugin.categories),
    keywords: normalizeStringArray(plugin.keywords),
    homepage: normalizeOptionalText(plugin.homepage) || null,
    repository: normalizeOptionalText(plugin.repository) || null,
    compatibility: latest?.compatibility || (plugin.compatibility && typeof plugin.compatibility === "object" ? { ...plugin.compatibility } : {}),
    trust: plugin.trust === "full-access" ? "full-access" : "restricted",
    permissions: normalizeStringArray(plugin.permissions),
    contributions: normalizeStringArray(plugin.contributions),
    distribution: latest?.distribution || distribution,
    versions,
    install: plugin.install && typeof plugin.install === "object" ? { ...plugin.install } : {},
    screenshots: normalizeStringArray(plugin.screenshots),
    readme,
    readmePath,
    readmeUrl,
  };
}

function normalizeMarketplaceVersions(plugin, { baseDir, source, fallbackDistribution }) {
  const rawVersions = Array.isArray(plugin.versions) ? plugin.versions : [];
  const normalized = rawVersions
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const version = normalizeOptionalText(item.version);
      if (!version) return null;
      return {
        version,
        compatibility: item.compatibility && typeof item.compatibility === "object"
          ? { ...item.compatibility }
          : {},
        distribution: normalizeDistribution(item.distribution, { baseDir, source }),
      };
    })
    .filter(Boolean);

  if (normalized.length === 0) {
    normalized.push({
      version: normalizeOptionalText(plugin.version) || "0.0.0",
      compatibility: plugin.compatibility && typeof plugin.compatibility === "object" ? { ...plugin.compatibility } : {},
      distribution: fallbackDistribution || null,
    });
  }

  return sortVersionRecordsDesc(normalized);
}

function normalizeDistribution(distribution, { baseDir, source }) {
  if (!distribution || typeof distribution !== "object") return null;
  if (distribution.kind === "source") {
    const rawPath = normalizeOptionalText(distribution.path);
    return {
      kind: "source",
      path: rawPath,
      resolvedPath: resolveDistributionPath(rawPath, baseDir, source),
    };
  }
  if (distribution.kind === "release") {
    return {
      kind: "release",
      packageUrl: normalizeOptionalText(distribution.packageUrl),
      sha256: normalizeOptionalText(distribution.sha256),
    };
  }
  return null;
}

export function getMarketplacePluginVersionState(plugin, {
  appVersion = "0.0.0",
  installedVersion = null,
  targetVersion = null,
} = {}) {
  const versions = Array.isArray(plugin?.versions) && plugin.versions.length > 0
    ? sortVersionRecordsDesc(plugin.versions)
    : sortVersionRecordsDesc([{
        version: plugin?.version || "0.0.0",
        compatibility: plugin?.compatibility || {},
        distribution: plugin?.distribution || null,
      }]);
  const latest = versions[0] || null;
  const selected = targetVersion
    ? versions.find((item) => item.version === targetVersion) || null
    : versions.find((item) => isVersionCompatible(appVersion, item.compatibility)) || null;
  const compatible = !!selected && isVersionCompatible(appVersion, selected.compatibility);
  const installed = normalizeOptionalText(installedVersion);
  const selectedVersion = compatible ? selected.version : null;
  const cmp = installed && selectedVersion ? comparePluginVersions(selectedVersion, installed) : null;
  const updateAvailable = cmp !== null && cmp > 0;
  const downgrade = cmp !== null && cmp < 0;
  const reinstall = cmp !== null && cmp === 0;
  const canInstall = compatible && !!selected?.distribution;
  const installAction = !compatible
    ? "incompatible"
    : !installed
      ? "install"
      : updateAvailable
        ? "update"
        : downgrade
          ? "downgrade"
          : reinstall
            ? "reinstall"
            : "install";

  return {
    latestVersion: latest?.version || null,
    selectedVersion,
    installedVersion: installed,
    updateAvailable,
    downgrade,
    reinstall,
    compatible,
    canInstall,
    installAction,
    selectedDistribution: compatible ? selected.distribution || null : null,
    selectedCompatibility: compatible ? selected.compatibility || {} : {},
  };
}

function resolveDistributionPath(rawPath, baseDir, source) {
  if (!rawPath) return null;
  if (path.isAbsolute(rawPath)) return path.resolve(rawPath);
  if (baseDir) return path.resolve(baseDir, rawPath);
  if (source?.kind === "url") return null;
  return path.resolve(rawPath);
}

function resolveOptionalLocalPath(rawPath, baseDir) {
  const text = normalizeOptionalText(rawPath);
  if (!text) return null;
  if (path.isAbsolute(text)) return path.resolve(text);
  if (baseDir) return path.resolve(baseDir, text);
  return path.resolve(text);
}

function resolveOptionalUrl(rawPath, baseUrl) {
  const text = normalizeOptionalText(rawPath);
  if (!text || !baseUrl) return null;
  try {
    return new URL(text, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))] : [];
}

function normalizeOptionalText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeSource(source) {
  if (!source) return { kind: "none", configured: false };
  if (source.kind === "file") return { kind: "file", configured: true, path: source.path };
  if (source.kind === "url") return { kind: "url", configured: true, url: source.url };
  return { kind: "none", configured: false };
}

function fallbackReadme(plugin) {
  const lines = [`# ${plugin.name}`, ""];
  if (plugin.description) lines.push(plugin.description, "");
  lines.push(`- Publisher: ${plugin.publisher}`);
  lines.push(`- Version: ${plugin.version}`);
  lines.push(`- Trust: ${plugin.trust}`);
  if (plugin.repository) lines.push(`- Repository: ${plugin.repository}`);
  return lines.join("\n");
}
