/**
 * Agent Phone Projection
 *
 * 每个 Agent 在每个 conversation 下拥有一份自己的手机文档。
 * 文档是 projection，不是消息 Truth；Truth 仍由 channel / DM store 拥有。
 */

import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import crypto from "crypto";

const ENCODED_META_KEYS = new Set();

export function safeConversationStem(conversationId) {
  const raw = String(conversationId || "").trim() || "conversation";
  const readable = raw
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "conversation";
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 8);
  return `${readable}-${hash}`;
}

export function getAgentPhoneProjectionPath(agentDir, conversationId) {
  return path.join(agentDir, "phone", "conversations", `${safeConversationStem(conversationId)}.md`);
}

function parseProjection(content) {
  const lines = content.split("\n");
  const meta = {};
  let bodyStart = 0;

  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        bodyStart = i + 1;
        break;
      }
      const idx = lines[i].indexOf(":");
      if (idx < 0) continue;
      const key = lines[i].slice(0, idx).trim();
      let val = lines[i].slice(idx + 1).trim();
      if (ENCODED_META_KEYS.has(key)) {
        try {
          val = decodeURIComponent(val);
        } catch {
          // Preserve old/raw values if they were written before encoding.
        }
      }
      meta[key] = val;
    }
  }

  const activities = [];
  for (const line of lines.slice(bodyStart)) {
    const match = line.match(/^- ([^\s]+) \[([^\]]+)\] (.*)$/);
    if (!match) continue;
    const detailsMatch = match[3].match(/^(.*?) <!-- details: (.*) -->$/);
    activities.push({
      timestamp: match[1],
      state: match[2],
      summary: (detailsMatch ? detailsMatch[1] : match[3]).trim(),
    });
  }

  return { meta, activities };
}

function serializeProjection(meta, body) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined || value === null || value === "") continue;
    const serialized = ENCODED_META_KEYS.has(key)
      ? encodeURIComponent(String(value))
      : String(value).replace(/\n/g, " ");
    lines.push(`${key}: ${serialized}`);
  }
  lines.push("---", "");
  return `${lines.join("\n")}${body || ""}`;
}

function projectionBody(content) {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return "";
  return content.slice(end + 4).replace(/^\n*/, "");
}

export function readAgentPhoneProjection(filePath) {
  if (!fs.existsSync(filePath)) return { meta: {}, activities: [] };
  return parseProjection(fs.readFileSync(filePath, "utf-8"));
}

export function listAgentPhoneProjectionFiles(agentDir) {
  const dir = path.join(agentDir, "phone", "conversations");
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dir, entry.name));
}

export function resolveAgentPhoneStoredSessionPath(agentDir, stored) {
  if (!stored || typeof stored !== "string") return null;
  const resolved = path.resolve(agentDir, ...stored.split("/").filter(Boolean));
  const base = path.resolve(agentDir);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

export async function ensureAgentPhoneProjection({
  agentDir,
  agentId,
  conversationId,
  conversationType,
  timestamp = new Date().toISOString(),
}) {
  if (!agentDir) throw new Error("agentDir is required");
  if (!agentId) throw new Error("agentId is required");
  if (!conversationId) throw new Error("conversationId is required");
  if (!conversationType) throw new Error("conversationType is required");

  const filePath = getAgentPhoneProjectionPath(agentDir, conversationId);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    const meta = {
      agentId,
      conversationId,
      conversationType,
      state: "idle",
      summary: "idle",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const title = `# Agent Phone: ${conversationType} ${conversationId}\n\n## Activity\n`;
    await fsp.writeFile(filePath, serializeProjection(meta, title), "utf-8");
  }
  return filePath;
}

export async function updateAgentPhoneProjectionMeta({
  agentDir,
  agentId,
  conversationId,
  conversationType,
  patch,
  timestamp = new Date().toISOString(),
}) {
  const filePath = await ensureAgentPhoneProjection({
    agentDir,
    agentId,
    conversationId,
    conversationType,
    timestamp,
  });
  const existing = fs.readFileSync(filePath, "utf-8");
  const parsed = parseProjection(existing);
  const nextMeta = {
    ...parsed.meta,
    ...patch,
    updatedAt: timestamp,
  };
  await fsp.writeFile(filePath, serializeProjection(nextMeta, projectionBody(existing)), "utf-8");
  return filePath;
}

export async function recordAgentPhoneActivity({
  agentDir,
  agentId,
  conversationId,
  conversationType,
  state,
  summary,
  details,
  timestamp = new Date().toISOString(),
}) {
  if (!state) throw new Error("state is required");
  const filePath = await ensureAgentPhoneProjection({
    agentDir,
    agentId,
    conversationId,
    conversationType,
    timestamp,
  });

  const existing = fs.readFileSync(filePath, "utf-8");
  const parsed = parseProjection(existing);
  const meta = {
    ...parsed.meta,
    agentId,
    conversationId,
    conversationType,
    state,
    summary: summary || state,
    updatedAt: timestamp,
  };
  if (details?.lastMessageTimestamp) {
    meta.lastViewedTimestamp = details.lastMessageTimestamp;
  }

  const detailsText = details && Object.keys(details).length > 0
    ? ` <!-- details: ${JSON.stringify(details)} -->`
    : "";
  const line = `- ${timestamp} [${state}] ${summary || state}${detailsText}\n`;
  await fsp.writeFile(filePath, serializeProjection(meta, `${projectionBody(existing)}${line}`), "utf-8");
  return { filePath, activity: { timestamp, state, summary: summary || state, details: details || null } };
}
