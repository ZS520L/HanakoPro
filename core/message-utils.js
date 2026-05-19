/**
 * 消息工具函数 — 跨模块共享的消息处理工具
 *
 * 从 sessions route 提取，供 route 层与 plugin 系统共用。
 */
import fs from "fs/promises";
import path from "path";
import { isToolCallBlock, getToolArgs } from "./llm-utils.js";
import { SessionManager } from "../lib/pi-sdk/index.js";

/**
 * 工具调用参数摘要键列表
 * 提取工具调用时只保留这些键作为摘要信息
 */
export const TOOL_ARG_SUMMARY_KEYS = [
  "file_path", "path", "command", "pattern", "url", "query",
  "key", "value", "action", "type", "schedule", "prompt", "label",
];

const SESSION_TAIL_READ_THRESHOLD = 256 * 1024;

/** 从文本中提取并剥离 <think>/<thinking> 标签 */
export function stripThinkTags(raw) {
  const thinkParts = [];
  const text = raw.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>\n*/g, (_, inner) => {
    thinkParts.push(inner.trim());
    return "";
  });
  return { text, thinkContent: thinkParts.join("\n") };
}

/**
 * 从 Pi SDK 的 content 块数组中提取纯文本 + thinking + tool_use 调用
 * content 可能是 string 或 [{type: "text", text: "..."}, {type: "thinking", thinking: "..."}, ...]
 * 返回 { text, thinking, toolUses, images }
 */
export function extractTextContent(content, { stripThink = false } = {}) {
  if (typeof content === "string") {
    if (stripThink) {
      const { text, thinkContent } = stripThinkTags(content);
      return { text, thinking: thinkContent, toolUses: [], images: [] };
    }
    return { text: content, thinking: "", toolUses: [], images: [] };
  }
  if (!Array.isArray(content)) return { text: "", thinking: "", toolUses: [], images: [] };
  const rawText = content
    .filter(block => block.type === "text" && block.text)
    .map(block => block.text)
    .join("");
  const images = content
    .filter(block => block.type === "image" && (block.data || block.source?.data))
    .map(block => ({ data: block.data || block.source.data, mimeType: block.mimeType || block.source?.media_type || "image/png" }));
  const { text, thinkContent } = stripThink ? stripThinkTags(rawText) : { text: rawText, thinkContent: "" };
  const thinking = [
    thinkContent,
    ...content
      .filter(block => block.type === "thinking" && block.thinking)
      .map(block => block.thinking),
  ].filter(Boolean).join("\n");
  const toolUses = content
    .filter(isToolCallBlock)
    .map(block => {
      const args = {};
      const params = getToolArgs(block);
      if (params && typeof params === "object") {
        for (const k of TOOL_ARG_SUMMARY_KEYS) {
          if (params[k] !== undefined) args[k] = params[k];
        }
      }
      return { name: block.name, args: Object.keys(args).length ? args : undefined };
    });
  return { text, thinking, toolUses, images };
}

/**
 * 优先从 session JSONL 读取完整历史。
 * engine.messages 可能只是当前上下文窗口，切回页面时会导致旧消息缺失。
 * 读文件失败时再退回内存态，避免历史接口直接空白。
 */
export async function loadSessionHistoryMessages(engine, explicitPath) {
  const sessionPath = explicitPath;
  if (!sessionPath) return [];

  const liveSession = engine?.getSessionByPath?.(sessionPath);
  const liveManager = liveSession?.sessionManager;
  if (liveManager && typeof liveManager.getBranch === "function") {
    return messagesFromBranchEntries(liveManager.getBranch());
  }

  try {
    if (await looksLikePiSessionFile(sessionPath)) {
      const manager = SessionManager.open(sessionPath, path.dirname(sessionPath));
      const messages = messagesFromBranchEntries(manager.getBranch());
      return messages;
    }
  } catch {
    // 旧文件或损坏文件继续走兼容读取，不让历史页直接空白。
  }

  try {
    const raw = await fs.readFile(sessionPath, "utf-8");
    const messages = [];

    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message) {
          const message = { ...entry.message };
          if (entry.id) message.id = entry.id;
          if (entry.timestamp) message.timestamp = entry.timestamp;
          messages.push(message);
        }
      } catch {
        // 跳过损坏行
      }
    }

    if (messages.length > 0) return messages;
  } catch {
    // 文件读取失败
  }

  return [];
}

function messagesFromBranchEntries(branch) {
  const messages = [];
  for (const entry of Array.isArray(branch) ? branch : []) {
    if (entry.type !== "message" || !entry.message) continue;
    const message = { ...entry.message };
    if (entry.id) message.id = entry.id;
    if (entry.timestamp) message.timestamp = entry.timestamp;
    messages.push(message);
  }
  return messages;
}

async function looksLikePiSessionFile(sessionPath) {
  const fh = await fs.open(sessionPath, "r");
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.toString("utf-8", 0, bytesRead).split("\n")[0]?.trim();
    if (!firstLine) return false;
    const header = JSON.parse(firstLine);
    return header?.type === "session" && typeof header.id === "string";
  } finally {
    await fh.close();
  }
}

async function readSessionTailUtf8(filePath, maxBytes = SESSION_TAIL_READ_THRESHOLD) {
  const stat = await fs.stat(filePath);
  if (!stat.size) return "";
  if (stat.size <= maxBytes) {
    return await fs.readFile(filePath, "utf-8");
  }

  const start = Math.max(0, stat.size - maxBytes);
  const fh = await fs.open(filePath, "r");
  try {
    const length = stat.size - start;
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, start);
    let raw = buf.toString("utf-8");
    const firstNewline = raw.indexOf("\n");
    if (firstNewline === -1) return "";
    return raw.slice(firstNewline + 1);
  } finally {
    await fh.close();
  }
}

/**
 * 从 session JSONL 尾部推断最后一条 assistant 文本摘要。
 *
 * 这里故意保持和 sessions route 旧语义一致：
 * - 只看物理文件尾部最近的 assistant message
 * - 若最近 assistant 没有文本，则返回 null，不继续向前找更早的 assistant
 *
 * 这样可以把整文件 read+split 降成有界尾读，同时不改变现有 UI 的终态判断规则。
 */
export async function loadLatestAssistantSummaryFromSessionFile(sessionPath, options = {}) {
  if (!sessionPath) return null;
  const maxBytes = options.maxBytes ?? SESSION_TAIL_READ_THRESHOLD;
  const summaryLimit = options.summaryLimit ?? 200;

  try {
    const raw = await readSessionTailUtf8(sessionPath, maxBytes);
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const lines = trimmed.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        const msg = entry?.message;
        if (entry?.type !== "message" || msg?.role !== "assistant") continue;
        const { text } = extractTextContent(msg.content, { stripThink: true });
        return text ? text.slice(0, summaryLimit) : null;
      } catch {
        // 跳过损坏行，继续向前扫描
      }
    }
  } catch {
    // 文件读取失败
  }

  return null;
}

export function relativePathInsideBase(targetPath, baseDir) {
  if (typeof targetPath !== "string" || typeof baseDir !== "string") return null;
  if (!targetPath || !baseDir) return null;

  const resolved = path.resolve(targetPath);
  const base = path.resolve(baseDir);
  const rel = path.relative(base, resolved);
  if (rel === "") return "";
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel;
}

/**
 * 校验 sessionPath 是否在合法范围内，防止路径穿越
 * baseDir 可以是 sessionDir（单 agent）或 agentsDir（跨 agent）
 */
export function isValidSessionPath(sessionPath, baseDir) {
  return relativePathInsideBase(sessionPath, baseDir) !== null;
}

/**
 * 严格校验：sessionPath 必须指向某 agent 的"活跃/归档"对话文件，
 * 即落在 `agents/{id}/sessions/xxx.jsonl` 或 `agents/{id}/sessions/archived/xxx.jsonl`。
 *
 * 明确拒绝旁路目录（subagent-sessions/、activity/、heartbeat/、.ephemeral/ 等）。
 * 这些目录下的 session 文件是 agent 运行态产物，不是用户可切换的对话焦点——把它们
 * 当成活跃 session 会让 listSessions 的"伪条目"分支伪造出"新对话"幻影条目（不能归档、
 * 重启即消失），参见 session-coordinator listSessions 占位逻辑。
 */
export function isActiveSessionPath(sessionPath, agentsDir) {
  const rel = relativePathInsideBase(sessionPath, agentsDir);
  if (rel === null) return false;
  const parts = rel.split(path.sep);
  if (parts.length < 3) return false;
  if (parts[1] !== "sessions") return false;
  if (parts.length === 3) return true;
  if (parts.length === 4 && parts[2] === "archived") return true;
  return false;
}
