/**
 * Spark provider 兼容层
 *
 * 处理 provider:
 *   - provider === "spark"
 *   - baseUrl 包含 "spark-api-open.xf-yun.com"
 *
 * 解决的协议问题：
 *   讯飞星火 HTTP OpenAI-compatible 接口要求 messages[].content 为字符串，
 *   不接受 OpenAI 多模态数组格式 [{ type: "text", text: "..." }]。
 *   官方文档：https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html
 *
 * 删除条件：
 *   - 讯飞 HTTP 接口接受标准 OpenAI 多模态 content 数组；或 Pi SDK 在 provider 层原生处理。
 *
 * 接口契约：见 ./README.md
 */

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function matches(model) {
  if (!model || typeof model !== "object") return false;
  const provider = lower(model.provider);
  const baseUrl = lower(model.baseUrl || model.base_url);
  return provider === "spark" || baseUrl.includes("spark-api-open.xf-yun.com");
}

function contentPartToText(part) {
  if (typeof part === "string") return part;
  if (!isPlainObject(part)) return "";
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  if (typeof part.input_text === "string") return part.input_text;
  return "";
}

function normalizeMessageContent(message) {
  if (!message || typeof message !== "object") return message;
  if (typeof message.content === "string") return message;
  if (!Array.isArray(message.content)) return message;
  const content = message.content.map(contentPartToText).filter(Boolean).join("\n");
  return { ...message, content };
}

export function apply(payload) {
  if (!Array.isArray(payload?.messages)) return payload;
  let changed = false;
  const messages = payload.messages.map((message) => {
    const normalized = normalizeMessageContent(message);
    if (normalized !== message) changed = true;
    return normalized;
  });
  return changed ? { ...payload, messages } : payload;
}
