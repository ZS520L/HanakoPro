/**
 * BridgeSessionManager — Bridge（外部平台）session 管理
 *
 * 负责 bridge session 索引读写、外部消息执行、消息注入。
 * 从 Engine 提取，Engine 通过 manager 访问 bridge 功能。
 */
import fs from "fs";
import path from "path";
import { createAgentSession, SessionManager } from "../lib/pi-sdk/index.js";
import { createDefaultSettings } from "./session-defaults.js";
import { debugLog } from "../lib/debug-log.js";
import { t, getLocale } from "../server/i18n.js";
import { safeReadJSON } from "../shared/safe-fs.js";
import { findModel } from "../shared/model-ref.js";
import { teardownSessionResources } from "./session-teardown.js";
import { isAbortLikeError, prepareVisionInputForTextOnlyModel } from "./vision-prepare.js";
import { adaptVisualContextMessages } from "./visual-context-pipeline.js";
import { SESSION_PERMISSION_MODES } from "./session-permission-mode.js";
import { collectMediaItems } from "../lib/tools/media-details.js";
import { materializeBridgeInboundFiles } from "../lib/session-files/bridge-inbound-files.js";
import { modelSupportsDirectVideoInput, modelSupportsVideoInput } from "../shared/model-capabilities.js";
import {
  buildFreshCompactMetaPatch,
  buildFreshCompactSnapshot,
  shouldRunFreshCompact,
} from "../lib/fresh-compact/policy.js";

function getSteerPrefix() {
  const isZh = getLocale().startsWith("zh");
  return isZh ? "（插话，无需 MOOD）\n" : "(Interjection, no MOOD needed)\n";
}

function assertVideoInputSupported(model, videos) {
  if (!videos?.length) return;
  if (!modelSupportsVideoInput(model)) {
    throw new Error("current model does not support video input");
  }
  if (!modelSupportsDirectVideoInput(model)) {
    throw new Error("current provider does not support direct video input");
  }
}

function buildPromptMediaOptions(opts) {
  const media = [
    ...(opts?.images || []),
    ...(opts?.videos || []),
  ];
  if (!media.length) return undefined;
  return {
    images: media,
    ...(opts.imageAttachmentPaths?.length ? { imageAttachmentPaths: opts.imageAttachmentPaths } : {}),
    ...(opts.videoAttachmentPaths?.length ? { videoAttachmentPaths: opts.videoAttachmentPaths } : {}),
  };
}

function getProviderMessageEndError(event) {
  if (event?.type !== "message_end" || event.message?.stopReason !== "error") return null;
  return event.message.errorMessage || event.message.error?.message || "Unknown error";
}

function zeroUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function withVisionExtension(resourceLoader, getBridge, getSessionPath, isEnabled, warn, resolveSessionFile) {
  return Object.create(resourceLoader, {
    getExtensions: {
      value: () => {
        const base = resourceLoader.getExtensions?.() ?? { extensions: [], errors: [] };
        const extension = {
          path: "hana-vision-context-injection",
          tools: new Map(),
          handlers: new Map([
            [
              "context",
              [
                async (event, ctx) => {
                  try {
                    if (isEnabled?.() !== true) return undefined;
                    const bridge = getBridge?.();
                    if (!bridge) return undefined;
                    const sessionPath = getSessionPath?.() || null;
                    const adapted = await adaptVisualContextMessages({
                      messages: event.messages,
                      sessionPath,
                      targetModel: ctx?.model,
                      visionBridge: bridge,
                      isVisionAuxiliaryEnabled: () => isEnabled?.() === true,
                      resolveSessionFile,
                      warn,
                    });
                    const injectedNotes = bridge.injectNotes(adapted.messages, sessionPath);
                    if (!adapted.injected && !injectedNotes.injected) return undefined;
                    return { messages: injectedNotes.messages };
                  } catch (err) {
                    warn?.(`vision context injection failed: ${err?.message || err}`);
                    return undefined;
                  }
                },
              ],
            ],
          ]),
          flags: new Map(),
          shortcuts: new Map(),
          commands: new Map(),
          messageRenderers: new Map(),
        };
        return { ...base, extensions: [extension, ...(base.extensions || [])] };
      },
    },
  });
}

/**
 * Bridge index entry（持久化到 bridge-sessions.json）。
 * 这个 typedef 只声明结构以便 IDE 和未来读者，运行时仍是 plain JSON object。
 *
 * @typedef {object} BridgeIndexEntry
 * @property {string} [file] - owner/xxx.jsonl 或 guests/xxx.jsonl（rotate 后会被移除保留 meta）
 * @property {string} [name]
 * @property {string} [avatarUrl]
 * @property {string} [userId]
 * @property {string} [chatId] - 平台投递地址；飞书等平台的 owner 身份 ID 不等于发送目标时必须保留
 * @property {string} [linkedSessionPath]
 *   - 预留字段：当该 bridge session 由某个桌面 session "推送"产生时，
 *     记录源桌面 session 的绝对路径。一期不写入（/push 命令在后续 phase 落地），
 *     现有读写路径对未知字段透明保留（readIndex → writeIndex roundtrip 不丢）。
 *     这是"桌面 session 推送到社交平台"长期能力的数据模型钩子。
 */

export class BridgeSessionManager {
  /**
   * @param {object} deps - 注入依赖（不持有 engine 引用）
   * @param {() => object} deps.getAgent - 返回当前 agent（需 sessionDir, yuanPrompt）
   * @param {(id: string) => object|null} deps.getAgentById - 按 ID 获取 agent
   * @param {() => Map<string, object>|object[]|undefined} [deps.getAgents] - 返回所有 agent（reconcile 用）
   * @param {() => import('./model-manager.js').ModelManager} deps.getModelManager
   * @param {() => object} deps.getResourceLoader
   * @param {() => object} deps.getPreferences
   * @param {(cwd: string, customTools?, opts?) => {tools: any[], customTools: any[]}} deps.buildTools
   * @param {() => string} deps.getHomeCwd
   * @param {() => boolean} [deps.isVisionAuxiliaryEnabled]
   */
  constructor(deps) {
    this._deps = deps;
    this._activeSessions = new Map();
    this._prePromptAbortControllers = new Map();
  }

  /** 活跃 bridge sessions（供 bridge-manager abort 用） */
  get activeSessions() { return this._activeSessions; }

  _emitSessionEvent(event, sessionPath) {
    if (!sessionPath || typeof this._deps.emitEvent !== "function") return;
    try {
      this._deps.emitEvent(event, sessionPath);
    } catch (err) {
      console.warn(`[bridge-session] emit ${event?.type || "event"} failed: ${err?.message || err}`);
    }
  }

  /** 指定 bridge session 是否正在 streaming */
  isSessionStreaming(sessionKey) {
    return this._prePromptAbortControllers.has(sessionKey)
      || (this._activeSessions.get(sessionKey)?.isStreaming ?? false);
  }

  /** abort 指定 bridge session（如果正在 streaming） */
  async abortSession(sessionKey) {
    const pending = this._prePromptAbortControllers.get(sessionKey);
    if (pending) {
      pending.abort();
      this._prePromptAbortControllers.delete(sessionKey);
      return true;
    }
    const session = this._activeSessions.get(sessionKey);
    if (!session?.isStreaming) return false;
    this._activeSessions.delete(sessionKey);
    try {
      const abortPromise = session.abort?.();
      Promise.resolve(abortPromise).catch((err) =>
        console.warn(`[bridge-session] abortSession[${sessionKey}]: abort failed: ${err.message}`),
      );
    } catch (err) {
      console.warn(`[bridge-session] abortSession[${sessionKey}]: abort failed: ${err.message}`);
    }
    try {
      session.dispose?.();
    } catch (err) {
      console.warn(`[bridge-session] abortSession[${sessionKey}]: session.dispose failed: ${err.message}`);
    }
    return true;
  }

  /** bridge 索引文件路径 */
  _indexPath(agent) {
    const a = agent || this._deps.getAgent();
    return path.join(a.sessionDir, "bridge", "bridge-sessions.json");
  }

  _resolveAgent(opts = {}, operation = "operation") {
    if (opts.agentId) {
      const agent = this._deps.getAgentById?.(opts.agentId) || null;
      if (!agent) throw new Error(`bridge ${operation}: agent "${opts.agentId}" not found`);
      return agent;
    }
    const agent = this._deps.getAgent?.() || null;
    if (!agent) throw new Error(`bridge ${operation}: focus agent not available`);
    return agent;
  }

  _listAgentsForReconcile() {
    const all = this._deps.getAgents?.();
    if (all instanceof Map) return [...all.values()].filter(Boolean);
    if (Array.isArray(all)) return all.filter(Boolean);
    const focus = this._deps.getAgent?.();
    return focus ? [focus] : [];
  }

  /**
   * 启动时 sanity check：扫描 bridge-index，清理孤儿条目
   * （有 file 引用但 JSONL 文件已不存在的）
   */
  reconcile() {
    let totalCleaned = 0;

    for (const agent of this._listAgentsForReconcile()) {
      const index = this.readIndex(agent);
      const bridgeDir = path.join(agent.sessionDir, "bridge");
      let cleaned = 0;

      for (const [sessionKey, raw] of Object.entries(index)) {
        const entry = typeof raw === "string" ? { file: raw } : raw;
        if (!entry.file) continue;
        const fp = path.join(bridgeDir, entry.file);
        if (!fs.existsSync(fp)) {
          // 保留元数据（name/avatarUrl/userId），只删 file 引用
          delete entry.file;
          index[sessionKey] = entry;
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.writeIndex(index, agent);
        totalCleaned += cleaned;
        debugLog()?.log("bridge", `reconcile: cleaned ${cleaned} orphan session refs for ${agent.id || "unknown"}`);
      }
    }

    if (totalCleaned > 0) {
      console.log(`[bridge-session] reconcile: 清理 ${totalCleaned} 个孤儿 session 引用`);
    }
  }

  /** 读取 bridge session 索引 */
  readIndex(agent) {
    return safeReadJSON(this._indexPath(agent), {});
  }

  /** 写入 bridge session 索引 */
  writeIndex(index, agent) {
    const dir = path.dirname(this._indexPath(agent));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this._indexPath(agent), JSON.stringify(index, null, 2) + "\n", "utf-8");
  }

  _normalizeIndexEntry(raw) {
    if (!raw) return {};
    return typeof raw === "string" ? { file: raw } : { ...raw };
  }

  _serializeIndexEntry(previousRaw, entry) {
    if (typeof previousRaw === "string" && Object.keys(entry).length === 1 && typeof entry.file === "string") {
      return entry.file;
    }
    return entry;
  }

  _relativeBridgeFile(bridgeDir, sessionPath) {
    const relative = path.relative(bridgeDir, sessionPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`bridge session path escapes bridge dir: ${sessionPath}`);
    }
    return relative.split(path.sep).join("/");
  }

  _syncIndexEntry(index, sessionKey, previousRaw, { bridgeDir, sessionPath, meta }) {
    const entry = this._normalizeIndexEntry(previousRaw);
    entry.file = this._relativeBridgeFile(bridgeDir, sessionPath);
    if (meta) Object.assign(entry, meta);
    const nextValue = this._serializeIndexEntry(previousRaw, entry);
    if (JSON.stringify(previousRaw ?? null) === JSON.stringify(nextValue)) return { changed: false, file: entry.file };
    index[sessionKey] = nextValue;
    return { changed: true, file: entry.file };
  }

  _buildOwnerFreshCompactContext(agent, homeCwd) {
    const prefs = this._deps.getPreferences();
    const systemPrompt = agent.buildSystemPrompt({
      cwdOverride: homeCwd,
      forceMemoryEnabled: agent.memoryMasterEnabled,
      ...(typeof agent.experienceEnabled === "boolean"
        ? { forceExperienceEnabled: agent.experienceEnabled === true }
        : {}),
    });
    const state = {
      bridgeReadOnly: prefs?.bridge?.readOnly === true,
      experienceEnabled: agent.experienceEnabled === true,
      memoryMasterEnabled: agent.memoryMasterEnabled !== false,
      model: agent.config?.models?.chat || null,
      thinkingLevel: prefs?.thinking_level || "auto",
    };
    return {
      systemPrompt,
      snapshot: buildFreshCompactSnapshot({ systemPrompt, state }),
    };
  }

  _writeFreshCompactIndexMeta(agent, sessionKey, patch) {
    const index = this.readIndex(agent);
    const raw = index[sessionKey];
    const entry = this._normalizeIndexEntry(raw);
    if (!entry.file) return false;
    entry.freshCompact = patch;
    index[sessionKey] = this._serializeIndexEntry(raw, entry);
    this.writeIndex(index, agent);
    return true;
  }

  listDailyFreshCompactTargets(agent, { now = new Date() } = {}) {
    const index = this.readIndex(agent);
    const bridgeDir = path.join(agent.sessionDir, "bridge");
    const targets = [];
    for (const [sessionKey, raw] of Object.entries(index)) {
      const entry = this._normalizeIndexEntry(raw);
      if (!entry.file) continue;
      const root = String(entry.file).split(/[\\/]/)[0];
      if (root !== "owner") continue;
      const sessionPath = path.join(bridgeDir, entry.file);
      if (!fs.existsSync(sessionPath)) continue;
      if (this.isSessionStreaming(sessionKey)) continue;
      const decision = shouldRunFreshCompact({ meta: entry, now });
      if (decision.run) {
        targets.push({ sessionKey, reason: decision.reason || "daily" });
      }
    }
    return targets;
  }

  /**
   * 执行外部平台消息：找到或创建持久 session，prompt 并捕获回复文本
   * @param {string} prompt - 格式化后的用户消息
   * @param {string} sessionKey - 会话标识（如 tg_dm_12345）
   * @param {object} [meta] - 元数据（name, avatarUrl, userId）
   * @param {object} [opts] - { guest: boolean, contextTag?: string, onDelta? }
   * @returns {Promise<string|null>} agent 的回复文本
   */
  async executeExternalMessage(prompt, sessionKey, meta, opts = {}) {
    try {
      let promptText = prompt;
      const isGuest = opts.guest === true;
      const agent = this._resolveAgent(opts, "executeExternalMessage");
      const mm = this._deps.getModelManager();
      const bridgeDir = path.join(agent.sessionDir, "bridge");
      const subDir = opts.guest ? "guests" : "owner";
      const sessionDir = path.join(bridgeDir, subDir);
      fs.mkdirSync(sessionDir, { recursive: true });

      // 查找已有 session（兼容旧格式字符串和新格式对象）
      const index = this.readIndex(agent);
      const raw = index[sessionKey];
      const existingFile = typeof raw === "string" ? raw : raw?.file || null;
      const existingPath = existingFile ? path.join(bridgeDir, existingFile) : null;

      let mgr;
      let reopenError = null;
      if (existingPath) {
        try {
          mgr = SessionManager.open(existingPath, sessionDir);
        } catch (err) {
          reopenError = err;
          mgr = null;
          console.warn(`[bridge-session] existing session open failed (${sessionKey}): ${err.message}; creating a new session and rebinding index`);
          debugLog()?.log("bridge-session", `open failed for ${sessionKey}: ${err.message}`);
        }
      }
      const homeCwd = this._deps.getHomeCwd(agent.id) || process.cwd();
      if (!mgr) {
        mgr = SessionManager.create(homeCwd, sessionDir);
      }

      let sessionOpts;
      const sessionPathRef = { current: null };
      // 工具 details.media 收集器（被动提取 tool_execution_end 事件）
      const toolMediaUrls = [];

      if (isGuest) {
        // guest 模式：yuan + public-ishiki + contextTag，主模型，无工具
        const yuanBase = agent.yuanPrompt;
        const pubIshiki = agent.publicIshiki;
        const parts = [yuanBase, pubIshiki, opts.contextTag].filter(Boolean);
        const guestPrompt = parts.join("\n\n");
        const tempResourceLoader = Object.create(this._deps.getResourceLoader());
        tempResourceLoader.getSystemPrompt = () => guestPrompt;
        tempResourceLoader.getSkills = () => ({ skills: [], diagnostics: [] });
        const guestResourceLoader = withVisionExtension(
          tempResourceLoader,
          () => this._deps.getVisionBridge?.(),
          () => sessionPathRef.current,
          () => this._deps.isVisionAuxiliaryEnabled?.() === true,
          (msg) => console.warn(`[bridge-session] ${msg}`),
          ({ fileId, filePath, sessionPath }) => {
            const lookupSessionPath = sessionPath || sessionPathRef.current || null;
            if (fileId) return this._deps.getSessionFile?.(fileId, { sessionPath: lookupSessionPath });
            if (filePath) return this._deps.getSessionFileByPath?.(filePath, { sessionPath: lookupSessionPath });
            return null;
          },
        );

        // 使用 agent 配置的模型，而非 defaultModel。
        // migration #5 之后 models.chat 必为 {id, provider} 对象；缺 provider 视为未配置。
        const chatRef = agent.config?.models?.chat;
        const ref = (typeof chatRef === "object" && chatRef?.id && chatRef?.provider) ? chatRef : null;
        if (!ref) {
          throw new Error(t("error.bridgeAgentNoChatModel", { name: agent.agentName }));
        }
        const chatModel = findModel(mm.availableModels, ref.id, ref.provider);
        if (!chatModel) {
          throw new Error(t("error.bridgeAgentModelNotAvailable", { name: agent.agentName, model: `${ref.provider}/${ref.id}` }));
        }

        sessionOpts = {
          model: chatModel,
          thinkingLevel: "none",
          resourceLoader: guestResourceLoader,
          tools: [],
          customTools: [],
          settingsManager: this._createSettings(chatModel),
        };
      } else {
        // owner 模式：完整 agent。抽出 _buildOwnerSessionOpts 后，compactSession 也能复用同一构造逻辑
        sessionOpts = this._buildOwnerSessionOpts(agent, mm, homeCwd, sessionPathRef);
      }

      const { session } = await createAgentSession({
        cwd: homeCwd,
        sessionManager: mgr,
        authStorage: mm.authStorage,
        modelRegistry: mm.modelRegistry,
        ...sessionOpts,
      });

      const activeSessionPath = session.sessionManager?.getSessionFile?.() || null;
      sessionPathRef.current = activeSessionPath;
      this._activeSessions.set(sessionKey, session);

      let displayAttachments = [];
      if (opts.inboundFiles?.length && !activeSessionPath) {
        throw new Error("bridge inbound files require a resolved sessionPath");
      }
      if (opts.inboundFiles?.length && activeSessionPath) {
        const materialized = await materializeBridgeInboundFiles({
          hanakoHome: this._deps.getHanakoHome?.(),
          sessionPath: activeSessionPath,
          files: opts.inboundFiles,
          registerSessionFile: this._deps.registerSessionFile,
        });
        if (materialized.imageAttachmentPaths.length) {
          promptText = addAttachedImageMarkers(promptText, materialized.imageAttachmentPaths);
          opts = {
            ...opts,
            imageAttachmentPaths: [
              ...(opts.imageAttachmentPaths || []),
              ...materialized.imageAttachmentPaths,
            ],
          };
        }
        displayAttachments = materialized.displayAttachments || [];
      }

      this._emitSessionEvent({ type: "session_status", isStreaming: true }, activeSessionPath);
      const displayMessage = {
        timestamp: Date.now(),
        ...(opts.displayMessage || {}),
        text: opts.displayMessage?.text ?? promptText,
        source: opts.displayMessage?.source || "bridge",
        bridgeSessionKey: sessionKey,
      };
      if (displayAttachments.length && !displayMessage.attachments?.length) {
        displayMessage.attachments = displayAttachments;
      }
      this._emitSessionEvent({
        type: "session_user_message",
        message: displayMessage,
      }, activeSessionPath);

      // 捕获文本输出
      let capturedText = "";
      let providerErrorMessage = null;
      const unsub = session.subscribe((event) => {
        if (event.type === "message_update") {
          const sub = event.assistantMessageEvent;
          if (sub?.type === "text_delta") {
            const delta = sub.delta || "";
            capturedText += delta;
            try { opts.onDelta?.(delta, capturedText); } catch {}
          }
        } else if (event.type === "tool_execution_end" && !event.isError) {
          toolMediaUrls.push(...collectMediaItems(event.result?.details?.media));
          const card = event.result?.details?.card;
          if (card?.description) {
            capturedText += (capturedText ? "\n\n" : "") + card.description;
          }
        }
        const messageEndError = getProviderMessageEndError(event);
        if (messageEndError) providerErrorMessage = messageEndError;
        this._emitSessionEvent(event, activeSessionPath);
      });

      try {
        const abortController = new AbortController();
        this._prePromptAbortControllers.set(sessionKey, abortController);
        ({ text: promptText, opts } = await prepareVisionInputForTextOnlyModel({
          targetModel: session.model,
          text: promptText,
          opts,
          sessionPath: activeSessionPath,
          getVisionBridge: () => this._deps.getVisionBridge?.(),
          visionPolicyTarget: {
            isVisionAuxiliaryEnabled: this._deps.isVisionAuxiliaryEnabled,
          },
          warn: (msg) => console.warn(`[bridge-session] ${msg}`),
          signal: abortController.signal,
        }));
        if (this._prePromptAbortControllers.get(sessionKey) === abortController) {
          this._prePromptAbortControllers.delete(sessionKey);
        }
        assertVideoInputSupported(session.model, opts?.videos);
        const promptOpts = buildPromptMediaOptions(opts);
        await session.prompt(promptText, promptOpts);
      } finally {
        this._prePromptAbortControllers.delete(sessionKey);
        await teardownSessionResources({
          session,
          unsub,
          label: `bridge.executeExternalMessage[${sessionKey}]`,
          warn: (msg) => console.warn(`[bridge-session] ${msg}`),
        });
        this._activeSessions.delete(sessionKey);
        this._emitSessionEvent({ type: "session_status", isStreaming: false }, activeSessionPath);
      }

      // 更新索引 + 元数据
      const sessionPath = activeSessionPath || session.sessionManager?.getSessionFile?.();
      if (sessionPath) {
        const { changed, file } = this._syncIndexEntry(index, sessionKey, raw, {
          bridgeDir,
          sessionPath,
          meta,
        });
        if (changed) {
          if (existingFile && existingFile !== file) {
            debugLog()?.log("bridge-session", `rebound ${sessionKey}: ${existingFile} -> ${file}`);
            if (reopenError) {
              console.log(`[bridge-session] ${sessionKey} 已自愈：${existingFile} -> ${file}`);
            }
          }
          this.writeIndex(index, agent);
        }
      }
      if (providerErrorMessage) {
        return { __bridgeError: true, message: providerErrorMessage };
      }

      const text = capturedText.trim() || null;
      if (toolMediaUrls.length) {
        debugLog()?.log("bridge-session", `tool media → ${toolMediaUrls.length} url(s) via details.media`);
        return { text, toolMedia: toolMediaUrls };
      }
      return text;
    } catch (err) {
      if (isAbortLikeError(err)) return null;
      console.error(`[bridge-session] external message failed (${sessionKey}):`, err.message);
      return { __bridgeError: true, message: err.message };
    }
  }

  /**
   * 向正在 streaming 的 bridge session 注入 steer 消息
   * @param {string} sessionKey
   * @param {string} text
   * @returns {boolean} 是否成功注入
   */
  steerSession(sessionKey, text) {
    const session = this._activeSessions.get(sessionKey);
    if (!session?.isStreaming) return false;
    session.steer(getSteerPrefix() + text);
    return true;
  }

  /**
   * 往指定 bridge session 追加一条 assistant 消息（不触发 LLM）。
   * createIfMissing 仅用于真实外发成功后的主动通知记录。
   *
   * @param {string} sessionKey - bridge session 标识
   * @param {string} text - 要追加的 assistant 消息文本
   * @param {object} [opts] - { agentId?: string, createIfMissing?: boolean, meta?: object }
   * @returns {boolean}
   */
  recordAssistantMessage(sessionKey, text, opts = {}) {
    const agent = this._resolveAgent(opts, "recordAssistantMessage");
    try {
      const index = this.readIndex(agent);
      const raw = index[sessionKey];
      const existingFile = typeof raw === "string" ? raw : raw?.file || null;
      const bridgeDir = path.join(agent.sessionDir, "bridge");
      const sessionDir = path.join(bridgeDir, "owner");
      fs.mkdirSync(sessionDir, { recursive: true });

      let mgr = null;
      let sessionPath = null;
      if (existingFile) {
        sessionPath = path.join(bridgeDir, existingFile);
        if (fs.existsSync(sessionPath)) {
          mgr = SessionManager.open(sessionPath, path.dirname(sessionPath));
        } else if (!opts.createIfMissing) {
          console.warn(`[bridge-session] recordAssistantMessage: session 文件不存在: ${sessionPath}`);
          return false;
        }
      } else if (!opts.createIfMissing) {
        console.warn(`[bridge-session] recordAssistantMessage: sessionKey "${sessionKey}" 不存在`);
        return false;
      }

      if (!mgr) {
        const homeCwd = this._deps.getHomeCwd(agent.id) || process.cwd();
        mgr = SessionManager.create(homeCwd, sessionDir);
        sessionPath = mgr.getSessionFile?.() || null;
        if (!sessionPath) {
          console.warn(`[bridge-session] recordAssistantMessage: new session path unavailable for "${sessionKey}"`);
          return false;
        }
      }

      mgr.appendMessage(this._buildRecordedAssistantMessage(agent, text));

      if (sessionPath) {
        const { changed } = this._syncIndexEntry(index, sessionKey, raw, {
          bridgeDir,
          sessionPath,
          meta: opts.meta || null,
        });
        if (changed) this.writeIndex(index, agent);
      }

      debugLog()?.log("bridge-session", `recorded assistant message to ${sessionKey} (${text.length} chars)`);
      return true;
    } catch (err) {
      console.error(`[bridge-session] recordAssistantMessage failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Back-compat wrapper used by slash/session ops.
   */
  injectMessage(sessionKey, text, opts = {}) {
    return this.recordAssistantMessage(sessionKey, text, { ...opts, createIfMissing: false });
  }

  _buildRecordedAssistantMessage(agent, text) {
    const mm = this._deps.getModelManager();
    const chatRef = agent.config?.models?.chat;
    const ref = (typeof chatRef === "object" && chatRef?.id && chatRef?.provider) ? chatRef : null;
    if (!ref) {
      throw new Error(t("error.bridgeAgentNoChatModel", { name: agent.agentName }));
    }
    const chatModel = findModel(mm.availableModels, ref.id, ref.provider);
    if (!chatModel) {
      throw new Error(t("error.bridgeAgentModelNotAvailable", { name: agent.agentName, model: `${ref.provider}/${ref.id}` }));
    }
    return {
      role: "assistant",
      content: [{ type: "text", text }],
      api: chatModel.api || "openai-completions",
      provider: chatModel.provider,
      model: chatModel.id,
      usage: zeroUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    };
  }

  /**
   * 构造 owner 模式 bridge session 的 createAgentSession opts。
   * 从 executeExternalMessage 的 owner 分支抽出，以便 compactSession 复用同一配置。
   *
   * 纯函数（相对于 this._deps）：不写 _activeSessions，不落盘索引。
   *
   * @param {object} agent
   * @param {import('./model-manager.js').ModelManager} mm
   * @param {string} homeCwd
   * @returns {object} sessionOpts for createAgentSession
   */
  _buildOwnerSessionOpts(agent, mm, homeCwd, sessionPathRef = { current: null }, opts = {}) {
    const prefs = this._deps.getPreferences();
    const bridgeReadOnly = prefs?.bridge?.readOnly === true;
    const bridgePermissionMode = bridgeReadOnly
      ? SESSION_PERMISSION_MODES.READ_ONLY
      : SESSION_PERMISSION_MODES.OPERATE;
    const agentToolsSnapshot = typeof agent.getToolsSnapshot === "function"
      ? agent.getToolsSnapshot({
        forceMemoryEnabled: agent.memoryMasterEnabled !== false,
        ...(typeof agent.experienceEnabled === "boolean"
          ? { forceExperienceEnabled: agent.experienceEnabled === true }
          : {}),
      })
      : agent.tools;
    const { tools: baseTools, customTools: baseCustomTools } = this._deps.buildTools(
      homeCwd, agentToolsSnapshot,
      {
        workspace: homeCwd,
        agentDir: agent.agentDir,
        getPermissionMode: () => bridgePermissionMode,
      },
    );

    // 使用 agent 配置的模型（必须是带 provider 的复合键对象）
    const ownerRef = agent.config?.models?.chat;
    const ref = (typeof ownerRef === "object" && ownerRef?.id && ownerRef?.provider) ? ownerRef : null;
    if (!ref) {
      throw new Error(t("error.bridgeAgentNoChatModel", { name: agent.agentName }));
    }
    const ownerModel = findModel(mm.availableModels, ref.id, ref.provider);
    if (!ownerModel) {
      throw new Error(t("error.bridgeAgentModelNotAvailable", { name: agent.agentName, model: `${ref.provider}/${ref.id}` }));
    }

    // 快照 prompt，隔离于其他 session 的 prompt 变更（与 SessionCoordinator.createSession 一致）。
    // 显式按 master 开关构建：bridge owner 是独立链路，不应受桌面端某个 session
    // 的 per-session 开关污染。用户在桌面关掉某个 session 的记忆，不影响这里。
    const ownerPromptSnapshot = opts.ownerPromptSnapshot || agent.buildSystemPrompt({
      cwdOverride: homeCwd,
      forceMemoryEnabled: agent.memoryMasterEnabled,
      ...(typeof agent.experienceEnabled === "boolean"
        ? { forceExperienceEnabled: agent.experienceEnabled === true }
        : {}),
    });
    const ownerResourceLoader = Object.create(this._deps.getResourceLoader(), {
      getSystemPrompt: { value: () => ownerPromptSnapshot },
    });
    const visionResourceLoader = withVisionExtension(
      ownerResourceLoader,
      () => this._deps.getVisionBridge?.(),
      () => sessionPathRef.current,
      () => this._deps.isVisionAuxiliaryEnabled?.() === true,
      (msg) => console.warn(`[bridge-session] ${msg}`),
      ({ fileId, filePath, sessionPath }) => {
        const lookupSessionPath = sessionPath || sessionPathRef.current || null;
        if (fileId) return this._deps.getSessionFile?.(fileId, { sessionPath: lookupSessionPath });
        if (filePath) return this._deps.getSessionFileByPath?.(filePath, { sessionPath: lookupSessionPath });
        return null;
      },
    );

    return {
      model: ownerModel,
      thinkingLevel: mm.resolveThinkingLevel(prefs?.thinking_level || "auto"),
      resourceLoader: visionResourceLoader,
      tools: baseTools,
      customTools: baseCustomTools,
      settingsManager: this._createSettings(ownerModel),
    };
  }

  /**
   * 对指定 bridge session 执行真正的上下文压缩。
   *
   * 流程：
   *   1. 从 index 定位 jsonl 文件
   *   2. 若当前正 streaming → 抛错（禁止并发压缩+生成）
   *   3. SessionManager.open + createAgentSession 组装临时 owner session
   *   4. 读取压缩前 token 占用 → session.compact() → 读取压缩后
   *   5. 不把临时 session 写入 _activeSessions（它不承担 LLM 生成，isStreaming 语义无关）
   *
   * 返回值为结构化对象，上层 /compact handler 负责消息文案。
   *
   * @param {string} sessionKey
   * @param {{ agentId?: string }} opts
   * @returns {Promise<{ tokensBefore: number|null, tokensAfter: number|null, contextWindow: number|null }>}
   */
  async compactSession(sessionKey, opts = {}) {
    // 1. 定位 agent
    const agent = this._resolveAgent(opts, "compactSession");

    // 2. 并发保护：正在生成回复时禁止压缩（SDK 内部冲突）
    const active = this._activeSessions.get(sessionKey);
    if (active?.isStreaming) {
      throw new Error("bridge compact: session is streaming, try again after the reply completes");
    }

    // 3. 读索引 → 拿到 jsonl 绝对路径
    const bridgeDir = path.join(agent.sessionDir, "bridge");
    const index = this.readIndex(agent);
    const raw = index[sessionKey];
    const existingFile = typeof raw === "string" ? raw : raw?.file || null;
    if (!existingFile) {
      throw new Error(`bridge compact: session "${sessionKey}" not found or has no history`);
    }
    const sessionFilePath = path.join(bridgeDir, existingFile);
    if (!fs.existsSync(sessionFilePath)) {
      throw new Error(`bridge compact: session file missing on disk: ${sessionFilePath}`);
    }

    // 4. 打开 SessionManager + 组装 owner 模式 createAgentSession opts
    const mm = this._deps.getModelManager();
    const homeCwd = this._deps.getHomeCwd(agent.id) || process.cwd();
    const sessionDir = path.dirname(sessionFilePath);
    const mgr = SessionManager.open(sessionFilePath, sessionDir);
    const freshContext = opts.fresh === true
      ? this._buildOwnerFreshCompactContext(agent, homeCwd)
      : null;
    const sessionOpts = this._buildOwnerSessionOpts(agent, mm, homeCwd, { current: sessionFilePath }, {
      ownerPromptSnapshot: freshContext?.systemPrompt,
    });

    const { session } = await createAgentSession({
      cwd: homeCwd,
      sessionManager: mgr,
      authStorage: mm.authStorage,
      modelRegistry: mm.modelRegistry,
      ...sessionOpts,
    });

    try {
      // 5. 读 usage → compact → 读 usage
      const before = session.getContextUsage?.() ?? null;
      if (session.isCompacting) {
        throw new Error("bridge compact: already compacting");
      }
      await session.compact();
      const after = session.getContextUsage?.() ?? null;

      const result = {
        tokensBefore: before?.tokens ?? null,
        tokensAfter: after?.tokens ?? null,
        contextWindow: after?.contextWindow ?? before?.contextWindow ?? null,
      };

      if (freshContext) {
        const reason = opts.reason || "manual";
        const patch = buildFreshCompactMetaPatch({
          snapshot: freshContext.snapshot,
          reason,
          now: opts.now || new Date(),
          usage: result,
        });
        this._writeFreshCompactIndexMeta(agent, sessionKey, patch);
        return { ...result, fresh: true, reason };
      }

      return result;
    } finally {
      await teardownSessionResources({
        session,
        label: `bridge.compactSession[${sessionKey}]`,
        warn: (msg) => console.warn(`[bridge-session] ${msg}`),
      });
    }
  }

  async freshCompactSession(sessionKey, opts = {}) {
    return this.compactSession(sessionKey, {
      ...opts,
      fresh: true,
      reason: opts.reason || "manual",
    });
  }

  /** 创建 bridge 专用 settings：compaction 由 SDK 默认触发（contextWindow - 16384） */
  _createSettings(_model) {
    return createDefaultSettings();
  }
}

function addAttachedImageMarkers(text, imageAttachmentPaths) {
  const promptText = text || "";
  const missing = Array.from(new Set(imageAttachmentPaths || []))
    .filter((filePath) => filePath && !promptText.includes(`[attached_image: ${filePath}]`));
  if (!missing.length) return promptText;
  const markerText = missing.map((filePath) => `[attached_image: ${filePath}]`).join("\n");
  return promptText ? `${markerText}\n${promptText}` : markerText;
}
