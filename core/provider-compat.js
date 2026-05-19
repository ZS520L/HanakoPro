/**
 * core/provider-compat.js — LLM HTTP payload 兼容层（唯一对外入口）
 *
 * 架构：dispatcher + 子模块。所有 provider-specific 补丁拆到 ./provider-compat/<name>.js。
 * 完整规范见 ./provider-compat/README.md。
 *
 * 两条调用路径共享本入口（commit f5b5d69 — chat 路径与 utility 路径合一的纪律）：
 *   - core/llm-client.js 的 callText（非流式 / utility 路径）
 *   - core/engine.js 的 Pi SDK before_provider_request 扩展（流式 / chat 路径）
 *
 * 本文件只保留：
 *   1. dispatcher（按 matches 分发到子模块，first-match-wins）
 *   2. 与 provider 无关的通用补丁（stripEmptyTools, stripIncompatibleThinking,
 *      normalizeImplicitOutputBudget）
 *   3. 协议鉴别函数（isDeepSeekModel, isAnthropicModel, getThinkingFormat）— 供其他 hana 模块复用
 *
 * 不允许在本文件加任何 provider-specific 实现细节；新 provider 一律开
 * core/provider-compat/<name>.js 子模块。
 */

import * as deepseek from "./provider-compat/deepseek.js";
import * as mimo from "./provider-compat/mimo.js";
import * as qwen from "./provider-compat/qwen.js";
import * as openaiVideoUrl from "./provider-compat/openai-video-url.js";
import * as anthropic from "./provider-compat/anthropic.js";
import { normalizeImplicitOutputBudget } from "./provider-compat/output-budget.js";
import {
  getReasoningProfile as getDeclaredReasoningProfile,
  getThinkingFormat as getDeclaredThinkingFormat,
} from "../shared/model-capabilities.js";

/**
 * 子模块注册表。顺序敏感：first-match-wins。
 * 新 provider 默认加在末尾；只有当模块的 matches 是另一模块子集（更具体规则）时才前置。
 */
const PROVIDER_MODULES = [deepseek, mimo, qwen, openaiVideoUrl, anthropic];

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

// ── Provider 鉴别（导出供其他 hana 模块复用，不属于子模块逻辑）──

/**
 * 判断 model 是否走 DeepSeek 兼容路径。
 * 委托给 deepseek 子模块的 matches，避免双源真相。
 */
export function isDeepSeekModel(model) {
  return deepseek.matches(model);
}

/**
 * 判断 model 是否走 Anthropic thinking 兼容路径。
 * Anthropic 没有专门的子模块（pi-ai SDK 已直接兼容），这里消费
 * model.compat.thinkingFormat，不按 provider 名猜测第三方兼容服务。
 */
export function isAnthropicModel(model) {
  if (!model || typeof model !== "object") return false;
  return lower(model.provider) === "anthropic" || getThinkingFormat(model) === "anthropic";
}

export function getThinkingFormat(model) {
  const declared = getDeclaredThinkingFormat(model);
  if (declared) return declared;
  if (isDeepSeekModel(model)) return "deepseek";
  return null;
}

export function getReasoningProfile(model) {
  return getDeclaredReasoningProfile(model);
}

// ── 通用 payload 处理（与 provider 无关）──

function stripEmptyTools(payload) {
  if (Array.isArray(payload.tools) && payload.tools.length === 0) {
    const { tools, ...rest } = payload;
    return rest;
  }
  return payload;
}

function stripIncompatibleThinking(payload, model) {
  if (!payload.thinking) return payload;
  // payload.thinking 只对 Anthropic-style / DeepSeek-style 请求体有效。
  // Qwen/openrouter 等格式即使支持 reasoning，也不接收这个字段。
  // 没有 model 信息时保守保留（旧降级路径），避免误删 anthropic 调用。
  if (!model) return payload;
  const thinkingFormat = getThinkingFormat(model);
  if (thinkingFormat === "anthropic" || thinkingFormat === "deepseek") return payload;
  const { thinking, ...rest } = payload;
  return rest;
}

/**
 * Provider payload 兼容化的唯一入口。chat 路径与 utility 路径共享。
 *
 * 处理顺序：
 *   1. 通用补丁（stripEmptyTools / stripIncompatibleThinking）
 *   2. 子模块分发（first-match-wins，最多匹配一个）
 *
 * @param {object} payload — 即将发送的 HTTP body（OpenAI / Anthropic 风格）
 * @param {object|null|undefined} model — 完整 model 对象 {id, provider, baseUrl, reasoning, maxTokens, quirks, ...}
 * @param {{ mode?: "chat" | "utility", reasoningLevel?: string, outputBudgetSource?: "user" | "system" | "sdk-default", maxTokensSource?: string, userMaxTokens?: number }} [options]
 * @returns {object} 处理后的 payload
 */
export function normalizeProviderPayload(payload, model, options = {}) {
  if (!payload || typeof payload !== "object") return payload;

  let result = payload;

  // 1. 通用补丁（与 provider 无关）
  result = stripEmptyTools(result);
  result = stripIncompatibleThinking(result, model);
  result = normalizeImplicitOutputBudget(result, model, options);

  // 2. Provider-specific 补丁（按 matches 分发，first-match-wins）
  for (const mod of PROVIDER_MODULES) {
    if (mod.matches(model)) {
      result = mod.apply(result, model, options);
      break;
    }
  }

  return result;
}

/**
 * Provider context 兼容化入口。运行于 Pi SDK context hook，早于 provider
 * serializer，专门承载 replay/history 这类 payload hook 已经来不及处理的协议校验。
 *
 * @param {Array|any} messages — Pi SDK AgentMessage[]
 * @param {object|null|undefined} model
 * @param {{ mode?: "chat" | "utility", reasoningLevel?: string }} [options]
 * @returns {Array|any}
 */
export function normalizeProviderContextMessages(messages, model, options = {}) {
  if (!Array.isArray(messages)) return messages;

  for (const mod of PROVIDER_MODULES) {
    if (mod.matches(model)) {
      if (typeof mod.normalizeContextMessages === "function") {
        return mod.normalizeContextMessages(messages, model, options);
      }
      break;
    }
  }

  return messages;
}
