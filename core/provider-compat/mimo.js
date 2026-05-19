/**
 * MiMo provider 兼容层
 *
 * 处理 provider:
 *   - provider === "mimo"
 *   - provider === "xiaomi" / "xiaomi-token" / token-plan variants
 *   - baseUrl hostname 属于 "xiaomimimo.com"
 *
 * 解决的协议问题：
 *   1. 思考模式开关通过 chat_template_kwargs.enable_thinking 控制
 *   2. 思考模式工具调用历史需要回传 reasoning_content
 *   3. utility mode 主动关思考，避免短输出被思考链吃掉可见文本预算
 *      官方文档：https://github.com/XiaomiMiMo/MiMo
 *
 * 删除条件：
 *   - MiMo 不再通过 chat_template_kwargs 控制 thinking
 *   - 或 pi-ai 直接原生处理 MiMo 的 reasoning_content replay
 *   - 或 hana 不再支持 MiMo
 *
 * 接口契约：见 ./README.md
 */

import { getReasoningProfile, isOfficialMimoEndpoint } from "../../shared/model-capabilities.js";
import {
  ensureAssistantContentForToolCalls,
  ensureReasoningContentForToolCalls,
  stripReasoningContent,
} from "./reasoning-content-replay.js";

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function matches(model) {
  if (!model || typeof model !== "object") return false;
  return isOfficialMimoEndpoint(model)
    || getReasoningProfile(model) === "mimo-openai";
}

function isThinkingOff(level) {
  return level === "off" || level === "none" || level === "disabled";
}

function shouldUseThinking(payload, model, reasoningLevel) {
  if (payload.chat_template_kwargs?.enable_thinking === false) return false;
  if (isThinkingOff(reasoningLevel)) return false;
  return Boolean(
    payload.reasoning_effort
    || payload.chat_template_kwargs?.enable_thinking === true
    || model?.reasoning === true
  );
}

function disableThinking(payload) {
  delete payload.reasoning_effort;
  if (hasOwn(payload, "thinking")) {
    delete payload.thinking;
  }
  const kwargs = isPlainObject(payload.chat_template_kwargs)
    ? payload.chat_template_kwargs
    : {};
  payload.chat_template_kwargs = {
    ...kwargs,
    enable_thinking: false,
  };
  delete payload.chat_template_kwargs.preserve_thinking;

  if (Array.isArray(payload.messages)) {
    const stripped = stripReasoningContent(payload.messages);
    if (stripped !== payload.messages) payload.messages = stripped;
  }
}

function enableThinking(payload) {
  delete payload.reasoning_effort;
  const kwargs = isPlainObject(payload.chat_template_kwargs)
    ? payload.chat_template_kwargs
    : {};
  payload.chat_template_kwargs = {
    ...kwargs,
    enable_thinking: true,
    preserve_thinking: true,
  };
}

export function apply(payload, model, options = {}) {
  if (!Array.isArray(payload.messages)) return payload;
  const mode = options.mode || "chat";
  const reasoningLevel = options.reasoningLevel;

  let next = payload;
  const editable = () => {
    if (next === payload) next = { ...payload };
    return next;
  };

  if (isThinkingOff(reasoningLevel) || payload.chat_template_kwargs?.enable_thinking === false) {
    disableThinking(editable());
    return next;
  }

  if (!shouldUseThinking(next, model, reasoningLevel)) return next;

  if (mode === "utility") {
    disableThinking(editable());
    return next;
  }

  const p = editable();
  enableThinking(p);

  const ensured = ensureReasoningContentForToolCalls(p.messages, { providerLabel: "MiMo" });
  if (ensured !== p.messages) {
    p.messages = ensured;
  }

  const contentEnsured = ensureAssistantContentForToolCalls(p.messages);
  if (contentEnsured !== p.messages) {
    p.messages = contentEnsured;
  }

  if (hasOwn(p, "thinking")) {
    delete p.thinking;
  }

  return next;
}
