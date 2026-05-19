import fs from "fs";
import path from "path";

const DEFAULT_MAX_BACKUPS_PER_PLUGIN = 3;

function safeSegment(value, fallback = "plugin") {
  const text = String(value || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return text || fallback;
}

function assertInsideDir(childPath, parentDir) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentDir);
  const parentWithSep = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child === parent || child.startsWith(parentWithSep);
}

function cleanupBackups(pluginBackupRoot, maxBackups) {
  if (!fs.existsSync(pluginBackupRoot)) return;
  const entries = fs.readdirSync(pluginBackupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(pluginBackupRoot, entry.name);
      const stat = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const entry of entries.slice(maxBackups)) {
    fs.rmSync(entry.fullPath, { recursive: true, force: true });
  }
}

export function createPluginInstallBackup({
  hanakoHome,
  pluginId,
  pluginDir,
  version,
  maxBackups = DEFAULT_MAX_BACKUPS_PER_PLUGIN,
} = {}) {
  if (!hanakoHome || !pluginId || !pluginDir || !fs.existsSync(pluginDir)) return null;
  const backupRoot = path.join(hanakoHome, "plugin-backups", safeSegment(pluginId));
  fs.mkdirSync(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = path.join(backupRoot, `${stamp}-v${safeSegment(version, "0.0.0")}`);
  const tmpDir = `${backupDir}.tmp`;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.cpSync(pluginDir, tmpDir, { recursive: true });
  fs.renameSync(tmpDir, backupDir);
  cleanupBackups(backupRoot, maxBackups);
  return { pluginId, version: version || null, pluginDir, backupDir };
}

export function restorePluginInstallBackup(backup, targetDir) {
  if (!backup?.backupDir || !targetDir || !fs.existsSync(backup.backupDir)) return false;
  const parent = path.dirname(targetDir);
  fs.mkdirSync(parent, { recursive: true });
  if (!assertInsideDir(targetDir, parent)) return false;
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.cpSync(backup.backupDir, targetDir, { recursive: true });
  return true;
}
