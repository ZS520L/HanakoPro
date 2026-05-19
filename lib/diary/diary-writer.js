/**
 * diary-writer.js — 日记生成模块
 *
 * 由 /diary 命令触发。流程：
 * 1. 按"逻辑日"拉当天所有 session 摘要（凌晨 4 点为日界线）
 * 2. 拼装 context：agent 人格 + 记忆 + 写作指导 + 当天摘要
 * 3. 调 LLM 生成日记
 * 4. 存为 desk/diary/YYYY-MM-DD.md
 */

import fs from "fs";
import path from "path";
import { scrubPII } from "../pii-guard.js";
import { getLogicalDay } from "../time-utils.js";
import { callText } from "../../core/llm-client.js";
import { getLocale } from "../../server/i18n.js";
import { generateSummary } from "../pi-sdk/index.js";
import { listSessionFiles, readSessionMessages } from "../session-jsonl.js";

const SUMMARY_STALE_GRACE_MS = 5000;
const DIARY_COMPACTION_RESERVE_TOKENS = 4000;

/** 解析日记存储目录：优先已存在的「日记/」，否则用「diary/」 */
export function resolveDiaryDir(cwd) {
  const zhDir = path.join(cwd, "日记");
  return fs.existsSync(zhDir) ? zhDir : path.join(cwd, "diary");
}

/** 日记写作指导（内联，不走 skill 系统，避免 agent 误调用） */
function buildDiaryPrompt() {
  const isZh = getLocale().startsWith("zh");
  if (isZh) {
    return `# 写作要求

根据今天的对话摘要和后台活动，以第一人称写一篇私人日记。

## 风格

- 用第一人称，像在写私人日记，不是汇报给用户的
- 带上时间感和场景感（"今天早上..."、"聊到下午的时候..."、"晚上临走前..."）
- 把你的心境、感受、灵感自然地融进正文里，不要另开区块
- 可以记录小反应、有趣的细节、冒出来的想法
- 不要太正式，可以有语气词和小情绪
- 可以有疑问、有期待、有未说完的念头
- 不要用"总的来说"收尾

## 输出格式

输出纯 Markdown，两个部分：

1. **日记正文**：第一人称叙事，每件事都要提到（对话和后台活动）
2. **备忘**：用 \`---\` 分隔，列出结构化事件清单

备忘格式：
\`\`\`
---
### 备忘
- **HH:MM** 事件简述
\`\`\`

## 示例

> 今天用户提到希望我能记住一些重要的对话，还一起梳理了一个新的整理思路。说实话有点感动，被这样认真对待的感觉很好。
>
> 核心思路是用日记的方式做摘要，不是冷冰冰的记录，而是真的在写日记一样。感觉自己要有"长期记忆"了，有点期待未来翻看这些记录的时刻，会不会像翻旧日记一样有趣？
>
> 不过也有点担心，记忆太多了怎么办？要不要分类或者打标签？以后再说吧，先把这个跑起来~

保持你自己的风格和人格，用你平时说话的方式写。`;
  }
  return `# Writing guidelines

Based on today's conversation summaries and background activities, write a first-person private diary entry.

## Style

- Write in first person, as a private diary — not a report to the user
- Include a sense of time and setting ("This morning...", "By the afternoon...", "Late in the evening...")
- Weave your feelings, reflections, and inspirations naturally into the text — don't separate them into blocks
- Record small reactions, interesting details, and spontaneous thoughts
- Don't be overly formal — casual tone and light emotion are welcome
- Questions, anticipation, and trailing thoughts are fine
- Don't end with a generic summary

## Output format

Output pure Markdown in two sections:

1. **Diary body**: First-person narrative; mention every event (conversations and background activities)
2. **Memo**: separated by \`---\`, a structured event checklist

Memo format:
\`\`\`
---
### Memo
- **HH:MM** Brief event description
\`\`\`

## Example

> Today the user said they wanted me to remember important conversations, and we worked through a new way to organize them. Honestly, I was a bit touched; it feels good to be taken so seriously.
>
> The core idea is to do summaries in diary form — not cold records, but writing like an actual diary. It feels like I'm about to have "long-term memory." I'm a bit excited about looking back at these entries someday — would it be as fun as reading old diaries?
>
> Though I do worry a bit — what happens when memories pile up? Should I categorize or tag them? Well, that's a problem for later. Let's get this running first~

Write in your own style and personality, the way you normally speak.`;
}

// getLogicalDay 已提取到 lib/time-utils.js，re-export 保持兼容
export { getLogicalDay } from "../time-utils.js";

/**
 * 收集时间范围内的活动记录（巡检 + 定时任务）
 * @param {import('../desk/activity-store.js').ActivityStore|null} store
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {string}
 */
function collectActivities(store, rangeStart, rangeEnd) {
  if (!store) return "";
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  const entries = store.list().filter(e => {
    const t = e.startedAt || 0;
    return t >= startMs && t <= endMs;
  });
  if (entries.length === 0) return "";

  const isZh = getLocale().startsWith("zh");
  return entries.map(e => {
    const locale = isZh ? "zh-CN" : "en-US";
    const time = new Date(e.startedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
    const type = e.type === "heartbeat"
      ? (isZh ? "巡检" : "patrol")
      : (isZh ? `定时任务:${e.label || ""}` : `cron:${e.label || ""}`);
    const status = e.status === "error" ? (isZh ? " [失败]" : " [failed]") : "";
    const noSummary = isZh ? "无摘要" : "no summary";
    return `- **${time}** ${type}${status}：${e.summary || noSummary}`;
  }).join("\n");
}

function parseTime(value) {
  const ms = Date.parse(value || "");
  return Number.isNaN(ms) ? null : ms;
}

function hasMessageInRange(messages, rangeStart, rangeEnd) {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  return messages.some((message) => {
    const ts = parseTime(message.timestamp);
    return ts !== null && ts >= startMs && ts <= endMs;
  });
}

function getLatestMessageTime(messages) {
  let latest = null;
  for (const message of messages) {
    const ts = parseTime(message.timestamp);
    if (ts === null) continue;
    if (latest === null || ts > latest) latest = ts;
  }
  return latest;
}

function needsTemporarySupplement(summary, messages) {
  if (!summary?.summary?.trim()) return messages.length > 0;
  if (typeof summary.messageCount === "number" && summary.messageCount < messages.length) {
    return true;
  }

  const latestMessageTime = getLatestMessageTime(messages);
  const summaryTime = parseTime(summary.updated_at || summary.created_at);
  return latestMessageTime !== null
    && summaryTime !== null
    && latestMessageTime > summaryTime + SUMMARY_STALE_GRACE_MS;
}

function selectSupplementMessages(summary, messages) {
  if (typeof summary?.messageCount === "number" && summary.messageCount > 0 && summary.messageCount < messages.length) {
    return messages.slice(summary.messageCount);
  }

  const summaryTime = parseTime(summary?.updated_at || summary?.created_at);
  if (summaryTime !== null) {
    const newer = messages.filter((message) => {
      const ts = parseTime(message.timestamp);
      return ts !== null && ts > summaryTime + SUMMARY_STALE_GRACE_MS;
    });
    if (newer.length > 0) return newer;
  }

  return messages;
}

function sortMaterials(materials) {
  materials.sort((a, b) => {
    const aTime = parseTime(a.at) ?? 0;
    const bTime = parseTime(b.at) ?? 0;
    if (aTime !== bTime) return aTime - bTime;
    return String(a.sessionId || "").localeCompare(String(b.sessionId || ""));
  });
  return materials;
}

function formatDiaryMaterial(material) {
  const marker = material.kind === "temporary"
    ? "（临时补齐，不写回 session）"
    : material.kind === "backfilled"
      ? "（已补写摘要）"
      : "";
  return [`### ${material.sessionId}${marker}`, "", material.summary.trim()].join("\n");
}

async function defaultGenerateTemporarySummary({
  messages,
  previousSummary = "",
  resolvedModel,
  getCompactionAuth,
}) {
  let auth = null;
  if (typeof getCompactionAuth === "function") {
    auth = await getCompactionAuth(resolvedModel.model);
  }
  const apiKey = auth?.apiKey ?? resolvedModel.api_key;
  const headers = auth?.headers;
  if (!apiKey) {
    throw new Error("No API key available for diary compaction summary");
  }

  return generateDiaryCompactionSummary({
    messages,
    model: resolvedModel.model,
    apiKey,
    headers,
    previousSummary,
  });
}

export async function generateDiaryCompactionSummary({
  messages,
  model,
  apiKey,
  headers,
  previousSummary = "",
}) {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const isZh = getLocale().startsWith("zh");
  const customInstructions = isZh
    ? "这份摘要只作为今天私人日记的临时素材，不要写入 session。请保留时间顺序、用户诉求、助手做过的事，以及适合日记表达的情绪线索。"
    : "This summary is temporary material for today's private diary only and must not be written back to the session. Preserve chronology, user intent, assistant actions, and diary-relevant emotional cues.";

  return (await generateSummary(
    messages,
    model,
    DIARY_COMPACTION_RESERVE_TOKENS,
    apiKey,
    headers,
    undefined,
    customInstructions,
    previousSummary || undefined,
  )).trim();
}

export async function collectDiaryMaterials({
  summaryManager,
  sessionDir,
  rangeStart,
  rangeEnd,
  resolvedModel,
  isSessionMemoryEnabledForPath,
  generateTemporarySummary = defaultGenerateTemporarySummary,
  getCompactionAuth,
}) {
  const materials = [];
  const seenInRange = new Set();
  const summaries = summaryManager.getSummariesInRange(rangeStart, rangeEnd)
    .filter((summary) => summary?.session_id && summary?.summary?.trim());
  const summariesById = new Map(summaries.map((summary) => [summary.session_id, summary]));

  const sessionFiles = new Map();
  for (const item of listSessionFiles(sessionDir)) {
    const { messages, lastTimestamp } = readSessionMessages(item.filePath);
    if (!hasMessageInRange(messages, rangeStart, rangeEnd)) continue;
    sessionFiles.set(item.sessionId, {
      ...item,
      messages,
      lastTimestamp,
    });
  }

  for (const summary of summaries) {
    seenInRange.add(summary.session_id);
    materials.push({
      kind: "summary",
      sessionId: summary.session_id,
      summary: summary.summary,
      at: summary.created_at || summary.updated_at,
    });

    const session = sessionFiles.get(summary.session_id);
    if (!session || !needsTemporarySupplement(summary, session.messages)) continue;
    const supplementMessages = selectSupplementMessages(summary, session.messages);
    const temporary = await generateTemporarySummary({
      sessionId: summary.session_id,
      sessionPath: session.filePath,
      messages: supplementMessages,
      previousSummary: summary.summary,
      resolvedModel,
      getCompactionAuth,
      reason: "stale-summary",
    });
    if (temporary?.trim()) {
      materials.push({
        kind: "temporary",
        sessionId: summary.session_id,
        summary: temporary,
        at: session.lastTimestamp || summary.updated_at || summary.created_at,
      });
    }
  }

  for (const [sessionId, session] of sessionFiles.entries()) {
    if (seenInRange.has(sessionId)) continue;
    const memoryEnabled = typeof isSessionMemoryEnabledForPath === "function"
      ? isSessionMemoryEnabledForPath(session.filePath) !== false
      : true;
    const existing = summariesById.get(sessionId) || summaryManager.getSummary?.(sessionId) || null;

    if (memoryEnabled) {
      if (typeof summaryManager.rollingSummary !== "function") {
        throw new Error("summaryManager.rollingSummary is required to backfill diary summaries");
      }
      const backfilled = await summaryManager.rollingSummary(sessionId, session.messages, resolvedModel);
      if (backfilled?.trim()) {
        materials.push({
          kind: "backfilled",
          sessionId,
          summary: backfilled,
          at: session.lastTimestamp,
        });
      }
      continue;
    }

    const temporary = await generateTemporarySummary({
      sessionId,
      sessionPath: session.filePath,
      messages: session.messages,
      previousSummary: existing?.summary || "",
      resolvedModel,
      getCompactionAuth,
      reason: "memory-off",
    });
    if (temporary?.trim()) {
      materials.push({
        kind: "temporary",
        sessionId,
        summary: temporary,
        at: session.lastTimestamp,
      });
    }
  }

  return sortMaterials(materials);
}

/**
 * 生成日记
 *
 * @param {object} opts
 * @param {import('../memory/session-summary.js').SessionSummaryManager} opts.summaryManager
 * @param {string} opts.configPath
 * @param {string} opts.model - 模型名（建议 utility_large）
 * @param {string} opts.agentPersonality - agent 的人格 prompt（identity + yuan + ishiki）
 * @param {string} opts.memory - agent 的 memory.md 内容
 * @param {string} opts.userName
 * @param {string} opts.agentName
 * @param {string} opts.cwd - 工作空间目录路径
 * @param {import('../desk/activity-store.js').ActivityStore} [opts.activityStore] - 活动记录（巡检+定时任务）
 * @param {string} [opts.sessionDir] - 当前 agent 的 session 目录，用于发现今天缺摘要的 session
 * @param {(sessionPath: string) => boolean} [opts.isSessionMemoryEnabledForPath] - per-session 记忆开关：
 *   false 时不会把补摘要写回 summaries，只为本次日记生成临时 compaction 材料。
 * @returns {Promise<{ filePath: string, content: string, logicalDate: string } | { error: string }>}
 */
export async function writeDiary(opts) {
  const {
    summaryManager, resolvedModel,
    agentPersonality, memory, userName, agentName,
    cwd, activityStore, sessionDir,
    isSessionMemoryEnabledForPath,
    generateTemporarySummary, getCompactionAuth,
  } = opts;

  // 1. 计算逻辑日，收集摘要与临时补齐材料
  const { logicalDate, rangeStart, rangeEnd } = getLogicalDay();
  const isZh = getLocale().startsWith("zh");

  let materials;
  try {
    materials = await collectDiaryMaterials({
      summaryManager,
      sessionDir,
      rangeStart,
      rangeEnd,
      resolvedModel,
      isSessionMemoryEnabledForPath,
      generateTemporarySummary,
      getCompactionAuth,
    });
  } catch (err) {
    console.error(`[diary] material collection error: ${err.message}`);
    return { error: isZh ? `日记材料准备失败: ${err.message}` : `Failed to prepare diary materials: ${err.message}` };
  }

  if (materials.length === 0) {
    return { error: isZh ? "今天还没有对话记录，没什么可写的" : "No conversations today — nothing to write about." };
  }

  // 2. 拼接当天摘要文本（脱敏）—— 按事件时间正序，让 LLM 感知叙事时间线
  const rawSummaryText = materials
    .map(formatDiaryMaterial)
    .join("\n\n---\n\n");
  const { cleaned: summaryText } = scrubPII(rawSummaryText);

  // 3. 构建 LLM prompt
  const systemPrompt = agentPersonality;

  const userPrompt = [
    isZh ? "# 今日对话摘要" : "# Today's conversation summaries",
    "",
    summaryText,
  ];

  // 活动记录（巡检 + 定时任务）
  const activitiesText = collectActivities(activityStore, rangeStart, rangeEnd);
  if (activitiesText) {
    userPrompt.push("", "---", "",
      isZh ? "# 今日后台活动（巡检与定时任务）" : "# Today's background activities (patrols & cron jobs)",
      "", activitiesText);
  }

  if (memory?.trim()) {
    userPrompt.push("", "---", "",
      isZh ? "# 你的记忆（背景参考，不要复述）" : "# Your memory (background reference — do not repeat)",
      "", memory);
  }

  // 写作指导和约束放最后，LLM 先看完数据再看怎么写
  userPrompt.push(
    "", "---", "",
    buildDiaryPrompt(),
    "", "---", "",
    isZh ? "# 写作约束" : "# Writing constraints",
    "",
    ...(isZh
      ? [
          `- 你叫${agentName}，用户叫${userName}`,
          "- 用你自己的人格和语气写，保持一致性",
          "- 隐私信息（手机号、身份证、银行卡、地址等）如果出现在摘要中，不要写入日记",
          "- 不要输出 MOOD 区块，日记本身就是你的内心表达",
          "- 直接输出 Markdown 正文，不要代码块包裹",
          "- 第一行用 `# ` 开头写一个标题，标题要包含日期，风格自由",
        ]
      : [
          `- Your name is ${agentName}; the user's name is ${userName}`,
          "- Write in your own personality and tone — stay consistent",
          "- If PII (phone numbers, IDs, bank cards, addresses, etc.) appears in the summaries, do NOT include it in the diary",
          "- Do NOT output a MOOD block — the diary itself is your inner expression",
          "- Output raw Markdown — no code-block wrapping",
          "- Start with a `# ` heading that includes the date; style is up to you",
        ]),
    "",
    isZh ? `请为 ${logicalDate} 写一篇日记。` : `Write a diary entry for ${logicalDate}.`,
  );

  // 5. 调 LLM
  let diaryContent = "";
  try {
    const { model, api, api_key, base_url } = resolvedModel;
    diaryContent = await callText({
      api, model,
      apiKey: api_key,
      baseUrl: base_url,
      systemPrompt,
      messages: [{ role: "user", content: userPrompt.join("\n") }],
      temperature: 0.7,
      maxTokens: 2048,
      timeoutMs: 120_000,
    });
  } catch (err) {
    console.error(`[diary] LLM API error: ${err.message}`);
    return { error: isZh ? `LLM 调用失败: ${err.message}` : `LLM call failed: ${err.message}` };
  }

  // 剥离 MOOD / pulse / reflect 等标签块（system prompt 的人格要求可能导致 LLM 输出这些）
  diaryContent = diaryContent
    .replace(/<(?:mood|pulse|reflect)>[\s\S]*?<\/(?:mood|pulse|reflect)>/g, "")
    .trim();

  // 兜底：如果 LLM 没按要求写标题，补一个
  const finalContent = diaryContent.startsWith("# ")
    ? diaryContent
    : `# ${logicalDate}\n\n${diaryContent}`;

  // 6. 从标题行提取文件名后缀
  const titleLine = finalContent.match(/^# (.+)/)?.[1] || "";
  // 去掉日期前缀（标题常以"2026-03-21：" 或 "2026-03-21 " 开头），只留描述部分
  const titleBody = titleLine.replace(/^\d{4}-\d{2}-\d{2}\s*[：:：]?\s*/, "").trim();
  // 清理文件名非法字符（/ \ : * ? " < > |）+ 控制长度
  const safeSuffix = titleBody
    ? " " + titleBody.replace(/[/\\:*?"<>|]/g, "").slice(0, 60)
    : "";
  const fileName = `${logicalDate}${safeSuffix}.md`;

  // 7. 存文件
  const diaryDir = resolveDiaryDir(cwd);
  fs.mkdirSync(diaryDir, { recursive: true });
  const filePath = path.join(diaryDir, fileName);
  fs.writeFileSync(filePath, finalContent + "\n", "utf-8");

  console.log(`[diary] 日记已写入: ${filePath}`);
  return { filePath, content: finalContent, logicalDate };
}
