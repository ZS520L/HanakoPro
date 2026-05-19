const fs = require("fs");
const crypto = require("crypto");

const DEFAULT_MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

function hashBuffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function versionsEqual(a, b) {
  if (!a || !b) return false;
  if (typeof a.sha256 === "string" && typeof b.sha256 === "string") {
    return a.sha256 === b.sha256 && a.size === b.size;
  }
  return a.mtimeMs === b.mtimeMs && a.size === b.size;
}

function readTextFileSnapshot(filePath, { maxBytes = DEFAULT_MAX_TEXT_FILE_BYTES } = {}) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;
  if (stat.size > maxBytes) return null;

  const buf = fs.readFileSync(filePath);
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return null;

  return {
    content: buf.toString("utf-8"),
    version: {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      sha256: hashBuffer(buf),
    },
  };
}

function writeTextFileIfUnchanged(filePath, content, expectedVersion) {
  if (expectedVersion) {
    const current = readTextFileSnapshot(filePath);
    if (!current || !versionsEqual(current.version, expectedVersion)) {
      return {
        ok: false,
        conflict: true,
        version: current?.version ?? null,
      };
    }
  }

  fs.writeFileSync(filePath, content, "utf-8");
  const next = readTextFileSnapshot(filePath);
  return {
    ok: true,
    conflict: false,
    version: next?.version ?? null,
  };
}

module.exports = {
  readTextFileSnapshot,
  writeTextFileIfUnchanged,
  versionsEqual,
};
