/**
 * Session 管理 REST 路由
 */
import { appendFileSync, existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
const fsp = fs;
import { Hono } from "hono";
import { safeJson } from "../hono-helpers.js";
import { t } from "../i18n.js";
import { extractBlocks } from "../block-extractors.js";
import { BrowserManager } from "../../lib/browser/browser-manager.js";
import { sessionIdFromFilename } from "../../lib/session-jsonl.js";
import {
  materializeExecutorIdentity,
  readSubagentSessionMetaSync,
} from "../../lib/subagent-executor-metadata.js";
import {
  extractTextContent,
  loadSessionHistoryMessages,
  loadLatestAssistantSummaryFromSessionFile,
  isValidSessionPath,
  isActiveSessionPath,
} from "../../core/message-utils.js";
import {
  loadLatestTodosFromSessionFile,
  loadLatestTodoSnapshotFromSessionFile,
} from "../../lib/tools/todo-compat.js";
import { SessionManager } from "../../lib/pi-sdk/index.js";
import { TODO_STATE_CUSTOM_TYPE } from "../../lib/tools/todo-constants.js";
import { mergeWorkspaceHistory } from "../../shared/workspace-history.js";
import { computeContextUsageSnapshot } from "../../core/context-usage-estimator.js";
import { resolveContextConfig } from "../../core/context-compressor.js";
import {
  deleteSessionFileSidecarSync,
  moveSessionFileSidecarSync,
  sessionFileSidecarPath,
} from "../../lib/session-files/session-file-registry.js";
import { serializeSessionFile } from "../../lib/session-files/session-file-response.js";
import { deleteSessionSkillSnapshotSync } from "../../lib/skills/session-skill-snapshot.js";
import { browserScreenshotPath } from "../../lib/session-files/browser-screenshot-file.js";
import { modelSupportsXhigh } from "../../core/session-thinking-level.js";
import {
  modelSupportsDirectVideoInput,
  modelSupportsVideoInput,
  resolveModelVideoInputTransport,
} from "../../shared/model-capabilities.js";
import { replayLatestUserTurn, revertLatestAssistantTurn } from "../../core/session-turn-actions.js";

function rcPlatformFromSessionKey(sessionKey) {
  const match = /^([a-z]+)_/i.exec(sessionKey || "");
  return match ? match[1] : "bridge";
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function coerceTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return asNumber;
  }
  return 0;
}

function completeTodoItems(todos) {
  return (Array.isArray(todos) ? todos : []).map((todo) => ({
    ...todo,
    status: "completed",
  }));
}

function getWritableSessionManager(engine, sessionPath) {
  const liveSession = engine.getSessionByPath?.(sessionPath);
  if (liveSession?.sessionManager) return liveSession.sessionManager;
  return SessionManager.open(sessionPath, path.dirname(sessionPath));
}

const TODO_COMPLETE_MESSAGE =
  "[Hana Todo] The user marked the current todo list as completed and removed it from the session UI. Treat every item in that list as completed. Create a new todo list only if new work needs tracking.";

export function createSessionsRoute(engine) {
  const route = new Hono();

  // session-meta.json sidecar 按 session 目录共享；同一个 request 里遍历几十个 block
  // 时不必每个 block 都重复 readFileSync + JSON.parse。调用端构造一次 Map 当 cache。
  function createSubagentMetaCache() {
    const map = new Map();
    return (sessionPath) => {
      if (!sessionPath) return null;
      if (map.has(sessionPath)) return map.get(sessionPath);
      const meta = readSubagentSessionMetaSync(sessionPath);
      map.set(sessionPath, meta);
      return meta;
    };
  }

  function applySubagentIdentity(block, task, readSessionMeta) {
    const sessionPath = block.streamKey || task?.meta?.sessionPath || null;
    const sessionMeta = readSessionMeta(sessionPath);
    const resolved =
      materializeExecutorIdentity(sessionMeta, engine.getAgent?.bind(engine))
      || materializeExecutorIdentity(task?.meta, engine.getAgent?.bind(engine))
      || materializeExecutorIdentity(block, engine.getAgent?.bind(engine));

    if (resolved) {
      block.agentId = resolved.agentId;
      block.agentName = resolved.agentName;
      return;
    }

    const inferredAgentId = sessionPath
      ? engine.agentIdFromSessionPath?.(sessionPath) || null
      : null;
    if (!inferredAgentId) return;

    const inferredAgent = engine.getAgent?.(inferredAgentId) || null;
    block.agentId = inferredAgentId;
    block.agentName = inferredAgent?.agentName || "Unknown agent";
  }

  function patchBlockExecutorMetadata(block, task, readSessionMeta) {
    const sessionPath = block.streamKey || task?.meta?.sessionPath || null;
    const sessionMeta = readSessionMeta(sessionPath);
    const sources = [sessionMeta, task?.meta, block];

    for (const source of sources) {
      if (!source) continue;
      if (source.executorAgentId && !block.executorAgentId) {
        block.executorAgentId = source.executorAgentId;
      }
      if (source.executorAgentNameSnapshot && !block.executorAgentNameSnapshot) {
        block.executorAgentNameSnapshot = source.executorAgentNameSnapshot;
      }
      if (source.executorMetaVersion && !block.executorMetaVersion) {
        block.executorMetaVersion = source.executorMetaVersion;
      }
    }
  }

  function patchBlockRequestedMetadata(block, task = null) {
    const sources = [task?.meta, block];

    for (const source of sources) {
      if (!source) continue;
      if (source.requestedAgentId && !block.requestedAgentId) {
        block.requestedAgentId = source.requestedAgentId;
      }
      if (source.requestedAgentNameSnapshot && !block.requestedAgentName) {
        block.requestedAgentName = source.requestedAgentNameSnapshot;
      }
    }
  }

  function createSubagentSummaryCache() {
    const map = new Map();
    return async (sessionPath) => {
      if (!sessionPath) return null;
      if (!map.has(sessionPath)) {
        map.set(sessionPath, loadLatestAssistantSummaryFromSessionFile(sessionPath));
      }
      return await map.get(sessionPath);
    };
  }

  function getSessionSummaryRecord(sessionPath, agentIdHint = null) {
    if (!sessionPath) return null;
    const agentId = agentIdHint || engine.agentIdFromSessionPath?.(sessionPath) || null;
    if (!agentId) return null;
    const agent = engine.getAgent?.(agentId) || null;
    const summaryManager = agent?.summaryManager || null;
    if (!summaryManager || typeof summaryManager.getSummary !== "function") return null;

    const sessionId = sessionIdFromFilename(path.basename(sessionPath));
    const record = summaryManager.getSummary(sessionId);
    return record?.summary?.trim() ? record : null;
  }

  function serializeSessionSummaryRecord(record) {
    return {
      hasSummary: !!record,
      summary: record?.summary || null,
      createdAt: record?.created_at || null,
      updatedAt: record?.updated_at || null,
    };
  }

  function invalidateRcTarget(sessionPath) {
    const rcState = engine.rcState;
    if (!rcState?.invalidateDesktopSession) return;

    const { detachedAttachments } = rcState.invalidateDesktopSession(sessionPath);
    for (const attachment of detachedAttachments) {
      try {
        engine.emitEvent?.({
          type: "bridge_rc_detached",
          sessionKey: attachment.sessionKey,
          sessionPath: attachment.desktopSessionPath,
        }, attachment.desktopSessionPath);
      } catch {}
    }
  }

  // 列出所有 agent 的历史 session
  route.get("/sessions", async (c) => {
    try {
      const sessions = await engine.listSessions();
      const attachments = engine.rcState?.listAttachments?.() || [];
      const rcAttachmentByPath = new Map(attachments.map((attachment) => [
        attachment.desktopSessionPath,
        {
          sessionKey: attachment.sessionKey,
          platform: rcPlatformFromSessionKey(attachment.sessionKey),
        },
      ]));
      return c.json(sessions.map(s => {
        const summaryRecord = getSessionSummaryRecord(s.path, s.agentId || null);
        return ({
          path: s.path,
          title: s.title || null,
          firstMessage: (s.firstMessage || "").slice(0, 100),
          modified: s.modified?.toISOString() || null,
          messageCount: s.messageCount || 0,
          cwd: s.cwd || null,
          agentId: s.agentId || null,
          agentName: s.agentName || null,
          modelId: s.modelId || null,
          modelProvider: s.modelProvider || null,
          pinnedAt: s.pinnedAt || null,
          hasSummary: !!summaryRecord,
          rcAttachment: rcAttachmentByPath.get(s.path)
            ? {
              ...rcAttachmentByPath.get(s.path),
              title: s.title || null,
            }
            : null,
        });
      }));
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 获取单个 session 的滚动摘要。列表只暴露 hasSummary，正文按需读取。
  route.get("/sessions/details", async (c) => {
    try {
      const sessionPath = c.req.query("path") || null;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "path" }) }, 400);
      }
      if (!isValidSessionPath(sessionPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }
      const details = await engine.getSessionDetails(sessionPath);
      if (!details) {
        return c.json({ error: "Session details not available" }, 404);
      }
      return c.json(details);
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 全文搜索会话内容
  route.get("/sessions/search", async (c) => {
    try {
      const q = (c.req.query("q") || "").trim().toLowerCase();
      if (!q || q.length < 1) {
        return c.json({ results: [] });
      }
      const sessions = await engine.listSessions();
      const results = [];
      const MAX_RESULTS = 50;  // 增加到 50，允许更多结果
      const MAX_FILES = 1000;  // 搜索所有会话，不限制数量

      for (const s of sessions.slice(0, MAX_FILES)) {
        if (results.length >= MAX_RESULTS) break;
        // 标题 / 首条消息匹配优先
        const titleLower = (s.title || "").toLowerCase();
        const firstLower = (s.firstMessage || "").toLowerCase();
        if (titleLower.includes(q) || firstLower.includes(q)) {
          results.push({
            path: s.path,
            title: s.title || null,
            firstMessage: (s.firstMessage || "").slice(0, 100),
            modified: s.modified?.toISOString?.() || null,
            messageCount: s.messageCount || 0,
            agentId: s.agentId || null,
            agentName: s.agentName || null,
            pinnedAt: s.pinnedAt || null,
            matchType: "title",
            snippet: null,
          });
          continue;
        }
        
        // 如果标题/首条消息已匹配，跳过全文搜索
        if (results.some(r => r.path === s.path)) continue;
        // 全文搜索 JSONL - 对每个会话执行类似 Ctrl+F 的搜索
        try {
          const sessionFile = s.agentId
            ? path.join(engine.agentsDir, s.agentId, "sessions", path.basename(s.path))
            : s.path;
          if (!existsSync(sessionFile)) continue;
          const content = await fsp.readFile(sessionFile, "utf-8");
          const lines = content.split('\n').filter(line => line.trim());
          
          let foundSnippet = null;
          let messageCount = 0;
          let matchedCount = 0;
          
          // 遍历所有消息记录，搜索任何包含关键词的内容
          for (const line of lines) {
            try {
              const record = JSON.parse(line);
              
              // 跳过非消息记录
              if (record.type !== "message" || !record.message) continue;
              messageCount++;
              
              const msg = record.message;
              let matchedText = null;
              
              // 策略 1：搜索 text 字段（用户消息和简单助手消息）
              if (typeof msg.text === 'string' && msg.text) {
                const textLower = msg.text.toLowerCase();
                if (textLower.includes(q)) {
                  matchedText = msg.text;
                }
              }
              
              // 策略 2：搜索 blocks 中的文本（Markdown 渲染的消息）
              if (!matchedText && msg.blocks && Array.isArray(msg.blocks)) {
                for (const block of msg.blocks) {
                  if (block.type === 'text' && block.text) {
                    const textLower = block.text.toLowerCase();
                    if (textLower.includes(q)) {
                      matchedText = block.text;
                      break;
                    }
                  }
                  // 搜索 thinking 块内容
                  if (block.type === 'thinking' && block.content) {
                    const contentLower = block.content.toLowerCase();
                    if (contentLower.includes(q)) {
                      matchedText = block.content;
                      break;
                    }
                  }
                }
              }
              
              // 策略 3：搜索 blocks 中的其他类型的文本内容
              if (!matchedText && msg.blocks && Array.isArray(msg.blocks)) {
                for (const block of msg.blocks) {
                  // 搜索代码块、引用等
                  if (block.code && block.code.toLowerCase().includes(q)) {
                    matchedText = block.code;
                    break;
                  }
                  if (block.quote && block.quote.toLowerCase().includes(q)) {
                    matchedText = block.quote;
                    break;
                  }
                  // 搜索嵌套的文本
                  if (block.children && Array.isArray(block.children)) {
                    for (const child of block.children) {
                      if (typeof child.text === 'string' && child.text.toLowerCase().includes(q)) {
                        matchedText = child.text;
                        break;
                      }
                    }
                  }
                }
              }
              
              // 策略 4：搜索其他可能的文本字段
              if (!matchedText && msg.content && typeof msg.content === 'string') {
                // 搜索 content 字段（某些消息格式）
                if (msg.content.toLowerCase().includes(q)) {
                  matchedText = msg.content;
                }
              }
              
              // 如果找到匹配，提取片段
              if (matchedText) {
                matchedCount++;
                if (!foundSnippet) {
                  const textLower = matchedText.toLowerCase();
                  const idx = textLower.indexOf(q);
                  const start = Math.max(0, idx - 40);
                  const end = Math.min(matchedText.length, idx + q.length + 60);
                  let snippet = matchedText.slice(start, end).replace(/\n/g, " ").trim();
                  if (start > 0) snippet = "…" + snippet;
                  if (end < matchedText.length) snippet = snippet + "…";
                  if (snippet.length > 180) snippet = snippet.slice(0, 180) + "…";
                  foundSnippet = snippet;
                }
                // 继续遍历所有消息，不要 break
              }
            } catch (err) {
              // 跳过解析失败的行
            }
          }
          
          if (foundSnippet) {
            // 调试：输出搜索统计和 snippet 内容
            console.log(`[Session Search] Query: "${q}" | Path: ${s.path} | Matches: ${matchedCount}/${messageCount} | Snippet: "${foundSnippet}"`);
            results.push({
              path: s.path,
              title: s.title || null,
              firstMessage: (s.firstMessage || "").slice(0, 100),
              modified: s.modified?.toISOString?.() || null,
              messageCount: s.messageCount || 0,
              agentId: s.agentId || null,
              agentName: s.agentName || null,
              pinnedAt: s.pinnedAt || null,
              matchType: "content",
              snippet: foundSnippet,
            });
          }
        } catch {
          // 跳过读取失败的文件
        }
      }
      return c.json({ results, query: q, total: results.length });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.get("/sessions/summary", async (c) => {
    try {
      const sessionPath = c.req.query("path") || null;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "path" }) }, 400);
      }
      if (!isValidSessionPath(sessionPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }

      const record = getSessionSummaryRecord(sessionPath);
      return c.json(serializeSessionSummaryRecord(record));
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 置顶 / 取消置顶 session
  route.post("/sessions/pin", async (c) => {
    try {
      const body = await safeJson(c);
      const { path: sessionPath, pinned } = body;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "path" }) }, 400);
      }
      if (typeof pinned !== "boolean") {
        return c.json({ error: t("error.missingParam", { param: "pinned" }) }, 400);
      }
      if (!isValidSessionPath(sessionPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }
      const pinnedAt = await engine.setSessionPinned(sessionPath, pinned);
      return c.json({ ok: true, pinnedAt });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 获取 session 的消息（支持 ?path= 指定 session，否则读焦点 session）
  route.get("/sessions/messages", async (c) => {
    try {
      const queryPath = c.req.query("path") || null;
      if (queryPath && !isValidSessionPath(queryPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }
      const sourceMessages = await loadSessionHistoryMessages(engine, queryPath);

      // 分页参数
      const beforeId = c.req.query("before") != null ? Number(c.req.query("before")) : null;
      const limit = Math.min(Number(c.req.query("limit")) || 50, 200);

      // 提取可显示的消息（user/assistant 文本 + 文件/artifact 工具结果）
      // 每条消息带稳定 id（原始 sourceMessages 索引）
      const allMessages = [];
      const blocks = [];
      let globalIdx = 0;

      for (const m of sourceMessages) {
        if (m.role === "user") {
          const { text, images } = extractTextContent(m.content);
          if (text || images.length) {
            allMessages.push({
              id: String(globalIdx),
              ...(m.id ? { entryId: m.id } : {}),
              role: "user",
              content: text,
              images: images.length ? images : undefined,
              ...(m.timestamp ? { timestamp: m.timestamp } : {}),
            });
            globalIdx++;
          }
        } else if (m.role === "assistant") {
          const { text, thinking, toolUses } = extractTextContent(m.content, { stripThink: true });
          if (text || toolUses.length) {
            allMessages.push({
              id: String(globalIdx),
              ...(m.id ? { entryId: m.id } : {}),
              role: "assistant",
              content: text,
              thinking: thinking || undefined,
              toolCalls: toolUses.length ? toolUses : undefined,
              ...(m.timestamp ? { timestamp: m.timestamp } : {}),
            });
            globalIdx++;
          }
        } else if (m.role === "toolResult") {
          const extracted = extractBlocks(m.toolName, m.details, m);
          for (const b of extracted) {
            blocks.push({ ...b, afterIndex: allMessages.length - 1 });
          }
          // 将 toolResult.details 回填到对应的 assistant toolCall（用于 diff 卡片等持久化展示）
          if (m.details && allMessages.length > 0) {
            const lastMsg = allMessages[allMessages.length - 1];
            if (lastMsg.role === "assistant" && lastMsg.toolCalls) {
              const matchIdx = lastMsg.toolCalls.findIndex(
                tc => tc.name === m.toolName && !tc.details
              );
              if (matchIdx >= 0) {
                lastMsg.toolCalls[matchIdx] = {
                  ...lastMsg.toolCalls[matchIdx],
                  details: m.details,
                  done: true,
                  success: !m.isError,
                };
              }
            }
          }
        }
      }

      // 分页：before 参数指定游标，否则默认返回最后 limit 条
      let messages;
      let hasMore = false;
      let slicedBlocks = blocks;

      const total = allMessages.length;
      // all=1 强制全量返回（流式恢复等特殊场景）
      const forceAll = c.req.query("all") === "1";

      if (forceAll) {
        messages = allMessages;
      } else {
        const endIdx = (beforeId != null && beforeId > 0)
          ? Math.min(beforeId, total)
          : total;
        const startIdx = Math.max(0, endIdx - limit);
        messages = allMessages.slice(startIdx, endIdx);
        hasMore = startIdx > 0;
        // 重映射 afterIndex 到切片内偏移，过滤超出范围的
        slicedBlocks = blocks
          .filter(b => b.afterIndex >= startIdx && b.afterIndex < endIdx)
          .map(b => ({ ...b, afterIndex: b.afterIndex - startIdx }));
      }

      // 修正 subagent blocks 的状态：优先从 deferred store 读终态，其次从 session 文件推断
      {
        const deferredStore = engine.deferredResults;
        const readSessionMeta = createSubagentMetaCache();
        const readSessionSummary = createSubagentSummaryCache();
        for (const b of slicedBlocks) {
          if (b.type !== "subagent" || !b.taskId) continue;
          const task = deferredStore?.query?.(b.taskId) || null;
          const deferredSessionPath = task?.meta?.sessionPath || null;
          if (!b.streamKey && deferredSessionPath) b.streamKey = deferredSessionPath;
          patchBlockRequestedMetadata(b, task);
          patchBlockExecutorMetadata(b, task, readSessionMeta);
          applySubagentIdentity(b, task, readSessionMeta);

          if (b.streamStatus !== "running") continue;

          // subagent 完成状态只能由 deferred store 的任务终态确认。
          // 子 session 可能有多轮输出，尾部 assistant 文本只能作为 resolved 后的摘要来源。
          if (deferredStore) {
            if (task?.status === "aborted") {
              b.streamStatus = "aborted";
              b.summary = task.reason || "aborted";
              if (task.meta?.sessionPath) b.streamKey = task.meta.sessionPath;
              patchBlockRequestedMetadata(b, task);
              patchBlockExecutorMetadata(b, task, readSessionMeta);
              applySubagentIdentity(b, task, readSessionMeta);
              continue;
            }
            if (task?.status === "failed") {
              b.streamStatus = "failed";
              b.summary = task.reason || "failed";
              if (task.meta?.sessionPath) b.streamKey = task.meta.sessionPath;
              patchBlockRequestedMetadata(b, task);
              patchBlockExecutorMetadata(b, task, readSessionMeta);
              applySubagentIdentity(b, task, readSessionMeta);
              continue;
            }
            if (task?.status === "resolved") {
              b.streamStatus = "done";
              if (task.meta?.sessionPath) b.streamKey = task.meta.sessionPath;
              patchBlockRequestedMetadata(b, task);
              patchBlockExecutorMetadata(b, task, readSessionMeta);
              applySubagentIdentity(b, task, readSessionMeta);

              const sp = b.streamKey || task.meta?.sessionPath || null;
              const summary = await readSessionSummary(sp);
              b.summary = summary || (typeof task.result === "string" ? task.result.slice(0, 200) : b.summary);
              continue;
            }
          }
        }
      }

      const resolvedSessionPath = queryPath || engine.currentSessionPath || null;
      patchSessionFileLifecycleBlocks(slicedBlocks, engine, resolvedSessionPath);
      const sessionFiles = listSessionRegistryFiles(engine, resolvedSessionPath);

      // 从历史中提取最新 todo 状态：branch-aware，沿当前 leaf 回溯到 root，
      // 只在当前分支路径上找最新合法快照。避免从抛弃的分支取到错误状态。
      const todos = await loadLatestTodosFromSessionFile(queryPath);

      return c.json({ messages, blocks: slicedBlocks, todos, hasMore, sessionFiles });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  route.post("/sessions/latest-user-message/replay", async (c) => {
    try {
      const body = await safeJson(c);
      const sessionPath = body?.path || body?.sessionPath || null;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "path" }) }, 400);
      }
      if (!isValidSessionPath(sessionPath, engine.agentsDir) || !isActiveSessionPath(sessionPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }
      if (!(await pathExists(sessionPath))) {
        return c.json({ error: "session not found" }, 404);
      }
      if (engine.isSessionStreaming?.(sessionPath)) {
        return c.json({ error: "session_busy" }, 409);
      }

      const result = await replayLatestUserTurn(engine, {
        sessionPath,
        sourceEntryId: body.sourceEntryId || null,
        clientMessageId: body.clientMessageId || null,
        replacementText: typeof body.text === "string" ? body.text : undefined,
        displayMessage: body.displayMessage || null,
        uiContext: body.uiContext ?? null,
      });
      return c.json({ ok: true, ...result });
    } catch (err) {
      const status = err.message === "session_busy" ? 409 : 400;
      return c.json({ error: err.message }, status);
    }
  });

  // Revert latest assistant turn — restore file checkpoints + branch conversation
  route.post("/sessions/revert-turn", async (c) => {
    try {
      const body = await safeJson(c);
      const sessionPath = body?.path || body?.sessionPath || null;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "path" }) }, 400);
      }
      if (!isValidSessionPath(sessionPath, engine.agentsDir) || !isActiveSessionPath(sessionPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }
      if (!(await pathExists(sessionPath))) {
        return c.json({ error: "session not found" }, 404);
      }
      if (engine.isSessionStreaming?.(sessionPath)) {
        return c.json({ error: "session_busy" }, 409);
      }

      // 1. Find and restore file checkpoints created during this turn
      const sinceTs = coerceTimestampMs(body.sinceTs);
      let restoredFiles = 0;
      if (sinceTs > 0) {
        const checkpoints = await engine.findCheckpointsBySessionSince(sessionPath, sinceTs);
        // Restore in reverse order (newest first) so overlapping edits revert correctly
        for (let i = checkpoints.length - 1; i >= 0; i--) {
          try {
            await engine.restoreCheckpoint(checkpoints[i].id);
            restoredFiles++;
          } catch {
            // skip corrupted/missing checkpoints
          }
        }
      }

      // 2. Branch conversation back (remove assistant response)
      const result = await revertLatestAssistantTurn(engine, {
        sessionPath,
        clientMessageId: body.clientMessageId || null,
        sinceTs,
      });

      return c.json({ ok: true, restoredFiles, ...result });
    } catch (err) {
      console.error("[revert-turn] error:", err.message, err.stack);
      const status = err.message === "session_busy" ? 409 : 400;
      return c.json({ error: err.message }, status);
    }
  });

  route.post("/sessions/todos/complete", async (c) => {
    try {
      const body = await safeJson(c);
      const sessionPath = body?.path;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "path" }) }, 400);
      }
      if (!isValidSessionPath(sessionPath, engine.agentsDir) || !isActiveSessionPath(sessionPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }
      try {
        await fs.access(sessionPath);
      } catch {
        return c.json({ error: t("error.sessionNotFound") }, 404);
      }
      if (engine.isSessionStreaming?.(sessionPath)) {
        return c.json({ error: "Cannot complete todos while session is streaming" }, 409);
      }

      const snapshot = await loadLatestTodoSnapshotFromSessionFile(sessionPath);
      const completedTodos = completeTodoItems(snapshot?.todos || []);
      if (!snapshot?.removed && completedTodos.length > 0) {
        const manager = getWritableSessionManager(engine, sessionPath);
        manager.appendCustomMessageEntry(
          TODO_STATE_CUSTOM_TYPE,
          TODO_COMPLETE_MESSAGE,
          false,
          {
            action: "complete_all",
            source: "user",
            removed: true,
            todos: completedTodos,
          },
        );
      }

      engine.emitEvent?.({ type: "todo_update", todos: [] }, sessionPath);
      return c.json({ ok: true, todos: [] });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 新建 session（可选指定工作目录和 agentId）
  route.post("/sessions/new", async (c) => {
    try {
      const body = await safeJson(c);
      const { cwd, memoryEnabled, agentId, currentSessionPath: oldSessionPath } = body;
      const workspaceFolders = Array.isArray(body.workspaceFolders)
        ? body.workspaceFolders.filter(p => typeof p === "string" && p.trim())
        : [];
      const memFlag = memoryEnabled !== false; // 默认 true
      console.log("[sessions] 新建 session", {
        hasCwd: !!cwd,
        memoryEnabled: memFlag,
        customAgent: !!agentId,
      });

      // 新建前挂起浏览器（保存当前 session 的浏览器状态）
      const bm = BrowserManager.instance();
      if (oldSessionPath && bm.isRunning(oldSessionPath)) {
        await bm.suspendForSession(oldSessionPath);
      }

      let newSessionPath, newAgentId;
      if (agentId && agentId !== (body.currentAgentId || engine.currentAgentId)) {
        ({ sessionPath: newSessionPath, agentId: newAgentId } = await engine.createSessionForAgent(
          agentId,
          cwd || undefined,
          memFlag,
          undefined,
          { workspaceFolders },
        ));
      } else {
        ({ sessionPath: newSessionPath, agentId: newAgentId } = await engine.createSession(
          null,
          cwd || undefined,
          memFlag,
          undefined,
          { workspaceFolders },
        ));
      }
      engine.persistSessionMeta();

      // 记住工作目录 + 更新历史
      if (cwd) {
        const history = mergeWorkspaceHistory(engine.config.cwd_history, [cwd]);
        await engine.updateConfig({ last_cwd: cwd, cwd_history: history });
      }

      console.log("[sessions] session 创建完成");
      return c.json({
        ok: true,
        path: newSessionPath,
        cwd: engine.cwd,
        workspaceFolders: engine.getSessionWorkspaceFolders?.(newSessionPath) || [],
        agentId: newAgentId,
        agentName: engine.getAgent(newAgentId)?.agentName || engine.agentName,
        planMode: engine.planMode,
        permissionMode: engine.permissionMode,
        accessMode: engine.accessMode,
        thinkingLevel: engine.getSessionThinkingLevel?.(newSessionPath) || engine.getThinkingLevel?.() || "auto",
        memoryModelUnavailableReason: engine.memoryModelUnavailableReason || null,
      });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 切换 session（支持跨 agent）
  route.post("/sessions/switch", async (c) => {
    try {
      const body = await safeJson(c);
      const { path: sessionPath, currentSessionPath: oldSessionPath } = body;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "path" }) }, 400);
      }
      // 必须是 agents/{id}/sessions/ 或 sessions/archived/ 下的对话文件，
      // 拒绝 subagent-sessions/、activity/、.ephemeral/ 等旁路目录——那些是
      // 运行态产物，不是用户可切换的对话焦点。
      if (!isActiveSessionPath(sessionPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }
      // 切换前挂起浏览器（保存当前 session 的浏览器状态）
      const bm = BrowserManager.instance();
      const suspendPath = oldSessionPath;
      if (suspendPath && bm.isRunning(suspendPath)) {
        await bm.suspendForSession(suspendPath);
      }

      await engine.switchSession(sessionPath);

      // 恢复目标 session 的浏览器（若有）
      await bm.resumeForSession(sessionPath);

      const session = engine.getSessionByPath(sessionPath);

      // 从 sessionPath 解析 agentId，避免依赖 engine 焦点指针的时序
      const switchedAgentId = engine.agentIdFromSessionPath(sessionPath) || engine.currentAgentId;
      const switchedAgent = engine.getAgent(switchedAgentId);

      // switchSession 已同步设置焦点到目标 session。
      // cwd/planMode/model 是 session 级状态，此时读焦点是安全的。
      // memoryEnabled 需要返回 session 自身冻结下来的值，而不是当前
      // master && session 的临时组合态；否则现有 session 的缓存前缀身份
      // 会被全局 gate 混淆。
      // agentId/agentName 已从 sessionPath 解析，不依赖焦点。
      const activeModel = engine.activeSessionModel ?? engine.currentModel;
      const frozenSessionMemoryEnabled =
        switchedAgent?.isSessionMemoryEnabledFor?.(sessionPath) ?? engine.memoryEnabled;
      return c.json({
        ok: true,
        messageCount: session?.messages?.length || 0,
        memoryEnabled: frozenSessionMemoryEnabled,
        planMode: engine.planMode,
        permissionMode: engine.permissionMode,
        accessMode: engine.accessMode,
        thinkingLevel: engine.getSessionThinkingLevel?.(sessionPath) || engine.getThinkingLevel?.() || "auto",
        memoryModelUnavailableReason: engine.memoryModelUnavailableReason || null,
        cwd: engine.cwd,
        workspaceFolders: engine.getSessionWorkspaceFolders?.(sessionPath) || [],
        agentId: switchedAgentId,
        agentName: switchedAgent?.agentName || switchedAgentId,
        browserRunning: bm.isRunning(sessionPath),
        browserUrl: bm.currentUrl(sessionPath) || null,
        isStreaming: engine.isSessionStreaming(sessionPath),
        currentModelId: activeModel?.id || null,
        currentModelProvider: activeModel?.provider || null,
        currentModelName: activeModel?.name || null,
        currentModelInput: Array.isArray(activeModel?.input) ? activeModel.input : null,
        currentModelVideo: modelSupportsVideoInput(activeModel),
        currentModelVideoTransport: resolveModelVideoInputTransport(activeModel),
        currentModelVideoTransportSupported: modelSupportsDirectVideoInput(activeModel),
        currentModelReasoning: activeModel?.reasoning ?? null,
        currentModelXhigh: modelSupportsXhigh(activeModel),
        currentModelContextWindow: activeModel?.contextWindow ?? null,
      });
    } catch (err) {
      const errDetail = `${err.message}\n${err.stack || ""}`;
      console.error("[sessions/switch] error:", errDetail);
      try { appendFileSync(path.join(engine.hanakoHome, "switch-error.log"), `${new Date().toISOString()}\n${errDetail}\n---\n`); } catch {}
      return c.json({ error: err.message }, 500);
    }
  });

  // 获取所有有浏览器的 session
  route.get("/browser/sessions", async (c) => {
    const bm = BrowserManager.instance();
    return c.json(bm.getBrowserSessions());
  });

  // 获取所有有浏览器痕迹的 session 状态（活跃 / 可恢复 / 不可用）
  route.get("/browser/session-states", async (c) => {
    const bm = BrowserManager.instance();
    return c.json(bm.getBrowserSessionStates());
  });

  // 关闭指定 session 的浏览器
  route.post("/browser/close-session", async (c) => {
    const body = await safeJson(c);
    const { sessionPath } = body;
    if (!sessionPath) return c.json({ error: "missing sessionPath" });
    const bm = BrowserManager.instance();
    await bm.closeBrowserForSession(sessionPath);
    return c.json({ ok: true, sessions: bm.getBrowserSessionStates() });
  });

  // 重命名 session
  route.post("/sessions/rename", async (c) => {
    try {
      const body = await safeJson(c);
      const { path: sessionPath, title } = body;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "path" }) }, 400);
      }
      if (typeof title !== "string" || !title.trim()) {
        return c.json({ error: t("error.missingParam", { param: "title" }) }, 400);
      }
      if (!isValidSessionPath(sessionPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }
      await engine.saveSessionTitle(sessionPath, title.trim());
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 清理过期归档 session
  route.post("/sessions/cleanup", async (c) => {
    try {
      const body = await safeJson(c);
      const { maxAgeDays = 90 } = body;
      const cutoff = Date.now() - maxAgeDays * 86400000;
      let deleted = 0;

      // 遍历所有 agent 的 sessions/archived/ 目录
      const agentsDir = engine.agentsDir;
      const agents = await fs.readdir(agentsDir).catch(() => []);
      for (const agentId of agents) {
        const archiveDir = path.join(agentsDir, agentId, "sessions", "archived");
        let files;
        try { files = await fs.readdir(archiveDir); } catch { continue; }
        for (const f of files) {
          if (!f.endsWith(".jsonl")) continue;
          const fp = path.join(archiveDir, f);
          try {
            const stat = await fs.stat(fp);
            if (stat.mtime.getTime() < cutoff) {
              await fs.unlink(fp);
              deleteSessionFileSidecarSync(fp);
              deleteSessionSkillSnapshotSync(fp);
              deleted++;
              // 清理 titles.json 孤儿（key = 对应的活跃路径）
              const activeKey = path.join(agentsDir, agentId, "sessions", f);
              invalidateRcTarget(activeKey);
              try { await engine.clearSessionTitle(activeKey); } catch {}
            }
          } catch {}
        }
      }

      return c.json({ ok: true, deleted, maxAgeDays });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 列出所有已归档 session（聚合各 agent 的 archived/ 目录）
  route.get("/sessions/archived", async (c) => {
    try {
      const list = await engine.listArchivedSessions();
      return c.json(list);
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 归档 session（支持跨 agent）
  route.post("/sessions/archive", async (c) => {
    try {
      const body = await safeJson(c);
      const { path: sessionPath } = body;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "path" }) }, 400);
      }
      // 校验路径在 agentsDir 范围内
      if (!isValidSessionPath(sessionPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }

      // 确认文件存在
      try {
        await fs.access(sessionPath);
      } catch {
        return c.json({ error: t("error.sessionNotFound") }, 404);
      }

      // 先从 engine 的 session map 中移除（如果正在后台跑会被 abort）
      await engine.setSessionPinned(sessionPath, false);
      await engine.closeSession(sessionPath);

      // 从 session 路径推导归档目录（同 agent 的 sessions/archived/）
      const sessDir = path.dirname(sessionPath);
      const archiveDir = path.join(sessDir, "archived");
      await fs.mkdir(archiveDir, { recursive: true });

      const fileName = path.basename(sessionPath);
      const destPath = path.join(archiveDir, fileName);
      if (await pathExists(sessionFileSidecarPath(destPath))) {
        return c.json({ error: "Stage file sidecar destination already exists" }, 409);
      }
      await fs.rename(sessionPath, destPath);
      moveSessionFileSidecarSync(sessionPath, destPath);

      // 将 mtime 置为归档瞬间，使 cleanup 按"归档时间"而非"最后活动时间"判断
      const nowSec = Date.now() / 1000;
      await fs.utimes(destPath, nowSec, nowSec);

      invalidateRcTarget(sessionPath);

      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 恢复归档 session → 移回 sessions/
  route.post("/sessions/restore", async (c) => {
    try {
      const body = await safeJson(c);
      const { path: sessionPath } = body;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "path" }) }, 400);
      }
      if (!isValidSessionPath(sessionPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }
      // 必须位于 /archived/ 目录下，防止把活跃 session 当归档路径调用
      const archDir = path.dirname(sessionPath);
      if (path.basename(archDir) !== "archived") {
        return c.json({ error: "Not an archived session path" }, 403);
      }
      try {
        await fs.access(sessionPath);
      } catch {
        return c.json({ error: t("error.sessionNotFound") }, 404);
      }

      const activeDir = path.dirname(archDir);
      const destPath = path.join(activeDir, path.basename(sessionPath));

      // 冲突检测：目标位置已存在，不自动改名（违背"禁止非用户预期的 fallback"）
      try {
        await fs.access(destPath);
        return c.json({ error: "Active path already exists" }, 409);
      } catch { /* 目标不存在，可以恢复 */ }
      if (await pathExists(sessionFileSidecarPath(destPath))) {
        return c.json({ error: "Stage file sidecar destination already exists" }, 409);
      }

      await fs.rename(sessionPath, destPath);
      moveSessionFileSidecarSync(sessionPath, destPath);
      return c.json({ ok: true, restoredPath: destPath });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // 永久删除一条归档 session
  route.post("/sessions/archived/delete", async (c) => {
    try {
      const body = await safeJson(c);
      const { path: sessionPath } = body;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "path" }) }, 400);
      }
      if (!isValidSessionPath(sessionPath, engine.agentsDir)) {
        return c.json({ error: "Invalid session path" }, 403);
      }
      const archDir = path.dirname(sessionPath);
      if (path.basename(archDir) !== "archived") {
        return c.json({ error: "Not an archived session path" }, 403);
      }
      try {
        await fs.unlink(sessionPath);
        deleteSessionFileSidecarSync(sessionPath);
        deleteSessionSkillSnapshotSync(sessionPath);
      } catch (err) {
        if (err.code === "ENOENT") {
          return c.json({ error: t("error.sessionNotFound") }, 404);
        }
        throw err;
      }
      // 清理 titles.json 孤儿（key = 对应的活跃路径）
      const activeKey = path.join(path.dirname(archDir), path.basename(sessionPath));
      invalidateRcTarget(activeKey);
      try { await engine.clearSessionTitle(activeKey); } catch {}
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // ══════════════════════════════════════════════════════
  // 压缩分叉：压缩旧消息 → 创建新会话
  // ══════════════════════════════════════════════════════
  route.post("/sessions/compress-fork", async (c) => {
    try {
      const body = await safeJson(c);
      const { sessionPath } = body;
      if (!sessionPath) {
        return c.json({ error: t("error.missingParam", { param: "sessionPath" }) }, 400);
      }
      if (engine.isSessionStreaming(sessionPath)) {
        return c.json({ error: t("error.waitForReply") }, 409);
      }

      const result = await engine.compressFork(sessionPath);
      if (!result.ok) {
        return c.json({ error: result.error }, 500);
      }

      engine.persistSessionMeta();

      // 切换到新会话以获取完整响应数据
      await engine.switchSession(result.sessionPath);

      const newSession = engine.getSessionByPath(result.sessionPath);
      const switchedAgentId = engine.agentIdFromSessionPath(result.sessionPath) || engine.currentAgentId;
      const switchedAgent = engine.getAgent(switchedAgentId);
      const contextUsage = computeContextUsageSnapshot(newSession);
      let compressionAvailable = false;
      try {
        const ctxConfig = resolveContextConfig(switchedAgent?._config);
        compressionAvailable = !!(ctxConfig.enabled && contextUsage.percent != null && (contextUsage.percent / 100) >= ctxConfig.threshold);
      } catch {}

      return c.json({
        ok: true,
        path: result.sessionPath,
        cwd: engine.cwd,
        workspaceFolders: engine.getSessionWorkspaceFolders?.(result.sessionPath) || [],
        agentId: switchedAgentId,
        agentName: switchedAgent?.agentName || engine.agentName,
        planMode: engine.planMode,
        permissionMode: engine.permissionMode,
        accessMode: engine.accessMode,
        thinkingLevel: engine.getSessionThinkingLevel?.(result.sessionPath) || engine.getThinkingLevel?.() || "auto",
        memoryModelUnavailableReason: engine.memoryModelUnavailableReason || null,
        messageCount: newSession?.messages?.length || 0,
        contextUsage: {
          tokens: contextUsage.tokens,
          contextWindow: contextUsage.contextWindow,
          percent: contextUsage.percent,
          compressionAvailable,
        },
      });
    } catch (err) {
      console.error("[sessions/compress-fork] error:", err);
      return c.json({ error: err.message }, 500);
    }
  });

  return route;
}

function patchSessionFileLifecycleBlocks(blocks, engine, sessionPath) {
  if (!sessionPath) return;
  for (const block of blocks || []) {
    if (!block) continue;
    if (!["file", "artifact", "skill", "screenshot"].includes(block.type)) continue;
    let file = null;
    if (block.fileId && typeof engine?.getSessionFile === "function") {
      file = engine.getSessionFile(block.fileId, { sessionPath });
    }
    if (!file && block.filePath && typeof engine?.getSessionFileByPath === "function") {
      file = engine.getSessionFileByPath(block.filePath, { sessionPath });
    }
    if (!file && block.type === "screenshot" && block.base64 && engine?.hanakoHome && typeof engine?.getSessionFileByPath === "function") {
      try {
        const filePath = browserScreenshotPath(engine.hanakoHome, sessionPath, {
          base64: block.base64,
          mimeType: block.mimeType,
        });
        file = engine.getSessionFileByPath(filePath, { sessionPath });
        if (file) block.type = "file";
      } catch {}
    }
    if (!file) continue;
    const patch = sessionFileLifecycleFields(file);
    Object.assign(block, patch);
    if (block.type === "skill" && block.installedFile) {
      block.installedFile = { ...block.installedFile, ...patch };
    }
  }
}

function listSessionRegistryFiles(engine, sessionPath) {
  if (!sessionPath || typeof engine?.listSessionFiles !== "function") return [];
  return engine.listSessionFiles(sessionPath).map(file => serializeSessionFile(file)).filter(Boolean);
}

function sessionFileLifecycleFields(file) {
  const fileId = file.fileId || file.id || null;
  return {
    ...(fileId ? { fileId } : {}),
    ...(file.filePath ? { filePath: file.filePath } : {}),
    ...(file.label || file.displayName ? { label: file.label || file.displayName } : {}),
    ...(file.ext !== undefined ? { ext: file.ext } : {}),
    ...(file.mime ? { mime: file.mime } : {}),
    ...(file.kind ? { kind: file.kind } : {}),
    ...(file.storageKind ? { storageKind: file.storageKind } : {}),
    ...(file.status ? { status: file.status } : {}),
    ...(file.missingAt !== undefined ? { missingAt: file.missingAt } : {}),
  };
}
