/**
 * qq-adapter.js — QQ 机器人适配器（v2 API）
 *
 * 使用 QQ 开放平台 v2 鉴权（AppID + AppSecret → access_token）。
 * 自建 WebSocket 连接接收消息，支持频道消息和 C2C 私信。
 *
 * 凭证：appID + appSecret，从 QQ 机器人开放平台获取。
 */

import WebSocket from "ws";
import { debugLog } from "../debug-log.js";
import { createMediaCapabilities } from "./media-capabilities.js";
import { QQApiError, QQ_FILE_TYPE, QQ_UPLOAD_SIZE_LIMITS, uploadQQLocalFile } from "./qq-local-upload.js";

const API_BASE = "https://api.sgroup.qq.com";
const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const MAX_MSG_SIZE = 100_000;
export const QQ_MEDIA_CAPABILITIES = createMediaCapabilities({
  platform: "qq",
  inputModes: ["local_file", "remote_url", "public_url"],
  supportedKinds: ["image", "video", "audio", "document"],
  requiresReplyContext: false,
  deliveryByKind: {
    image: "native_image",
    video: "native_video",
    audio: "native_audio",
    document: "native_file",
  },
  maxBytes: {
    local_file: {
      image: QQ_UPLOAD_SIZE_LIMITS[QQ_FILE_TYPE.IMAGE],
      video: QQ_UPLOAD_SIZE_LIMITS[QQ_FILE_TYPE.VIDEO],
      audio: QQ_UPLOAD_SIZE_LIMITS[QQ_FILE_TYPE.VOICE],
      document: QQ_UPLOAD_SIZE_LIMITS[QQ_FILE_TYPE.FILE],
    },
  },
  source: "https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/rich-media.html",
});

// WebSocket OpCode
const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

// Intents
const INTENTS = {
  PUBLIC_GUILD_MESSAGES: 1 << 30,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C: 1 << 25,
};

function qqFileTypeForMedia(url, metadata = {}) {
  const kind = metadata.kind;
  if (kind === "image") return 1;
  if (kind === "video") return 2;
  if (kind === "audio") return 3;
  if (kind === "document") return 4;

  const name = metadata.filename || (() => {
    try { return new URL(url).pathname; } catch { return url; }
  })();
  const ext = String(name || "").split(".").pop()?.toLowerCase() || "";
  const mime = String(metadata.mime || "").toLowerCase();
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return 1;
  if (mime.startsWith("video/") || ["mp4", "mov"].includes(ext)) return 2;
  if (mime.startsWith("audio/") || ["mp3", "ogg", "wav", "silk", "amr", "flac"].includes(ext)) return 3;
  return 4;
}

function qqMediaEndpoints(chatId, metadata = {}, resource) {
  const targetType = qqTargetType(metadata);
  if (targetType === "group") return [`/v2/groups/${chatId}/${resource}`];
  if (targetType === "user") return [`/v2/users/${chatId}/${resource}`];
  return [`/v2/users/${chatId}/${resource}`, `/v2/groups/${chatId}/${resource}`];
}

function qqMessageEndpoints(chatId, replyContext = {}) {
  const targetType = qqTargetType(replyContext);
  if (targetType === "group") return [{ path: `/v2/groups/${chatId}/messages`, label: "Group" }];
  if (targetType === "user") return [{ path: `/v2/users/${chatId}/messages`, label: "C2C" }];
  if (targetType === "channel") return [{ path: `/channels/${chatId}/messages`, label: "Channel", channel: true }];
  return [
    { path: `/v2/users/${chatId}/messages`, label: "C2C" },
    { path: `/v2/groups/${chatId}/messages`, label: "Group" },
    { path: `/channels/${chatId}/messages`, label: "Channel", channel: true },
  ];
}

function qqTargetType(metadata = {}) {
  const ctx = metadata.replyContext || metadata;
  if (ctx.targetType) return String(ctx.targetType);
  if (metadata.isGroup === true || ctx.isGroup === true || metadata.targetScope === "group" || ctx.targetScope === "group") return "group";
  if (metadata.isGroup === false || ctx.isGroup === false || metadata.targetScope === "dm" || ctx.targetScope === "dm") return "user";
  return null;
}

function qqMessageIdFromContext(replyContext = null) {
  if (!replyContext) return null;
  if (typeof replyContext === "string") return replyContext;
  if (replyContext.messageId) return String(replyContext.messageId);
  if (replyContext.msgId) return String(replyContext.msgId);
  if (replyContext._msgId) return String(replyContext._msgId);
  if (replyContext.replyContext) return qqMessageIdFromContext(replyContext.replyContext);
  return null;
}

function normalizeQQReplyContext(replyContext = null) {
  if (!replyContext) return {};
  if (typeof replyContext === "string") return { messageId: replyContext };
  if (typeof replyContext !== "object") return {};
  const nested = replyContext.replyContext && typeof replyContext.replyContext === "object"
    ? replyContext.replyContext
    : {};
  const messageId = qqMessageIdFromContext(replyContext);
  return {
    ...nested,
    ...replyContext,
    ...(messageId ? { messageId } : {}),
  };
}

/**
 * @param {object} opts
 * @param {string} opts.appID
 * @param {string} opts.appSecret
 * @param {(msg: object) => void} opts.onMessage
 * @param {Record<string,string>} [opts.dmGuildMap]
 * @param {(userId: string, guildId: string) => void} [opts.onDmGuildDiscovered]
 * @param {(status: string, error?: string) => void} [opts.onStatus]
 */
export function createQQAdapter({ appID, appSecret, agentId, onMessage, dmGuildMap, onDmGuildDiscovered, onStatus }) {
  let accessToken = null;
  let tokenExpiresAt = 0;
  let ws = null;
  let heartbeatTimer = null;
  let lastSeq = null;
  let sessionId = null;
  let stopped = false;
  let reconnectAttempts = 0;
  let heartbeatAckReceived = true;
  let lastConnectedAt = 0;

  const userGuildMap = new Map(Object.entries(dmGuildMap || {}));
  const passiveReplySeq = new Map();

  function nextPassiveReplySeq(messageId) {
    if (!messageId) return undefined;
    const now = Date.now();
    for (const [key, entry] of passiveReplySeq) {
      if (now - entry.ts > 10 * 60 * 1000) passiveReplySeq.delete(key);
    }
    const current = passiveReplySeq.get(messageId)?.seq || 0;
    const seq = current + 1;
    passiveReplySeq.set(messageId, { seq, ts: now });
    return seq;
  }

  function attachPassiveReplyFields(body, replyContext) {
    const messageId = qqMessageIdFromContext(replyContext);
    if (!messageId) return body;
    body.msg_id = messageId;
    body.msg_seq = nextPassiveReplySeq(messageId);
    return body;
  }

  // ── Token 管理 ──

  async function refreshToken() {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: appID, clientSecret: appSecret }),
    });
    const data = await res.json();
    if (!data.access_token) {
      throw new Error(`Failed to get access_token: ${JSON.stringify(data)}`);
    }
    accessToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in || 7200) * 1000;
    debugLog()?.log("bridge", `[qq] token 已刷新，有效期 ${data.expires_in}s`);
    return accessToken;
  }

  async function getToken() {
    // 提前 5 分钟刷新
    if (!accessToken || Date.now() > tokenExpiresAt - 5 * 60 * 1000) {
      return refreshToken();
    }
    return accessToken;
  }

  // ── API 请求 ──

  async function apiRequest(method, path, body) {
    const token = await getToken();
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `QQBot ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      let bizCode;
      let message = text;
      try {
        const parsed = JSON.parse(text);
        bizCode = parsed.code ?? parsed.err_code;
        message = parsed.message || parsed.msg || text;
      } catch {}
      throw new QQApiError(`QQ API [${path}] ${res.status}: ${String(message).slice(0, 200)}`, {
        status: res.status,
        path,
        bizCode,
      });
    }
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new QQApiError(`QQ API [${path}] returned invalid JSON: ${text.slice(0, 200)}`, {
        status: res.status,
        path,
      });
    }
  }

  // ── WebSocket ──

  async function connect() {
    if (stopped) return;
    try {
      const token = await getToken();
      const { url } = await apiRequest("GET", "/gateway");

      ws = new WebSocket(url);

      ws.on("open", () => {
        debugLog()?.log("bridge", "[qq] WebSocket 已连接");
        lastConnectedAt = Date.now();
        reconnectAttempts = 0;
      });

      ws.on("message", (raw) => {
        let payload;
        try { payload = JSON.parse(raw); } catch { return; }
        handlePayload(payload, token);
      });

      ws.on("close", (code) => {
        debugLog()?.log("bridge", `[qq] WebSocket 断开 (code: ${code})`);
        stopHeartbeat();
        if (!stopped) scheduleReconnect();
      });

      ws.on("error", (err) => {
        console.error("[qq] WebSocket error:", err.message);
        debugLog()?.error("bridge", `[qq] WebSocket error: ${err.message}`);
        onStatus?.("error", err.message);
      });
    } catch (err) {
      console.error("[qq] 连接失败:", err.message);
      onStatus?.("error", err.message);
      if (!stopped) scheduleReconnect();
    }
  }

  function handlePayload(payload, token) {
    const { op, d, s, t } = payload;
    if (s) lastSeq = s;

    switch (op) {
      case OP.HELLO:
        startHeartbeat(d.heartbeat_interval);
        // 鉴权
        if (sessionId) {
          // Resume
          wsSend({ op: OP.RESUME, d: { token: `QQBot ${token}`, session_id: sessionId, seq: lastSeq } });
        } else {
          // Identify
          wsSend({
            op: OP.IDENTIFY,
            d: {
              token: `QQBot ${token}`,
              intents: INTENTS.PUBLIC_GUILD_MESSAGES | INTENTS.GROUP_AND_C2C,
              shard: [0, 1],
            },
          });
        }
        break;

      case OP.DISPATCH:
        if (t === "READY") {
          sessionId = d.session_id;
          debugLog()?.log("bridge", `[qq] 鉴权成功，session: ${sessionId}`);
          onStatus?.("connected");
        } else if (t === "RESUMED") {
          debugLog()?.log("bridge", "[qq] 会话已恢复");
          onStatus?.("connected");
        } else {
          handleEvent(t, d);
        }
        break;

      case OP.HEARTBEAT_ACK:
        heartbeatAckReceived = true;
        break;

      case OP.RECONNECT:
        debugLog()?.log("bridge", "[qq] 收到重连指令");
        ws?.close();
        break;

      case OP.INVALID_SESSION:
        debugLog()?.log("bridge", "[qq] 会话失效，重新鉴权");
        sessionId = null;
        lastSeq = null;
        ws?.close();
        break;
    }
  }

  /** 从 QQ v2 API 事件的 data.attachments 提取统一附件 */
  function extractAttachments(data) {
    const attachments = [];
    if (data.attachments?.length) {
      for (const att of data.attachments) {
        const ct = att.content_type || "";
        const type = ct.startsWith("image/") ? "image"
          : ct.startsWith("video/") ? "video"
          : ct.startsWith("audio/") ? "audio" : "file";
        attachments.push({
          type, url: att.url, filename: att.filename,
          mimeType: ct, size: att.size,
          width: att.width, height: att.height,
        });
      }
    }
    return attachments;
  }

  function handleEvent(type, data) {
    // C2C 私信
    if (type === "C2C_MESSAGE_CREATE") {
      const text = (data.content || "").trim();
      const attachments = extractAttachments(data);
      if (!text && !attachments.length) return;
      if (text.length > MAX_MSG_SIZE) return;
      onMessage({
        platform: "qq",
        agentId,
        chatId: data.author?.user_openid || data.author?.id,
        userId: data.author?.user_openid || data.author?.id,
        sessionKey: `qq_dm_${data.author?.user_openid || data.author?.id}@${agentId}`,
        text: text.slice(0, MAX_MSG_SIZE),
        senderName: data.author?.username || "User",
        isGroup: false,
        _msgId: data.id,
        replyTargetType: "user",
        attachments: attachments.length ? attachments : undefined,
      });
    }
    // 群聊消息
    else if (type === "GROUP_AT_MESSAGE_CREATE") {
      let text = (data.content || "").replace(/<@!?\d+>/g, "").trim();
      const attachments = extractAttachments(data);
      if (!text && !attachments.length) return;
      if (text.length > MAX_MSG_SIZE) return;
      onMessage({
        platform: "qq",
        agentId,
        chatId: data.group_openid,
        userId: data.author?.member_openid || data.author?.id,
        sessionKey: `qq_group_${data.group_openid}@${agentId}`,
        text: text.slice(0, MAX_MSG_SIZE),
        senderName: data.author?.username || "User",
        isGroup: true,
        _msgId: data.id,
        replyTargetType: "group",
        attachments: attachments.length ? attachments : undefined,
      });
    }
    // 频道公域消息（兼容旧的频道机器人）
    else if (type === "AT_MESSAGE_CREATE") {
      let text = (data.content || "").replace(/<@!?\d+>/g, "").trim();
      const attachments = extractAttachments(data);
      if (!text && !attachments.length) return;
      onMessage({
        platform: "qq",
        agentId,
        chatId: data.channel_id,
        userId: data.author?.id,
        sessionKey: `qq_group_${data.channel_id}@${agentId}`,
        text: text.slice(0, MAX_MSG_SIZE),
        senderName: data.author?.username || "User",
        isGroup: true,
        _msgId: data.id,
        replyTargetType: "channel",
        attachments: attachments.length ? attachments : undefined,
      });
    }
    // 频道私信
    else if (type === "DIRECT_MESSAGE_CREATE") {
      const text = (data.content || "").trim();
      const attachments = extractAttachments(data);
      if (!text && !attachments.length) return;
      const chatId = data.guild_id;
      if (data.author?.id && chatId) {
        if (userGuildMap.get(data.author.id) !== chatId) {
          userGuildMap.set(data.author.id, chatId);
          onDmGuildDiscovered?.(data.author.id, chatId);
        }
      }
      onMessage({
        platform: "qq",
        agentId,
        chatId,
        userId: data.author?.id,
        sessionKey: `qq_dm_${data.author?.id}@${agentId}`,
        text: text.slice(0, MAX_MSG_SIZE),
        senderName: data.author?.username || "User",
        isGroup: false,
        _msgId: data.id,
        attachments: attachments.length ? attachments : undefined,
      });
    }
  }

  function wsSend(data) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  function startHeartbeat(interval) {
    stopHeartbeat();
    heartbeatAckReceived = true;
    heartbeatTimer = setInterval(() => {
      if (!heartbeatAckReceived) {
        debugLog()?.log("bridge", "[qq] 心跳超时（未收到 ACK），强制重连");
        ws?.close();
        return;
      }
      heartbeatAckReceived = false;
      wsSend({ op: OP.HEARTBEAT, d: lastSeq });
    }, interval);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    // 如果上次连接保活超过 5 分钟，说明不是启动阶段频繁失败，重置计数
    if (lastConnectedAt && Date.now() - lastConnectedAt > 5 * 60 * 1000) {
      reconnectAttempts = 0;
    }
    const delays = [1000, 2000, 5000, 10000, 30000, 60000];
    const delay = delays[Math.min(reconnectAttempts, delays.length - 1)];
    reconnectAttempts++;
    debugLog()?.log("bridge", `[qq] ${delay / 1000}s 后重连（第 ${reconnectAttempts} 次）`);
    setTimeout(() => connect(), delay);
  }

  // ── 启动 ──
  connect();

  // ── Token 定时刷新 ──
  let tokenRefreshFailures = 0;
  const tokenRefreshTimer = setInterval(async () => {
    try {
      await refreshToken();
      tokenRefreshFailures = 0;
    } catch (err) {
      tokenRefreshFailures++;
      console.error(`[qq] token 刷新失败（连续第 ${tokenRefreshFailures} 次）:`, err.message);
      debugLog()?.error("bridge", `[qq] token 刷新失败: ${err.message}`);
      if (tokenRefreshFailures >= 3) {
        onStatus?.("error", `Token 连续 ${tokenRefreshFailures} 次刷新失败`);
      }
    }
  }, 60 * 60 * 1000); // 每小时刷新

  async function sendRichMediaMessage(chatId, fileInfo, metadata = {}) {
    const msgBody = { msg_type: 7, media: { file_info: fileInfo }, content: " " };
    attachPassiveReplyFields(msgBody, metadata.replyContext || metadata);
    const messageEndpoints = qqMediaEndpoints(chatId, metadata, "messages");
    for (const endpoint of messageEndpoints) {
      try {
        await apiRequest("POST", endpoint, msgBody);
        return;
      } catch (err) {
        if (endpoint === messageEndpoints.at(-1)) {
          debugLog()?.error("bridge", `[qq] 富媒体消息发送失败: ${err.message}`);
          throw err;
        }
      }
    }
  }

  let lastBlockTs = 0;

  return {
    mediaCapabilities: QQ_MEDIA_CAPABILITIES,

    async sendReply(chatId, text, replyContext = null) {
      const context = normalizeQQReplyContext(replyContext);
      const messageEndpoints = qqMessageEndpoints(chatId, context);
      const MAX = 2000;
      for (let i = 0; i < text.length; i += MAX) {
        const chunk = text.slice(i, i + MAX);
        let lastError = null;
        const errors = [];
        for (const endpoint of messageEndpoints) {
          const body = endpoint.channel
            ? { content: chunk }
            : { content: chunk, msg_type: 0 };
          attachPassiveReplyFields(body, context);
          try {
            await apiRequest("POST", endpoint.path, body);
            lastError = null;
            break;
          } catch (err) {
            lastError = err;
            errors.push(`${endpoint.label}=${err.message}`);
          }
        }
        if (lastError) {
          debugLog()?.error("bridge", `[qq] 消息发送全部失败 chatId=${chatId}: ${errors.join(", ")}`);
          throw lastError;
        }
      }
    },

    async sendBlockReply(chatId, text, replyContext = null) {
      const now = Date.now();
      const elapsed = now - lastBlockTs;
      const delay = 800 + Math.random() * 1200;
      if (lastBlockTs && elapsed < delay) {
        await new Promise((r) => setTimeout(r, delay - elapsed));
      }
      await this.sendReply(chatId, text, replyContext);
      lastBlockTs = Date.now();
    },

    /** 发送媒体（两步上传：先上传获取 file_info，再发送富媒体消息） */
    async sendMedia(chatId, url, metadata = {}) {
      const fileType = qqFileTypeForMedia(url, metadata);
      if (metadata.isGroup === true && fileType === 4) {
        throw new Error("QQ 群聊暂不开放文件类型发送，请改用单聊或发送图片/视频/语音");
      }

      const uploadBody = { file_type: fileType, url, srv_send_msg: false };
      let fileInfo;
      // Step 1: 上传。实时 Bridge 路径会传 isGroup；手动发送等未知入口保留探测顺序。
      const uploadEndpoints = qqMediaEndpoints(chatId, metadata, "files");
      for (const endpoint of uploadEndpoints) {
        try {
          const res = await apiRequest("POST", endpoint, uploadBody);
          fileInfo = res.file_info;
          break;
        } catch (err) {
          if (endpoint === uploadEndpoints.at(-1)) {
            debugLog()?.error("bridge", `[qq] 媒体上传失败: ${err.message}`);
            throw err;
          }
        }
      }
      // Step 2: 发送富媒体消息
      await sendRichMediaMessage(chatId, fileInfo, metadata);
    },

    /** 发送已归属的本地 SessionFile：本机直接分片上传到 QQ，再发送 file_info。 */
    async sendMediaFile(chatId, filePath, metadata = {}) {
      const fileType = qqFileTypeForMedia(metadata.filename || filePath, metadata);
      if (metadata.isGroup === true && fileType === QQ_FILE_TYPE.FILE) {
        throw new Error("QQ 群聊暂不开放文件类型发送，请改用单聊或发送图片/视频/语音");
      }
      const uploadResult = await uploadQQLocalFile({ apiRequest, chatId, filePath, fileType, metadata });
      if (!uploadResult?.file_info) {
        throw new Error("QQ 本地文件上传成功但未返回 file_info");
      }
      await sendRichMediaMessage(chatId, uploadResult.file_info, metadata);
    },

    /** QQ 本地文件入口必须保留文件归属和 realpath 校验，不接受裸 buffer。 */
    async sendMediaBuffer(_chatId, _buffer, { filename } = {}) {
      const label = filename ? `：${filename}` : "";
      throw new Error(`QQ 发送本地文件需要已注册的 staged file${label}`);
    },

    stop() {
      stopped = true;
      stopHeartbeat();
      clearInterval(tokenRefreshTimer);
      if (ws) {
        try { ws.close(); } catch {}
        ws = null;
      }
    },

    async getMe() {
      return apiRequest("GET", "/users/@me");
    },

    resolveOwnerChatId(userId) {
      return userGuildMap.get(userId) || null;
    },
  };
}
