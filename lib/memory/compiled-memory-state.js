import fs from "fs";
import path from "path";

const COMPILED_FILES = ["memory.md", "facts.md", "today.md", "week.md", "longterm.md"];

export function resetMarkerPath(memoryDir) {
  return path.join(memoryDir, "reset.json");
}

export function readCompiledResetAt(memoryDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(resetMarkerPath(memoryDir), "utf-8"));
    const value = raw?.compiledResetAt;
    if (!value || Number.isNaN(Date.parse(value))) return null;
    return value;
  } catch {
    return null;
  }
}

export function writeCompiledResetMarker(memoryDir, resetAt = new Date().toISOString()) {
  if (!resetAt || Number.isNaN(Date.parse(resetAt))) {
    throw new Error("compiledResetAt must be an ISO timestamp");
  }
  fs.mkdirSync(memoryDir, { recursive: true });
  const marker = {
    compiledResetAt: resetAt,
    updatedAt: new Date().toISOString(),
  };
  atomicWrite(resetMarkerPath(memoryDir), JSON.stringify(marker, null, 2) + "\n");
  return resetAt;
}

export function clearCompiledMemoryArtifacts(memoryDir) {
  fs.mkdirSync(memoryDir, { recursive: true });
  for (const name of COMPILED_FILES) {
    const filePath = path.join(memoryDir, name);
    fs.writeFileSync(filePath, "", "utf-8");
    removeIfExists(`${filePath}.fingerprint`);
  }
}

export function clearCompiledSummarySources(summariesDir, summaryManager = null) {
  fs.mkdirSync(summariesDir, { recursive: true });
  for (const entry of fs.readdirSync(summariesDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    removeIfExists(path.join(summariesDir, entry.name));
  }
  summaryManager?.clearCache?.();
}

export function normalizeCompiledSectionBody(value) {
  const raw = stripThinkTagBlocks(String(value || "")).trim();
  if (!raw) return "";

  const parsedArray = parseStringArray(raw);
  const text = parsedArray
    ? parsedArray.map((item) => `- ${item.trim()}`).join("\n")
    : raw;

  return text
    .split(/\r?\n/)
    .filter((line) => !/^#{1,6}\s+\S/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeCompiledLLMResult(value, source = "compiled memory") {
  const normalized = normalizeCompiledSectionBody(value);
  if (!normalized && hasDanglingLeadingThinkTag(value)) {
    throw new Error(`${source} returned an unterminated thinking block`);
  }
  return normalized;
}

export function stripThinkTagBlocks(value) {
  return String(value || "")
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>\s*/gi, "")
    .replace(/^\s*<think(?:ing)?>[\s\S]*$/i, "")
    .replace(/<\/think(?:ing)?>\s*/gi, "");
}

export function hasDanglingLeadingThinkTag(value) {
  const text = String(value || "");
  return /^\s*<think(?:ing)?>/i.test(text) && !/<\/think(?:ing)?>/i.test(text);
}

function parseStringArray(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every((item) => typeof item === "string")) return null;
    return parsed.filter((item) => item.trim());
  } catch {
    return null;
  }
}

function removeIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}
