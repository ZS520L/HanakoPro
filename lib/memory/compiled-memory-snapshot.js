import fs from "fs";
import path from "path";
import { assemble } from "./compile.js";
import { normalizeCompiledSectionBody } from "./compiled-memory-state.js";

export const COMPILED_MEMORY_BLOCKS = [
  { key: "facts", fileName: "facts.md", label: "重要事实" },
  { key: "today", fileName: "today.md", label: "今天" },
  { key: "week", fileName: "week.md", label: "本周早些时候" },
  { key: "longterm", fileName: "longterm.md", label: "长期情况" },
];

export function emptyCompiledMemory() {
  return Object.fromEntries(COMPILED_MEMORY_BLOCKS.map(({ key }) => [key, ""]));
}

export function normalizeCompiledMemory(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(COMPILED_MEMORY_BLOCKS.map(({ key }) => [
    key,
    normalizeCompiledSectionBody(typeof source[key] === "string" ? source[key] : ""),
  ]));
}

export function hasCompiledMemory(compiled) {
  const normalized = normalizeCompiledMemory(compiled);
  return COMPILED_MEMORY_BLOCKS.some(({ key }) => Boolean(normalized[key]));
}

export function compactCompiledMemory(compiled) {
  const normalized = normalizeCompiledMemory(compiled);
  return Object.fromEntries(
    COMPILED_MEMORY_BLOCKS
      .map(({ key }) => [key, normalized[key]])
      .filter(([, value]) => Boolean(value)),
  );
}

export function readCompiledMemorySnapshot(memoryDir) {
  const fromSectionFiles = normalizeCompiledMemory(Object.fromEntries(
    COMPILED_MEMORY_BLOCKS.map(({ key, fileName }) => [
      key,
      readOptionalText(path.join(memoryDir, fileName)),
    ]),
  ));
  const fromMemoryMd = parseMemoryMd(readOptionalText(path.join(memoryDir, "memory.md")));
  return normalizeCompiledMemory(Object.fromEntries(
    COMPILED_MEMORY_BLOCKS.map(({ key }) => [
      key,
      fromSectionFiles[key] || fromMemoryMd[key] || "",
    ]),
  ));
}

export function writeCompiledMemorySnapshot(memoryDir, compiled, opts = {}) {
  const normalized = normalizeCompiledMemory(compiled);
  if (!hasCompiledMemory(normalized)) return false;

  fs.mkdirSync(memoryDir, { recursive: true });
  for (const { key, fileName } of COMPILED_MEMORY_BLOCKS) {
    fs.writeFileSync(path.join(memoryDir, fileName), normalized[key] || "", "utf-8");
  }

  writeImportedSummarySeed(memoryDir, normalized, opts);
  assemble(
    path.join(memoryDir, "facts.md"),
    path.join(memoryDir, "today.md"),
    path.join(memoryDir, "week.md"),
    path.join(memoryDir, "longterm.md"),
    path.join(memoryDir, "memory.md"),
  );
  return true;
}

function writeImportedSummarySeed(memoryDir, compiled, opts = {}) {
  const summary = buildImportedSummary(compiled);
  if (!summary) return;

  const summariesDir = path.join(memoryDir, "summaries");
  fs.mkdirSync(summariesDir, { recursive: true });
  const now = new Date().toISOString();
  const sessionId = safeSeedId(opts.sourceId || `compiled-memory-import-${now}`);
  const payload = {
    session_id: sessionId,
    created_at: now,
    updated_at: now,
    summary,
    messageCount: 0,
    snapshot: summary,
    snapshot_at: now,
    imported: {
      source: opts.source || "character-card",
      packageName: opts.sourcePackage || null,
    },
  };
  fs.writeFileSync(path.join(summariesDir, `${sessionId}.json`), JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

function buildImportedSummary(compiled) {
  const normalized = normalizeCompiledMemory(compiled);
  const importantFacts = normalized.facts || "无";
  const context = [
    normalized.today ? `#### 今天\n\n${normalized.today}` : "",
    normalized.week ? `#### 本周早些时候\n\n${normalized.week}` : "",
    normalized.longterm ? `#### 长期情况\n\n${normalized.longterm}` : "",
  ].filter(Boolean).join("\n\n");

  if (!normalized.facts && !context) return "";
  return [
    "### 重要事实",
    "",
    importantFacts,
    "",
    "### 事情经过",
    "",
    context || "无",
  ].join("\n");
}

function readOptionalText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function parseMemoryMd(content) {
  const result = emptyCompiledMemory();
  const text = String(content || "").trim();
  if (!text) return result;

  const titleToKey = new Map([
    ["重要事实", "facts"],
    ["key facts", "facts"],
    ["今天", "today"],
    ["today", "today"],
    ["本周早些时候", "week"],
    ["earlier this week", "week"],
    ["长期情况", "longterm"],
    ["long-term context", "longterm"],
  ]);
  let currentKey = null;
  const chunks = Object.fromEntries(COMPILED_MEMORY_BLOCKS.map(({ key }) => [key, []]));
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      currentKey = titleToKey.get(heading[1].trim().toLowerCase()) || null;
      continue;
    }
    if (currentKey) chunks[currentKey].push(line);
  }
  for (const { key } of COMPILED_MEMORY_BLOCKS) {
    result[key] = normalizeMemoryMdSection(chunks[key].join("\n"));
  }
  return result;
}

function normalizeMemoryMdSection(value) {
  const normalized = normalizeCompiledSectionBody(value);
  if (normalized === "（暂无）" || normalized === "(none)") return "";
  return normalized;
}

function safeSeedId(value) {
  const raw = String(value || "compiled-memory-import").trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "compiled-memory-import";
}
