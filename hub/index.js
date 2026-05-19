/**
 * Hub — 消息调度中枢
 *
 * 同进程模式：Hub 和 HanaEngine 跑在同一个 Node 进程里。
 * hub.send() 内部直接调 engine 方法，行为零变化。
 * EventBus 通过 engine.setEventBus() 注入，统一事件广播。
 *
 * 模块：
 *   EventBus      — 统一事件总线
 *   ChannelRouter  — 频道手机送达 + 调度
 *   GuestHandler   — Guest 留言机
 *   Scheduler      — Heartbeat + Cron
 */

import path from "path";
import fs from "fs";
import crypto from "crypto";
import { EventBus } from "./event-bus.js";
import { ChannelRouter } from "./channel-router.js";
import { GuestHandler } from "./guest-handler.js";
import { Scheduler } from "./scheduler.js";
import { DmRouter } from "./dm-router.js";
import { AgentPhoneActivityStore } from "../lib/conversations/agent-phone-activity.js";
import {
  extractTextContent,
  loadSessionHistoryMessages,
  isValidSessionPath,
} from "../core/message-utils.js";
import { submitDesktopSessionMessage } from "../core/desktop-session-submit.js";
import { extOfName, inferFileKind } from "../lib/file-metadata.js";

export class Hub {
  /**
   * @param {object} opts
   * @param {import('../core/engine.js').HanaEngine} opts.engine
   */
  constructor({ engine }) {
    this._engine = engine;
    this._eventBus = new EventBus();
    this._channelRouter = new ChannelRouter({ hub: this });
    this._guestHandler = new GuestHandler({ hub: this });
    this._scheduler = new Scheduler({ hub: this });
    this._dmRouter = new DmRouter({ hub: this });
    this._agentPhoneActivities = new AgentPhoneActivityStore({
      emit: (event) => this._eventBus.emit(event, null),
    });

    // 注入 Hub 回调到 Engine（单向：Hub → Engine，不再双向引用）
    engine.setHubCallbacks({
      hub: this,  // 用于 slash dispatcher setHub 注入；engine.setHubCallbacks 内部会调 dispatcher.setHub(hub)
      scheduler: this._scheduler,
      dmRouter: this._dmRouter,
      channelRouter: this._channelRouter,
      eventBus: this._eventBus,
      pauseForAgentSwitch: () => this.pauseForAgentSwitch(),
      resumeAfterAgentSwitch: () => this.resumeAfterAgentSwitch(),
      triggerChannelDelivery: (name, opts) => this._channelRouter.triggerImmediate(name, opts),
      triggerChannelTriage: (name, opts) => this._channelRouter.triggerImmediate(name, opts),
    });

    // 注入 EventBus（替代旧的 proxy hack）
    engine.setEventBus(this._eventBus);

    this._sessionHandlerCleanups = [];
    this._setupSessionHandlers();
    this._setupDmHandler();
  }

  /** @returns {import('../core/engine.js').HanaEngine} */
  get engine() { return this._engine; }

  /** @returns {EventBus} */
  get eventBus() { return this._eventBus; }

  /** @returns {ChannelRouter} */
  get channelRouter() { return this._channelRouter; }

  /** @returns {Scheduler} */
  get scheduler() { return this._scheduler; }

  /** @returns {import('../lib/bridge/bridge-manager.js').BridgeManager|null} */
  get bridgeManager() { return this._bridgeManager || null; }
  set bridgeManager(bm) { this._bridgeManager = bm; }

  get agentPhoneActivities() { return this._agentPhoneActivities; }

  // ──────────── 订阅 ────────────

  /**
   * 订阅事件（替代 engine.subscribe）
   * @param {Function} callback  (event, sessionPath) => void
   * @param {object} [filter]    可选过滤器
   * @returns {Function} unsubscribe
   */
  subscribe(callback, filter) {
    return this._eventBus.subscribe(callback, filter);
  }

  // ──────────── 消息统一入口 ────────────

  /**
   * 统一消息入口
   *
   * @param {string} text  消息文本
   * @param {object} [opts]
   * @param {string}  [opts.sessionKey]  Bridge/频道的 session 标识
   * @param {string}  [opts.role]        "owner" | "agent" | "guest"（默认 "owner"）
   * @param {boolean} [opts.ephemeral]   true = 不持久化 session（cron/heartbeat/channel）
   * @param {object}  [opts.meta]        Bridge 元数据 { name, avatarUrl, userId }
   * @param {boolean} [opts.isGroup]     是否群聊（影响 guest 上下文标签）
   * @param {string}  [opts.cwd]         工作目录覆盖
   * @param {string}  [opts.model]       模型覆盖
   * @param {string}  [opts.persist]     持久化目录（activity session）
   * @returns {Promise<*>}
   */
  async send(text, opts = {}) {
    const {
      sessionKey,
      role = "owner",
      ephemeral = false,
      meta,
      isGroup = false,
      cwd,
      model,
      persist,
      from,
      to,
      onDelta,
      images,
      imageAttachmentPaths,
      videos,
      videoAttachmentPaths,
      inboundFiles,
      sessionPath,
      agentId,
      uiContext,
      displayMessage,
    } = opts;
    const o = { sessionKey, role, ephemeral, meta, isGroup, cwd, model, persist, from, to, onDelta, images, imageAttachmentPaths, videos, videoAttachmentPaths, inboundFiles, sessionPath, agentId, uiContext, displayMessage };

    // ── 图片预处理：持久化到磁盘 + 插入 [attached_image] 标记 ──
    // 在路由之前统一处理，所有消息路径（WS / Bridge DM / Bridge Group）共享
    if (
      o.images?.length
      && this._engine.hanakoHome
      && !o.inboundFiles?.length
      && !hasDisplayImageAttachments(o.displayMessage)
    ) {
      const attachDir = path.join(this._engine.hanakoHome, "attachments");
      await fs.promises.mkdir(attachDir, { recursive: true });
      const savedPaths = [];
      for (const img of o.images) {
        const ext = (img.mimeType || "image/png").split("/")[1] || "png";
        const hash = crypto.createHash("md5").update((img.data || "").slice(0, 1024)).digest("hex").slice(0, 8);
        const filePath = path.join(attachDir, `upload-${Date.now()}-${hash}.${ext}`);
        try {
          await fs.promises.writeFile(filePath, Buffer.from(img.data, "base64"));
          savedPaths.push(filePath);
        } catch { /* best-effort; prompt still goes through */ }
      }
      if (savedPaths.length) {
        const pathNote = savedPaths.map(p => `[attached_image: ${p}]`).join("\n");
        text = `${pathNote}\n${text}`;
        o.imageAttachmentPaths = savedPaths;
      }
    }
    if (
      o.videos?.length
      && this._engine.hanakoHome
      && !o.inboundFiles?.length
      && !hasDisplayVideoAttachments(o.displayMessage)
    ) {
      const attachDir = path.join(this._engine.hanakoHome, "attachments");
      await fs.promises.mkdir(attachDir, { recursive: true });
      const savedPaths = [];
      for (const video of o.videos) {
        const ext = extensionForVideoMime(video.mimeType);
        const hash = crypto.createHash("md5").update((video.data || "").slice(0, 1024)).digest("hex").slice(0, 8);
        const filePath = path.join(attachDir, `upload-${Date.now()}-${hash}${ext}`);
        try {
          await fs.promises.writeFile(filePath, Buffer.from(video.data, "base64"));
          savedPaths.push(filePath);
        } catch { /* best-effort; prompt still goes through */ }
      }
      if (savedPaths.length) {
        const pathNote = savedPaths.map(p => `[attached_video: ${p}]`).join("\n");
        text = `${pathNote}\n${text}`;
        o.videoAttachmentPaths = savedPaths;
      }
    }

    // 路由表：按顺序匹配，第一条命中即执行。
    // 优先级通过位置保证，新增路由在此处显式插入，不依赖散落在各处的 if 顺序。
    const routes = [
      { // 桌面端 owner
        match: o => !o.sessionKey && !o.ephemeral && o.role === "owner",
        handle: () => o.sessionPath
          ? submitDesktopSessionMessage(this._engine, {
            sessionPath: o.sessionPath,
            text,
            images: o.images,
            imageAttachmentPaths: o.imageAttachmentPaths,
            videos: o.videos,
            videoAttachmentPaths: o.videoAttachmentPaths,
            inboundFiles: o.inboundFiles,
            onDelta: o.onDelta,
            uiContext: o.uiContext,
            displayMessage: o.displayMessage,
          })
          : this._engine.prompt(text, { images: o.images, videos: o.videos }),
      },
      { // Bridge guest
        match: o => o.sessionKey && o.role === "guest",
        handle: () => this._guestHandler.handle(text, o.sessionKey, o.meta, { isGroup: o.isGroup, agentId: o.agentId, onDelta: o.onDelta, images: o.images, imageAttachmentPaths: o.imageAttachmentPaths, videos: o.videos, videoAttachmentPaths: o.videoAttachmentPaths, inboundFiles: o.inboundFiles, displayMessage: o.displayMessage }),
      },
      { // Bridge owner
        match: o => o.sessionKey && !o.ephemeral,
        handle: () => this._engine.executeExternalMessage(text, o.sessionKey, o.meta, { guest: false, agentId: o.agentId, onDelta: o.onDelta, images: o.images, imageAttachmentPaths: o.imageAttachmentPaths, videos: o.videos, videoAttachmentPaths: o.videoAttachmentPaths, inboundFiles: o.inboundFiles, displayMessage: o.displayMessage }),
      },
      { // 隔离执行（cron/heartbeat/channel）
        match: o => o.ephemeral,
        handle: () => this._engine.executeIsolated(text, { cwd: o.cwd, model: o.model, persist: o.persist }),
      },
    ];

    for (const route of routes) {
      if (route.match(o)) return route.handle();
    }
    throw new Error(`[Hub] unhandled route: role=${o.role}, sessionKey=${o.sessionKey}, ephemeral=${o.ephemeral}`);
  }

  /**
   * 中断生成（支持指定 session）
   */
  async abort(sessionPath) {
    return sessionPath
      ? this._engine.abortSession(sessionPath)
      : this._engine.abort();
  }

  // ──────────── 调度器管理 ────────────

  /**
   * 初始化所有调度器（Scheduler + ChannelRouter）
   * 在 engine.init() 完成后由 server/index.js 调用
   */
  initSchedulers() {
    const engine = this._engine;

    // Scheduler（heartbeat + cron）
    this._scheduler.start();

    // ChannelRouter：仅在频道总开关为开时启动
    if (engine.isChannelsEnabled?.()) {
      this._channelRouter.start();
      this._channelRouter.setupPostHandler();
    }
  }

  /**
   * Agent 切换前暂停：停所有 heartbeat（cron 全 agent 并发，不中断），ChannelRouter 持续跑
   */
  async pauseForAgentSwitch() {
    await this._scheduler.stopHeartbeat();
  }

  /**
   * Agent 切换完成后恢复：重启所有 agent 的 heartbeat（幂等），重新注入 handler
   */
  resumeAfterAgentSwitch() {
    this._scheduler.startHeartbeat();
    this._setupDmHandler();
    this._channelRouter.setupPostHandler();
  }

  /**
   * 停止所有调度器（dispose 用）
   */
  async stopSchedulers() {
    await this._scheduler.stop();
    await this._channelRouter.stop();
  }

  // ──────────── 频道代理方法 ────────────

  triggerChannelDelivery(channelName, opts) {
    return this._channelRouter.triggerImmediate(channelName, opts);
  }

  triggerChannelTriage(channelName, opts) {
    return this.triggerChannelDelivery(channelName, opts);
  }

  async toggleChannels(enabled) {
    return this._channelRouter.toggle(enabled);
  }

  refreshChannelProactiveSchedule() {
    return this._channelRouter.refreshProactiveSchedule();
  }

  // ──────────── 生命周期 ────────────

  async dispose() {
    for (const cleanup of this._sessionHandlerCleanups) cleanup();
    this._sessionHandlerCleanups = [];
    await this.stopSchedulers();
    await this._engine.dispose();
    this._eventBus.clear();
  }

  // ──────────── 内部 ────────────

  /** @returns {DmRouter} */
  get dmRouter() { return this._dmRouter; }

  _setupSessionHandlers() {
    const bus = this._eventBus;
    const engine = this._engine;

    // ── session:send ──
    this._sessionHandlerCleanups.push(bus.handle("session:send", async ({ text, sessionPath, ...opts }) => {
      if (!text || typeof text !== "string" || !text.trim()) {
        throw new Error("text is required");
      }
      const sp = sessionPath;
      if (!sp) throw new Error("sessionPath is required for session:send");
      if (engine.isSessionStreaming(sp)) throw new Error("session_busy");
      engine.promptSession(sp, text, opts).catch(err => {
        console.error("[Hub] session:send promptSession error:", err.message);
        bus.emit({ type: "error", error: err.message, source: "session:send" }, sp);
      });
      return { sessionPath: sp, accepted: true };
    }));

    // ── session:abort ──
    this._sessionHandlerCleanups.push(bus.handle("session:abort", async ({ sessionPath } = {}) => {
      const sp = sessionPath;
      if (!sp) return { aborted: false };
      const result = await engine.abortSession(sp);
      return { aborted: !!result };
    }));

    // ── session:history ──
    this._sessionHandlerCleanups.push(bus.handle("session:history", async ({ sessionPath, limit: rawLimit } = {}) => {
      if (!sessionPath) throw new Error("sessionPath is required");
      if (!isValidSessionPath(sessionPath, engine.agentsDir)) {
        throw new Error("Invalid session path");
      }
      const limit = Math.min(Number(rawLimit) || 50, 200);
      const sourceMessages = await loadSessionHistoryMessages(engine, sessionPath);
      const messages = [];
      for (const m of sourceMessages) {
        if (m.role === "user") {
          const { text, images } = extractTextContent(m.content);
          if (text || images.length) {
            messages.push({ role: "user", content: text, images: images.length ? images : undefined });
          }
        } else if (m.role === "assistant") {
          const { text, thinking, toolUses } = extractTextContent(m.content, { stripThink: true });
          if (text || toolUses.length) {
            messages.push({
              role: "assistant",
              content: text,
              thinking: thinking || undefined,
              toolCalls: toolUses.length ? toolUses : undefined,
            });
          }
        }
        if (messages.length >= limit) break;
      }
      return { messages };
    }));

    // ── session:list ──
    this._sessionHandlerCleanups.push(bus.handle("session:list", async ({ agentId } = {}) => {
      const all = await engine.listSessions();
      const filtered = agentId ? all.filter(s => s.agentId === agentId) : all;
      const sessions = filtered.map(s => ({
        path: s.path,
        title: s.title,
        firstMessage: s.firstMessage,
        agentId: s.agentId,
        agentName: s.agentName,
        modelId: s.modelId,
        messageCount: s.messageCount,
        cwd: s.cwd,
        modified: s.modified,
      }));
      return { sessions };
    }));

    // ── agent:list ──
    this._sessionHandlerCleanups.push(bus.handle("agent:list", async () => {
      const all = engine.listAgents();
      const agents = all.map(a => ({
        id: a.id,
        name: a.name,
        isCurrent: a.isCurrent,
        isPrimary: a.isPrimary,
      }));
      return { agents };
    }));

    // ── provider & agent handlers ──

    this._sessionHandlerCleanups.push(bus.handle("provider:credentials", async ({ providerId }) => {
      const creds = engine.providerRegistry.getCredentials(providerId);
      if (!creds?.apiKey) return { error: "no_credentials" };
      return {
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        api: creds.api,
        ...(creds.accountId ? { accountId: creds.accountId } : {}),
      };
    }));

    this._sessionHandlerCleanups.push(bus.handle("provider:models-by-type", async ({ type, providerId }) => {
      if (providerId) {
        return { models: engine.providerRegistry.getModelsByType(providerId, type) };
      }
      return { models: engine.providerRegistry.getAllModelsByType(type) };
    }));

    this._sessionHandlerCleanups.push(bus.handle("provider:media-providers", async ({ capability = "image_generation" } = {}) => {
      const providers = {};
      for (const provider of engine.providerRegistry.getMediaProviders(capability)) {
        const credentialStatus = engine.providerRegistry.getMediaProviderCredentialStatus(provider.providerId, capability);
        providers[provider.providerId] = {
          ...provider,
          hasCredentials: credentialStatus.hasCredentials,
          unavailableReason: credentialStatus.unavailableReason,
          credentialLanes: credentialStatus.lanes,
          activeCredentialLaneId: credentialStatus.activeLaneId || null,
          activeCredentialProviderId: credentialStatus.activeProviderId || null,
          models: provider.models.map((model) => ({
            id: model.id,
            name: model.displayName || model.name || model.id,
            displayName: model.displayName || model.name || model.id,
            protocolId: model.protocolId,
            credentialLaneId: model.credentialLaneId,
          })),
          availableModels: [],
        };
      }
      return { providers };
    }));

    this._sessionHandlerCleanups.push(bus.handle("agent:config", async ({ agentId }) => {
      const { agent, error } = resolveAgentForBus(engine, agentId);
      if (error) return { error };
      return { config: agent.config };
    }));

    this._sessionHandlerCleanups.push(bus.handle("agent:update-config", async ({ agentId, partial }) => {
      const { agent, error } = resolveAgentForBus(engine, agentId);
      if (error) return { error };
      if (typeof engine.updateConfig !== "function") return { error: "agent_update_unavailable" };
      await engine.updateConfig(partial || {}, { agentId });
      const { agent: fresh } = resolveAgentForBus(engine, agentId);
      return { config: fresh?.config || agent.config };
    }));
  }

  _setupDmHandler() {
    const engine = this._engine;
    // 给所有 agent 注入 DM 回调
    for (const [, agent] of engine.agents || []) {
      agent.setDmSentHandler((fromId, toId) =>
        this._dmRouter.handleNewDm(fromId, toId));
    }
  }

}

function resolveAgentForBus(engine, agentId) {
  if (!agentId) return { error: "agent_id_required" };
  if (typeof engine?.getAgent !== "function") return { error: "agent_lookup_unavailable" };
  const agent = engine.getAgent(agentId);
  if (!agent) return { error: "not_found" };
  return { agent };
}

function hasDisplayImageAttachments(displayMessage) {
  const attachments = displayMessage?.attachments;
  if (!Array.isArray(attachments)) return false;
  return attachments.some((attachment) => {
    if (!attachment?.path || attachment.isDir) return false;
    return inferFileKind({
      mime: attachment.mimeType,
      ext: extOfName(attachment.name || attachment.path),
      isDirectory: false,
    }) === "image";
  });
}

function hasDisplayVideoAttachments(displayMessage) {
  const attachments = displayMessage?.attachments;
  if (!Array.isArray(attachments)) return false;
  return attachments.some((attachment) => {
    if (!attachment?.path || attachment.isDir) return false;
    return inferFileKind({
      mime: attachment.mimeType,
      ext: extOfName(attachment.name || attachment.path),
      isDirectory: false,
    }) === "video";
  });
}

function extensionForVideoMime(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized === "video/webm") return ".webm";
  if (normalized === "video/quicktime") return ".mov";
  return ".mp4";
}
