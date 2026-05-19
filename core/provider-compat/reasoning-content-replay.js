const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function hasToolCalls(message) {
  return Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasStringReasoningContent(message) {
  return hasOwn(message, "reasoning_content") && typeof message.reasoning_content === "string";
}

function normalizeAssistantContent(content) {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (!Array.isArray(content)) return "";

  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

/**
 * 从 message.content 恢复 OpenAI 兼容 reasoning_content 原文。
 *
 * Pi SDK 在跨模型保护时会把 thinking block 降级成 text block；在 provider
 * replay 边界，首段 thinking/text 就是需要回传给供应商的思考链原文。
 *
 * @param {object|null|undefined} message
 * @returns {string}
 */
export function extractReasoningFromContent(message) {
  if (!message || typeof message !== "object") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.length === 0) return "";

  for (const block of content) {
    if (block && block.type === "thinking" && typeof block.thinking === "string") {
      return block.thinking;
    }
  }

  const first = content[0];
  if (first && first.type === "text" && typeof first.text === "string") {
    return first.text;
  }

  return "";
}

/**
 * 保证所有带 tool_calls 的 assistant message 都有真实 reasoning_content。
 *
 * @param {Array|any} messages
 * @param {{ providerLabel: string }} options
 * @returns {Array|any}
 */
export function ensureReasoningContentForToolCalls(messages, options = {}) {
  if (!Array.isArray(messages)) return messages;

  const providerLabel = options.providerLabel || "Provider";
  const missingError =
    `${providerLabel} thinking mode reasoning_content is missing for tool_calls history. `
    + `Compact this session or start a new session before continuing with ${providerLabel} thinking mode.`;

  let changed = false;
  const next = messages.map((message) => {
    if (!message || typeof message !== "object" || message.role !== "assistant") {
      return message;
    }
    if (!hasToolCalls(message)) {
      return message;
    }
    if (hasStringReasoningContent(message)) {
      return message;
    }
    const recovered = extractReasoningFromContent(message);
    if (!isNonEmptyString(recovered)) {
      throw new Error(missingError);
    }
    changed = true;
    return { ...message, reasoning_content: recovered };
  });

  return changed ? next : messages;
}

/**
 * OpenAI 兼容工具调用历史中，部分供应商要求 assistant.content 不能是 null。
 *
 * @param {Array|any} messages
 * @returns {Array|any}
 */
export function ensureAssistantContentForToolCalls(messages) {
  if (!Array.isArray(messages)) return messages;

  let changed = false;
  const next = messages.map((message) => {
    if (!message || typeof message !== "object" || message.role !== "assistant") {
      return message;
    }
    if (!hasToolCalls(message)) {
      return message;
    }

    const content = normalizeAssistantContent(message.content);
    if (message.content === content) {
      return message;
    }

    changed = true;
    return { ...message, content };
  });

  return changed ? next : messages;
}

export function stripReasoningContent(messages) {
  if (!Array.isArray(messages)) return messages;

  let changed = false;
  const next = messages.map((message) => {
    if (!message || typeof message !== "object" || !hasOwn(message, "reasoning_content")) {
      return message;
    }
    changed = true;
    const copy = { ...message };
    delete copy.reasoning_content;
    return copy;
  });
  return changed ? next : messages;
}
