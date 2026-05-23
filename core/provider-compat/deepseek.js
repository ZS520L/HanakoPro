/**
 * DeepSeek provider 兼容层
 *
 * 处理 provider:
 *   - provider === "deepseek"
 *   - baseUrl 包含 "api.deepseek.com"
 *
 * 解决的协议问题：
 *   1. 思考模式开启字段：thinking: {type: "enabled" | "disabled"}
 *   2. reasoning_effort 归一化：low/medium → high；xhigh → max
 *      Anthropic 格式下对应 output_config.effort
 *   3. max_tokens 抬升：思考模式下需 ≥ 32768
 *   4. utility mode 主动关思考（短输出场景思考链既无意义又耗光预算）
 *   5. 工具调用轮次必须回传真实 reasoning_content（issue #468 根因；缺失时 fail closed，不伪造空占位）
 *      官方文档：https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
 *
 * 删除条件：
 *   - DeepSeek 不再要求回传 reasoning_content（协议变更）
 *   - 或 pi-ai 直接以 reasoning_content 字段处理 DeepSeek 思考链
 *     （不再借用 thinkingSignature 字段当协议字段名路标）
 *   - 或 hana 不再支持 DeepSeek
 *
 * 接口契约：见 ./README.md
 */

import { getReasoningProfile } from "../../shared/model-capabilities.js";
import {
  ensureAssistantContentForToolCalls,
  ensureReasoningContentForToolCalls as ensureReasoningContentForToolCallsBase,
  extractReasoningFromContent,
  stripReasoningContent,
} from "./reasoning-content-replay.js";

export { ensureAssistantContentForToolCalls, extractReasoningFromContent };

const DEEPSEEK_HIGH_THINKING_BUDGET = 32768;
const DEEPSEEK_HIGH_SAFE_MAX_TOKENS = 65536;
const DEEPSEEK_MAX_SAFE_MAX_TOKENS = 131072;

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const SUPPORTED_STRICT_SCHEMA_TYPES = new Set(["object", "string", "number", "integer", "boolean", "array"]);
const UNSUPPORTED_STRICT_SCHEMA_KEYS = ["minLength", "maxLength", "minItems", "maxItems", "nullable"];
const MISSING_ANTHROPIC_TOOL_THINKING_ERROR =
  "DeepSeek Anthropic thinking mode history is missing non-empty thinking content for a tool call. "
  + "Compact this session or start a new session before continuing with DeepSeek Anthropic thinking mode.";

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function positiveInteger(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export function matches(model) {
  if (!model || typeof model !== "object") return false;
  const provider = lower(model.provider);
  // base_url: 兼容上游 SDK 偶发的 snake_case 别名（pi-ai SDK / 用户自定 model 配置）
  const baseUrl = lower(model.baseUrl || model.base_url);
  return provider === "deepseek" || baseUrl.includes("api.deepseek.com");
}

function isKnownThinkingModelId(id) {
  const normalized = lower(id);
  return normalized === "deepseek-reasoner" || normalized.startsWith("deepseek-v4-");
}

function isDeepSeekV4ModelId(id) {
  const normalized = lower(id);
  return normalized === "deepseek-v4"
    || normalized.startsWith("deepseek-v4-")
    || normalized.startsWith("deepseek-v4.");
}

function isDeepSeekAnthropicProfile(model) {
  if (getReasoningProfile(model) === "deepseek-v4-anthropic") return true;
  return lower(model?.api) === "anthropic-messages" && isDeepSeekV4ModelId(model?.id);
}

function isThinkingOff(level) {
  return level === "off" || level === "none" || level === "disabled";
}

function reasoningEffortForLevel(level) {
  if (!level) return null;
  if (level === "xhigh" || level === "max") return "max";
  if (level === "minimal" || level === "low" || level === "medium" || level === "high") return "high";
  return null;
}

function applyRequestedReasoningLevel(payload, level) {
  const effort = reasoningEffortForLevel(level);
  if (effort) payload.reasoning_effort = effort;
}

function enableThinking(payload) {
  payload.thinking = { type: "enabled" };
}

function normalizeAnthropicThinking(thinking) {
  if (!thinking || typeof thinking !== "object" || Array.isArray(thinking)) {
    return { type: "enabled" };
  }
  const next = { type: "enabled" };
  if (positiveInteger(thinking.budget_tokens)) {
    next.budget_tokens = positiveInteger(thinking.budget_tokens);
  }
  return next;
}

function shouldUseThinking(payload, model, reasoningLevel) {
  if (payload.thinking?.type === "disabled") return false;
  if (isThinkingOff(reasoningLevel)) return false;
  const knownThinkingModel = model?.reasoning === true || isKnownThinkingModelId(model?.id || payload.model);
  return Boolean(
    payload.reasoning_effort
    || (knownThinkingModel && reasoningEffortForLevel(reasoningLevel))
    || knownThinkingModel
  );
}

function normalizeReasoningEffort(payload) {
  if (!hasOwn(payload, "reasoning_effort")) return;
  if (payload.reasoning_effort === "low" || payload.reasoning_effort === "medium") {
    payload.reasoning_effort = "high";
  } else if (payload.reasoning_effort === "xhigh") {
    payload.reasoning_effort = "max";
  }
}

function disableThinking(payload) {
  delete payload.reasoning_effort;
  payload.thinking = { type: "disabled" };
  if (Array.isArray(payload.messages)) {
    const stripped = stripReasoningContent(payload.messages);
    if (stripped !== payload.messages) payload.messages = stripped;
  }
}

function disableAnthropicThinking(payload) {
  delete payload.reasoning_effort;
  delete payload.output_config;
  payload.thinking = { type: "disabled" };
}

function useBetaStrictTools(model) {
  return model?.compat?.deepseekBetaStrictTools === true
    || model?.deepseekBetaStrictTools === true
    || model?.deepseek_beta_strict_tools === true;
}

function inferStrictSchemaType(value) {
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" && Number.isFinite(value)) return Number.isInteger(value) ? "integer" : "number";
  if (Array.isArray(value)) return "array";
  if (isPlainObject(value)) return "object";
  return "";
}

function normalizeStrictSchemaType(type) {
  if (typeof type === "string") return SUPPORTED_STRICT_SCHEMA_TYPES.has(type) ? type : "";
  if (!Array.isArray(type)) return "";
  const normalized = type.find((item) => typeof item === "string" && SUPPORTED_STRICT_SCHEMA_TYPES.has(item));
  return normalized || "";
}

function normalizeStrictRef(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/^#\/\$defs\//, "#/$def/")
    .replace(/^#\/definitions\//, "#/$def/");
}

function normalizeStrictSchema(schema, seen = new WeakSet()) {
  if (!isPlainObject(schema)) return schema;
  if (seen.has(schema)) return schema;
  seen.add(schema);

  let next = schema;
  const editable = () => {
    if (next === schema) next = { ...schema };
    return next;
  };

  for (const key of UNSUPPORTED_STRICT_SCHEMA_KEYS) {
    if (hasOwn(schema, key)) delete editable()[key];
  }

  const normalizedType = normalizeStrictSchemaType(schema.type);
  if (normalizedType && normalizedType !== schema.type) {
    editable().type = normalizedType;
  } else if (hasOwn(schema, "type") && !normalizedType) {
    delete editable().type;
  }
  const normalizedRef = normalizeStrictRef(schema.$ref);
  if (normalizedRef !== schema.$ref) editable().$ref = normalizedRef;

  if (isPlainObject(schema.properties)) {
    const properties = {};
    let changed = false;
    for (const [key, value] of Object.entries(schema.properties)) {
      const normalized = normalizeStrictSchema(value, seen);
      properties[key] = normalized;
      if (normalized !== value) changed = true;
    }
    if (changed) editable().properties = properties;
  }

  if (isPlainObject(schema.items)) {
    const items = normalizeStrictSchema(schema.items, seen);
    if (items !== schema.items) editable().items = items;
  } else if (Array.isArray(schema.items)) {
    const items = schema.items.map((item) => normalizeStrictSchema(item, seen));
    const target = editable();
    target.items = items.length === 1 ? items[0] : { anyOf: items };
  }

  if (Array.isArray(schema.anyOf)) {
    const values = schema.anyOf.map((item) => normalizeStrictSchema(item, seen));
    if (values.some((item, index) => item !== schema.anyOf[index])) editable().anyOf = values;
  }

  for (const key of ["oneOf", "allOf"]) {
    if (!Array.isArray(schema[key])) continue;
    const values = schema[key].map((item) => normalizeStrictSchema(item, seen));
    const target = editable();
    target.anyOf = Array.isArray(target.anyOf) ? [...target.anyOf, ...values] : values;
    delete target[key];
  }

  let mergedDefs = null;
  let defsChanged = false;
  for (const key of ["$def", "$defs", "definitions"]) {
    if (!isPlainObject(schema[key])) continue;
    if (!mergedDefs) mergedDefs = {};
    for (const [name, value] of Object.entries(schema[key])) {
      const normalized = normalizeStrictSchema(value, seen);
      mergedDefs[name] = normalized;
      if (normalized !== value || key !== "$def") defsChanged = true;
    }
  }
  if (mergedDefs) {
    const target = editable();
    if (defsChanged || target.$def !== mergedDefs) target.$def = mergedDefs;
    delete target.$defs;
    delete target.definitions;
  }

  const candidate = next;
  if (candidate.type === "object" || isPlainObject(candidate.properties)) {
    if (candidate.type !== "object") editable().type = "object";
    const properties = isPlainObject(candidate.properties) ? candidate.properties : {};
    const required = Object.keys(properties);
    const hasRequired = Array.isArray(candidate.required)
      && candidate.required.length === required.length
      && required.every((key) => candidate.required.includes(key));
    if (!hasRequired) editable().required = required;
    if (candidate.additionalProperties !== false) editable().additionalProperties = false;
  }
  if (!candidate.type && Array.isArray(candidate.enum) && candidate.enum.length > 0) {
    const inferred = inferStrictSchemaType(candidate.enum[0]);
    if (inferred && candidate.enum.every((value) => inferStrictSchemaType(value) === inferred)) {
      editable().type = inferred;
    }
  }
  if (!candidate.type && hasOwn(candidate, "const")) {
    const inferred = inferStrictSchemaType(candidate.const);
    if (inferred) editable().type = inferred;
  }

  return next;
}

function withStrictToolDefinition(tool) {
  if (!isPlainObject(tool) || tool.type !== "function" || !isPlainObject(tool.function)) {
    return tool;
  }
  const fn = tool.function;
  const parameters = normalizeStrictSchema(isPlainObject(fn.parameters) ? fn.parameters : { type: "object", properties: {} });
  if (fn.strict === true && parameters === fn.parameters) return tool;
  return {
    ...tool,
    function: {
      ...fn,
      ...(parameters ? { parameters } : {}),
      strict: true,
    },
  };
}

function applyBetaStrictTools(payload, model) {
  if (!useBetaStrictTools(model) || !Array.isArray(payload.tools) || payload.tools.length === 0) {
    return payload;
  }
  const tools = payload.tools.map(withStrictToolDefinition);
  if (tools.every((tool, index) => tool === payload.tools[index])) return payload;
  return { ...payload, tools };
}

function normalizeMaxTokenField(payload) {
  if (!hasOwn(payload, "max_completion_tokens")) return;
  if (!hasOwn(payload, "max_tokens")) {
    payload.max_tokens = payload.max_completion_tokens;
  }
  delete payload.max_completion_tokens;
}

function ensureThinkingTokenBudget(payload, model) {
  const current = positiveInteger(payload.max_tokens);
  if (current && current > DEEPSEEK_HIGH_THINKING_BUDGET) return;

  const modelLimit = positiveInteger(model?.maxTokens || model?.maxOutput);
  const desired = payload.reasoning_effort === "max"
    ? DEEPSEEK_MAX_SAFE_MAX_TOKENS
    : DEEPSEEK_HIGH_SAFE_MAX_TOKENS;
  const target = modelLimit ? Math.min(modelLimit, desired) : desired;

  if (target <= DEEPSEEK_HIGH_THINKING_BUDGET) {
    disableThinking(payload);
    return;
  }

  payload.max_tokens = target;
}

/**
 * 恢复/校验：保证所有「带 tool_calls 的 assistant message」都有真实 reasoning_content 字段。
 *
 * 三档策略：
 *   档 1：已有 string reasoning_content（包括合法空字符串）→ 不动
 *   档 2：无 reasoning_content 但能从 message.content 恢复原文 → 注入恢复值
 *   档 3：原文也找不到 → 抛错，阻止远端 400（禁止把缺字段伪造成空字符串）
 *
 * 这条恢复/校验覆盖以下漏字段路径：
 *   - 跨 V4 子版本切换：pi-ai transform-messages 把 thinking block 降级 text
 *   - 空思考被过滤：openai-completions nonEmptyThinkingBlocks filter 掉空内容后补了空字符串
 *   - compaction / 跨 session 续接边界：原文确实丢失（此时本函数 fail closed）
 *
 * 不可变契约：未修改时返回原数组；修改时返回新数组（仅修改的 message 浅拷贝）。
 *
 * @param {Array|any} messages payload.messages
 * @returns {Array|any} 原数组或新数组
 */
export function ensureReasoningContentForToolCalls(messages) {
  return ensureReasoningContentForToolCallsBase(messages, { providerLabel: "DeepSeek" });
}

function hasAgentToolCall(content) {
  return Array.isArray(content) && content.some((block) => {
    if (!block || typeof block !== "object") return false;
    return block.type === "toolCall" || block.type === "tool_use" || block.type === "function_call";
  });
}

function hasNonEmptyThinking(content) {
  return Array.isArray(content) && content.some((block) => {
    return block
      && block.type === "thinking"
      && typeof block.thinking === "string"
      && block.thinking.trim().length > 0;
  });
}

export function normalizeContextMessages(messages, model, options = {}) {
  if (!Array.isArray(messages)) return messages;
  if (!isDeepSeekAnthropicProfile(model)) return messages;
  if (options.mode === "utility" || isThinkingOff(options.reasoningLevel)) return messages;

  for (const message of messages) {
    if (!message || typeof message !== "object" || message.role !== "assistant") continue;
    const content = message.content;
    if (!hasAgentToolCall(content)) continue;
    if (!hasNonEmptyThinking(content)) {
      throw new Error(MISSING_ANTHROPIC_TOOL_THINKING_ERROR);
    }
  }

  return messages;
}

function applyAnthropicPayload(payload, model, options = {}) {
  const mode = options.mode || "chat";
  const reasoningLevel = options.reasoningLevel;

  let next = payload;
  const editable = () => {
    if (next === payload) next = { ...payload };
    return next;
  };

  if (isThinkingOff(reasoningLevel) || next.thinking?.type === "disabled") {
    disableAnthropicThinking(editable());
    return next;
  }

  if (!shouldUseThinking(next, model, reasoningLevel)) return next;

  if (mode === "utility") {
    disableAnthropicThinking(editable());
    return next;
  }

  const p = editable();
  delete p.reasoning_effort;
  p.thinking = normalizeAnthropicThinking(p.thinking);

  const effort = reasoningEffortForLevel(reasoningLevel);
  if (effort) {
    p.output_config = { effort };
  } else {
    delete p.output_config;
  }

  return next;
}

function stripToolChoice(payload) {
  if (!hasOwn(payload, "tool_choice")) return payload;
  const next = { ...payload };
  delete next.tool_choice;
  return next;
}

export function apply(payload, model, options = {}) {
  if (!Array.isArray(payload.messages)) return payload;
  if (isDeepSeekAnthropicProfile(model)) {
    return applyAnthropicPayload(payload, model, options);
  }
  const mode = options.mode || "chat";
  const reasoningLevel = options.reasoningLevel;

  let next = payload;
  const editable = () => {
    if (next === payload) next = { ...payload };
    return next;
  };

  next = applyBetaStrictTools(next, model);

  if (hasOwn(payload, "max_completion_tokens")) {
    normalizeMaxTokenField(editable());
  }

  if (isThinkingOff(reasoningLevel) || next.thinking?.type === "disabled") {
    disableThinking(editable());
    return next;
  }

  if (!shouldUseThinking(next, model, reasoningLevel)) return next;

  if (mode === "utility") {
    disableThinking(editable());
    return next;
  }

  const p = editable();
  applyRequestedReasoningLevel(p, reasoningLevel);
  normalizeReasoningEffort(p);
  enableThinking(p);
  ensureThinkingTokenBudget(p, model);
  if (p.thinking?.type === "disabled") {
    return next;
  }

  // chat mode 思考开启：严格校验 tool_calls 历史的 reasoning_content（覆盖 transform-messages 降级）。
  // 守卫与上方 off-path / utility-path 风格对称；此处 p 已是副本，去掉守卫直接赋值也对，但保持三处同形便于阅读。
  const ensured = ensureReasoningContentForToolCalls(p.messages);
  if (ensured !== p.messages) {
    p.messages = ensured;
  }

  const contentEnsured = ensureAssistantContentForToolCalls(p.messages);
  if (contentEnsured !== p.messages) {
    p.messages = contentEnsured;
  }

  next = stripToolChoice(p);
  return next;
}
