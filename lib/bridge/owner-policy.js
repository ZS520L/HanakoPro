import { parseSessionKey } from "./session-key.js";

export function getConfiguredBridgeOwner(agent, platform) {
  const owner = agent?.config?.bridge?.[platform]?.owner;
  return typeof owner === "string" && owner ? owner : null;
}

export function isBridgeOwner({ platform, chatType = "dm", userId, agent }) {
  if (!userId) return false;
  if (platform === "wechat") return chatType === "dm";

  const owner = getConfiguredBridgeOwner(agent, platform);
  return !!owner && owner === userId;
}

export function resolveBridgeOwnerUserId({ platform, agent, index }) {
  const configured = getConfiguredBridgeOwner(agent, platform);
  if (configured) return configured;
  if (platform !== "wechat") return null;
  return inferUniqueWechatOwnerFromIndex(index);
}

export function resolveBridgeOwnerDeliveryTarget({ platform, agent, index }) {
  const userId = resolveBridgeOwnerUserId({ platform, agent, index });
  if (!userId) return null;

  if (platform === "feishu") {
    return resolveFeishuDeliveryTarget(index, userId);
  }

  return { userId, chatId: userId, sessionKey: null };
}

function resolveFeishuDeliveryTarget(index, ownerId) {
  for (const [sessionKey, raw] of Object.entries(index || {})) {
    const { platform, chatType, chatId: sessionUserId } = parseSessionKey(sessionKey);
    if (platform !== "feishu" || chatType !== "dm") continue;

    const entry = typeof raw === "string" ? {} : raw || {};
    if (entry.userId !== ownerId && sessionUserId !== ownerId) continue;
    if (!entry.chatId) continue;
    return { userId: ownerId, chatId: entry.chatId, sessionKey };
  }
  return null;
}

function inferUniqueWechatOwnerFromIndex(index) {
  const ids = new Set();
  for (const [sessionKey, raw] of Object.entries(index || {})) {
    const { platform, chatType, chatId } = parseSessionKey(sessionKey);
    if (platform !== "wechat" || chatType !== "dm") continue;

    const entry = typeof raw === "string" ? {} : raw || {};
    const userId = entry.userId || chatId;
    if (userId) ids.add(userId);
  }
  return ids.size === 1 ? [...ids][0] : null;
}
