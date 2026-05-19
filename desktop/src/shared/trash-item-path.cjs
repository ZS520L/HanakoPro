/**
 * trash-item-path.cjs — normalize renderer-provided paths for shell.trashItem().
 *
 * Electron shell.trashItem expects the platform's native separator. Renderer
 * workspace paths are intentionally display-friendly and may use "/" on every
 * OS, so the IPC boundary owns the conversion before touching the filesystem.
 */
const path = require("path");

function pathForPlatform(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function resolveTrashItemPath(filePath, platform = process.platform) {
  if (typeof filePath !== "string" || filePath.length === 0) return null;
  const pathImpl = pathForPlatform(platform);
  if (!pathImpl.isAbsolute(filePath)) return null;
  return pathImpl.resolve(filePath);
}

module.exports = { resolveTrashItemPath };
