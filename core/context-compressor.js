/**
 * 上下文压缩器 — 根据 agent config.context 配置选择并执行压缩策略。
 *
 * 消费点：session-coordinator 在构建 LLM 请求前调用。
 *
 * 纪律：
 *   - 纯逻辑 + LLM 调用，不碰 session/agent 对象的内部状态
 *   - 调用方负责把压缩结果持久化（appendCompaction / replaceMessages）
 */

import { DEFAULT_CONTEXT_COMPRESSION } from "../shared/context-compression.js";
import { estimateTokens, serializeConversation } from "../lib/pi-sdk/index.js";
import { createModuleLogger } from "../lib/debug-log.js";

const log = createModuleLogger("context-compressor");

/**
 * 从 agent config 中读取并规范化 context 压缩配置。
 * @param {object} agentConfig - agent._config
 * @returns {import('../shared/context-compression.js').ContextCompressionConfig}
 */
export function resolveContextConfig(agentConfig) {
  const raw = agentConfig?.context;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CONTEXT_COMPRESSION };
  return {
    ...DEFAULT_CONTEXT_COMPRESSION,
    ...raw,
    protect: {
      ...DEFAULT_CONTEXT_COMPRESSION.protect,
      ...(raw.protect || {}),
    },
  };
}

/**
 * 判断是否应该触发压缩。
 *
 * @param {object} params
 * @param {Array} params.messages - 当前 session 的消息列表
 * @param {number} params.contextWindow - 模型上下文窗口大小（token）
 * @param {object} params.contextConfig - resolveContextConfig 的结果
 * @returns {boolean}
 */
export function shouldTriggerCompression({ messages, contextWindow, contextConfig }) {
  if (!contextConfig.enabled) return false;
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  const ratio = totalTokens / contextWindow;
  return ratio >= contextConfig.threshold;
}

/**
 * 将消息列表按"保护最近 N 轮"分割为可压缩部分和保留部分，
 * 并根据 protect 配置从 compressible 中过滤受保护消息。
 *
 * @param {Array} messages - 全部消息
 * @param {number} recentTurnsProtected - 保护的最近轮数
 * @param {object} [protect] - 保护配置
 * @param {boolean} [protect.systemPrompt=true] - 保护 system 消息（不纳入压缩）
 * @param {boolean} [protect.recentToolResults=true] - 保护 tool/function 结果消息
 * @returns {{ compressible: Array, retained: Array }}
 */
export function splitMessages(messages, recentTurnsProtected, protect) {
  const protectSystem = protect?.systemPrompt !== false;   // 默认 true
  const protectTool   = protect?.recentToolResults !== false; // 默认 true

  // 一轮 = 一个 user 消息开始的回合。从后往前数轮。
  let turnCount = 0;
  let splitIndex = 0; // 默认：全部保留（compressible 为空）

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      turnCount++;
      if (turnCount > recentTurnsProtected) {
        splitIndex = i + 1;
        break;
      }
    }
  }

  // 如果发现不到 N+1 轮，则全部保留
  if (turnCount <= recentTurnsProtected) {
    return { compressible: [], retained: messages };
  }

  // 从 compressible 中过滤受保护的消息类型 → 移入 retained 前部
  const rawCompressible = messages.slice(0, splitIndex);
  const rawRetained = messages.slice(splitIndex);

  const filteredCompressible = [];
  const protectedPrefix = []; // 被保护的消息，放到 retained 前面

  for (const m of rawCompressible) {
    const isSystem = m.role === "system";
    const isToolResult = m.role === "tool" || m.role === "function";
    const isToolCall = m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
    if ((protectSystem && isSystem) || (protectTool && (isToolResult || isToolCall))) {
      protectedPrefix.push(m);
    } else {
      filteredCompressible.push(m);
    }
  }

  return {
    compressible: filteredCompressible,
    retained: [...protectedPrefix, ...rawRetained],
  };
}

export function cloneMessageForForkRetention(message) {
  const cloned = JSON.parse(JSON.stringify(message));
  if (cloned?.role === "assistant") {
    delete cloned.usage;
  }
  return cloned;
}

// ════════════════════════════
//  压缩策略
// ════════════════════════════

/**
 * 策略 1：艾宾浩斯遗忘曲线
 *
 * 按时间距离对消息分组，越旧的组压缩比越高。
 * 最旧 1/3 → 极度压缩（1-2 句摘要）
 * 中间 1/3 → 中度压缩（段落摘要）
 * 最近 1/3 → 轻度压缩（保留关键细节）
 */
async function compressEbbinghaus(compressible, model, generateFn) {
  if (compressible.length === 0) return "";

  const third = Math.max(1, Math.floor(compressible.length / 3));
  const oldest = compressible.slice(0, third);
  const middle = compressible.slice(third, third * 2);
  const recent = compressible.slice(third * 2);

  const segments = [];

  if (oldest.length > 0) {
    const text = serializeConversation(oldest);
    const summary = await generateFn(
      `Compress the following conversation history into 1-2 sentences, retaining only the most critical facts and decisions:\n\n${text}`,
      model,
    );
    if (summary) segments.push(`[远期摘要] ${summary}`);
  }

  if (middle.length > 0) {
    const text = serializeConversation(middle);
    const summary = await generateFn(
      `Summarize the following conversation, preserving key facts, decisions, and action items in a concise paragraph:\n\n${text}`,
      model,
    );
    if (summary) segments.push(`[中期摘要] ${summary}`);
  }

  if (recent.length > 0) {
    const text = serializeConversation(recent);
    const summary = await generateFn(
      `Summarize the following recent conversation, preserving important details, code references, and context needed for continuation:\n\n${text}`,
      model,
    );
    if (summary) segments.push(`[近期摘要] ${summary}`);
  }

  return segments.join("\n\n");
}

/**
 * 策略 2：滚动摘要 + 尾部保留（推荐默认）
 *
 * 整体压缩 compressible 部分为结构化摘要。
 */
async function compressRollingSummary(compressible, model, generateFn) {
  if (compressible.length === 0) return "";

  const text = serializeConversation(compressible);
  const summary = await generateFn(
    `Summarize the following conversation history into a structured format with these sections:
- **Facts established**: Key information confirmed during the conversation
- **Decisions made**: Agreed-upon choices and directions
- **Action items**: Pending tasks or next steps
- **Current state**: Where the conversation stands

Preserve exact variable names, file paths, error messages, and code references.

${text}`,
    model,
  );
  return summary || "";
}

/**
 * 策略 3：分层递归摘要
 *
 * 将可压缩消息分成多块，每块独立摘要（L1），再合并为全局摘要（L2）。
 */
async function compressHierarchical(compressible, model, generateFn) {
  if (compressible.length === 0) return "";

  const CHUNK_SIZE = 20;
  const chunks = [];
  for (let i = 0; i < compressible.length; i += CHUNK_SIZE) {
    chunks.push(compressible.slice(i, i + CHUNK_SIZE));
  }

  // L1: 每块独立摘要
  const l1Summaries = await Promise.all(
    chunks.map(async (chunk, idx) => {
      const text = serializeConversation(chunk);
      const summary = await generateFn(
        `Summarize this conversation segment (part ${idx + 1}/${chunks.length}), preserving key facts, decisions, and code references:\n\n${text}`,
        model,
      );
      return summary || "";
    }),
  );

  // L2: 合并为全局摘要
  if (l1Summaries.length <= 1) return l1Summaries[0] || "";

  const combined = l1Summaries.map((s, i) => `[段落 ${i + 1}] ${s}`).join("\n\n");
  const l2Summary = await generateFn(
    `Combine these segment summaries into a single coherent high-level state summary. Preserve the most important facts, decisions, and current state:\n\n${combined}`,
    model,
  );
  return `[全局状态]\n${l2Summary}\n\n[分段摘要]\n${l1Summaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
}

/**
 * 策略 4：重要性加权保留
 *
 * 让 LLM 对每条消息评分，低分压缩，高分保留。
 */
async function compressImportance(compressible, model, generateFn) {
  if (compressible.length === 0) return "";

  const text = serializeConversation(compressible);
  const summary = await generateFn(
    `Analyze the following conversation and create a compressed version that:
1. Keeps verbatim any messages containing: error messages, code blocks, file paths, explicit decisions, architecture choices
2. Summarizes messages containing: exploratory discussion, repeated questions, status updates, greetings
3. Removes: filler, acknowledgments, redundant confirmations

Output the compressed conversation, marking kept messages with [KEPT] and summarized sections with [SUMMARY]:

${text}`,
    model,
  );
  return summary || "";
}

/**
 * 策略 5：Map-Reduce 并行摘要
 *
 * 与分层类似但更激进——Map 阶段高度并行，Reduce 阶段合并。
 */
async function compressMapReduce(compressible, model, generateFn) {
  if (compressible.length === 0) return "";

  const CHUNK_SIZE = 15;
  const chunks = [];
  for (let i = 0; i < compressible.length; i += CHUNK_SIZE) {
    chunks.push(compressible.slice(i, i + CHUNK_SIZE));
  }

  // Map: 并行摘要
  const mapped = await Promise.all(
    chunks.map(async (chunk) => {
      const text = serializeConversation(chunk);
      return generateFn(
        `Extract the essential information from this conversation chunk. Keep facts, decisions, code references, and action items. Be very concise:\n\n${text}`,
        model,
      );
    }),
  );

  // Reduce: 合并
  const reducedInput = mapped.filter(Boolean).join("\n---\n");
  const reduced = await generateFn(
    `Merge these conversation summaries into a single coherent condensation. Eliminate redundancy while preserving all unique facts, decisions, and action items:\n\n${reducedInput}`,
    model,
  );
  return reduced || "";
}

/**
 * 策略 6：自定义
 *
 * 使用用户提供的 prompt 模板。
 */
async function compressCustom(compressible, model, generateFn, customPrompt) {
  if (compressible.length === 0) return "";
  const history = serializeConversation(compressible);
  const prompt = customPrompt.replace(/\{\{history\}\}/g, history);
  const summary = await generateFn(prompt, model);
  return summary || "";
}

/** 策略注册表 */
const STRATEGY_MAP = {
  "ebbinghaus": compressEbbinghaus,
  "rolling-summary": compressRollingSummary,
  "hierarchical": compressHierarchical,
  "importance": compressImportance,
  "map-reduce": compressMapReduce,
};

/**
 * 执行上下文压缩。
 *
 * @param {object} params
 * @param {Array} params.messages - 可压缩的消息列表（已 split 过）
 * @param {string} params.mode - 压缩模式 id
 * @param {object} params.model - 压缩用模型对象
 * @param {function} params.generateFn - (prompt, model) => Promise<string> 摘要生成函数
 * @param {string} [params.customPrompt] - 自定义模式的 prompt 模板
 * @returns {Promise<string>} 压缩后的摘要文本
 */
export async function executeCompression({ messages, mode, model, generateFn, customPrompt }) {
  log.log(`[compress] mode=${mode}, messages=${messages.length}`);

  if (mode === "custom" && customPrompt) {
    return compressCustom(messages, model, generateFn, customPrompt);
  }

  const strategy = STRATEGY_MAP[mode] || STRATEGY_MAP["rolling-summary"];
  return strategy(messages, model, generateFn);
}
