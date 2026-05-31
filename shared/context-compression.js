/**
 * 上下文压缩模式定义（前后端共享）
 *
 * 每种模式对应一种压缩策略，后端 context-compressor.js 根据 mode id 选择策略。
 */

/** @type {ReadonlyArray<{id: string, nameKey: string, descKey: string}>} */
export const COMPRESSION_MODES = Object.freeze([
  {
    id: "ebbinghaus",
    nameKey: "settings.context.modes.ebbinghaus",
    descKey: "settings.context.modes.ebbinghausDesc",
  },
  {
    id: "rolling-summary",
    nameKey: "settings.context.modes.rollingSummary",
    descKey: "settings.context.modes.rollingSummaryDesc",
  },
  {
    id: "hierarchical",
    nameKey: "settings.context.modes.hierarchical",
    descKey: "settings.context.modes.hierarchicalDesc",
  },
  {
    id: "importance",
    nameKey: "settings.context.modes.importance",
    descKey: "settings.context.modes.importanceDesc",
  },
  {
    id: "map-reduce",
    nameKey: "settings.context.modes.mapReduce",
    descKey: "settings.context.modes.mapReduceDesc",
  },
  {
    id: "custom",
    nameKey: "settings.context.modes.custom",
    descKey: "settings.context.modes.customDesc",
  },
]);

/**
 * 内置模式使用的提示词模板（只读预览用）。
 * {{history}} 代表待压缩的对话历史。
 */
export const BUILTIN_MODE_PROMPTS = Object.freeze({
  "ebbinghaus": `# 艾宾浩斯遗忘曲线压缩

将对话历史按时间距离分为三组，越旧的组压缩越激进：

## 远期（最旧 1/3）→ 极度压缩
Compress the following conversation history into 1-2 sentences, retaining only the most critical facts and decisions:

{{history}}

## 中期（中间 1/3）→ 中度压缩
Summarize the following conversation, preserving key facts, decisions, and action items in a concise paragraph:

{{history}}

## 近期（最近 1/3）→ 轻度压缩
Summarize the following recent conversation, preserving important details, code references, and context needed for continuation:

{{history}}`,

  "rolling-summary": `Summarize the following conversation history into a structured format with these sections:
- **Facts established**: Key information confirmed during the conversation
- **Decisions made**: Agreed-upon choices and directions
- **Action items**: Pending tasks or next steps
- **Current state**: Where the conversation stands

Preserve exact variable names, file paths, error messages, and code references.

{{history}}`,

  "hierarchical": `# 分层递归摘要（两阶段）

## L1: 分段摘要（每 20 条消息一段，并行执行）
Summarize this conversation segment (part N/M), preserving key facts, decisions, and code references:

{{history}}

## L2: 全局合并
Combine these segment summaries into a single coherent high-level state summary. Preserve the most important facts, decisions, and current state:

[段落 1] ...
[段落 2] ...`,

  "importance": `Analyze the following conversation and create a compressed version that:
1. Keeps verbatim any messages containing: error messages, code blocks, file paths, explicit decisions, architecture choices
2. Summarizes messages containing: exploratory discussion, repeated questions, status updates, greetings
3. Removes: filler, acknowledgments, redundant confirmations

Output the compressed conversation, marking kept messages with [KEPT] and summarized sections with [SUMMARY]:

{{history}}`,

  "map-reduce": `# Map-Reduce 并行摘要（两阶段）

## Map: 并行提取（每 15 条消息一块）
Extract the essential information from this conversation chunk. Keep facts, decisions, code references, and action items. Be very concise:

{{history}}

## Reduce: 合并
Merge these conversation summaries into a single coherent condensation. Eliminate redundancy while preserving all unique facts, decisions, and action items:

[块 1 摘要]
---
[块 2 摘要]
---
...`,
});

/** 默认上下文压缩配置 */
export const DEFAULT_CONTEXT_COMPRESSION = Object.freeze({
  enabled: false,
  threshold: 0.7,
  recentTurnsProtected: 5,
  mode: "rolling-summary",
  customPrompt: "",
  compressionModel: "custom",
  compressionCustomModel: null,
  protect: {
    systemPrompt: true,
    pinnedMemory: true,
    recentToolResults: true,
  },
});
