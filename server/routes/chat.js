/**
 * WebSocket 聊天路由
 *
 * 桥接 Pi SDK streaming 事件 → WebSocket 消息
 * 支持多 session 并发：所有 session 事件平等广播，前端按 sessionPath 路由
 */
import { Hono } from "hono";
import { MoodParser, ThinkTagParser, CardParser } from "../../core/events.js";
import { extractBlocks } from "../block-extractors.js";
import { toAppEventWsMessage } from "../app-events.js";
import { wsSend, wsParse } from "../ws-protocol.js";
import { debugLog } from "../../lib/debug-log.js";
import { t } from "../i18n.js";
import { getLastAssistantUsage } from "../../lib/pi-sdk/index.js";
import { logLlmUsage } from "../../lib/llm/usage-observer.js";
import { BrowserManager } from "../../lib/browser/browser-manager.js";
import { terminalManager } from "../terminal/manager.js";
import {
  createSessionStreamState,
  beginSessionStream,
  finishSessionStream,
  appendSessionStreamEvent,
  resumeSessionStream,
} from "../session-stream-store.js";
import { AppError } from "../../shared/errors.js";
import { errorBus } from "../../shared/error-bus.js";
import { waitTimingDetails } from "../../lib/tools/wait-contract.js";
import { MAX_CHAT_IMAGE_BASE64_CHARS, isAllowedChatImageMime, isChatImageBase64WithinLimit } from "../../shared/image-mime.js";
import { isAllowedChatVideoMime, isChatVideoBase64WithinLimit } from "../../shared/video-mime.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

/** tool_start 事件只广播这些 arg 字段，避免传输完整文件内容（同步维护：chat-render-shim.ts extractToolDetail） */
const TOOL_ARG_SUMMARY_KEYS = ["file_path", "path", "command", "pattern", "url", "query", "key", "value", "action", "type", "schedule", "prompt", "label"];
const FILE_WRITE_PREPARE_PREVIEW_MAX_CHARS = 12 * 1024;

export function summarizeToolStartArgs(toolName, rawArgs, startedAt = Date.now()) {
  if (!rawArgs || typeof rawArgs !== "object") return undefined;
  const args = {};
  for (const k of TOOL_ARG_SUMMARY_KEYS) {
    if (rawArgs[k] !== undefined) args[k] = rawArgs[k];
  }
  if (toolName === "wait" && rawArgs.seconds !== undefined) {
    Object.assign(args, waitTimingDetails(rawArgs.seconds, startedAt));
  }
  return Object.keys(args).length ? args : undefined;
}

/**
 * 从 Pi SDK 的 content 块中提取纯文本
 */
function extractText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(b => b.type === "text" && b.text)
    .map(b => b.text)
    .join("");
}

function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessageMetadata(session) {
  const model = session?.model || {};
  return {
    api: model.api || model.apiId || model.provider || "unknown",
    provider: model.provider || "unknown",
    model: model.id || model.modelId || model.name || "unknown",
    usage: zeroUsage(),
  };
}

function fileNameFromPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.replace(/\\/g, "/");
  return normalized.split("/").pop() || value;
}

function assistantToolCallFromEvent(event) {
  if (event?.toolCall?.name) return event.toolCall;
  const content = event?.partial?.content;
  if (Array.isArray(content) && typeof event.contentIndex === "number") {
    const block = content[event.contentIndex];
    if (block?.name) return block;
  }
  return null;
}

function maybeParseJsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function decodePartialJsonString(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[++i];
    if (!next) break;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "u" && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16));
      i += 4;
    } else {
      out += next;
    }
  }
  return out;
}

function extractPartialJsonStringValue(raw, key) {
  if (typeof raw !== "string" || !raw) return null;
  const keyPattern = `"${key}"`;
  const keyIndex = raw.indexOf(keyPattern);
  if (keyIndex < 0) return null;
  const colonIndex = raw.indexOf(":", keyIndex + keyPattern.length);
  if (colonIndex < 0) return null;
  let quoteIndex = -1;
  for (let i = colonIndex + 1; i < raw.length; i++) {
    if (/\s/.test(raw[i])) continue;
    if (raw[i] !== "\"") return null;
    quoteIndex = i;
    break;
  }
  if (quoteIndex < 0) return null;
  let escaped = false;
  let value = "";
  for (let i = quoteIndex + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) {
      value += "\\" + ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") return decodePartialJsonString(value);
    value += ch;
  }
  if (escaped) value += "\\";
  return decodePartialJsonString(value);
}

function extractFileWriteToolPreview(event) {
  const toolCall = assistantToolCallFromEvent(event);
  const toolName = toolCall?.name || "";
  if (toolName !== "write" && toolName !== "edit") return null;
  const args = maybeParseJsonObject(toolCall?.input) || maybeParseJsonObject(toolCall?.arguments);
  const partialArgs = typeof toolCall?.partialArgs === "string" ? toolCall.partialArgs : "";
  const delta = typeof event?.delta === "string" ? event.delta : "";
  const rawPath = args?.path || args?.file_path || extractPartialJsonStringValue(partialArgs, "path") || extractPartialJsonStringValue(partialArgs, "file_path") || null;
  const content = typeof args?.content === "string"
    ? args.content
    : extractPartialJsonStringValue(partialArgs, "content") || "";
  return {
    toolName,
    key: toolCall?.id || `${event.contentIndex ?? 0}:${toolName}`,
    rawPath: typeof rawPath === "string" ? rawPath : null,
    fileName: fileNameFromPath(rawPath),
    content,
    partialArgs,
    delta,
  };
}

function summarizeWriteStartPreview(toolName, rawArgs) {
  if (toolName !== "write" && toolName !== "edit") return null;
  if (!rawArgs || typeof rawArgs !== "object") return null;
  const content = typeof rawArgs.content === "string" ? rawArgs.content : "";
  if (!content) return null;
  const rawPath = typeof rawArgs.path === "string"
    ? rawArgs.path
    : typeof rawArgs.file_path === "string"
      ? rawArgs.file_path
      : null;
  const previewChunk = content.slice(0, FILE_WRITE_PREPARE_PREVIEW_MAX_CHARS);
  return {
    rawPath,
    fileName: fileNameFromPath(rawPath),
    previewChunk,
    previewTruncated: content.length > FILE_WRITE_PREPARE_PREVIEW_MAX_CHARS,
  };
}

export function toCompactionLifecycleWsMessage(event, sessionPath, getSessionByPath) {
  if (!sessionPath) return null;
  if (event.type === "compaction_start") {
    return {
      type: "compaction_start",
      sessionPath,
      reason: event.reason ?? null,
    };
  }
  if (event.type !== "compaction_end") return null;

  const usage = getSessionByPath?.(sessionPath)?.getContextUsage?.();
  return {
    type: "compaction_end",
    sessionPath,
    reason: event.reason ?? null,
    aborted: event.aborted ?? false,
    willRetry: event.willRetry ?? false,
    tokens: usage?.tokens ?? null,
    contextWindow: usage?.contextWindow ?? null,
    percent: usage?.percent ?? null,
  };
}

export function createChatRoute(engine, hub, { upgradeWebSocket }) {
  const restRoute = new Hono();
  const wsRoute = new Hono();

  let activeWsClients = 0;
  let disconnectAbortTimer = null;
  const DISCONNECT_ABORT_GRACE_MS = 15_000;
  const sessionState = new Map(); // sessionPath -> shared stream state

  function cancelDisconnectAbort() {
    if (disconnectAbortTimer) {
      clearTimeout(disconnectAbortTimer);
      disconnectAbortTimer = null;
    }
  }

  function scheduleDisconnectAbort() {
    if (disconnectAbortTimer || activeWsClients > 0) return;
    disconnectAbortTimer = setTimeout(() => {
      disconnectAbortTimer = null;
      if (activeWsClients > 0) return;

      // 中断所有正在 streaming 的 owner session（焦点 + 后台）
      for (const [, ss] of sessionState) ss.isAborted = true;
      debugLog()?.log("ws", `no clients for ${DISCONNECT_ABORT_GRACE_MS}ms, aborting all streaming`);
      engine.abortAllStreaming().catch(() => {});
    }, DISCONNECT_ABORT_GRACE_MS);
  }

  const MAX_SESSION_STATES = 100;

  function requireSessionPath(msg, ws) {
    if (msg.sessionPath) return msg.sessionPath;
    wsSend(ws, { type: "error", message: "sessionPath is required" });
    return null;
  }

  function getState(sessionPath) {
    if (!sessionPath) return null;
    if (!sessionState.has(sessionPath)) {
      // 超过上限时，循环淘汰非流式的最久未访问 entry
      while (sessionState.size >= MAX_SESSION_STATES) {
        let oldest = null;
        let oldestTime = Infinity;
        for (const [sp, ss] of sessionState) {
          if (!ss.isStreaming && sp !== sessionPath && ss.lastAccessed < oldestTime) {
            oldest = sp;
            oldestTime = ss.lastAccessed;
          }
        }
        if (oldest) sessionState.delete(oldest);
        else break; // 全是流式 session，无法淘汰
      }
      sessionState.set(sessionPath, {
        thinkTagParser: new ThinkTagParser(),
        moodParser: new MoodParser(),
        cardParser: new CardParser(),
        _cardHints: [],
        _cardEmitted: false,
        isThinking: false,
        hasOutput: false,
        hasToolCall: false,
        hasThinking: false,
        hasError: false,
        isAborted: false,
        titleRequested: false,
        titlePreview: "",
        visibleAssistantText: "",
        fileWritePreviews: new Map(),
        lastAccessed: Date.now(),
        ...createSessionStreamState(),
      });
    }
    const ss = sessionState.get(sessionPath);
    ss.lastAccessed = Date.now();
    return ss;
  }

  const clients = new Set();

  function broadcast(msg) {
    for (const client of clients) {
      wsSend(client, msg);
    }
  }

  // 浏览器缩略图 30s 定时刷新（browser 活跃时）
  let _browserThumbTimer = null;
  function startBrowserThumbPoll() {
    if (_browserThumbTimer) return;
    _browserThumbTimer = setInterval(async () => {
      const browser = BrowserManager.instance();
      if (!browser.hasAnyRunning) { stopBrowserThumbPoll(); return; }
      await Promise.all(browser.runningSessions.map(async (sp) => {
        const wasRunning = browser.isRunning(sp);
        const thumbnail = await browser.thumbnail(sp);
        if (thumbnail) {
          broadcast({ type: "browser_status", running: true, url: browser.currentUrl(sp), thumbnail, sessionPath: sp });
        } else if (wasRunning && !browser.isRunning(sp)) {
          broadcast({
            type: "browser_status",
            running: false,
            url: browser.currentUrl(sp),
            error: browser.sessionUnavailableReason?.(sp) || null,
            sessionPath: sp,
          });
        }
      }));
      if (!browser.hasAnyRunning) stopBrowserThumbPoll();
    }, 30_000);
  }
  function stopBrowserThumbPoll() {
    if (_browserThumbTimer) { clearInterval(_browserThumbTimer); _browserThumbTimer = null; }
  }

  function emitStreamEvent(sessionPath, ss, event) {
    const entry = appendSessionStreamEvent(ss, event);
    // Phase 4: 始终广播所有事件，前端按 sessionPath 路由到对应 panel
    broadcast({
      ...event,
      sessionPath,
      streamId: entry.streamId,
      seq: entry.seq,
    });
    return entry;
  }

  function finishStreamingState(ss) {
    if (!ss) return;
    if (ss.isStreaming) finishSessionStream(ss);
    ss.thinkTagParser.reset();
    ss.moodParser.reset();
    ss.cardParser.reset();
  }

  function finishErroredStream(sessionPath, ss) {
    if (!sessionPath || !ss?.isStreaming) return;
    if (ss.isThinking) {
      ss.isThinking = false;
      emitStreamEvent(sessionPath, ss, { type: "thinking_end" });
    }
    emitStreamEvent(sessionPath, ss, { type: "turn_end" });
    finishStreamingState(ss);
    broadcast({ type: "status", isStreaming: false, sessionPath });
  }

  function appendVisibleAssistantText(ss, text) {
    if (!ss || typeof text !== "string" || !text) return;
    ss.visibleAssistantText = `${ss.visibleAssistantText || ""}${text}`;
  }

  async function persistInterruptedAssistantSnapshot(sessionPath, ss) {
    const text = String(ss?.visibleAssistantText || "").trimEnd();
    if (!text.trim()) return false;
    let session = engine.getSessionByPath?.(sessionPath);
    if (!session?.sessionManager && typeof engine.ensureSessionLoaded === "function") {
      session = await engine.ensureSessionLoaded(sessionPath);
    }
    const manager = session?.sessionManager;
    if (typeof manager?.appendMessage !== "function") return false;
    const branch = typeof manager.getBranch === "function" ? manager.getBranch() : [];
    const lastMessage = Array.isArray(branch)
      ? [...branch].reverse().find(entry => entry?.type === "message" && entry.message)
      : null;
    if (lastMessage?.message?.role === "assistant") {
      const existing = extractText(lastMessage.message.content).trimEnd();
      if (existing === text) return false;
    }
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text }],
      ...assistantMessageMetadata(session),
      stopReason: "interrupted",
      timestamp: Date.now(),
    });
    return true;
  }

  function maybeGenerateFirstTurnTitle(sessionPath, ss) {
    if (!sessionPath || !ss || ss.titleRequested) return;

    const session = engine.getSessionByPath(sessionPath);
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const userMsgCount = messages.filter(m => m.role === "user").length;
    if (userMsgCount !== 1) return;

    const assistantMsg = messages.find(m => m.role === "assistant");
    const assistantText = (ss.titlePreview || extractText(assistantMsg?.content)).trim();
    if (!assistantText) return;

    ss.titleRequested = true;
    generateSessionTitle(engine, broadcast, {
      sessionPath,
      assistantTextHint: assistantText,
    }).then((ok) => {
      if (!ok) ss.titleRequested = false;
    }).catch((err) => {
      ss.titleRequested = false;
      console.error("[chat] generateSessionTitle error:", err.message);
    });
  }

  // 单订阅：事件只写入一次，再按需广播到所有连接中的客户端。
  hub.subscribe((event, sessionPath) => {
    // Non-session-scoped events: handle before session resolution
    const appEventMessage = toAppEventWsMessage(event);
    if (appEventMessage) {
      broadcast(appEventMessage);
      return;
    }

    if (event.type === "plugin_ui_changed") {
      broadcast({ type: "plugin_ui_changed" });
      return;
    }

    const compactionMessage = toCompactionLifecycleWsMessage(
      event,
      sessionPath,
      (sp) => engine.getSessionByPath(sp),
    );
    if (compactionMessage) {
      broadcast(compactionMessage);
      return;
    }

    const ss = sessionPath ? getState(sessionPath) : null;

    // Helper: feed CardParser, emit card events or pass text through as text_delta
    const feedCardPipeline = (text) => {
      ss.cardParser.feed(text, (cEvt) => {
        switch (cEvt.type) {
          case "text":
            ss.titlePreview += cEvt.data || "";
            appendVisibleAssistantText(ss, cEvt.data);
            emitStreamEvent(sessionPath, ss, { type: "text_delta", delta: cEvt.data });
            maybeGenerateFirstTurnTitle(sessionPath, ss);
            break;
          case "card_start":
            ss._cardEmitted = true;
            emitStreamEvent(sessionPath, ss, { type: "card_start", attrs: cEvt.attrs });
            break;
          case "card_text":
            emitStreamEvent(sessionPath, ss, { type: "card_text", delta: cEvt.data });
            break;
          case "card_end":
            emitStreamEvent(sessionPath, ss, { type: "card_end" });
            break;
        }
      });
    };

    const FILE_WRITE_PREPARE_MIN_GROWTH = 256;
    const FILE_WRITE_PREPARE_MIN_INTERVAL_MS = 200;
    const emitFileWritePrepare = (assistantEvent) => {
      if (!ss) return false;
      const preview = extractFileWriteToolPreview(assistantEvent);
      if (!preview) return false;
      if (ss.isThinking) {
        ss.isThinking = false;
        emitStreamEvent(sessionPath, ss, { type: "thinking_end" });
      }
      const previous = ss.fileWritePreviews.get(preview.key) || { contentLength: 0, rawPartialArgs: "", lastEmittedLen: -1, lastEmitAt: 0 };
      const rawPartialArgs = preview.partialArgs || `${previous.rawPartialArgs || ""}${preview.delta || ""}`;
      const rawPath = preview.rawPath || extractPartialJsonStringValue(rawPartialArgs, "path") || extractPartialJsonStringValue(rawPartialArgs, "file_path") || null;
      const content = preview.content || extractPartialJsonStringValue(rawPartialArgs, "content") || "";
      const previewText = content.slice(0, FILE_WRITE_PREPARE_PREVIEW_MAX_CHARS);
      const isEnd = assistantEvent?.type === "toolcall_end";
      const previewReset = previous.contentLength > content.length;
      const growth = content.length - (previous.lastEmittedLen ?? -1);
      const elapsed = Date.now() - (previous.lastEmitAt || 0);
      const shouldEmit = isEnd || previewReset || previous.lastEmittedLen < 0 || growth >= FILE_WRITE_PREPARE_MIN_GROWTH || elapsed >= FILE_WRITE_PREPARE_MIN_INTERVAL_MS;
      const nextState = {
        contentLength: content.length,
        previewText,
        rawPartialArgs,
        lastEmittedLen: shouldEmit ? content.length : (previous.lastEmittedLen ?? -1),
        lastEmitAt: shouldEmit ? Date.now() : (previous.lastEmitAt || 0),
      };
      ss.fileWritePreviews.set(preview.key, nextState);
      // eslint-disable-next-line no-console
      console.log("[hana-debug] fwp probe contentLen=", content.length, "lastEmittedLen=", previous.lastEmittedLen, "growth=", growth, "elapsed=", elapsed, "shouldEmit=", shouldEmit, "isEnd=", isEnd);
      if (!shouldEmit) return true;
      emitStreamEvent(sessionPath, ss, {
        type: "file_write_prepare",
        name: preview.toolName,
        prepareKey: preview.key,
        rawPath,
        fileName: fileNameFromPath(rawPath) || preview.fileName,
        previewReset,
        previewText,
        previewTruncated: content.length > FILE_WRITE_PREPARE_PREVIEW_MAX_CHARS,
        done: isEnd,
      });
      return true;
    };

    if (event.type === "message_update") {
      if (!ss) return;
      const sub = event.assistantMessageEvent?.type;

      if (sub === "text_delta") {
        ss.hasOutput = true;
        if (ss.isThinking) {
          ss.isThinking = false;
          emitStreamEvent(sessionPath, ss, { type: "thinking_end" });
        }

        const delta = event.assistantMessageEvent.delta;
        // ThinkTagParser（最外层）→ MoodParser → CardParser
        ss.thinkTagParser.feed(delta, (tEvt) => {
          switch (tEvt.type) {
            case "think_start":
              emitStreamEvent(sessionPath, ss, { type: "thinking_start" });
              break;
            case "think_text":
              emitStreamEvent(sessionPath, ss, { type: "thinking_delta", delta: tEvt.data });
              break;
            case "think_end":
              emitStreamEvent(sessionPath, ss, { type: "thinking_end" });
              break;
            case "text":
              // 非 think 内容继续走 MoodParser → CardParser 链
              ss.moodParser.feed(tEvt.data, (evt) => {
                switch (evt.type) {
                  case "text":
                    feedCardPipeline(evt.data);
                    break;
                  case "mood_start":
                    emitStreamEvent(sessionPath, ss, { type: "mood_start" });
                    break;
                  case "mood_text":
                    emitStreamEvent(sessionPath, ss, { type: "mood_text", delta: evt.data });
                    break;
                  case "mood_end":
                    emitStreamEvent(sessionPath, ss, { type: "mood_end" });
                    break;
                }
              });
              break;
          }
        });
      } else if (sub === "thinking_delta") {
        ss.hasThinking = true;
        if (!ss.isThinking) {
          ss.isThinking = true;
          emitStreamEvent(sessionPath, ss, { type: "thinking_start" });
        }
        emitStreamEvent(sessionPath, ss, {
          type: "thinking_delta",
          delta: event.assistantMessageEvent.delta || "",
        });
      } else if (sub === "toolcall_start" || sub === "toolcall_delta" || sub === "toolcall_end") {
        // eslint-disable-next-line no-console
        console.log("[hana-debug] message_update toolcall event:", sub, "name=", assistantToolCallFromEvent(event.assistantMessageEvent)?.name || "(none)");
        const handled = emitFileWritePrepare(event.assistantMessageEvent);
        // eslint-disable-next-line no-console
        console.log("[hana-debug] emitFileWritePrepare handled=", handled);
      } else if (sub === "error") {
        ss.hasError = true;
        broadcast({ type: "error", message: event.assistantMessageEvent.error || "Unknown error", sessionPath });
        finishErroredStream(sessionPath, ss);
      }
    } else if (event.type === "toolcall_start" || event.type === "toolcall_delta" || event.type === "toolcall_end") {
      // eslint-disable-next-line no-console
      console.log("[hana-debug] top-level toolcall event:", event.type, "name=", assistantToolCallFromEvent(event)?.name || "(none)");
      const handled = emitFileWritePrepare(event);
      // eslint-disable-next-line no-console
      console.log("[hana-debug] emitFileWritePrepare(top) handled=", handled);
    } else if (event.type === "tool_execution_start") {
      if (!ss) return;
      ss.hasToolCall = true;
      if (ss.isThinking) {
        ss.isThinking = false;
        emitStreamEvent(sessionPath, ss, { type: "thinking_end" });
      }
      // 只保留前端 extractToolDetail 需要的字段，避免广播完整文件内容
      const args = summarizeToolStartArgs(event.toolName || "", event.args);
      emitStreamEvent(sessionPath, ss, { type: "tool_start", name: event.toolName || "", args });
      const startPreview = summarizeWriteStartPreview(event.toolName || "", event.args);
      if (startPreview) {
        emitStreamEvent(sessionPath, ss, {
          type: "tool_progress",
          name: event.toolName || "",
          stage: event.toolName === "edit" ? "applying" : "writing",
          fileName: startPreview.fileName,
          rawPath: startPreview.rawPath,
          previewReset: true,
          previewChunk: startPreview.previewChunk,
          previewTruncated: startPreview.previewTruncated,
        });
      }
    } else if (event.type === "tool_execution_end") {
      if (!ss) return;
      emitStreamEvent(sessionPath, ss, {
        type: "tool_end",
        name: event.toolName || "",
        success: !event.isError,
        details: event.result?.details,
      });

      // Unified content_block emission for all tool results
      const blocks = extractBlocks(event.toolName, event.result?.details, event.result);
      for (const block of blocks) {
        emitStreamEvent(sessionPath, ss, { type: "content_block", block });
      }

      if (event.toolName === "browser") {
        const d = event.result?.details || {};
        const statusMsg = {
          type: "browser_status",
          running: d.running ?? false,
          url: d.url || null,
        };
        if (d.thumbnail) statusMsg.thumbnail = d.thumbnail;
        emitStreamEvent(sessionPath, ss, statusMsg);
        if (statusMsg.running) startBrowserThumbPoll();
        else stopBrowserThumbPoll();
      }

      if (["write", "edit", "bash"].includes(event.toolName)) {
        // wrapFileTouchTool 把 filePath 挂在 details 上；bash 改的文件路径未知，留空让前端做全量刷新。
        const filePath = (event.toolName === "write" || event.toolName === "edit")
          ? (event.result?.details?.filePath || null)
          : null;
        broadcast({ type: "desk_changed", sessionPath, filePath });
      }
    } else if (event.type === "tool_execution_update") {
      if (!ss) return;
      emitStreamEvent(sessionPath, ss, {
        type: "tool_progress",
        name: event.toolName || "",
        stage: event.stage || "",
        filePath: event.filePath || null,
        fileName: event.fileName || null,
        rawPath: event.rawPath || null,
        operation: event.operation || null,
        bytesWritten: event.bytesWritten,
        totalBytes: event.totalBytes,
        progress: event.progress,
        previewReset: event.previewReset,
        previewChunk: event.previewChunk,
        previewTruncated: event.previewTruncated,
        error: event.error,
        warning: event.warning,
      });
      if ((event.toolName === "write" || event.toolName === "edit") && event.stage === "written") {
        broadcast({ type: "desk_changed", sessionPath, filePath: event.filePath || null });
      }
    } else if (event.type === "jian_update") {
      broadcast({ type: "jian_update", content: event.content });
    } else if (event.type === "devlog") {
      broadcast({ type: "devlog", text: event.text, level: event.level });
    } else if (event.type === "browser_bg_status") {
      broadcast({ type: "browser_bg_status", running: event.running, url: event.url, sessionPath });
    } else if (event.type === "computer_overlay") {
      if (!ss) return;
      emitStreamEvent(sessionPath, ss, event);
    } else if (event.type === "session_confirmation" && event.request) {
      if (!ss) return;
      emitStreamEvent(sessionPath, ss, {
        type: "content_block",
        block: event.request,
      });
    } else if (event.type === "cron_confirmation" && event.confirmId) {
      // 新的阻塞式 cron 确认（通过 emitEvent 触发）
      if (!ss) return;
      emitStreamEvent(sessionPath, ss, {
        type: "content_block",
        block: { type: "cron_confirm", confirmId: event.confirmId, jobData: event.jobData, status: "pending" },
      });
    } else if (event.type === "settings_confirmation") {
      if (!ss) return;
      emitStreamEvent(sessionPath, ss, {
        type: "content_block",
        block: {
          type: "settings_confirm", confirmId: event.confirmId,
          settingKey: event.settingKey, cardType: event.cardType,
          currentValue: event.currentValue, proposedValue: event.proposedValue,
          options: event.options, optionLabels: event.optionLabels || null,
          label: event.label, description: event.description,
          frontend: event.frontend, status: "pending",
        },
      });
    } else if (event.type === "confirmation_resolved") {
      broadcast({
        type: "confirmation_resolved",
        confirmId: event.confirmId,
        action: event.action,
        value: event.value,
      });
    } else if (event.type === "apply_frontend_setting") {
      broadcast({
        type: "apply_frontend_setting",
        key: event.key,
        value: event.value,
      });
    } else if (event.type === "block_update") {
      broadcast({
        type: "block_update",
        taskId: event.taskId,
        patch: event.patch,
        sessionPath,
      });
    } else if (event.type === "todo_update") {
      broadcast({
        type: "todo_update",
        todos: Array.isArray(event.todos) ? event.todos : [],
        sessionPath,
      });
    } else if (event.type === "activity_update") {
      broadcast({ type: "activity_update", activity: event.activity });
    } else if (event.type === "bridge_message") {
      broadcast({ type: "bridge_message", message: event.message });
    } else if (event.type === "bridge_status") {
      broadcast({ type: "bridge_status", platform: event.platform, status: event.status, error: event.error, agentId: event.agentId || null });
    } else if (event.type === "session_branch_reset") {
      if (!ss) return;
      emitStreamEvent(sessionPath, ss, {
        type: "session_branch_reset",
        messageId: event.messageId || null,
        clientMessageId: event.clientMessageId || null,
      });
    } else if (event.type === "session_user_message") {
      if (!ss) return;
      // 用户发了新消息：放闸所有终端会话的 humanInterruptPending，让 AI 可以重新执行 terminal_write。
      try {
        for (const term of terminalManager.list?.() ?? []) {
          const inst = terminalManager.get?.(term.id);
          if (inst?.clearHumanInterruptPending) inst.clearHumanInterruptPending();
        }
      } catch {}
      emitStreamEvent(sessionPath, ss, { type: "session_user_message", message: event.message });
    } else if (event.type === "session_status") {
      if (ss) {
        if (event.isStreaming) {
          ss.thinkTagParser.reset();
          ss.moodParser.reset();
          ss.cardParser.reset();
          ss._cardHints = [];
          ss._cardEmitted = false;
          ss.isThinking = false;
          ss.hasOutput = false;
          ss.hasToolCall = false;
          ss.hasThinking = false;
          ss.hasError = false;
          ss.isAborted = false;
          ss.titleRequested = false;
          ss.titlePreview = "";
          ss.visibleAssistantText = "";
          beginSessionStream(ss);
        } else if (ss.isStreaming) {
          finishStreamingState(ss);
        }
      }
      broadcast({ type: "status", isStreaming: !!event.isStreaming, sessionPath });
    } else if (event.type === "bridge_rc_attached") {
      broadcast({
        type: "bridge_rc_attached",
        sessionKey: event.sessionKey,
        sessionPath,
        title: event.title,
        platform: event.platform || null,
      });
    } else if (event.type === "bridge_rc_detached") {
      broadcast({
        type: "bridge_rc_detached",
        sessionKey: event.sessionKey,
        sessionPath,
      });
    } else if (event.type === "plan_mode") {
      broadcast({ type: "plan_mode", enabled: event.enabled, sessionPath });
    } else if (event.type === "notification") {
      broadcast({ type: "notification", title: event.title, body: event.body });
    } else if (event.type === "channel_new_message") {
      broadcast({
        type: "channel_new_message",
        channelName: event.channelName,
        sender: event.sender,
        message: event.message || null,
      });
    } else if (event.type === "dm_new_message") {
      broadcast({ type: "dm_new_message", from: event.from, to: event.to });
    } else if (event.type === "conversation_agent_activity") {
      broadcast({ type: "conversation_agent_activity", activity: event.activity });
    } else if (event.type === "message_end") {
      // Provider 级别错误（超时、连接断开等）通过 message_end 传递，不经过 message_update
      if (!ss) return;
      if (event.message?.stopReason === "error") {
        ss.hasError = true;
        broadcast({ type: "error", message: event.message.errorMessage || "Unknown error", sessionPath });
        finishErroredStream(sessionPath, ss);
      }
    } else if (event.type === "turn_end") {
      if (!ss) return;
      if (!ss.isStreaming) return;
      // 关闭结构化 thinking（如有）——必须在 flush 之前，否则前端收不到 thinking_end
      if (ss.isThinking) {
        ss.isThinking = false;
        emitStreamEvent(sessionPath, ss, { type: "thinking_end" });
      }
      // flush 顺序：ThinkTag → Mood → Card（和 feed 顺序一致）
      // flush 内部的 mood → card 管线（thinkTag flush 和 mood flush 共用）
      const feedMoodPipeline = (text) => {
        ss.moodParser.feed(text, (evt) => {
          if (evt.type === "text") {
            feedCardPipeline(evt.data);
          } else if (evt.type === "mood_start") {
            emitStreamEvent(sessionPath, ss, { type: "mood_start" });
          } else if (evt.type === "mood_text") {
            emitStreamEvent(sessionPath, ss, { type: "mood_text", delta: evt.data });
          } else if (evt.type === "mood_end") {
            emitStreamEvent(sessionPath, ss, { type: "mood_end" });
          }
        });
      };
      ss.thinkTagParser.flush((tEvt) => {
        if (tEvt.type === "think_text") {
          emitStreamEvent(sessionPath, ss, { type: "thinking_delta", delta: tEvt.data });
        } else if (tEvt.type === "think_end") {
          emitStreamEvent(sessionPath, ss, { type: "thinking_end" });
        } else if (tEvt.type === "text") {
          feedMoodPipeline(tEvt.data);
        }
      });
      ss.moodParser.flush((evt) => {
        if (evt.type === "text") {
          feedCardPipeline(evt.data);
        } else if (evt.type === "mood_text") {
          emitStreamEvent(sessionPath, ss, { type: "mood_text", delta: evt.data });
        }
      });
      ss.cardParser.flush((cEvt) => {
        if (cEvt.type === "text") {
          appendVisibleAssistantText(ss, cEvt.data);
          emitStreamEvent(sessionPath, ss, { type: "text_delta", delta: cEvt.data });
        } else if (cEvt.type === "card_text") {
          emitStreamEvent(sessionPath, ss, { type: "card_text", delta: cEvt.data });
        } else if (cEvt.type === "card_start") {
          ss._cardEmitted = true;
          emitStreamEvent(sessionPath, ss, { type: "card_start", attrs: cEvt.attrs });
        } else if (cEvt.type === "card_end") {
          emitStreamEvent(sessionPath, ss, { type: "card_end" });
        }
      });


      // 空回复检测：本轮没有文本输出也没有工具调用，提示用户检查配置
      // 被 abort 的 turn 不弹此提示（用户主动停止 / WS 断开 / 连接超时）
      if (!ss.hasOutput && !ss.hasToolCall && !ss.hasThinking && !ss.hasError && !ss.isAborted) {
        broadcast({ type: "error", message: t("error.modelNoResponse"), sessionPath });
      }

      // ── token usage 事件（供插件监听做用量统计）──
      try {
        const sess = engine.getSessionByPath(sessionPath);
        if (sess) {
          const usage = getLastAssistantUsage(sess.entries ?? []);
          if (usage) {
            const model = sess.model;
            logLlmUsage({
              source: "chat",
              api: model?.api ?? null,
              modelId: model?.id ?? null,
              provider: model?.provider ?? null,
              usage,
              costRates: model?.cost,
            });
            hub.eventBus.emit({
              type: "token_usage",
              usage,
              modelId: model?.id ?? null,
              modelProvider: model?.provider ?? null,
            }, sessionPath);
          }
        }
      } catch (_) { /* 统计失败不阻塞主流程 */ }

      emitStreamEvent(sessionPath, ss, { type: "turn_end" });
      finishSessionStream(ss);
      ss.hasOutput = false;
      ss.hasToolCall = false;
      ss.hasThinking = false;
      ss.hasError = false;
      ss.isAborted = false;
      ss.thinkTagParser.reset();
      ss.moodParser.reset();
      ss.cardParser.reset();
      ss._cardHints = [];
      ss._cardEmitted = false;

      debugLog()?.log("ws", `turn done (${sessionPath?.split("/").pop()})`);
      maybeGenerateFirstTurnTitle(sessionPath, ss);
    } else if (event.type === "deferred_result") {
      if (!ss) return;
      emitStreamEvent(sessionPath, ss, {
        type: "deferred_result",
        taskId: event.taskId,
        status: event.status,
        result: event.result,
        reason: event.reason,
        meta: event.meta,
      });
    }
  });

  // ── 后台任务终止 ──

  restRoute.post("/task/:taskId/abort", async (c) => {
    const taskId = c.req.param("taskId");
    const registry = engine.taskRegistry;
    if (!registry) return c.json({ error: "registry unavailable" }, 500);
    const result = registry.abort(taskId);
    if (result === "not_found") return c.json({ error: "task not found" }, 404);
    if (result === "no_handler") return c.json({ error: "task type does not support abort" }, 400);
    return c.json({ ok: true, status: result });
  });

  // ── WebSocket 路由（挂载在 wsRoute，由 index.js 挂到根路径） ──

  wsRoute.get("/ws",
    upgradeWebSocket((c) => {
      let closed = false;

      return {
        onOpen(event, ws) {
          activeWsClients++;
          clients.add(ws);
          cancelDisconnectAbort();
          debugLog()?.log("ws", "client connected");
        },

        onMessage(event, ws) {
          // Hono @hono/node-ws delivers event.data as a string for text frames
          const msg = wsParse(event.data);
          if (!msg) return;

          // Wrap the async handler with error handling (replaces wrapWsHandler)
          (async () => {
            if (msg.type === "abort") {
              const abortPath = requireSessionPath(msg, ws); if (!abortPath) return;
              const abortSs = getState(abortPath);
              if (abortSs) abortSs.isAborted = true;
              let abortAccepted = false;
              try {
                if (typeof engine.interruptSessionForPrompt === "function") {
                  abortAccepted = !!(await engine.interruptSessionForPrompt(abortPath));
                } else {
                  abortAccepted = !!(await hub.abort(abortPath));
                }
              } catch {}
              if (!abortAccepted) {
                finishStreamingState(abortSs);
                broadcast({ type: "status", isStreaming: false, sessionPath: abortPath });
              }
              try { await persistInterruptedAssistantSnapshot(abortPath, abortSs); } catch {}
              return;
            }

            if (msg.type === "interrupt_prompt" && (msg.text || msg.images?.length || msg.videos?.length)) {
              const interruptPath = requireSessionPath(msg, ws); if (!interruptPath) return;
              const interruptSs = getState(interruptPath);
              if (interruptSs) interruptSs.isAborted = true;
              let interruptAccepted = false;
              try {
                if (typeof engine.interruptSessionForPrompt === "function") {
                  interruptAccepted = !!(await engine.interruptSessionForPrompt(interruptPath));
                }
              } catch {}
              if (!interruptAccepted) {
                finishStreamingState(interruptSs);
                broadcast({ type: "status", isStreaming: false, sessionPath: interruptPath });
              }
              try { await persistInterruptedAssistantSnapshot(interruptPath, interruptSs); } catch {}
              msg.type = "prompt";
              msg.interruptedPreviousTurn = true;
            }

            if (msg.type === "steer" && msg.text) {
              debugLog()?.log("ws", `steer (${msg.text.length} chars)`);
              const steerPath = requireSessionPath(msg, ws); if (!steerPath) return;
              if (engine.steerSession(steerPath, msg.text)) {
                wsSend(ws, { type: "steered" });
                return;
              }
              // agent 已停止，降级为正常 prompt（下面的 prompt 分支会处理）
              debugLog()?.log("ws", `steer missed, falling back to prompt`);
              msg.type = "prompt";
            }

            // session 切回时，前端请求补发离屏期间的流式内容
            if (msg.type === "resume_stream") {
              const currentPath = requireSessionPath(msg, ws); if (!currentPath) return;
              const ss = sessionState.get(currentPath);
              if (ss) {
                const resumed = resumeSessionStream(ss, {
                  streamId: msg.streamId,
                  sinceSeq: msg.sinceSeq,
                });
                wsSend(ws, {
                  type: "stream_resume",
                  sessionPath: currentPath,
                  streamId: resumed.streamId,
                  sinceSeq: resumed.sinceSeq,
                  nextSeq: resumed.nextSeq,
                  reset: resumed.reset,
                  truncated: resumed.truncated,
                  isStreaming: resumed.isStreaming,
                  events: resumed.events,
                });
              } else {
                wsSend(ws, {
                  type: "stream_resume",
                  sessionPath: currentPath,
                  streamId: null,
                  sinceSeq: Number.isFinite(msg.sinceSeq) ? Math.max(0, msg.sinceSeq) : 0,
                  nextSeq: 1,
                  reset: false,
                  truncated: false,
                  isStreaming: false,
                  events: [],
                });
              }
              return;
            }

            if (msg.type === "context_usage") {
              const usagePath = requireSessionPath(msg, ws); if (!usagePath) return;
              const usageSession = engine.getSessionByPath(usagePath);
              const usage = usageSession?.getContextUsage?.();
              wsSend(ws, {
                type: "context_usage",
                sessionPath: usagePath,
                tokens: usage?.tokens ?? null,
                contextWindow: usage?.contextWindow ?? null,
                percent: usage?.percent ?? null,
              });
              return;
            }

            if (msg.type === "slash" && typeof msg.text === "string") {
              const sp = requireSessionPath(msg, ws); if (!sp) return;
              const dispatcher = engine.slashDispatcher;
              if (!dispatcher) {
                wsSend(ws, { type: "error", message: "slash system not ready", sessionPath: sp });
                return;
              }
              const session = engine.getSessionByPath(sp);
              const agentId = session?.agentId || msg.agentId;
              if (!agentId) {
                wsSend(ws, { type: "error", message: "agentId required", sessionPath: sp });
                return;
              }
              const sendReply = async (text) => {
                wsSend(ws, { type: "slash_result", sessionPath: sp, text });
              };
              const res = await dispatcher.tryDispatch(msg.text.trim(), {
                sessionRef: { kind: "desktop", agentId, sessionPath: sp },
                source: "desktop",
                senderId: "desktop",
                isOwner: true,
                reply: sendReply,
              });
              if (!res.handled) {
                wsSend(ws, { type: "slash_result", sessionPath: sp, text: `[未知命令] ${msg.text}` });
              }
              return;
            }

            if (msg.type === "compact") {
              const compactPath = requireSessionPath(msg, ws); if (!compactPath) return;
              const session = engine.getSessionByPath(compactPath);
              if (!session) {
                wsSend(ws, { type: "error", message: t("error.noActiveSession"), sessionPath: compactPath });
                return;
              }
              if (session.isCompacting) {
                wsSend(ws, { type: "error", message: t("error.compacting"), sessionPath: compactPath });
                return;
              }
              if (engine.isSessionStreaming(compactPath)) {
                wsSend(ws, { type: "error", message: t("error.waitForReply"), sessionPath: compactPath });
                return;
              }
              try {
                await session.compact();
              } catch (err) {
                const errMsg = err.message || "";
                if (!errMsg.includes("Already compacted") && !errMsg.includes("Nothing to compact")) {
                  wsSend(ws, { type: "error", message: t("error.compactFailed", { msg: errMsg }), sessionPath: compactPath });
                }
              }
              return;
            }

            if (msg.type === "prompt" && (msg.text || msg.images?.length || msg.videos?.length)) {
              // 图片校验：最多 10 张，单张 ≤ 20MB，仅允许常见图片 MIME
              if (msg.images?.length) {
                const MAX_IMAGES = 10;
                if (msg.images.length > MAX_IMAGES) {
                  wsSend(ws, { type: "error", message: t("error.maxImages", { max: MAX_IMAGES }), sessionPath: msg.sessionPath });
                  return;
                }
                for (const img of msg.images) {
                  if (!img?.mimeType || !isAllowedChatImageMime(img.mimeType)) {
                    wsSend(ws, { type: "error", message: t("error.unsupportedImageFormat", { mime: img?.mimeType || "unknown" }), sessionPath: msg.sessionPath });
                    return;
                  }
                  if (img.data && !isChatImageBase64WithinLimit(img.data)) {
                    wsSend(ws, { type: "error", message: t("error.imageTooLarge"), sessionPath: msg.sessionPath });
                    return;
                  }
                }
              }
              if (msg.videos?.length) {
                const MAX_VIDEOS = 3;
                if (msg.videos.length > MAX_VIDEOS) {
                  wsSend(ws, { type: "error", message: t("error.maxVideos", { max: MAX_VIDEOS }), sessionPath: msg.sessionPath });
                  return;
                }
                for (const video of msg.videos) {
                  if (!video?.mimeType || !isAllowedChatVideoMime(video.mimeType)) {
                    wsSend(ws, { type: "error", message: t("error.unsupportedVideoFormat", { mime: video?.mimeType || "unknown" }), sessionPath: msg.sessionPath });
                    return;
                  }
                  if (video.data && !isChatVideoBase64WithinLimit(video.data)) {
                    wsSend(ws, { type: "error", message: t("error.videoTooLarge"), sessionPath: msg.sessionPath });
                    return;
                  }
                }
              }
              // 图片持久化 + [attached_image] 标记 + image 模态 check 统一在 hub.send() 和下游 handler 处理
              let promptText = msg.text || "";
              // Skill invocation tags
              if (msg.skills?.length) {
                const skillNote = msg.skills.map(s => `[Use skill: ${s}]`).join('\n');
                promptText = `${skillNote}\n${promptText}`;
              }
              if (!promptText.trim()) {
                if (msg.images?.length) promptText = t("error.viewImage");
                else if (msg.videos?.length) promptText = t("error.viewVideo");
              }
              debugLog()?.log("ws", `user message (${promptText.length} chars, ${msg.images?.length || 0} images, ${msg.videos?.length || 0} videos)`);
              // Phase 2: 客户端可指定 sessionPath，否则用焦点 session
              const promptSessionPath = requireSessionPath(msg, ws); if (!promptSessionPath) return;
              if (engine.isSessionStreaming(promptSessionPath)) {
                wsSend(ws, { type: "error", message: t("error.stillStreaming", { name: engine.agentName }), sessionPath: promptSessionPath });
                return;
              }
              // Reject prompt while model switch is in progress
              if (engine.isSessionSwitching(promptSessionPath)) {
                wsSend(ws, { type: "error", message: "正在切换模型，请稍候", sessionPath: promptSessionPath });
                return;
              }
              try {
                await hub.send(promptText, {
                  sessionPath: promptSessionPath,
                  images: msg.images,
                  videos: msg.videos,
                  uiContext: msg.uiContext ?? null,
                  displayMessage: msg.displayMessage,
                });
              } catch (err) {
                const isUserAbort = err.name === 'AbortError'
                  || (err.message === 'This operation was aborted')
                  || (err.type === 'aborted');
                if (!isUserAbort) {
                  const errMessage = err.message === "session_busy"
                    ? t("error.stillStreaming", { name: engine.agentName })
                    : err.message;
                  wsSend(ws, { type: "error", message: errMessage, sessionPath: promptSessionPath });
                }
              }
            }
          })().catch((err) => {
            const appErr = AppError.wrap(err);
            errorBus.report(appErr, { context: { wsMessageType: msg.type } });
            const isUserAbort = appErr.name === 'AbortError'
              || appErr.message === 'This operation was aborted'
              || appErr.type === 'aborted';
            if (!isUserAbort) {
              wsSend(ws, { type: 'error', message: appErr.message || 'Unknown error', error: appErr.toJSON(), sessionPath: msg.sessionPath });
            }
          });
        },

        onError(event, ws) {
          const err = event.error || event;
          console.error("[ws] error:", err.message || err);
          debugLog()?.error("ws", err.message || String(err));
        },

        // 清理：WS 断开时只中断前台 session（后台 channel delivery / cron 不受影响）
        onClose(event, ws) {
          if (closed) return;
          closed = true;
          activeWsClients = Math.max(0, activeWsClients - 1);
          clients.delete(ws);
          debugLog()?.log("ws", "client disconnected");
          scheduleDisconnectAbort();
          // 无活跃客户端时，清理非流式 session 状态（防止 Map 无限增长）
          if (activeWsClients === 0) {
            for (const [sp, ss] of sessionState) {
              if (!ss.isStreaming) sessionState.delete(sp);
            }
          }
        },
      };
    })
  );

  return { restRoute, wsRoute };
}

/**
 * 后台生成 session 标题：从第一轮对话提取摘要
 * 只在 session 还没有自定义标题时执行
 */
async function generateSessionTitle(engine, notify, opts = {}) {
  try {
    const sessionPath = opts.sessionPath;
    if (!sessionPath) return false;

    // 检查是否已有标题（避免重复生成）
    const sessions = await engine.listSessions();
    const current = sessions.find(s => s.path === sessionPath);
    if (current?.title) return true;

    const session = engine.getSessionByPath(sessionPath);
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const userMsg = messages.find(m => m.role === "user");
    const assistantMsg = messages.find(m => m.role === "assistant");
    if (!userMsg && !opts.userTextHint) return false;

    const userText = (opts.userTextHint || extractText(userMsg?.content)).trim();
    const assistantText = (opts.assistantTextHint || extractText(assistantMsg?.content)).trim();
    if (!userText || !assistantText) return false;

    // 超时由 callText 内部的 AbortSignal 统一控制：超时即取消 Pi SDK 连接，无空跑
    let title = await engine.summarizeTitle(userText, assistantText, { timeoutMs: 15_000, sessionPath });

    // API 失败时，用用户第一条消息截取作为 fallback 标题
    if (!title) {
      const fallback = userText.replace(/\n/g, " ").trim().slice(0, 30);
      if (!fallback) return;
      title = fallback;
      console.log("[chat] session 标题 API 失败，使用 fallback:", title);
    }

    // 保存标题
    await engine.saveSessionTitle(sessionPath, title);

    // 通知前端更新
    notify({ type: "session_title", title, path: sessionPath });
    return true;
  } catch (err) {
    console.error("[chat] 生成 session 标题失败:", err.message);
    return false;
  }
}
