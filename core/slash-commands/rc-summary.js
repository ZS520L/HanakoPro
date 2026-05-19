/**
 * rc-summary.js — 为 /rc 接管生成桌面 session 简述（三级 fallback）
 *
 * 接管成功后要发一条带 summary 的回复给 bridge 用户，告诉 ta
 * "这个桌面会话之前聊了什么"。三级模型 fallback 提升 resilience：
 *
 *   1. utility          ← 小工具模型（快/便宜）
 *   2. utility_large    ← 大工具模型（utility_large，准确度更好）
 *   3. chat             ← agent 主聊天模型（最权威，当前 bridge 也在用的这个）
 *   4. null             ← 上层自行兜底为 "已接管对话 <title>"
 *
 * 为什么三级而不是单点：utility/utility_large 常走更轻的端点，
 * 主模型做摘要浪费资源；但任何一级因为凭证/网络/限流失败时应能向下降级，
 * 用户感知是「summary 还是会出现，只是有时候来自不同模型」。
 *
 * 不在此处做兜底文案；失败返回 null，调用方（/rc 选择 handler）决定最终文案，
 * 避免"摘要器"和"文案兜底"两个职责互相纠缠。
 */
import fs from "fs";
import { callText } from "../llm-client.js";
import { getLocale } from "../../server/i18n.js";
import { isToolCallBlock } from "../llm-utils.js";

const SUMMARY_TIMEOUT_MS = 15_000;
const SUMMARY_MAX_TOKENS = 150;
const CONTENT_CHAR_LIMIT = 1500;
const MAX_TURNS_FROM_TAIL = 8;

/**
 * @param {object} engine  engine.resolveUtilityConfig()、engine.resolveModelWithCredentials(ref)
 * @param {object} agent   agent.config.models.chat 用于 tier 3
 * @param {string} sessionPath  桌面 session 绝对路径
 * @returns {Promise<string|null>}
 */
export async function summarizeSessionForRc(engine, agent, sessionPath) {
  if (!sessionPath || !fs.existsSync(sessionPath)) return null;

  const content = _extractRecentTurns(sessionPath);
  if (!content.userText && !content.assistantText) return null;

  const isZh = getLocale().startsWith("zh");
  const messages = _buildMessages(content, isZh);

  // Tier 1: utility
  let utilConfig = null;
  try {
    utilConfig = engine.resolveUtilityConfig?.(agent?.id ? { agentId: agent.id } : undefined);
  } catch { /* ignore, fall through */ }

  if (utilConfig?.utility && utilConfig.api_key && utilConfig.base_url && utilConfig.api) {
    const text = await _safeCall({
      api: utilConfig.api, model: utilConfig.utility,
      apiKey: utilConfig.api_key, baseUrl: utilConfig.base_url,
      messages,
    }, "utility");
    if (text) return text;
  }

  // Tier 2: utility_large
  if (utilConfig?.utility_large && utilConfig.large_api_key && utilConfig.large_base_url && utilConfig.large_api) {
    const text = await _safeCall({
      api: utilConfig.large_api, model: utilConfig.utility_large,
      apiKey: utilConfig.large_api_key, baseUrl: utilConfig.large_base_url,
      messages,
    }, "utility_large");
    if (text) return text;
  }

  // Tier 3: chat model
  const chatRef = agent?.config?.models?.chat;
  if (chatRef?.id && chatRef?.provider) {
    try {
      const resolved = engine.resolveModelWithCredentials?.({ id: chatRef.id, provider: chatRef.provider });
      if (resolved) {
        const text = await _safeCall({
          api: resolved.api, model: resolved.model,
          apiKey: resolved.api_key, baseUrl: resolved.base_url,
          messages,
        }, "chat");
        if (text) return text;
      }
    } catch (err) {
      console.warn(`[rc-summary] chat tier resolve failed: ${err.message}`);
    }
  }

  return null;
}

async function _safeCall({ api, model, apiKey, baseUrl, messages }, tierLabel) {
  try {
    const text = await callText({
      api, model, apiKey, baseUrl,
      messages,
      temperature: 0.3,
      maxTokens: SUMMARY_MAX_TOKENS,
      timeoutMs: SUMMARY_TIMEOUT_MS,
    });
    return text?.trim() || null;
  } catch (err) {
    console.warn(`[rc-summary] ${tierLabel} tier failed: ${err.message}`);
    return null;
  }
}

/** 从 session jsonl 读最近几轮对话的 user/assistant text + tool names */
function _extractRecentTurns(sessionPath) {
  let raw;
  try { raw = fs.readFileSync(sessionPath, "utf-8"); }
  catch { return { userText: "", assistantText: "", tools: [] }; }

  const lines = raw.trim().split("\n").map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const messages = lines
    .filter(l => l.type === "message" && l.message)
    .slice(-MAX_TURNS_FROM_TAIL);

  let userText = "";
  let assistantText = "";
  const tools = [];
  for (const line of messages) {
    const m = line.message;
    const textParts = (m.content || []).filter(c => c.type === "text").map(c => c.text).join("\n");
    if (m.role === "user" && textParts) {
      userText += (userText ? "\n---\n" : "") + textParts;
    }
    if (m.role === "assistant") {
      if (textParts) assistantText += (assistantText ? "\n---\n" : "") + textParts;
      const toolParts = (m.content || []).filter(isToolCallBlock);
      for (const tp of toolParts) tools.push(tp.name || "unknown_tool");
    }
  }
  return {
    userText: userText.slice(0, CONTENT_CHAR_LIMIT),
    assistantText: assistantText.slice(0, CONTENT_CHAR_LIMIT),
    tools: [...new Set(tools)],
  };
}

function _buildMessages({ userText, assistantText, tools }, isZh) {
  const system = isZh
    ? `你是对话摘要生成器。根据下面几轮对话，概括这个桌面会话正在处理什么、当前进展，以及能看出的下一步线索。
规则：中文，直接输出 1-3 句，100 字以内；不加引号、不加前缀、不列编号；不要逐条复述工具日志，也不要只写工具名或泛泛一句。`
    : `You summarize conversations. Given the turns below, describe what this desktop session is handling, its current progress, and any visible next-step clue.
Rules: output 1-3 direct English sentences under 60 words; no quotes, preamble, or numbering; do not list tool logs, and do not reduce the summary to tool names or a generic phrase.`;

  const toolStr = tools.length > 0
    ? (isZh ? `\n用到的工具：${tools.join("、")}` : `\nTools used: ${tools.join(", ")}`)
    : "";

  const contextLabel = isZh ? "对话片段" : "Conversation";
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: `${contextLabel}：\n\n${isZh ? "用户：" : "User: "}${userText}\n\n${isZh ? "助手：" : "Assistant: "}${assistantText}${toolStr}`,
    },
  ];
}
