/**
 * AgentExecutor — Agent 会话执行器
 *
 * 使用 Engine 中的长驻 Agent 实例（不再创建临时 Agent），
 * 创建临时 session 执行多轮 prompt，捕获标记了 capture: true 的轮次输出。
 *
 * ChannelRouter 和 DmRouter 共用这个执行器。
 */

import fs from "fs";
import path from "path";
import { createAgentSession, SessionManager } from "../lib/pi-sdk/index.js";
import { debugLog } from "../lib/debug-log.js";
import { t } from "../server/i18n.js";
import { createDefaultSettings } from "../core/session-defaults.js";
import { SESSION_PERMISSION_MODES } from "../core/session-permission-mode.js";
import { teardownSessionResources } from "../core/session-teardown.js";
import {
  filterAgentPhoneTools,
  getAgentPhoneActiveToolNames,
  getAgentPhonePermissionMode,
  getAgentPhoneSessionDir,
  getAgentPhoneRefreshDate,
  shouldCompactAgentPhoneSession,
} from "../lib/conversations/agent-phone-session.js";
import {
  ensureAgentPhoneProjection,
  readAgentPhoneProjection,
  updateAgentPhoneProjectionMeta,
} from "../lib/conversations/agent-phone-projection.js";
import { findModel, requireModelRef } from "../shared/model-ref.js";
import {
  buildFreshCompactMetaPatch,
  buildFreshCompactSnapshot,
  shouldRunFreshCompact,
} from "../lib/fresh-compact/policy.js";

function resolveAgentPhoneModel(engine, ctx, agentConfig, modelOverride) {
  if (!modelOverride) return ctx.resolveModel(agentConfig);
  const ref = requireModelRef(modelOverride);
  const found = findModel(engine.availableModels || [], ref.id, ref.provider);
  if (!found) {
    throw new Error(`Agent phone model override not available: ${ref.provider}/${ref.id}`);
  }
  return found;
}

/**
 * 以指定 agentId 的身份跑一次临时会话。
 *
 * @param {string} agentId
 * @param {Array<{text: string, capture?: boolean}>} rounds  按序执行的 prompts
 * @param {object} opts
 * @param {import('../core/engine.js').HanaEngine} opts.engine
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.sessionSuffix="temp"]
 * @param {string} [opts.systemAppend] - 追加到 system prompt 末尾
 * @param {boolean} [opts.keepSession=false] - 是否保留 session 文件
 * @param {boolean} [opts.noMemory=false] - 不注入记忆，只用 personality
 * @param {boolean} [opts.noTools=false] - 不注入工具
 * @param {boolean} [opts.readOnly=false] - 只读执行权限（保留工具 schema，调用时拦截副作用工具）
 * @returns {Promise<string>}  capture 轮的输出（已去掉 MOOD 块）
 */
export async function runAgentSession(agentId, rounds, { engine, signal, sessionSuffix = "temp", ephemeralDir, systemAppend, keepSession = false, noMemory = false, noTools = false, readOnly = false } = {}) {
  // 1. 从长驻 Map 获取 Agent 实例
  const agent = engine.getAgent(agentId);
  if (!agent) {
    throw new Error(t("error.agentExecNotInit", { id: agentId }));
  }
  const agentDir = agent.agentDir;

  // 2. 临时 ResourceLoader
  const ctx = engine.createSessionContext();
  const tempResourceLoader = Object.create(ctx.resourceLoader);

  // noMemory 模式：只用 personality（identity + yuan + ishiki），不注入记忆/用户档案等
  const basePrompt = noMemory ? agent.personality : agent.systemPrompt;
  tempResourceLoader.getSystemPrompt = () =>
    systemAppend ? `${basePrompt}\n\n${systemAppend}` : basePrompt;
  tempResourceLoader.getSkills = () => ctx.getSkillsForAgent(agent);

  // 3. 临时 session
  const cwd = engine.getHomeCwd(agentId) || process.cwd();
  const sessionDir = ephemeralDir || path.join(agentDir, "sessions", sessionSuffix);
  fs.mkdirSync(sessionDir, { recursive: true });
  const tempSessionMgr = SessionManager.create(cwd, sessionDir);

  // 工具模式：noTools = 无工具；readOnly 只影响执行权限，不裁剪 schema。
  let tools, customTools;
  if (noTools) {
    tools = [];
    customTools = [];
  } else {
    const agentToolsSnapshot = typeof agent.getToolsSnapshot === "function"
      ? agent.getToolsSnapshot({
        forceMemoryEnabled: agent.memoryMasterEnabled !== false,
        ...(typeof agent.experienceEnabled === "boolean"
          ? { forceExperienceEnabled: agent.experienceEnabled === true }
          : {}),
      })
      : agent.tools;
    const permissionMode = readOnly
      ? SESSION_PERMISSION_MODES.READ_ONLY
      : SESSION_PERMISSION_MODES.OPERATE;
    const built = ctx.buildTools(cwd, agentToolsSnapshot, {
      agentDir,
      workspace: engine.getHomeCwd(agentId),
      getSessionPath: () => tempSessionMgr?.getSessionFile?.() || null,
      getPermissionMode: () => permissionMode,
    });
    tools = built.tools;
    customTools = built.customTools;
  }
  const model = ctx.resolveModel(agent.config);
  const { session } = await createAgentSession({
    cwd,
    sessionManager: tempSessionMgr,
    settingsManager: createDefaultSettings(),
    authStorage: ctx.authStorage,
    modelRegistry: ctx.modelRegistry,
    model,
    thinkingLevel: "medium",
    resourceLoader: tempResourceLoader,
    tools,
    customTools,
  });

  // 4. AbortSignal 连接
  let onAbort;
  if (signal) {
    onAbort = () => { try { session.abort(); } catch {} };
    signal.addEventListener("abort", onAbort, { once: true });
  }

  // 5. 文本捕获
  let capturedText = "";
  let isCapturing = false;
  const unsub = session.subscribe((event) => {
    if (!isCapturing) return;
    if (event.type === "message_update") {
      const sub = event.assistantMessageEvent;
      if (sub?.type === "text_delta") capturedText += sub.delta || "";
    }
  });

  debugLog()?.log("agent-executor", `${agentId} session started (${rounds.length} rounds)`);

  try {
    for (const round of rounds) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      isCapturing = !!round.capture;
      if (round.capture) capturedText = "";
      await session.prompt(round.text);
    }
  } finally {
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    await teardownSessionResources({
      session,
      unsub,
      label: `hub.runAgentSession[${agentId}]`,
      warn: (msg) => debugLog()?.warn("agent-executor", msg),
    });
  }

  // 6. 清理临时 session 文件（keepSession=true 时保留，供 DM 等场景存档）
  if (!keepSession) {
    const sessionPath = session.sessionManager?.getSessionFile?.();
    if (sessionPath) {
      try { fs.unlinkSync(sessionPath); } catch {}
    }
  }

  // 7. 去掉 MOOD 块（backtick 和 XML 两种格式，一次过）
  const text = capturedText
    .replace(/```(?:mood|pulse|reflect)[\s\S]*?```\n*|<(?:mood|pulse|reflect)>[\s\S]*?<\/(?:mood|pulse|reflect)>\n*/gi, "")
    .trim();

  debugLog()?.log("agent-executor", `${agentId} done, ${text.length} chars captured`);
  return text;
}

function storedRelativePath(agentDir, filePath) {
  return path.relative(agentDir, filePath).split(path.sep).join("/");
}

function resolveStoredSessionPath(agentDir, stored) {
  if (!stored || typeof stored !== "string") return null;
  const resolved = path.resolve(agentDir, ...stored.split("/").filter(Boolean));
  const base = path.resolve(agentDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null;
  return resolved;
}

async function maybeCompactPhoneSession(session, { isActive = false, onActivity } = {}) {
  const usage = session.getContextUsage?.() ?? null;
  const reason = shouldCompactAgentPhoneSession({
    tokens: usage?.tokens,
    isActive,
  });
  if (!reason) return null;
  if (session.isCompacting) return null;

  await onActivity?.(
    "compacting",
    reason === "hard" ? "正在压缩手机会话（180K 硬上限）" : "正在空闲压缩手机会话",
    {
      reason,
      tokensBefore: usage?.tokens ?? null,
      contextWindow: usage?.contextWindow ?? null,
    },
  );
  await session.compact();
  const after = session.getContextUsage?.() ?? null;
  await onActivity?.(
    "idle",
    "手机会话压缩完成",
    {
      reason,
      tokensBefore: usage?.tokens ?? null,
      tokensAfter: after?.tokens ?? null,
      contextWindow: after?.contextWindow ?? usage?.contextWindow ?? null,
    },
  );
  return { reason, before: usage, after };
}

async function maybeFreshCompactPhoneSession(session, {
  agentDir,
  agentId,
  conversationId,
  conversationType,
  projectionMeta = {},
  snapshot,
  now = new Date(),
  reason: explicitReason = null,
  onActivity,
} = {}) {
  const decision = shouldRunFreshCompact({
    meta: projectionMeta,
    snapshot,
    now,
    force: explicitReason === "manual",
  });
  if (!decision.run) return null;
  if (session.isCompacting) return null;

  const reason = explicitReason || decision.reason;
  const before = session.getContextUsage?.() ?? null;
  await onActivity?.(
    "compacting",
    reason === "daily" ? "正在按日刷新压缩手机会话" : "正在刷新压缩手机会话",
    {
      reason,
      tokensBefore: before?.tokens ?? null,
      contextWindow: before?.contextWindow ?? null,
    },
  );
  await session.compact();
  const after = session.getContextUsage?.() ?? null;
  const usage = {
    tokensBefore: before?.tokens ?? null,
    tokensAfter: after?.tokens ?? null,
    contextWindow: after?.contextWindow ?? before?.contextWindow ?? null,
  };
  const patch = buildFreshCompactMetaPatch({
    snapshot,
    reason,
    now,
    usage,
  });
  await updateAgentPhoneProjectionMeta({
    agentDir,
    agentId,
    conversationId,
    conversationType,
    patch,
  });
  await onActivity?.(
    "idle",
    "手机会话刷新压缩完成",
    {
      reason,
      ...usage,
    },
  );
  return { reason, ...usage };
}

export async function freshCompactAgentPhoneSession(agentId, {
  engine,
  conversationId,
  conversationType = "channel",
  toolMode = "read_only",
  modelOverride = null,
  now = new Date(),
  reason = "daily",
  onActivity,
} = {}) {
  if (!conversationId) throw new Error("conversationId is required for agent phone fresh compact");

  const agent = engine.getAgent(agentId);
  if (!agent) {
    throw new Error(t("error.agentExecNotInit", { id: agentId }));
  }
  const agentDir = agent.agentDir;
  const projectionPath = await ensureAgentPhoneProjection({
    agentDir,
    agentId,
    conversationId,
    conversationType,
  });
  const projection = readAgentPhoneProjection(projectionPath);
  const existingSessionPath = resolveStoredSessionPath(agentDir, projection.meta.phoneSessionFile);
  if (!existingSessionPath || !fs.existsSync(existingSessionPath)) {
    throw new Error(`agent phone fresh compact: session file missing for ${conversationId}`);
  }

  const ctx = engine.createSessionContext();
  const tempResourceLoader = Object.create(ctx.resourceLoader);
  const basePrompt = agent.systemPrompt;
  tempResourceLoader.getSystemPrompt = () => basePrompt;
  tempResourceLoader.getSkills = () => ctx.getSkillsForAgent(agent);

  const cwd = engine.getHomeCwd(agentId) || process.cwd();
  const sessionDir = getAgentPhoneSessionDir(agentDir, conversationId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionManager = SessionManager.open(existingSessionPath, sessionDir);

  const agentToolsSnapshot = typeof agent.getToolsSnapshot === "function"
    ? agent.getToolsSnapshot({
      forceMemoryEnabled: agent.memoryMasterEnabled !== false,
      ...(typeof agent.experienceEnabled === "boolean"
        ? { forceExperienceEnabled: agent.experienceEnabled === true }
        : {}),
    })
    : agent.tools;
  const phonePermissionMode = getAgentPhonePermissionMode(toolMode);
  const built = ctx.buildTools(cwd, agentToolsSnapshot, {
    agentDir,
    workspace: engine.getHomeCwd(agentId),
    getSessionPath: () => sessionManager?.getSessionFile?.() || null,
    getPermissionMode: () => phonePermissionMode,
  });
  const { tools, customTools } = filterAgentPhoneTools(built);
  const model = resolveAgentPhoneModel(engine, ctx, agent.config, modelOverride);
  const { session } = await createAgentSession({
    cwd,
    sessionManager,
    settingsManager: createDefaultSettings(),
    authStorage: ctx.authStorage,
    modelRegistry: ctx.modelRegistry,
    model,
    thinkingLevel: "medium",
    resourceLoader: tempResourceLoader,
    tools,
    customTools,
  });
  session.setActiveToolsByName?.(getAgentPhoneActiveToolNames({ tools, customTools }));

  const snapshot = buildFreshCompactSnapshot({
    systemPrompt: basePrompt,
    state: {
      conversationType,
      memoryEnabled: agent.memoryMasterEnabled !== false,
      model: modelOverride || agent.config?.models?.chat || null,
      toolMode,
    },
  });

  try {
    return await maybeFreshCompactPhoneSession(session, {
      agentDir,
      agentId,
      conversationId,
      conversationType,
      projectionMeta: projection.meta,
      snapshot,
      now,
      reason,
      onActivity,
    });
  } finally {
    await teardownSessionResources({
      session,
      label: `hub.freshCompactAgentPhoneSession[${agentId}:${conversationId}]`,
      warn: (msg) => debugLog()?.warn("agent-executor", msg),
    });
  }
}

/**
 * 以 Agent Phone 方式运行可复用会话。
 *
 * 每个 agent + conversation 复用同一个 session 文件；projection 文档记录
 * session file。该函数不删除 session 文件。
 */
export async function runAgentPhoneSession(agentId, rounds, {
  engine,
  signal,
  conversationId,
  conversationType = "channel",
  systemAppend,
  noMemory = false,
  toolMode = "read_only",
  modelOverride = null,
  onActivity,
  onSessionReady,
  emitEvents = false,
  extraCustomTools = [],
} = {}) {
  if (!conversationId) throw new Error("conversationId is required for agent phone session");

  const agent = engine.getAgent(agentId);
  if (!agent) {
    throw new Error(t("error.agentExecNotInit", { id: agentId }));
  }
  const agentDir = agent.agentDir;
  await ensureAgentPhoneProjection({
    agentDir,
    agentId,
    conversationId,
    conversationType,
  });

  const ctx = engine.createSessionContext();
  const tempResourceLoader = Object.create(ctx.resourceLoader);
  const basePrompt = noMemory ? agent.personality : agent.systemPrompt;
  tempResourceLoader.getSystemPrompt = () =>
    systemAppend ? `${basePrompt}\n\n${systemAppend}` : basePrompt;
  tempResourceLoader.getSkills = () => ctx.getSkillsForAgent(agent);

  const cwd = engine.getHomeCwd(agentId) || process.cwd();
  const sessionDir = getAgentPhoneSessionDir(agentDir, conversationId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const projectionPath = await ensureAgentPhoneProjection({
    agentDir,
    agentId,
    conversationId,
    conversationType,
  });
  const projection = readAgentPhoneProjection(projectionPath);
  const existingSessionPath = resolveStoredSessionPath(agentDir, projection.meta.phoneSessionFile);
  const refreshNow = new Date();
  const refreshDate = getAgentPhoneRefreshDate(refreshNow);
  const openedExistingSession = existingSessionPath && fs.existsSync(existingSessionPath);
  const sessionManager = openedExistingSession
    ? SessionManager.open(existingSessionPath, sessionDir)
    : SessionManager.create(cwd, sessionDir);

  const agentToolsSnapshot = typeof agent.getToolsSnapshot === "function"
    ? agent.getToolsSnapshot({
      forceMemoryEnabled: agent.memoryMasterEnabled !== false,
      ...(typeof agent.experienceEnabled === "boolean"
        ? { forceExperienceEnabled: agent.experienceEnabled === true }
        : {}),
    })
    : agent.tools;
  const phonePermissionMode = getAgentPhonePermissionMode(toolMode);
  const built = ctx.buildTools(cwd, agentToolsSnapshot, {
    agentDir,
    workspace: engine.getHomeCwd(agentId),
    getSessionPath: () => sessionManager?.getSessionFile?.() || null,
    getPermissionMode: () => phonePermissionMode,
  });
  const { tools, customTools } = filterAgentPhoneTools(built, { toolMode });
  const sessionCustomTools = [
    ...customTools,
    ...(Array.isArray(extraCustomTools) ? extraCustomTools : []),
  ];
  const model = resolveAgentPhoneModel(engine, ctx, agent.config, modelOverride);
  const { session } = await createAgentSession({
    cwd,
    sessionManager,
    settingsManager: createDefaultSettings(),
    authStorage: ctx.authStorage,
    modelRegistry: ctx.modelRegistry,
    model,
    thinkingLevel: "medium",
    resourceLoader: tempResourceLoader,
    tools,
    customTools: sessionCustomTools,
  });
  session.setActiveToolsByName?.(getAgentPhoneActiveToolNames({
    tools,
    customTools: sessionCustomTools,
  }));

  const sessionPath = session.sessionManager?.getSessionFile?.();
  if (sessionPath) {
    await updateAgentPhoneProjectionMeta({
      agentDir,
      agentId,
      conversationId,
      conversationType,
      patch: {
        phoneSessionFile: storedRelativePath(agentDir, sessionPath),
        lastRefreshedDate: refreshDate,
        toolMode,
      },
    });
    try { await onSessionReady?.(sessionPath); } catch {}
  }

  let onAbort;
  if (signal) {
    onAbort = () => { try { session.abort(); } catch {} };
    signal.addEventListener("abort", onAbort, { once: true });
  }

  let capturedText = "";
  let isCapturing = false;
  let lastLiveActivity = null;
  const recordLiveActivity = (key, state, summary, details = {}) => {
    if (!isCapturing || lastLiveActivity === key) return;
    lastLiveActivity = key;
    Promise.resolve(onActivity?.(state, summary, details)).catch(() => {});
  };
  const unsub = session.subscribe((event) => {
    if (emitEvents && sessionPath && isCapturing) {
      engine.emitEvent?.({ ...event, isolated: true }, sessionPath);
    }
    if (!isCapturing) return;
    if (event.type === "message_update") {
      const sub = event.assistantMessageEvent;
      if (sub?.type === "thinking_delta") {
        recordLiveActivity("thinking", "thinking", "正在思考");
      }
      if (sub?.type === "text_delta") {
        recordLiveActivity("composing", "replying", "正在准备回复");
      }
      if (sub?.type === "text_delta") capturedText += sub.delta || "";
    } else if (event.type === "tool_execution_start") {
      if (event.toolName === "channel_reply") {
        recordLiveActivity("channel_reply", "replying", "正在发送频道消息");
      } else if (event.toolName === "channel_pass") {
        recordLiveActivity("channel_pass", "no_reply", "正在选择本轮不发言");
      }
    }
  });

  debugLog()?.log("agent-executor", `${agentId} phone session started (${conversationType}:${conversationId}, ${rounds.length} rounds)`);

  try {
    await maybeCompactPhoneSession(session, { isActive: false, onActivity });
    for (const round of rounds) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      isCapturing = !!round.capture;
      if (round.capture) {
        capturedText = "";
        lastLiveActivity = null;
      }
      await session.prompt(round.text);
    }
    await maybeCompactPhoneSession(session, { isActive: false, onActivity });
  } finally {
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
    await teardownSessionResources({
      session,
      unsub,
      label: `hub.runAgentPhoneSession[${agentId}:${conversationId}]`,
      warn: (msg) => debugLog()?.warn("agent-executor", msg),
    });
  }

  const text = capturedText
    .replace(/```(?:mood|pulse|reflect)[\s\S]*?```\n*|<(?:mood|pulse|reflect)>[\s\S]*?<\/(?:mood|pulse|reflect)>\n*/gi, "")
    .trim();

  debugLog()?.log("agent-executor", `${agentId} phone done, ${text.length} chars captured`);
  return text;
}
