const CHANNEL_DESKTOP = "desktop";
const CHANNEL_BRIDGE_OWNER = "bridge_owner";
const CHANNEL_AUTO = "auto";
const CONTEXT_RECORD_WHEN_DELIVERED = "record_when_delivered";
const AUDIENCE_OWNER = "owner";

const VALID_CHANNELS = new Set([CHANNEL_DESKTOP, CHANNEL_BRIDGE_OWNER, CHANNEL_AUTO]);

export function formatNotificationText(title, body) {
  const safeTitle = typeof title === "string" ? title.trim() : "";
  const safeBody = typeof body === "string" ? body.trim() : "";
  if (safeTitle && safeBody) return `${safeTitle}\n\n${safeBody}`;
  return safeBody || safeTitle;
}

export function normalizeNotificationPayload(payload = {}) {
  const title = typeof payload.title === "string" ? payload.title : "";
  const body = typeof payload.body === "string" ? payload.body : "";
  const audience = payload.audience || AUDIENCE_OWNER;
  const contextPolicy = payload.contextPolicy || CONTEXT_RECORD_WHEN_DELIVERED;
  const { channels, invalidChannels } = normalizeChannels(payload.channels);

  return { ...payload, title, body, audience, contextPolicy, channels, invalidChannels };
}

function normalizeChannels(value) {
  const hasExplicitChannels = Array.isArray(value) || (typeof value === "string" && value);
  const raw = Array.isArray(value) ? value : hasExplicitChannels ? [value] : [CHANNEL_DESKTOP];
  const normalized = [];
  const invalidChannels = [];
  for (const item of raw) {
    const channel = typeof item === "string" ? item.trim() : "";
    if (!channel) continue;
    if (!VALID_CHANNELS.has(channel)) {
      invalidChannels.push(channel);
      continue;
    }
    if (channel === CHANNEL_AUTO) {
      if (!normalized.includes(CHANNEL_DESKTOP)) normalized.push(CHANNEL_DESKTOP);
      continue;
    }
    if (!normalized.includes(channel)) normalized.push(channel);
  }
  if (!hasExplicitChannels && normalized.length === 0) normalized.push(CHANNEL_DESKTOP);
  return { channels: normalized, invalidChannels };
}

export class NotificationService {
  /**
   * @param {object} deps
   * @param {(event: {title: string, body: string, agentId?: string|null}) => void|Promise<void>} deps.emitDesktop
   * @param {() => import('../bridge/bridge-manager.js').BridgeManager|null} deps.getBridgeManager
   */
  constructor({ emitDesktop, getBridgeManager } = {}) {
    this._emitDesktop = emitDesktop;
    this._getBridgeManager = getBridgeManager;
  }

  async notify(payload, context = {}) {
    const normalized = normalizeNotificationPayload(payload);
    const deliveries = [];

    for (const channel of normalized.invalidChannels) {
      deliveries.push({
        channel,
        status: "failed",
        error: `unsupported notification channel: ${channel}`,
      });
    }

    for (const channel of normalized.channels) {
      if (channel === CHANNEL_DESKTOP) {
        deliveries.push(await this._deliverDesktop(normalized, context));
      } else if (channel === CHANNEL_BRIDGE_OWNER) {
        deliveries.push(await this._deliverBridgeOwner(normalized, context));
      }
    }

    return {
      ok: deliveries.length > 0 && deliveries.every((d) => d.status === "sent"),
      title: normalized.title,
      body: normalized.body,
      channels: normalized.channels,
      deliveries,
    };
  }

  async _deliverDesktop(payload, context) {
    try {
      await this._emitDesktop?.({
        title: payload.title,
        body: payload.body,
        agentId: context.agentId || null,
      });
      return { channel: CHANNEL_DESKTOP, status: "sent" };
    } catch (err) {
      return { channel: CHANNEL_DESKTOP, status: "failed", error: err.message };
    }
  }

  async _deliverBridgeOwner(payload, context) {
    if (payload.audience !== AUDIENCE_OWNER) {
      return {
        channel: CHANNEL_BRIDGE_OWNER,
        status: "failed",
        error: `unsupported audience for bridge_owner: ${payload.audience}`,
      };
    }

    const manager = this._getBridgeManager?.();
    if (!manager) {
      return { channel: CHANNEL_BRIDGE_OWNER, status: "failed", error: "bridge manager unavailable" };
    }

    const text = formatNotificationText(payload.title, payload.body);
    if (!text) {
      return { channel: CHANNEL_BRIDGE_OWNER, status: "failed", error: "notification text is empty" };
    }

    try {
      const result = await manager.sendProactive(text, context.agentId || null, {
        contextPolicy: payload.contextPolicy,
      });
      if (!result) {
        return { channel: CHANNEL_BRIDGE_OWNER, status: "failed", error: "no bridge owner delivery target available" };
      }
      return {
        channel: CHANNEL_BRIDGE_OWNER,
        status: "sent",
        platform: result.platform,
        chatId: result.chatId,
        sessionKey: result.sessionKey,
        recorded: result.recorded === true,
      };
    } catch (err) {
      return { channel: CHANNEL_BRIDGE_OWNER, status: "failed", error: err.message };
    }
  }
}
