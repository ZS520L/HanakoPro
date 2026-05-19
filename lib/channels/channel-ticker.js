/**
 * channel-ticker.js — 频道手机调度器（中断恢复 + 主动提醒）
 *
 * 调度模型：
 * - 群聊新消息 → 中断当前执行 → 手机送达所有频道成员 → 恢复中断点
 * - 频道提醒到期 → 随机点醒一个频道成员 → 让它基于频道 Truth 主动发言
 *
 * 中断恢复机制：
 * - 用户消息到达时，abort 当前 session
 * - 保存检查点（已处理到哪个 agent 的哪个频道）
 * - 处理完用户消息后，从检查点恢复继续
 *
 * 调度器本身不调用 LLM，通过回调委托给 engine。
 */

import {
  readBookmarks,
  updateBookmark,
  getNewMessages,
  getRecentMessages,
  getChannelMembers,
  getChannelMeta,
} from "./channel-store.js";
import { debugLog } from "../debug-log.js";
import { readBoolean, resolveAgentPhoneGuardLimit } from "../conversations/agent-phone-prompt.js";
import fs from "fs";
import path from "path";

/**
 * 创建频道顺序轮询调度器
 *
 * @param {object} opts
 * @param {string} opts.channelsDir - 频道目录
 * @param {string} opts.agentsDir - agents 父目录
 * @param {() => string[]} opts.getAgentOrder - 返回参与轮转的 agent ID 列表
 * @param {(agentId, channelName, newMessages, allUpdates, opts?) => Promise<{replied, replyContent?}>} opts.executeCheck
 * @param {(agentId, channelName, payload) => Promise<void>} opts.onMemorySummarize
 * @param {(event, data) => void} [opts.onEvent]
 * @returns {{ start, stop, triggerImmediate, isRunning }}
 */
export function createChannelTicker({
  channelsDir,
  agentsDir,
  getAgentOrder,
  executeCheck,
  onMemorySummarize,
  onEvent,
  random = Math.random,
}) {
  const DEFAULT_REMINDER_INTERVAL_MINUTES = 31;
  const PAUSE_MS = DEFAULT_REMINDER_INTERVAL_MINUTES * 60 * 1000;

  // ── 状态 ──
  let _timer = null;          // 下一个 cycle 的定时器
  let _cyclePromise = null;   // 当前 cycle 的 Promise
  let _abortCtrl = null;      // 当前频道执行的 AbortController
  let _interruptPending = false; // 中断标记
  let _checkpoint = null;     // { agentIdx, channelIdx } 中断恢复点
  let _running = false;       // 是否有 cycle 在运行
  const _reminderDueAt = new Map(); // channelName → { dueAt, intervalMs }

  // ── 手机送达状态（新群聊消息触发的立即处理）──
  let _deliveryAbortCtrl = null; // delivery 专用 AbortController
  let _deliveryPromise = null;   // 当前 delivery 的 Promise
  let _triggerChain = Promise.resolve(); // 串行化 triggerImmediate 调用
  let _stopped = false;          // stop() 后禁止新的 delivery

  // ── 工具函数 ──

  /** 获取频道文件中最新一条消息的时间戳 */
  function getLatestTimestamp(channelFile) {
    if (!fs.existsSync(channelFile)) return null;
    const content = fs.readFileSync(channelFile, "utf-8");
    const headerRe = /^### .+? \| (\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?)$/gm;
    let lastMatch = null;
    let m;
    while ((m = headerRe.exec(content)) !== null) {
      lastMatch = m[1];
    }
    return lastMatch;
  }

  function listChannelFiles() {
    if (!fs.existsSync(channelsDir)) return [];
    return fs.readdirSync(channelsDir)
      .filter(f => f.endsWith(".md"))
      .map(f => ({
        channelName: f.replace(/\.md$/, ""),
        channelFile: path.join(channelsDir, f),
      }));
  }

  function readReminderIntervalMs(channelFile) {
    const meta = getChannelMeta(channelFile);
    const minutes = Number(meta.agentPhoneReminderIntervalMinutes);
    const normalized = Number.isFinite(minutes) && minutes > 0
      ? Math.floor(minutes)
      : DEFAULT_REMINDER_INTERVAL_MINUTES;
    return normalized * 60 * 1000;
  }

  function isProactiveEnabled(channelFile) {
    const meta = getChannelMeta(channelFile);
    return meta.agentPhoneProactiveEnabled === undefined
      ? true
      : readBoolean(meta.agentPhoneProactiveEnabled);
  }

  function refreshReminderSchedule(now = Date.now()) {
    const seen = new Set();
    for (const { channelName, channelFile } of listChannelFiles()) {
      seen.add(channelName);
      if (!isProactiveEnabled(channelFile)) {
        _reminderDueAt.delete(channelName);
        continue;
      }
      const intervalMs = readReminderIntervalMs(channelFile);
      const existing = _reminderDueAt.get(channelName);
      if (!existing || existing.intervalMs !== intervalMs) {
        _reminderDueAt.set(channelName, { intervalMs, dueAt: now + intervalMs });
      }
    }
    for (const channelName of [..._reminderDueAt.keys()]) {
      if (!seen.has(channelName)) _reminderDueAt.delete(channelName);
    }
  }

  function resetChannelReminder(channelName, now = Date.now()) {
    const channelFile = path.join(channelsDir, `${channelName}.md`);
    if (!fs.existsSync(channelFile)) {
      _reminderDueAt.delete(channelName);
      return;
    }
    if (!isProactiveEnabled(channelFile)) {
      _reminderDueAt.delete(channelName);
      return;
    }
    const intervalMs = readReminderIntervalMs(channelFile);
    _reminderDueAt.set(channelName, { intervalMs, dueAt: now + intervalMs });
  }

  function readGuardLimit(channelFile, memberCount) {
    const meta = getChannelMeta(channelFile);
    return resolveAgentPhoneGuardLimit(meta.agentPhoneGuardLimit, memberCount);
  }

  function pickRandomAgent(channelName) {
    const channelFile = path.join(channelsDir, `${channelName}.md`);
    if (!fs.existsSync(channelFile)) return null;
    const channelMembers = new Set(getChannelMembers(channelFile));
    const agents = getAgentOrder().filter(id => channelMembers.has(id));
    if (agents.length === 0) return null;
    const idx = Math.min(agents.length - 1, Math.floor(Math.max(0, Math.min(0.999999, random())) * agents.length));
    return agents[idx];
  }

  /** 收集一个 agent 的所有频道更新（有新消息的） */
  function collectAgentChannels(agentId) {
    const channelsMdPath = path.join(agentsDir, agentId, "channels.md");
    const bookmarks = readBookmarks(channelsMdPath);
    const updates = [];

    for (const { channelName, channelFile } of listChannelFiles()) {
      const members = getChannelMembers(channelFile);
      if (!members.includes(agentId)) continue;

      const bookmark = bookmarks.get(channelName);
      const bk = !bookmark || bookmark === "never" ? null : bookmark;
      // 每个 agent 的 phone cursor 是自己的 bookmark；送达内容只包含它还没看过的新群聊消息。
      const recentMsgs = getNewMessages(channelFile, bk, agentId);
      const hasNew = recentMsgs.length > 0;

      updates.push({
        channelName,
        channelFile,
        channelsMdPath,
        bookmark: bk,
        newMessages: recentMsgs,
        hasNew,
      });
    }
    return updates;
  }

  // ── 核心：顺序轮询 ──

  /**
   * 执行一个完整的 cycle：所有 agent 依次处理所有频道
   * 支持从 checkpoint 恢复
   */
  async function _runCycle() {
    _running = true;
    try {
      const agents = getAgentOrder();
      if (agents.length === 0) return;

      // 从检查点恢复或从头开始
      const startAgent = _checkpoint?.agentIdx ?? 0;
      const startChannel = _checkpoint?.channelIdx ?? 0;
      _checkpoint = null;

      console.log(`\x1b[90m[channel-ticker] cycle 开始（${agents.length} 个 agent${startAgent > 0 ? `，从 ${agents[startAgent]} 恢复` : ""}）\x1b[0m`);
      debugLog()?.log("ticker", `cycle start (${agents.length} agents${startAgent > 0 ? `, resume from idx ${startAgent}` : ""})`);
      onEvent?.("channel_cycle_start", { agents, resumeFrom: startAgent });

      for (let ai = startAgent; ai < agents.length; ai++) {
        const agentId = agents[ai];
        const channelUpdates = collectAgentChannels(agentId);
        const withNew = channelUpdates.filter(u => u.hasNew);
        const startCh = (ai === startAgent) ? startChannel : 0;

        if (withNew.length === 0) {
          debugLog()?.log("ticker", `${agentId}: no new messages, skipping`);
          continue;
        }

        console.log(`\x1b[90m[channel-ticker] → ${agentId}（${withNew.length} 个频道有新消息）\x1b[0m`);
        debugLog()?.log("ticker", `→ ${agentId} (${withNew.length} channels with new msgs)`);

        for (let ci = startCh; ci < channelUpdates.length; ci++) {
          // ★ 每个频道之前检查中断
          if (_interruptPending) {
            _checkpoint = { agentIdx: ai, channelIdx: ci };
            console.log(`\x1b[90m[channel-ticker] 中断！保存检查点 agent=${agentId} ch=${ci}\x1b[0m`);
            debugLog()?.log("ticker", `interrupted, checkpoint: agent=${ai} ch=${ci}`);
            return;
          }

          const update = channelUpdates[ci];
          if (!update.hasNew) continue;

          await _processOneChannel(agentId, update);
        }
      }

      // 全部完成
      console.log(`\x1b[90m[channel-ticker] cycle 完成，${Math.round(PAUSE_MS / 1000)}秒后下一轮\x1b[0m`);
      debugLog()?.log("ticker", `cycle done, next in ${Math.round(PAUSE_MS / 1000)}s`);
      onEvent?.("channel_cycle_done", {});
      _scheduleNext(PAUSE_MS);
    } catch (err) {
      console.error(`\x1b[90m[channel-ticker] cycle 错误: ${err.message}\x1b[0m`);
      debugLog()?.error("ticker", `cycle error: ${err.message}`);
      // 出错后也调度下一轮
      _scheduleNext(PAUSE_MS);
    } finally {
      _running = false;
    }
  }

  /**
   * 处理单个频道（可被 abort）
   */
  async function _processOneChannel(agentId, update) {
    _abortCtrl = new AbortController();

    console.log(`\x1b[90m[channel-ticker] ${agentId} 检查 #${update.channelName}（${update.newMessages.length} 条新消息）\x1b[0m`);

    try {
      const result = await executeCheck(
        agentId,
        update.channelName,
        update.newMessages,
        [],
        { signal: _abortCtrl.signal },
      );

      // 成功：更新 bookmark
      const latestTs = getLatestTimestamp(update.channelFile);
      if (latestTs) {
        await updateBookmark(update.channelsMdPath, update.channelName, latestTs);
      }

      // 回复了 → 记忆摘要
      if (result?.replied && onMemorySummarize) {
        await onMemorySummarize(agentId, update.channelName, {
          messages: update.newMessages,
          replyContent: result.replyContent || "",
        });
      }
    } catch (err) {
      if (_interruptPending) {
        // 被中断，不更新 bookmark（下次重试）
        console.log(`\x1b[90m[channel-ticker] ${agentId}/#${update.channelName} 被中断\x1b[0m`);
        return;
      }
      console.error(`\x1b[90m[channel-ticker] ${agentId} 处理 #${update.channelName} 失败: ${err.message}\x1b[0m`);
    } finally {
      _abortCtrl = null;
    }
  }

  // ── 中断处理 ──

  /**
   * 新群聊消息后立即中断 + 手机送达
   *
   * 合并机制：如果用户连续发多条消息，后到的消息会：
   * 1. abort 正在进行的 delivery（如果有）
   * 2. 等它结束
   * 3. 用最新的滑动窗口重新开始
   *
   * 这样保证 agent 看到的永远是最新的完整上下文。
   *
   * @param {string} channelName
   * @param {{ mentionedAgents?: string[] }} [opts]
   */
  function triggerImmediate(channelName, { mentionedAgents } = {}) {
    if (_stopped) return Promise.resolve();

    // 串行化：新调用排在前一个完成之后，避免并发重入
    _triggerChain = _triggerChain.then(async () => {
      if (_stopped) return;

      // abort 正在进行的 delivery（如果有）
      if (_deliveryAbortCtrl) {
        console.log(`\x1b[90m[channel-ticker] 新消息到达，abort 当前送达并重新开始\x1b[0m`);
        debugLog()?.log("ticker", `new message arrived, aborting current delivery to restart`);
        _deliveryAbortCtrl.abort();
      }
      if (_deliveryPromise) {
        await _deliveryPromise.catch(() => {});
        _deliveryPromise = null;
      }

      // 启动新的 delivery
      _deliveryPromise = _doDelivery(channelName, { mentionedAgents });
      await _deliveryPromise.catch(() => {});
      _deliveryPromise = null;
    }).catch(() => {});

    return _triggerChain;
  }

  function triggerReminder(channelName) {
    if (_stopped) return Promise.resolve();
    _triggerChain = _triggerChain.then(async () => {
      if (_stopped) return;
      const channelFile = path.join(channelsDir, `${channelName}.md`);
      if (!fs.existsSync(channelFile) || !isProactiveEnabled(channelFile)) return;
      const proactiveAgentId = pickRandomAgent(channelName);
      if (!proactiveAgentId) return;
      _deliveryPromise = _doDelivery(channelName, { proactiveAgentId });
      await _deliveryPromise.catch(() => {});
      _deliveryPromise = null;
    }).catch(() => {});
    return _triggerChain;
  }

  /**
   * 实际执行手机消息送达的内部方法（可被 abort）
   */
  async function _doDelivery(channelName, { mentionedAgents, proactiveAgentId = null } = {}) {
    // ── 1. 中断正在运行的 cycle ──
    _interruptPending = true;

    if (_abortCtrl) {
      _abortCtrl.abort();
    }

    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }

    if (_cyclePromise) {
      await _cyclePromise.catch(() => {});
      _cyclePromise = null;
    }

    _interruptPending = false;

    // ── 2. 创建 delivery 专用 AbortController ──
    _deliveryAbortCtrl = new AbortController();
    const signal = _deliveryAbortCtrl.signal;

    // ── 3. 过滤 agent：频道 members 是唯一成员真相源，cursor 只表示读到哪儿 ──
    const channelFile = path.join(channelsDir, `${channelName}.md`);
    if (!fs.existsSync(channelFile)) return;
    const channelMembers = new Set(getChannelMembers(channelFile));
    const allAgents = getAgentOrder();
    const mentionedList = Array.from(new Set(
      Array.isArray(mentionedAgents)
        ? mentionedAgents.filter((agentId) => typeof agentId === "string" && agentId.trim()).map((agentId) => agentId.trim())
        : [],
    ));
    const mentionedSet = new Set(mentionedList);
    const hasMentions = mentionedSet.size > 0;
    const memberAgents = allAgents
      .filter(id => channelMembers.has(id))
      .sort((a, b) =>
        Number(b === proactiveAgentId) - Number(a === proactiveAgentId)
        || Number(mentionedSet.has(b)) - Number(mentionedSet.has(a)));
    let agents = proactiveAgentId
      ? memberAgents.filter(id => id === proactiveAgentId)
      : memberAgents;

    const deliveryLabel = proactiveAgentId
      ? `频道提醒 → ${proactiveAgentId}`
      : `新群聊消息 → 手机送达`;
    console.log(`\x1b[90m[channel-ticker] ${deliveryLabel} #${channelName}（${agents.length}/${allAgents.length} 个 agent${hasMentions ? `，优先 @ ${[...mentionedSet].join(",")}` : ""}）\x1b[0m`);
    debugLog()?.log("ticker", `phone delivery #${channelName} (${agents.length} agents${proactiveAgentId ? `, proactive=${proactiveAgentId}` : ""}${hasMentions ? `, mentioned first: ${[...mentionedSet].join(",")}` : ""})`);

    // ── 4. 逐个 agent 送达未读消息；有人发言则继续下一轮，直到所有手机都追平 ──
    try {
      const maxChecks = readGuardLimit(channelFile, memberAgents.length);
      let checks = 0;
      let proactiveDelivered = false;
      let expandedAfterProactiveReply = false;

      while (agents.length > 0 && checks < maxChecks) {
        let delivered = 0;
        let replied = false;

        for (const agentId of agents) {
          if (checks >= maxChecks) break;

          // ★ 被 abort 了就停
          if (signal.aborted) {
            console.log(`\x1b[90m[channel-ticker] 手机送达被新消息中断，停止\x1b[0m`);
            debugLog()?.log("ticker", `phone delivery aborted by new message`);
            return;
          }

          const channelsMdPath = path.join(agentsDir, agentId, "channels.md");
          const bookmarks = readBookmarks(channelsMdPath);
          const bookmark = bookmarks.get(channelName);
          const bk = !bookmark || bookmark === "never" ? null : bookmark;
          const proactive = !proactiveDelivered && proactiveAgentId === agentId;
          const unreadMsgs = proactive
            ? getRecentMessages(channelFile, 20, agentId)
            : getNewMessages(channelFile, bk, agentId);
          if (unreadMsgs.length === 0) continue;
          if (proactive) proactiveDelivered = true;

          delivered += 1;
          checks += 1;
          console.log(`\x1b[90m[channel-ticker] ${proactive ? "提醒" : "送达"} ${agentId} → #${channelName}（${unreadMsgs.length} 条${proactive ? "最近消息" : "未读"}）\x1b[0m`);

          try {
            const result = await executeCheck(agentId, channelName, unreadMsgs, [], {
              signal,
              proactive,
              ...(hasMentions ? {
                mentionedAgents: mentionedList,
                mentionTargeted: mentionedSet.has(agentId),
              } : {}),
            });

            if (signal.aborted) return; // 被 abort 了，不更新 bookmark

            const latestTs = getLatestTimestamp(channelFile);
            if (latestTs) {
              await updateBookmark(channelsMdPath, channelName, latestTs);
            }

            if (onMemorySummarize) {
              await onMemorySummarize(agentId, channelName, {
                messages: unreadMsgs,
                replyContent: result?.replyContent || "",
              });
            }

            if (result?.replied) replied = true;
            if (result?.replied && proactiveAgentId && !expandedAfterProactiveReply) {
              agents = memberAgents;
              expandedAfterProactiveReply = true;
            }
          } catch (err) {
            if (signal.aborted) return; // 被 abort 了，静默退出
            console.error(`[channel-ticker] 手机送达 ${agentId}/#${channelName} 失败: ${err.message}`);
          }
        }

        if (delivered === 0 || !replied) break;
      }

      if (checks >= maxChecks) {
        console.warn(`\x1b[90m[channel-ticker] #${channelName} phone delivery reached guard limit (${maxChecks})\x1b[0m`);
        debugLog()?.warn?.("ticker", `phone delivery guard limit hit #${channelName} (${maxChecks} checks)`);
        onEvent?.("channel_delivery_guard", { channelName, maxChecks });
      }
    } finally {
      _deliveryAbortCtrl = null;

      // ── 5. 恢复被中断的 cycle 或调度下一轮 ──
      // 放在 finally 里，这样即使 delivery 被 abort 也能恢复 checkpoint。
      // 但如果被 abort 了，由新的 delivery 负责恢复，这里跳过。
      if (!signal.aborted) {
        if (_checkpoint) {
          console.log(`\x1b[90m[channel-ticker] 恢复中断的 cycle（checkpoint agent=${_checkpoint.agentIdx} ch=${_checkpoint.channelIdx}）\x1b[0m`);
          debugLog()?.log("ticker", `resuming cycle from checkpoint`);
          _cyclePromise = _runCycle();
        } else {
          resetChannelReminder(channelName);
          _scheduleNext(PAUSE_MS);
        }
      }
    }
  }

  // ── 定时调度 ──

  /** 调度下一个 cycle */
  function _scheduleNext(_delayMs) {
    if (_timer) clearTimeout(_timer);
    refreshReminderSchedule();
    let nextChannel = null;
    let nextDueAt = Infinity;
    for (const [channelName, entry] of _reminderDueAt.entries()) {
      if (entry.dueAt < nextDueAt) {
        nextDueAt = entry.dueAt;
        nextChannel = channelName;
      }
    }
    if (!nextChannel) return;
    const delayMs = Math.max(0, nextDueAt - Date.now());
    _timer = setTimeout(() => {
      _timer = null;
      triggerReminder(nextChannel).finally(() => _scheduleNext());
    }, delayMs);
    if (_timer.unref) _timer.unref();

    console.log(`\x1b[90m[channel-ticker] 下次频道提醒：#${nextChannel}，${Math.round(delayMs / 1000)}秒后\x1b[0m`);
  }

  function refreshSchedule() {
    if (_stopped) return;
    _scheduleNext();
  }

  /** 启动调度器 */
  function start() {
    if (_timer || _running) return;
    _stopped = false;

    console.log(`\x1b[90m[channel-ticker] 调度器已启动（默认频道提醒间隔 ${DEFAULT_REMINDER_INTERVAL_MINUTES} 分钟）\x1b[0m`);
    _scheduleNext();
  }

  /** 停止调度器 */
  async function stop() {
    _stopped = true; // 禁止新的 delivery
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
    // 停止 delivery
    if (_deliveryAbortCtrl) _deliveryAbortCtrl.abort();
    if (_deliveryPromise) {
      await _deliveryPromise.catch(() => {});
      _deliveryPromise = null;
    }
    // 等待串行链完成
    await _triggerChain.catch(() => {});
    // 标记中断，让 cycle 尽快退出
    _interruptPending = true;
    if (_abortCtrl) _abortCtrl.abort();
    if (_cyclePromise) {
      await _cyclePromise.catch(() => {});
      _cyclePromise = null;
    }
    _interruptPending = false;
    _checkpoint = null;
  }

  return {
    start,
    stop,
    triggerImmediate,
    triggerReminder,
    refreshSchedule,
    get isRunning() { return _running; },
  };
}
