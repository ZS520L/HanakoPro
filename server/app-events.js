function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizePayload(payload, context) {
  if (payload === undefined) return {};
  if (isPlainObject(payload)) return payload;
  console.warn(`[app-events] invalid payload for ${context}; expected plain object`);
  return null;
}

function normalizeSource(source) {
  if (source === undefined) return "server";
  if (typeof source === "string" && source) return source;
  console.warn("[app-events] invalid source for app_event; expected non-empty string");
  return null;
}

export function emitAppEvent(engine, type, payload = undefined) {
  if (typeof type !== "string" || !type) return;
  const normalizedPayload = normalizePayload(payload, type);
  if (!normalizedPayload) return;

  engine.emitEvent?.({
    type: "app_event",
    event: {
      type,
      payload: normalizedPayload,
      source: "server",
    },
  }, null);
}

export function toAppEventWsMessage(event) {
  if (event?.type !== "app_event") return null;
  if (typeof event.event?.type !== "string" || !event.event.type) return null;
  const payload = normalizePayload(event.event.payload, event.event.type);
  if (!payload) return null;
  const source = normalizeSource(event.event.source);
  if (!source) return null;

  return {
    type: "app_event",
    event: {
      type: event.event.type,
      payload,
      source,
    },
  };
}
