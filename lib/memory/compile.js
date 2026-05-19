/**
 * compile.js — 记忆编译器（v3 四块独立编译 + assemble）
 *
 * 四个独立函数各自有指纹缓存，互不依赖：
 *   compileToday()    → today.md（当天 sessions）
 *   compileWeek()     → week.md（过去7天滑动窗口）
 *   compileLongterm() → longterm.md（fold 周报到长期）
 *   compileFacts()    → facts.md（重要事实，继承上一版）
 *
 * assemble() 同步读取四个文件，拼成 memory.md（≤2000 token）。
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getLogicalDay } from "../time-utils.js";
import { callText } from "../../core/llm-client.js";
import { getLocale } from "../../server/i18n.js";
import { safeReadFile } from "../../shared/safe-fs.js";
import { normalizeCompiledLLMResult, normalizeCompiledSectionBody } from "./compiled-memory-state.js";

function _isZh() { return getLocale().startsWith("zh"); }

const EMPTY_MEMORY_ZH = "（暂无记忆）\n";
const EMPTY_MEMORY_EN = "(No memory yet)\n";
export function getEmptyMemory() { return _isZh() ? EMPTY_MEMORY_ZH : EMPTY_MEMORY_EN; }

// ════════════════════════════
//  v3 四块独立编译 + assemble
// ════════════════════════════

/**
 * 编译今天的 session 摘要 → today.md
 * @param {import('./session-summary.js').SessionSummaryManager} summaryManager
 * @param {string} outputPath
 * @param {{ model: string, api: string, api_key: string, base_url: string }} resolvedModel
 * @returns {Promise<"compiled"|"skipped">}
 */
export async function compileToday(summaryManager, outputPath, resolvedModel, opts = {}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const { rangeStart } = getLogicalDay();
  const sessions = summaryManager.getSummariesInRange(rangeStart, new Date(), { since: opts.since || null });
  const fpPath = outputPath + ".fingerprint";

  // 空 sessions 不写 fingerprint：rollingSummary 失败期会让 sessions 持续为空，
  // 若落下 "empty" 指纹，之后 summary 恢复前该指纹仍会命中（因为下一次也是 empty），
  // 导致 today.md 永远卡在 0 bytes。只在有真实 session 摘要时用 fingerprint 去重。
  if (sessions.length === 0) {
    try { fs.unlinkSync(fpPath); } catch {}
    const cur = safeReadFile(outputPath, "");
    if (cur.length > 0) atomicWrite(outputPath, "");
    return "compiled";
  }

  const fpKeys = sessions.map((s) => `${s.session_id}:${s.updated_at}`);
  const fp = computeFingerprint(fpKeys);
  try {
    if (fs.readFileSync(fpPath, "utf-8").trim() === fp && fs.existsSync(outputPath)) return "skipped";
  } catch {}

  const input = sessions.map((s) => s.summary).join("\n\n---\n\n");
  const isZh = _isZh();
  const result = await _compactLLM(
    input,
    isZh
      ? `请把今天的对话摘要整理成一份"用户近况与大主题清单"。

提炼原则：
- 把同一主题/项目的多次往返归并为一件事，不要逐条流水账
- 时间标注用主时段（"上午/傍晚"或粗略 HH:MM 区间），不需精确到分钟
- 记忆的核心职责是维护用户模型，优先记录用户是谁、喜欢什么、在意什么、最近关注什么
- 工作相关内容只允许保留到大主题层级：只写用户最近关注的领域/项目/主题，不写该主题里的细节

可以记录：
- 用户的身份、人格特质、审美、兴趣、喜欢或讨厌的事物
- 用户最近关注的大主题，例如"记忆系统""Project Hana""AI Agent"
- 用户生活、创作、关系或长期关注方向的变化

不要记录：
- 不要记录执行步骤、文件名、工具、命令、检查顺序、协作偏好、工作细节
- 任务过程中的方法论选择、工具偏好、格式要求、术语规则
- 具体子问题、具体方案、具体改法、具体测试或发布流程
- 助手具体产出的内容（"生成了一篇关于 X 的文章"够了，不要摘录文章内容）
- 来回修改、重试、被打断又恢复这类过程波动

输出 3-5 条粗颗粒事件，每条 1-2 句。最多 300 字。一天平淡就写得短。不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文列表或段落。`
      : `Distill today's conversation summaries into a "user-current-state and broad-theme list".

Principles:
- Merge multiple back-and-forth on the same topic/project into ONE event; do not enumerate line by line
- Time markers use major periods ("morning/evening" or rough HH:MM range), no minute-level precision
- Memory's core job is to maintain a user model: prioritize who the user is, what they like, what they care about, and what they are broadly focused on recently
- Work-related content may only be kept at the broad-theme level: record the domain/project/theme, not details inside that theme

May record:
- The user's identity, personality traits, aesthetics, interests, likes, and dislikes
- Broad themes the user is currently focused on, such as "memory systems", "Project Hana", or "AI Agent"
- Changes in the user's life, creative work, relationships, or long-term areas of attention

Do NOT record:
- Execution steps, filenames, tools, commands, validation order, collaboration preferences, or work details
- Task-level methodology choices, tool preferences, format requirements, terminology rules
- Specific subproblems, concrete solutions, concrete code changes, tests, or release flows
- Specific content of assistant's output ("wrote an article about X" is enough; do not excerpt the article)
- Revisions, retries, interruptions and resumptions — these are process noise

Output 3-5 coarse events, 1-2 sentences each. Max 180 words. Keep it short on quiet days. Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.`,
    resolvedModel,
    450,
  );

  atomicWrite(outputPath, normalizeCompiledLLMResult(result, "compileToday"));
  fs.writeFileSync(fpPath, fp);
  return "compiled";
}

/**
 * 编译过去 7 天滑动窗口的摘要 → week.md
 * @param {object} resolvedModel
 */
export async function compileWeek(summaryManager, outputPath, resolvedModel, opts = {}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  const sessions = summaryManager.getSummariesInRange(sevenDaysAgo, now, { since: opts.since || null });
  const fpPath = outputPath + ".fingerprint";

  // 空 sessions 不写 fingerprint：同 compileToday 的理由，避免失败态被指纹锁死。
  if (sessions.length === 0) {
    try { fs.unlinkSync(fpPath); } catch {}
    const cur = safeReadFile(outputPath, "");
    if (cur.length > 0) atomicWrite(outputPath, "");
    return "compiled";
  }

  const fpKeys = sessions.map((s) => `${s.session_id}:${s.updated_at}`);
  const fp = computeFingerprint(fpKeys);
  try {
    if (fs.readFileSync(fpPath, "utf-8").trim() === fp && fs.existsSync(outputPath)) return "skipped";
  } catch {}

  const input = sessions.map((s) => s.summary).join("\n\n---\n\n");
  const isZh = _isZh();
  const result = await _compactLLM(
    input,
    isZh
      ? `请把过去 7 天的对话摘要整理成一份"本周用户主题概要"。

关键定位：到 week 这一层，记录已经是粗线条的了。它不是"每天发生的事"的集合，而是再上一层——归纳用户这一周大致在关注什么、投入什么、发生了什么重要变化。读这份记录的人只需要知道用户近况和大主题，不需要知道任何过程细节。

提炼层级：
- 记忆的核心职责是维护用户模型：用户是谁、喜欢什么、在意什么、最近关注什么
- 工作相关内容只允许保留到大主题层级：只写用户最近关注的领域/项目/主题，不写该主题里的细节
- 持续性的关注主题（"本周持续关注 X"、"这几天主要在做 Y"）放最前
- 够分量的个人近况、创作主题、关系变化、兴趣变化次之
- 时间用模糊表述（"周初/前几天/这两天"），不留精确时间戳

明确不要保留的内容：
- 不要记录执行步骤、文件名、工具、命令、检查顺序、协作偏好、工作细节
- 某个主题里的具体子问题、具体方案、具体改法、具体测试或发布流程
- 任务过程中的方法论、工具、格式选择
- 单次对话内的来回修改、临时决定
- 助手的具体产出内容
- 不重要的杂事（普通的闲聊、查询、调试）

只记录"用户这一周大致关注什么、发生了什么重要变化"。工作只记大主题，其他可以不写。

输出 3-5 条本周主题/事件。最多 400 字。不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文列表或段落。`
      : `Distill the past 7 days' conversation summaries into a "weekly user-theme overview".

Positioning: at the week layer, the record is already coarse-grained. It is NOT a collection of "what happened each day" — it is one level above: distilling what the user was broadly focused on, invested in, and what important changes happened. The reader only needs user current-state and broad themes, not any process detail.

Layering:
- Memory's core job is to maintain a user model: who the user is, what they like, what they care about, and what they are broadly focused on recently
- Work-related content may only be kept at the broad-theme level: record the domain/project/theme, not details inside that theme
- Persistent focus themes ("focused on X this week", "spent several days on Y") come first
- Substantial personal current-state, creative themes, relationship changes, or interest changes come second
- Time is vague ("early in the week / a few days ago / these last two days"); do NOT preserve exact timestamps

Explicitly do NOT keep:
- Execution steps, filenames, tools, commands, validation order, collaboration preferences, or work details
- Specific subproblems, concrete solutions, concrete code changes, tests, or release flows
- Task-level details (how it was done, how many revisions, interruptions and resumptions)
- Task-level methodology, tools, format choices
- Within-conversation revisions and temporary decisions
- Specific content of assistant's output
- Trivial activity (small talk, lookups, debugging)

Record only "what the user was broadly focused on and what important changes happened this week". For work, keep only the broad theme. Skip the rest.

Output 3-5 weekly themes/events. Max 240 words. Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.`,
    resolvedModel,
    600,
  );

  atomicWrite(outputPath, normalizeCompiledLLMResult(result, "compileWeek"));
  fs.writeFileSync(fpPath, fp);
  return "compiled";
}

/**
 * 将 week.md fold 进 longterm.md（每日一次）
 * @param {object} resolvedModel
 */
export async function compileLongterm(weekMdPath, longtermPath, resolvedModel) {
  fs.mkdirSync(path.dirname(longtermPath), { recursive: true });

  const weekContent = safeReadFile(weekMdPath, "").trim();

  if (!weekContent) return "skipped";

  // fingerprint：week.md 内容没变就跳过，避免每天把同一批内容反复折叠
  const fp = computeFingerprint([weekContent]);
  const fpPath = longtermPath + ".fingerprint";
  try {
    if (fs.readFileSync(fpPath, "utf-8").trim() === fp && fs.existsSync(longtermPath)) return "skipped";
  } catch {}

  const prevLongterm = safeReadFile(longtermPath, "").trim();

  const isZh = _isZh();
  const input = prevLongterm
    ? (isZh
        ? `## 上一份长期情况\n\n${prevLongterm}\n\n## 本周新增\n\n${weekContent}`
        : `## Previous long-term context\n\n${prevLongterm}\n\n## This week's additions\n\n${weekContent}`)
    : weekContent;

  const result = await _compactLLM(
    input,
    isZh
      ? `请把以下内容整合成一份长期用户画像记录。

记忆不是工作日志，也不是协作手册。到 longterm 这一层，记录已经是最稳定的用户画像核心。只保留"如果一年后回看仍然适合用来理解用户这个人"的内容：
- 用户的身份、人格特质、审美、兴趣、价值取向
- 用户长期喜欢或讨厌的事物
- 用户长期关系和稳定生活背景
- 用户持续关注或投入的长期关注方向

去掉这些"单次性内容"：
- 某天/某周完成的具体任务
- 用户偏好的工作方式、协作流程、工程纪律
- 工具使用习惯、检查顺序、汇报格式
- 某类任务的处理方法
- 助手的具体产出内容
- 任何"这周/那周"级别的细节

最多 400 字。不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文列表或段落。`
      : `Consolidate the following into a long-term user-profile record.

Memory is not a work log or collaboration manual. At the longterm layer, the record is the most stable user-profile core. Keep only what would still help understand the user as a person "if reviewed a year from now":
- The user's identity, personality traits, aesthetics, interests, and values
- Things the user has long liked or disliked
- Long-term relationships and stable life background
- Persistent long-term focus directions

Remove these "one-off" contents:
- Specific tasks completed on a particular day or week
- User-preferred work style, collaboration process, or engineering discipline
- Tool habits, validation order, report format
- How to handle a class of task
- Specific content of assistant's output
- Any "this week / that week" level details

Max 240 words. Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.`,
    resolvedModel,
    600,
  );

  atomicWrite(longtermPath, normalizeCompiledLLMResult(result, "compileLongterm"));
  fs.writeFileSync(fpPath, fp);
  return "compiled";
}

/**
 * 从近期 session 摘要的 重要事实 / Key Facts 段编译 facts.md
 * @param {object} resolvedModel
 */
export async function compileFacts(summaryManager, outputPath, resolvedModel, opts = {}) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // 读取上一版 facts.md 作为继承基础（避免 30 天外的稳定属性丢失）
  const prevFacts = safeReadFile(outputPath, "").trim();

  // 取最近 30 天的新摘要，提取 重要事实 / Key Facts 段。
  // 兼容旧 H2 摘要和新 H3 摘要，避免调整 rolling summary 层级时丢老数据。
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const sessions = summaryManager.getSummariesInRange(thirtyDaysAgo, now, { since: opts.since || null });

  const factParts = [];
  for (const s of sessions) {
    if (!s.summary) continue;
    const text = extractMarkdownSection(s.summary, ["重要事实", "Key Facts"]);
    if (text && !isEmptyFactSection(text)) factParts.push(text);
  }

  // 没有新摘要时：保留旧 facts 原样
  if (factParts.length === 0) {
    if (!prevFacts) atomicWrite(outputPath, "");
    return "compiled";
  }

  // 把旧 facts 和新摘要里的事实合并后去重
  const newFacts = factParts.join("\n");
  const combined = prevFacts
    ? `${prevFacts}\n${newFacts}`
    : newFacts;

  const isZh = _isZh();
  const result = await _compactLLM(
    combined,
    isZh
      ? "将以下重要事实去重合并（200字以内）。只保留稳定的、跨时间有效的用户画像：身份、人格特质、审美、兴趣、喜欢或讨厌的事物、长期关系、长期关注方向。不要保留工作方式、协作流程、工具偏好、执行细节。矛盾时以最新为准。不要输出 Markdown 标题，不要以 #、##、### 开头；直接输出正文列表或段落。"
      : "Deduplicate and merge the following key facts (under 120 words). Keep only stable, time-persistent user-profile facts: identity, personality traits, aesthetics, interests, likes/dislikes, long-term relationships, and long-term focus directions. Do not keep work style, collaboration process, tool preferences, or execution details. When facts conflict, prefer the latest. Do not output Markdown headings. Do not start with #, ##, or ###; output body text only.",
    resolvedModel,
    300,
  );

  atomicWrite(outputPath, normalizeCompiledLLMResult(result, "compileFacts"));
  return "compiled";
}

function extractMarkdownSection(markdown, titles) {
  if (!markdown) return "";
  const wanted = new Set(titles.map(normalizeHeadingTitle));
  const lines = String(markdown).split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const heading = parseMarkdownHeading(lines[i]);
    if (!heading || !wanted.has(normalizeHeadingTitle(heading.title))) continue;

    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const nextHeading = parseMarkdownHeading(lines[j]);
      if (nextHeading && nextHeading.level <= heading.level) break;
      body.push(lines[j]);
    }
    return body.join("\n").trim();
  }

  return "";
}

function parseMarkdownHeading(line) {
  const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(String(line || ""));
  if (!match) return null;
  return {
    level: match[1].length,
    title: match[2].replace(/[ \t]+#+[ \t]*$/, "").trim(),
  };
}

function normalizeHeadingTitle(title) {
  return String(title || "").trim().toLowerCase();
}

function isEmptyFactSection(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return true;
  return lines.every((line) => {
    const itemText = line.replace(/^[-*+][ \t]+/, "").trim().toLowerCase();
    return itemText === "无" || itemText === "none";
  });
}

/**
 * 将四个中间文件组装成 memory.md（同步，不调 LLM）
 * @param {string} factsPath
 * @param {string} todayPath
 * @param {string} weekPath
 * @param {string} longtermPath
 * @param {string} memoryMdPath
 */
export function assemble(factsPath, todayPath, weekPath, longtermPath, memoryMdPath) {
  const read = (p) => { try { return fs.readFileSync(p, "utf-8").trim(); } catch { return ""; } };

  const facts    = normalizeCompiledSectionBody(read(factsPath));
  const today    = normalizeCompiledSectionBody(read(todayPath));
  const week     = normalizeCompiledSectionBody(read(weekPath));
  const longterm = normalizeCompiledSectionBody(read(longtermPath));

  // 四个标题始终保留，空栏写占位符，避免格式漂移
  const isZh = _isZh();
  const empty = isZh ? "（暂无）" : "(none)";
  const section = (title, content) =>
    `## ${title}\n\n${content || empty}`;

  const md = [
    section(isZh ? "重要事实" : "Key facts", facts),
    section(isZh ? "今天" : "Today", today),
    section(isZh ? "本周早些时候" : "Earlier this week", week),
    section(isZh ? "长期情况" : "Long-term context", longterm),
  ].join("\n\n") + "\n";

  atomicWrite(memoryMdPath, md);
}

/**
 * 通用 LLM 压缩调用（内部）
 * @param {string} input
 * @param {string} systemPrompt
 * @param {{ model: string, api: string, api_key: string, base_url: string }} resolvedModel
 * @param {number} maxTokens
 */
async function _compactLLM(input, systemPrompt, resolvedModel, maxTokens) {
  const { model, api, api_key, base_url } = resolvedModel;
  return callText({
    api, model,
    apiKey: api_key,
    baseUrl: base_url,
    messages: [{ role: "user", content: input }],
    systemPrompt,
    temperature: 0.3,
    maxTokens: maxTokens,
    timeoutMs: 60_000,
  });
}

// ════════════════════════════
//  辅助
// ════════════════════════════

function computeFingerprint(keys) {
  return crypto.createHash("md5").update(keys.join("\n")).digest("hex");
}

function atomicWrite(filePath, content) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}
