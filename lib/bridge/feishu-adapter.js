/**
 * feishu-adapter.js — 飞书 Bot WebSocket 长连接适配器
 *
 * 使用 @larksuiteoapi/node-sdk 的 WSClient 接收消息，
 * 通过 onMessage 回调将标准化消息交给 BridgeManager。
 */

import * as lark from "@larksuiteoapi/node-sdk";
import { debugLog } from "../debug-log.js";
import { downloadMedia, detectMime, formatSize, streamToBuffer } from "./media-utils.js";
import { createMediaCapabilities } from "./media-capabilities.js";
import { createStreamingCapabilities } from "./streaming-capabilities.js";

export const FEISHU_MEDIA_CAPABILITIES = createMediaCapabilities({
  platform: "feishu",
  inputModes: ["buffer", "remote_url", "public_url"],
  supportedKinds: ["image", "video", "audio", "document"],
  requiresReplyContext: false,
  deliveryByKind: {
    image: "native_image",
    video: "native_file",
    audio: "native_file",
    document: "native_file",
  },
  maxBytes: {
    buffer: {
      image: 10 * 1024 * 1024,
      video: 30 * 1024 * 1024,
      audio: 30 * 1024 * 1024,
      document: 30 * 1024 * 1024,
    },
  },
  source: ".docs/BRIDGE-MEDIA-CAPABILITIES.md#feishu",
});

export const FEISHU_STREAMING_CAPABILITIES = createStreamingCapabilities({
  platform: "feishu",
  mode: "edit_message",
  scopes: ["dm"],
  minIntervalMs: 500,
  maxChars: 150_000,
  source: "https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/update",
});

function markdownPostMessageContent(text) {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: "md", text }]],
    },
  });
}

function describeFeishuError(err) {
  const data = err?.response?.data || err?.data || err?.body || null;
  if (data && typeof data === "object") {
    const parts = [];
    if (data.code !== undefined) parts.push(`code=${data.code}`);
    if (data.msg) parts.push(`msg=${data.msg}`);
    const logId = data.error?.log_id || data.log_id;
    if (logId) parts.push(`log_id=${logId}`);
    if (parts.length) return parts.join(", ");
  }
  return err?.message || String(err);
}

function wrapFeishuError(label, err) {
  const wrapped = new Error(`飞书${label}失败：${describeFeishuError(err)}`);
  wrapped.cause = err;
  return wrapped;
}

async function callFeishu(label, fn) {
  try {
    return await fn();
  } catch (err) {
    throw wrapFeishuError(label, err);
  }
}

function assertUploadBuffer(buffer, label, maxBytes) {
  if (!buffer || typeof buffer.length !== "number") {
    throw new Error(`飞书${label}上传失败：媒体内容必须是 Buffer`);
  }
  if (buffer.length === 0) {
    throw new Error(`飞书${label}上传失败：文件大小不能为 0`);
  }
  if (Number.isFinite(maxBytes) && buffer.length > maxBytes) {
    throw new Error(`飞书${label}上传失败：文件大小 ${formatSize(buffer.length)} 超过 ${formatSize(maxBytes)} 限制`);
  }
}

function requireUploadKey(res, key, label) {
  // @larksuiteoapi/node-sdk returns the OpenAPI data object directly; the
  // nested data fallback keeps this boundary tolerant of raw HTTP responses.
  const value = res?.[key] || res?.data?.[key];
  if (typeof value === "string" && value.trim()) return value;
  throw new Error(`飞书${label}上传失败：未返回 ${key}`);
}

function feishuFileDelivery({ mime = "", filename = "" } = {}) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const lowerMime = String(mime || "").toLowerCase();
  if (ext === "mp4" || lowerMime === "video/mp4") {
    return { fileType: "mp4", msgType: "media" };
  }
  if (ext === "opus" || lowerMime === "audio/opus") {
    return { fileType: "opus", msgType: "audio" };
  }
  const fileType = { pdf: "pdf", doc: "doc", docx: "doc", xls: "xls",
    xlsx: "xls", ppt: "ppt", pptx: "ppt" }[ext] || "stream";
  return { fileType, msgType: "file" };
}

function fileMessageContent(msgType, fileKey, metadata = {}) {
  const content = { file_key: fileKey };
  if (msgType === "media") {
    const imageKey = metadata.imageKey || metadata.image_key;
    if (imageKey) content.image_key = imageKey;
  }
  return content;
}

async function bufferFromFeishuDownload(resp, label) {
  let stream;
  try {
    stream = resp?.getReadableStream ? resp.getReadableStream() : resp;
  } catch (err) {
    throw wrapFeishuError(label, err);
  }
  if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
    throw new Error(`飞书${label}失败：SDK 未返回可读流`);
  }
  try {
    return await streamToBuffer(stream);
  } catch (err) {
    throw wrapFeishuError(label, err);
  }
}

/**
 * @param {object} opts
 * @param {string} opts.appId - 飞书 App ID
 * @param {string} opts.appSecret - 飞书 App Secret
 * @param {(msg: BridgeMessage) => void} opts.onMessage
 * @param {(status: string, error?: string) => void} [opts.onStatus]
 * @returns {{ sendReply, stop }}
 */
export function createFeishuAdapter({ appId, appSecret, agentId, onMessage, onStatus }) {
  const client = new lark.Client({ appId, appSecret });

  /** 用户信息缓存 { [openId]: { name, avatarUrl } }，LRU 上限 200 */
  const userCache = new Map();
  const USER_CACHE_MAX = 200;

  async function getUserInfo(openId) {
    const cached = userCache.get(openId);
    // 只使用成功缓存（有 name 的），失败的下次重试
    if (cached?.name) {
      // LRU touch：删除后重新插入，保持 Map 尾部是最新的
      userCache.delete(openId);
      userCache.set(openId, cached);
      return cached;
    }

    try {
      const res = await client.contact.user.get({
        path: { user_id: openId },
        params: { user_id_type: "open_id" },
      });
      const user = res?.data?.user;
      // 优先 nickname（用户昵称）→ en_name → name（真名，最后 fallback）
      const displayName = user?.nickname || user?.en_name || user?.name || null;
      const avatarUrl = user?.avatar?.avatar_240 || user?.avatar?.avatar_72 || null;
      console.log("[feishu] getUserInfo succeeded (cached:", !!cached, ")");
      const info = { name: displayName, avatarUrl };
      if (info.name) {
        userCache.set(openId, info);
        // LRU 淘汰：超过上限时删除最早的条目（Map 迭代顺序 = 插入顺序）
        if (userCache.size > USER_CACHE_MAX) {
          const oldest = userCache.keys().next().value;
          userCache.delete(oldest);
        }
      }
      return info;
    } catch (err) {
      const detail = err?.response?.data || err?.data || err.message;
      console.error("[feishu] getUserInfo failed");
      return { name: null, avatarUrl: null };
    }
  }

  const eventDispatcher = new lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data) => {
      const { message, sender } = data;

      // 忽略 bot 自身消息
      if (sender.sender_type === "bot") return;

      const attachments = [];
      let text = "";

      try {
        if (message.message_type === "text") {
          text = JSON.parse(message.content).text || "";
        } else if (message.message_type === "image") {
          const { image_key } = JSON.parse(message.content);
          attachments.push({
            type: "image",
            platformRef: image_key,
            mimeType: "image/jpeg",
            _messageId: message.message_id,
          });
        } else if (message.message_type === "file") {
          const { file_key, file_name } = JSON.parse(message.content);
          attachments.push({ type: "file", platformRef: file_key, filename: file_name,
            _messageId: message.message_id });
        } else if (message.message_type === "audio") {
          const { file_key, duration } = JSON.parse(message.content);
          attachments.push({ type: "audio", platformRef: file_key,
            duration: duration ? duration / 1000 : undefined, _messageId: message.message_id });
        } else if (message.message_type === "media") {
          // 飞书 "media" = 视频
          const { file_key, file_name, duration } = JSON.parse(message.content);
          attachments.push({ type: "video", platformRef: file_key, filename: file_name,
            duration: duration ? duration / 1000 : undefined, _messageId: message.message_id });
        } else {
          return; // sticker 等暂不支持
        }
      } catch (e) {
        console.error("[feishu] Failed to parse message content:", e.message);
        return;
      }

      if (!text && !attachments.length) return;

      const MAX_MSG_SIZE = 100_000;
      if (text.length > MAX_MSG_SIZE) {
        console.warn(`[feishu] 消息过大（${text.length} chars），已截断`);
        text = text.slice(0, MAX_MSG_SIZE);
      }

      const chatId = message.chat_id;
      const openId = sender.sender_id?.open_id || "unknown";
      const userId = sender.sender_id?.user_id || openId;
      const chatType = message.chat_type; // "p2p" | "group"
      const isGroup = chatType === "group";
      const sessionKey = isGroup ? `fs_group_${chatId}@${agentId}` : `fs_dm_${openId}@${agentId}`;

      const userInfo = await getUserInfo(openId);

      onMessage({
        platform: "feishu",
        agentId,
        chatId,
        userId,
        sessionKey,
        text,
        senderName: userInfo.name,
        avatarUrl: userInfo.avatarUrl,
        isGroup,
        attachments: attachments.length ? attachments : undefined,
      });
    },
  });

  const wsClient = new lark.WSClient({
    appId,
    appSecret,
    loggerLevel: lark.LoggerLevel.warn,
  });

  // start() 调用 reConnect() 后立即 resolve，不等 WebSocket 连通。
  // SDK 内部有自动重连机制，连接成功后 wsConfig.wsInstance 会被设置。
  // 通过轮询 wsInstance 确认连接状态，避免访问不存在的私有属性。
  wsClient.start({ eventDispatcher }).then(() => {
    // 轮询检查连接状态（SDK 不暴露连接事件）
    let checks = 0;
    const maxChecks = 20; // 20 × 500ms = 10s
    const timer = setInterval(() => {
      checks++;
      const wsInstance = wsClient.wsConfig?.wsInstance;
      if (wsInstance && wsInstance.readyState === 1) {
        clearInterval(timer);
        onStatus?.("connected");
      } else if (checks >= maxChecks) {
        clearInterval(timer);
        console.error("[feishu] WSClient not connected after 10s");
        onStatus?.("error", "WebSocket connection failed");
      }
    }, 500);
  }).catch((err) => {
    console.error("[feishu] WSClient start failed:", err.message);
    debugLog()?.error("bridge", `feishu WSClient start failed: ${err.message}`);
    onStatus?.("error", err.message);
  });

  /** 每个 chatId 独立的 block streaming 发送时间（用于 humanDelay），LRU 上限 200 */
  const lastBlockTsMap = new Map();
  const BLOCK_TS_MAX = 200;

  return {
    mediaCapabilities: FEISHU_MEDIA_CAPABILITIES,
    streamingCapabilities: FEISHU_STREAMING_CAPABILITIES,

    async sendReply(chatId, text) {
      await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          msg_type: "post",
          content: markdownPostMessageContent(text),
        },
      });
    },

    /** block streaming 专用：发一条气泡，两条之间加 humanDelay */
    async sendBlockReply(chatId, text) {
      const now = Date.now();
      const lastTs = lastBlockTsMap.get(chatId) || 0;
      const elapsed = now - lastTs;
      const delay = 800 + Math.random() * 1200; // 800~2000ms
      if (lastTs && elapsed < delay) {
        await new Promise(r => setTimeout(r, delay - elapsed));
      }
      await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          msg_type: "post",
          content: markdownPostMessageContent(text),
        },
      });
      // LRU: delete + set 确保活跃的 chatId 移到尾部（Map.set 对已有 key 不改变顺序）
      lastBlockTsMap.delete(chatId);
      lastBlockTsMap.set(chatId, Date.now());
      if (lastBlockTsMap.size > BLOCK_TS_MAX) {
        lastBlockTsMap.delete(lastBlockTsMap.keys().next().value);
      }
    },

    async startStreamReply(chatId, text) {
      const res = await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: chatId,
          msg_type: "post",
          content: markdownPostMessageContent(text),
        },
      });
      const messageId = res?.data?.message_id;
      if (!messageId) throw new Error("Feishu stream message create returned no message_id");
      return { messageId };
    },

    async updateStreamReply(_chatId, state, text) {
      if (!state?.messageId) throw new Error("Feishu stream update requires messageId");
      await client.im.message.update({
        path: { message_id: state.messageId },
        data: {
          msg_type: "post",
          content: markdownPostMessageContent(text),
        },
      });
    },

    async finishStreamReply(chatId, state, text) {
      await this.updateStreamReply(chatId, state, text);
    },

    /** 下载飞书图片（通过 image_key） */
    async downloadImage(imageKey, messageId) {
      // 用户发来的图片需要通过消息资源接口下载；image.get 只适用于机器人自己上传的图片。
      const resp = messageId
        ? await callFeishu("图片下载", () => client.im.messageResource.get({
          path: { message_id: messageId, file_key: imageKey },
          params: { type: "image" },
        }))
        : await callFeishu("图片下载", () => client.im.image.get({ path: { image_key: imageKey } }));
      return bufferFromFeishuDownload(resp, "图片下载");
    },

    /** 下载飞书文件/音频/视频（通过 message_id + file_key） */
    async downloadFile(messageId, fileKey) {
      const resp = await callFeishu("文件下载", () => client.im.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type: "file" },
      }));
      return bufferFromFeishuDownload(resp, "文件下载");
    },

    /** 发送媒体（图片走 image API，其他走 file API） */
    async sendMedia(chatId, url, metadata = {}) {
      const buffer = await downloadMedia(url);
      const filename = metadata.filename || (() => { try { return new URL(url).pathname.split("/").pop() || "file"; } catch { return "file"; } })();
      const mime = metadata.mime || detectMime(buffer, "application/octet-stream", filename);
      await this.sendMediaBuffer(chatId, buffer, { ...metadata, mime, filename });
    },

    /** 发送本地 staged file 内容：MediaDeliveryService 负责归属校验和读入 Buffer。 */
    async sendMediaBuffer(chatId, buffer, metadata = {}) {
      const filename = metadata.filename || "file";
      const mime = metadata.mime || detectMime(buffer, "application/octet-stream", filename);
      if (mime.startsWith("image/")) {
        assertUploadBuffer(buffer, "图片", FEISHU_MEDIA_CAPABILITIES.maxBytes.buffer.image);
        const res = await callFeishu("图片上传", () => client.im.image.create({
          data: { image_type: "message", image: buffer },
        }));
        const imageKey = requireUploadKey(res, "image_key", "图片");
        await callFeishu("消息发送", () => client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId, msg_type: "image",
            content: JSON.stringify({ image_key: imageKey }),
          },
        }));
      } else {
        assertUploadBuffer(buffer, "文件", FEISHU_MEDIA_CAPABILITIES.maxBytes.buffer.document);
        const { fileType, msgType } = feishuFileDelivery({ mime, filename });
        const res = await callFeishu("文件上传", () => client.im.file.create({
          data: { file_type: fileType, file_name: filename, file: buffer },
        }));
        const fileKey = requireUploadKey(res, "file_key", "文件");
        await callFeishu("消息发送", () => client.im.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            msg_type: msgType,
            content: JSON.stringify(fileMessageContent(msgType, fileKey, metadata)),
          },
        }));
      }
    },

    stop() {
      try { wsClient.close(); } catch {}
    },
  };
}
