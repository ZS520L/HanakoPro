import { parseSessionKey } from "./session-key.js";

export const BRIDGE_NOTIFY_PLATFORMS = ["wechat", "feishu", "telegram", "qq"];

const PLATFORM_LABELS = {
  zh: {
    wechat: "微信",
    feishu: "飞书",
    telegram: "Telegram",
    qq: "QQ",
  },
  en: {
    wechat: "WeChat",
    feishu: "Feishu",
    telegram: "Telegram",
    qq: "QQ",
  },
};

function localeKey(locale) {
  return String(locale || "").startsWith("zh") ? "zh" : "en";
}

export function bridgePlatformLabel(platform, locale = "zh") {
  const key = localeKey(locale);
  return PLATFORM_LABELS[key][platform] || platform || null;
}

export function normalizeBridgePlatforms(value) {
  const raw = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  const bridgePlatforms = [];
  const invalidBridgePlatforms = [];
  for (const item of raw) {
    const platform = typeof item === "string" ? item.trim() : "";
    if (!platform) continue;
    if (!BRIDGE_NOTIFY_PLATFORMS.includes(platform)) {
      invalidBridgePlatforms.push(platform);
      continue;
    }
    if (!bridgePlatforms.includes(platform)) bridgePlatforms.push(platform);
  }
  return { bridgePlatforms, invalidBridgePlatforms };
}

export function buildBridgeContext(input = {}, locale = "zh") {
  const parsed = parseSessionKey(input.sessionKey || "");
  const platform = input.platform || parsed.platform;
  if (!BRIDGE_NOTIFY_PLATFORMS.includes(platform)) {
    return { isBridgeSession: false };
  }

  const chatType = input.chatType || parsed.chatType || "dm";
  const role = input.role || input.audience || (input.guest === true ? "guest" : "owner");
  const userId = input.userId || null;
  const chatId = input.chatId || parsed.chatId || null;
  const sessionKey = input.sessionKey || null;
  const agentId = input.agentId || parsed.agentId || null;
  const notificationHint = role === "owner" && chatType === "dm"
    ? {
        channels: ["bridge_owner"],
        bridgePlatforms: [platform],
        contextPolicy: "record_when_delivered",
      }
    : null;

  return {
    isBridgeSession: true,
    platform,
    platformLabel: bridgePlatformLabel(platform, locale),
    chatType,
    role,
    sessionKey,
    agentId,
    userId,
    chatId,
    notificationHint,
  };
}

export function buildBridgePromptLine(context, locale = "zh") {
  if (!context?.isBridgeSession || !context.platform) return "";
  const label = bridgePlatformLabel(context.platform, locale);
  if (!label) return "";
  if (localeKey(locale) === "zh") {
    return `当前用户正通过${label}与你对话，仅在需要理解当前平台或“这里”等指代时参考。`;
  }
  return `The user is currently talking with you through ${label}; use this only when interpreting the current platform or references like "here."`;
}

export function appendBridgePromptLine(prompt, context, locale = "zh") {
  const line = buildBridgePromptLine(context, locale);
  if (!line) return prompt || "";
  const base = prompt || "";
  if (base.includes(line)) return base;
  return `${base}\n\n${line}`;
}

export function bridgeContextIndexMeta(context, meta = {}) {
  if (!context?.isBridgeSession) return meta || null;
  return {
    ...(meta || {}),
    platform: context.platform,
    chatType: context.chatType,
    role: context.role,
    ...(context.userId ? { userId: context.userId } : {}),
    ...(context.chatId ? { chatId: context.chatId } : {}),
  };
}
