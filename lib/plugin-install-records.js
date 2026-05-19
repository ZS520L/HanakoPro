import fs from "fs";
import path from "path";

const INSTALL_RECORDS_VERSION = 1;
const MAX_HISTORY = 20;

function emptyRecords() {
  return { version: INSTALL_RECORDS_VERSION, plugins: {} };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return emptyRecords();
    console.warn(`[plugin-installs] failed to read ${filePath}: ${err.message}`);
    return emptyRecords();
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

export class PluginInstallRecords {
  constructor({ hanakoHome }) {
    if (!hanakoHome) throw new Error("PluginInstallRecords requires hanakoHome");
    this._path = path.join(hanakoHome, "plugin-installs.json");
  }

  _read() {
    const raw = readJson(this._path);
    return {
      version: INSTALL_RECORDS_VERSION,
      plugins: raw?.plugins && typeof raw.plugins === "object" ? raw.plugins : {},
    };
  }

  get(pluginId) {
    if (!pluginId) return null;
    const records = this._read();
    const record = records.plugins[pluginId];
    return record ? structuredClone(record) : null;
  }

  recordInstall(record) {
    if (!record?.pluginId) throw new Error("recordInstall requires pluginId");
    const now = new Date().toISOString();
    const records = this._read();
    const previous = records.plugins[record.pluginId] || null;
    const historyItem = previous
      ? {
          installedVersion: previous.installedVersion || null,
          source: previous.source || null,
          updatedAt: previous.updatedAt || previous.installedAt || null,
          packageUrl: previous.packageUrl || null,
          sha256: previous.sha256 || null,
        }
      : null;
    records.plugins[record.pluginId] = {
      pluginId: record.pluginId,
      installedVersion: record.installedVersion || "0.0.0",
      source: record.source || "local",
      marketplaceId: record.marketplaceId || null,
      marketplaceSource: record.marketplaceSource || null,
      distributionKind: record.distributionKind || null,
      packageUrl: record.packageUrl || null,
      sha256: record.sha256 || null,
      sourcePath: record.sourcePath || null,
      installedAt: previous?.installedAt || now,
      updatedAt: now,
      history: [
        ...(historyItem ? [historyItem] : []),
        ...(Array.isArray(previous?.history) ? previous.history : []),
      ].slice(0, MAX_HISTORY),
    };
    atomicWriteJson(this._path, records);
    return structuredClone(records.plugins[record.pluginId]);
  }

  remove(pluginId) {
    if (!pluginId) return;
    const records = this._read();
    delete records.plugins[pluginId];
    atomicWriteJson(this._path, records);
  }
}
