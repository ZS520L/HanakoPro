/**
 * Anthropic Messages prompt-cache compatibility layer.
 *
 * Chat requests normally get cache_control from Pi SDK before this layer runs.
 * Utility requests are direct HTTP calls, so this module makes the same marker
 * contract available through normalizeProviderPayload.
 */

const CACHE_CONTROL = { type: "ephemeral" };

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function hasCacheControl(block) {
  return Boolean(block && typeof block === "object" && block.cache_control);
}

function shouldCacheContentBlock(block) {
  return block && typeof block === "object"
    && (block.type === "text" || block.type === "image" || block.type === "tool_result");
}

function withCacheControl(block) {
  if (!shouldCacheContentBlock(block) || hasCacheControl(block)) return block;
  return { ...block, cache_control: { ...CACHE_CONTROL } };
}

function normalizeSystem(system) {
  if (typeof system === "string") {
    return {
      value: [{ type: "text", text: system, cache_control: { ...CACHE_CONTROL } }],
      changed: true,
    };
  }

  if (!Array.isArray(system)) {
    return { value: system, changed: false };
  }

  let lastIndex = -1;
  for (let i = system.length - 1; i >= 0; i--) {
    if (system[i]?.type === "text") {
      lastIndex = i;
      break;
    }
  }
  if (lastIndex < 0 || hasCacheControl(system[lastIndex])) {
    return { value: system, changed: false };
  }

  const next = system.slice();
  next[lastIndex] = withCacheControl(system[lastIndex]);
  return { value: next, changed: true };
}

function normalizeLastUserMessage(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { value: messages, changed: false };
  }

  const lastIndex = messages.length - 1;
  const lastMessage = messages[lastIndex];
  if (!lastMessage || lastMessage.role !== "user") {
    return { value: messages, changed: false };
  }

  if (typeof lastMessage.content === "string") {
    if (lastMessage.content.trim().length === 0) {
      return { value: messages, changed: false };
    }
    const next = messages.slice();
    next[lastIndex] = {
      ...lastMessage,
      content: [{
        type: "text",
        text: lastMessage.content,
        cache_control: { ...CACHE_CONTROL },
      }],
    };
    return { value: next, changed: true };
  }

  if (!Array.isArray(lastMessage.content) || lastMessage.content.length === 0) {
    return { value: messages, changed: false };
  }

  const blockIndex = lastMessage.content.length - 1;
  const lastBlock = lastMessage.content[blockIndex];
  if (!shouldCacheContentBlock(lastBlock) || hasCacheControl(lastBlock)) {
    return { value: messages, changed: false };
  }

  const nextContent = lastMessage.content.slice();
  nextContent[blockIndex] = withCacheControl(lastBlock);
  const next = messages.slice();
  next[lastIndex] = { ...lastMessage, content: nextContent };
  return { value: next, changed: true };
}

export function matches(model) {
  if (!model || typeof model !== "object") return false;
  if (lower(model.api) !== "anthropic-messages") return false;
  if (lower(model.provider) === "anthropic") return true;
  if (lower(model.id).startsWith("claude-")) return true;
  return model.compat?.cacheControlFormat === "anthropic";
}

export function apply(payload) {
  let result = payload;

  if (Object.prototype.hasOwnProperty.call(payload, "system")) {
    const system = normalizeSystem(payload.system);
    if (system.changed) result = { ...result, system: system.value };
  }

  const messages = normalizeLastUserMessage(result.messages);
  if (messages.changed) result = { ...result, messages: messages.value };

  return result;
}
