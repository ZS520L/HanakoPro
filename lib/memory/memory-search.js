import fs from "node:fs";
import path from "node:path";
import { Type } from "../pi-sdk/index.js";
import { t } from "../../server/i18n.js";

function resolvePinnedPath(agentDirOrOptions, opts) {
  if (typeof agentDirOrOptions === "string") return path.join(agentDirOrOptions, "pinned.md");
  if (typeof opts?.pinnedPath === "string") return opts.pinnedPath;
  if (typeof opts?.agentDir === "string") return path.join(opts.agentDir, "pinned.md");
  return "";
}

function readPinnedMemories(pinnedPath) {
  if (!pinnedPath) return [];
  let raw = "";
  try {
    raw = fs.readFileSync(pinnedPath, "utf-8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

function normalize(text) {
  return String(text || "").toLowerCase();
}

function queryTerms(query) {
  const normalized = normalize(query).trim();
  if (!normalized) return [];
  const parts = normalized
    .split(/[\s,，.。!！?？;；:："“”'‘’()[\]{}<>《》、\\/|]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  return Array.from(new Set([normalized, ...parts]));
}

function searchPinnedMemories(memories, query) {
  const terms = queryTerms(query);
  if (terms.length === 0) return memories.map((memory, index) => ({ memory, index, score: 1 }));
  return memories
    .map((memory, index) => {
      const normalized = normalize(memory);
      const score = terms.reduce((sum, term) => sum + (normalized.includes(term) ? 1 : 0), 0);
      return { memory, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

export function createMemorySearchTool(agentDirOrOptions, opts = {}) {
  const pinnedPath = resolvePinnedPath(agentDirOrOptions, opts);
  return {
    name: "search_memory",
    label: t("error.memorySearchLabel"),
    description: t("error.memorySearchDesc"),
    parameters: Type.Object({
      query: Type.String({ description: t("error.memorySearchQueryDesc") }),
    }),
    execute: async (_toolCallId, params) => {
      try {
        const t0 = performance.now();
        const memories = readPinnedMemories(pinnedPath);

        if (memories.length === 0) {
          return {
            content: [{ type: "text", text: t("error.memorySearchEmpty") }],
            details: { resultCount: 0, source: "pinned" },
          };
        }

        const results = searchPinnedMemories(memories, params.query);

        const elapsed = performance.now() - t0;
        console.log(`\x1b[90m[memory-search] ${elapsed.toFixed(0)}ms | pinned hits: ${results.length}\x1b[0m`);

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: t("error.memorySearchEmpty") }],
            details: { resultCount: 0, source: "pinned" },
          };
        }

        const lines = results.map((r, i) => `${i + 1}. ${r.memory}`);

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { resultCount: results.length, source: "pinned" },
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: t("error.memorySearchError", { msg: err.message }) }],
          details: {},
        };
      }
    },
  };
}
