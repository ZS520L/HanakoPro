/**
 * ToolGroupBlock — 工具调用组，含展开/折叠
 */

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import styles from './Chat.module.css';
import { extractToolDetail } from '../../utils/message-parser';
import type { ToolDetail } from '../../utils/message-parser';
import { TerminalSessionCard } from './TerminalSessionCard';
import { FileDiffCard } from './FileDiffCard';

import type { ToolCall } from '../../stores/chat-types';
import type { TerminalAggregate } from './AssistantMessage';

interface Props {
  tools: ToolCall[];
  collapsed: boolean;
  agentName?: string;
  /** 在更早的 tool_group 已经画过卡片的 terminal session id。该列表里的会话不再重复渲染卡片。*/
  excludeTerminalIds?: Set<string>;
  /**
   * 整条 assistant message 跨 tool_group 聚合后的终端 session 输出快照。
   * 当本 group 内的 terminal_create / terminal_write 没有 captured output 时，
   * 用这里的快照（一般来自后续 tool_group 里 wait/read 的结果）回灌静态预览，
   * 避免 server 重启后历史对话的终端卡变成"(暂无输出…)"。
   */
  terminalAggregates?: Map<string, TerminalAggregate>;
}

function getToolLabel(name: string, phase: string, agentName: string): string {
  const t = window.t;
  const vars = { name: agentName };
  const val = t?.(`tool.${name}.${phase}`, vars);
  if (val && val !== `tool.${name}.${phase}`) return val;
  return t?.(`tool._fallback.${phase}`, vars) || name;
}

export const ToolGroupBlock = memo(function ToolGroupBlock({ tools: rawTools, collapsed: initialCollapsed, agentName = 'Hanako', excludeTerminalIds, terminalAggregates }: Props) {
  // subagent 有独立卡片，不在工具组里重复显示
  const tools = rawTools.filter(t => t.name !== 'subagent');
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  useEffect(() => {
    setCollapsed(initialCollapsed);
  }, [initialCollapsed]);
  const toggle = useCallback(() => setCollapsed(v => !v), []);

  if (tools.length === 0) return null;

  const allDone = tools.every(t => t.done);
  const failCount = tools.filter(t => t.done && !t.success).length;
  const isSingle = tools.length === 1;

  // 终端卡片渲染策略（对齐 Windsurf 的 run_command 模型）：
  //
  //   1. 卡片只在「本组里发生了一次"主动动作"」时才渲染，即必须出现 terminal_create 或 terminal_write。
  //      纯观察类调用（terminal_read / terminal_wait / terminal_interrupt / terminal_kill）单独出现时
  //      不再画新卡 —— 用户要看那段输出，回滚去最近的 run_command 卡片即可，
  //      避免每次"打断 / 确认"都生成一张近似重复的卡。
  //
  //   2. 同一会话 id 在本组里只画一张卡。
  //
  //   3. 卡片的静态输出来源优先级：
  //        terminal_wait.details.output  (那次 wait 期间的新输出切片，最贴近"这条命令产出了什么")
  //      > terminal_read.details.output  (ring buffer 尾部，可能含旧轮内容)
  //      > terminal_create.details.output (通常为空，仅 fallback)
  //      高优先级源有值后，低优先级不会覆盖；同优先级取最后一次。
  //
  //   4. 没有任何 captured output 时（例如本组只有 terminal_create + terminal_write），
  //      卡片回退到 WS 实时订阅，展示该会话当前 PTY 尾部。
  interface TermSeed {
    id: string;
    title?: string;
    cwd?: string;
    /** 本轮静态输出快照（按优先级取自 wait/read/create 的 details.output） */
    staticOutput?: string;
    staticAlive?: boolean;
    staticExitCode?: number | null;
    truncated?: boolean;
    /** 已记录的 staticOutput 来自哪种工具（用于优先级比较） */
    outputSource?: 'wait' | 'read' | 'create';
    /** 本组工具调用涉及的 cursor 范围 —— 卡片用它向 server 拉完整输出 */
    sliceFrom?: number;
    sliceTo?: number;
  }
  const OUTPUT_PRIORITY: Record<string, number> = {
    terminal_wait: 3,
    terminal_read: 2,
    terminal_create: 1,
  };
  // 第一步：扫所有 terminal_* tool，确定哪些 session id 触发了"主动动作"
  const activeIds = new Set<string>();
  for (const t of tools) {
    if (t.name !== 'terminal_create' && t.name !== 'terminal_write') continue;
    const id = (t.details?.id as string | undefined) ?? (t.args?.id as string | undefined);
    if (id && !excludeTerminalIds?.has(id)) activeIds.add(id);
  }
  // 第二步：聚合属于这些 active session 的所有 tool 的 metadata + 最佳 captured output
  const terminalSessions: TermSeed[] = [];
  const byId = new Map<string, TermSeed>();
  for (const t of tools) {
    if (!t.name.startsWith('terminal_')) continue;
    const id =
      (t.details?.id as string | undefined) ??
      (t.args?.id as string | undefined);
    if (!id || !activeIds.has(id)) continue;
    let seed = byId.get(id);
    if (!seed) {
      seed = {
        id,
        title: t.details?.title as string | undefined,
        cwd: t.details?.cwd as string | undefined,
      };
      byId.set(id, seed);
      terminalSessions.push(seed);
    }
    const out = t.details?.output as string | undefined;
    if (typeof out === 'string') {
      const incomingPriority = OUTPUT_PRIORITY[t.name] ?? 0;
      const currentPriority = seed.outputSource
        ? (OUTPUT_PRIORITY[`terminal_${seed.outputSource}`] ?? 0)
        : -1;
      if (incomingPriority >= currentPriority) {
        seed.staticOutput = out;
        seed.staticAlive = t.details?.alive as boolean | undefined;
        seed.staticExitCode = (t.details?.exitCode as number | null | undefined) ?? null;
        seed.truncated = !!(t.details?.outputTruncated);
        if (t.name === 'terminal_wait') seed.outputSource = 'wait';
        else if (t.name === 'terminal_read') seed.outputSource = 'read';
        else if (t.name === 'terminal_create') seed.outputSource = 'create';
      }
    }
    if (!seed.title && t.details?.title) seed.title = t.details.title as string;
    if (!seed.cwd && t.details?.cwd) seed.cwd = t.details.cwd as string;

    // 收集 cursor 范围 —— 用本组里能看到的最早 cursor 作为 sliceFrom，最新 cursor 作为 sliceTo
    // terminal_create: details.cursor (= 0 for 新建 session)
    // terminal_write : details.cursorBefore (写入前) / cursor (写入后)
    // terminal_wait  : details.sinceCursor / cursor
    // terminal_read  : details.cursor
    const candidateFroms: number[] = [];
    const candidateTos: number[] = [];
    if (t.name === 'terminal_create' && typeof t.details?.cursor === 'number') {
      candidateFroms.push(t.details.cursor as number);
    }
    if (t.name === 'terminal_write') {
      if (typeof t.details?.cursorBefore === 'number') candidateFroms.push(t.details.cursorBefore as number);
      if (typeof t.details?.cursor === 'number') candidateTos.push(t.details.cursor as number);
    }
    if (t.name === 'terminal_wait') {
      if (typeof t.details?.sinceCursor === 'number') candidateFroms.push(t.details.sinceCursor as number);
      if (typeof t.details?.cursor === 'number') candidateTos.push(t.details.cursor as number);
    }
    if (t.name === 'terminal_read' && typeof t.details?.cursor === 'number') {
      candidateTos.push(t.details.cursor as number);
    }
    for (const v of candidateFroms) {
      if (seed.sliceFrom === undefined || v < seed.sliceFrom) seed.sliceFrom = v;
    }
    for (const v of candidateTos) {
      if (seed.sliceTo === undefined || v > seed.sliceTo) seed.sliceTo = v;
    }
  }

  // 跨 tool_group 回灌：本 group 没拿到 output / cursor / title 的字段，
  // 用整条 message 聚合后的快照补上。这样重启后历史对话的终端卡也能看到内容。
  if (terminalAggregates) {
    for (const seed of terminalSessions) {
      const agg = terminalAggregates.get(seed.id);
      if (!agg) continue;
      if (seed.staticOutput === undefined && typeof agg.staticOutput === 'string') {
        seed.staticOutput = agg.staticOutput;
      }
      if (seed.staticAlive === undefined && typeof agg.staticAlive === 'boolean') seed.staticAlive = agg.staticAlive;
      if (seed.staticExitCode === undefined || seed.staticExitCode === null) seed.staticExitCode = agg.staticExitCode ?? null;
      if (!seed.truncated && agg.outputTruncated) seed.truncated = true;
      if (seed.sliceFrom === undefined && typeof agg.sliceFrom === 'number') seed.sliceFrom = agg.sliceFrom;
      if (seed.sliceTo === undefined && typeof agg.sliceTo === 'number') seed.sliceTo = agg.sliceTo;
      if (!seed.title && agg.title) seed.title = agg.title;
      if (!seed.cwd && agg.cwd) seed.cwd = agg.cwd;
    }
  }

  // ── 文件 diff 卡片（Windsurf 风格 inline diff）──
  // 对 write / edit / edit-diff 工具，如果 details 携带了 oldContent / newContent，就渲染一张 diff 卡片。
  interface DiffSeed {
    fileName: string;
    filePath: string;
    oldContent: string;
    newContent: string;
  }
  const FILE_TOUCH_TOOLS = new Set(['write', 'edit', 'edit-diff']);
  const diffCards: DiffSeed[] = [];
  const seenDiffPaths = new Set<string>();
  for (const t of tools) {
    if (!FILE_TOUCH_TOOLS.has(t.name) || !t.done) continue;
    const d = t.details as Record<string, unknown> | undefined;
    if (!d) continue;
    const fp = (d.filePath ?? d.file_path ?? t.args?.path ?? t.args?.file_path) as string | undefined;
    if (!fp || seenDiffPaths.has(fp)) continue;
    const oldC = d.oldContent as string | undefined;
    const newC = d.newContent as string | undefined;
    if (typeof oldC !== 'string' && typeof newC !== 'string') continue;
    // 跳过 oldContent === newContent（无变化）
    if (oldC === newC) continue;
    seenDiffPaths.add(fp);
    diffCards.push({
      fileName: (d.fileName as string) || fp.split(/[\\/]/).pop() || fp,
      filePath: fp,
      oldContent: oldC ?? '',
      newContent: newC ?? '',
    });
  }

  // 摘要标题
  const _t = window.t ?? ((p: string) => p);
  let summaryText = '';
  if (allDone) {
    if (failCount > 0) {
      summaryText = _t('toolGroup.countWithFail', { total: tools.length, fail: failCount });
    } else {
      summaryText = _t('toolGroup.count', { n: tools.length });
    }
  } else {
    const running = tools.filter(t => !t.done).length;
    summaryText = _t('toolGroup.running', { n: running });
  }

  return (
    <div className={`${styles.toolGroup}${isSingle ? ` ${styles.toolGroupSingle}` : ''}`}>
      {!isSingle && (
        <div
          className={`${styles.toolGroupSummary}${allDone ? ` ${styles.toolGroupSummaryClickable}` : ''}`}
          onClick={allDone ? toggle : undefined}
        >
          <span className={styles.toolGroupTitle}>{summaryText}</span>
          {allDone && <span className={styles.toolGroupArrow}>{collapsed ? '›' : '‹'}</span>}
          {!allDone && (
            <span className={styles.toolDots} />
          )}
        </div>
      )}
      <div className={`${styles.toolGroupContent}${collapsed && !isSingle ? ` ${styles.toolGroupContentCollapsed}` : ''}`}>
        {tools.map((tool, i) => (
          <ToolIndicator key={`${tool.name}-${i}`} tool={tool} agentName={agentName} />
        ))}
        {tools.filter(shouldShowLiveFileCard).map((tool, i) => (
          <FileWriteLiveCard key={`live-file-${tool.name}-${i}`} tool={tool} />
        ))}
        {/* 本组里出现过的每个终端会话都挂一个实时预览卡片 ——
            不限于 terminal_create，也包括复用已有 session 的 write/read/wait/interrupt/kill。
            这样用户在同一个 shell 上跑多轮命令时，每轮 AI 回复里都能看到实时输出，
            与 Windsurf 一致。 */}
        {diffCards.map(d => (
          <FileDiffCard
            key={`diff-${d.filePath}`}
            fileName={d.fileName}
            filePath={d.filePath}
            oldContent={d.oldContent}
            newContent={d.newContent}
          />
        ))}
        {terminalSessions.map(s => (
          <TerminalSessionCard
            key={`term-${s.id}`}
            termId={s.id}
            title={s.title}
            cwd={s.cwd}
            staticOutput={s.staticOutput}
            staticAlive={s.staticAlive}
            staticExitCode={s.staticExitCode ?? null}
            outputTruncated={s.truncated}
            sliceFrom={s.sliceFrom}
            sliceTo={s.sliceTo}
          />
        ))}
      </div>
    </div>
  );
});

// ── ToolIndicator ──

function handleDetailClick(e: React.MouseEvent, detail: ToolDetail) {
  e.preventDefault();
  e.stopPropagation();
  if (!detail.href) return;
  if (detail.hrefType === 'file') {
    window.platform?.showInFinder?.(detail.href);
  } else {
    window.platform?.openExternal?.(detail.href);
  }
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function waitSecondsFromTool(tool: ToolCall, now: number): number | null {
  const args = tool.args || {};
  const details = tool.details || {};
  const detailSeconds = finiteNumber(details.seconds);
  const argSeconds = finiteNumber(args.seconds);
  const seconds = detailSeconds ?? argSeconds;

  if (tool.done) return seconds;

  const startedAt = finiteNumber(args.startedAt);
  const durationMs = finiteNumber(args.durationMs);
  if (startedAt !== null && durationMs !== null) {
    return Math.max(0, Math.ceil((startedAt + durationMs - now) / 1000));
  }
  return seconds;
}

function waitToolDetail(tool: ToolCall, now: number): ToolDetail {
  const seconds = waitSecondsFromTool(tool, now);
  return { text: seconds === null ? '?s' : `${seconds}s` };
}

function fileProgressText(progress: ToolCall['progress']): string {
  if (!progress) return '';
  if (progress.error) return progress.error;
  const text = fileStageText(progress);
  const fileName = typeof progress.fileName === 'string' && progress.fileName.trim() ? progress.fileName.trim() : '';
  if (fileName && (progress.stage === 'writing' || progress.stage === 'applying')) return `${text}：${fileName}`;
  return text;
}

function fileStageText(progress: ToolCall['progress']): string {
  if (!progress) return '';
  if (progress.error) return progress.error;
  const stageText: Record<string, string> = {
    preparing: '正在准备文件',
    snapshotting: '正在读取旧内容',
    writing: '正在写入文件',
    applying: '正在应用修改',
    written: '文件已写入，正在收尾',
    diffing: '正在准备差异',
    finalizing: '正在收尾处理',
    done: '完成',
    failed: '失败',
  };
  return stageText[progress.stage || ''] || progress.stage || '';
}

function pathBaseName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const normalized = value.replace(/\\/g, '/');
  return normalized.split('/').pop() || value;
}

function liveFileName(tool: ToolCall): string {
  const progress = tool.progress;
  const details = tool.details || {};
  const args = tool.args || {};
  return (
    (typeof progress?.fileName === 'string' && progress.fileName) ||
    (typeof details.fileName === 'string' && details.fileName) ||
    pathBaseName(args.path) ||
    pathBaseName(args.file_path) ||
    pathBaseName(progress?.rawPath) ||
    pathBaseName(progress?.filePath) ||
    'untitled'
  );
}

function liveFileTitle(tool: ToolCall): string {
  const progress = tool.progress;
  const args = tool.args || {};
  return (
    (typeof progress?.filePath === 'string' && progress.filePath) ||
    (typeof progress?.rawPath === 'string' && progress.rawPath) ||
    (typeof args.path === 'string' && args.path) ||
    (typeof args.file_path === 'string' && args.file_path) ||
    liveFileName(tool)
  );
}

function shouldShowLiveFileCard(tool: ToolCall): boolean {
  return (tool.name === 'write' || tool.name === 'edit') && !tool.done && !!tool.progress;
}

function fileOperationBadge(progress: ToolCall['progress']): string {
  if (progress?.operation === 'created') return 'new';
  if (progress?.operation === 'modified') return 'modified';
  return '';
}

function FileWriteLiveCard({ tool }: { tool: ToolCall }) {
  const progress = tool.progress;
  const fileName = liveFileName(tool);
  const title = liveFileTitle(tool);
  const badge = fileOperationBadge(progress);
  const previewText = progress?.previewText || '';
  const stage = fileStageText(progress) || '正在准备内容预览';
  const failed = !!progress?.error;

  // Windsurf-style tail: keep the latest content in view as it streams in.
  const previewRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = previewRef.current;
    if (!el || tool.done) return;
    el.scrollTop = el.scrollHeight;
  }, [previewText, tool.done]);

  return (
    <div className={styles.liveFileWriteCard} data-failed={String(failed)}>
      <div className={styles.liveFileWriteHeader}>
        <span className={failed ? styles.liveFileWriteErrorIcon : styles.liveFileWriteSpinner} />
        <span className={styles.liveFileWriteName} title={title}>{fileName}</span>
        {badge && <span className={styles.liveFileWriteBadge}>{badge}</span>}
      </div>
      <div className={styles.liveFileWritePreview} ref={previewRef}>
        {previewText ? (
          <pre>{previewText}{progress?.previewTruncated ? '\n…' : ''}</pre>
        ) : (
          <span className={styles.liveFileWritePlaceholder}>{stage}</span>
        )}
      </div>
    </div>
  );
}

/** 安全地将 args/details 序列化为短预览 */
function summarizeObj(obj: Record<string, unknown> | undefined, maxLen = 800): string {
  if (!obj || Object.keys(obj).length === 0) return '';
  // 过滤掉 oldContent/newContent（太大且已有 diff 卡片展示）
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'oldContent' || k === 'newContent') continue;
    filtered[k] = v;
  }
  if (Object.keys(filtered).length === 0) return '';
  try {
    let s = JSON.stringify(filtered, null, 2);
    if (s.length > maxLen) s = s.slice(0, maxLen) + '\n…';
    return s;
  } catch {
    return '';
  }
}

const ToolIndicator = memo(function ToolIndicator({ tool, agentName }: { tool: ToolCall; agentName: string }) {
  const [now, setNow] = useState(() => Date.now());
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (tool.name !== 'wait' || tool.done) return;
    if (finiteNumber(tool.args?.startedAt) === null || finiteNumber(tool.args?.durationMs) === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [tool.name, tool.done, tool.args?.startedAt, tool.args?.durationMs]);

  const detail = tool.name === 'wait'
    ? waitToolDetail(tool, now)
    : extractToolDetail(tool.name, tool.args);
  const phase = tool.done ? (tool.success ? 'done' : 'failed') : 'running';
  const label = getToolLabel(tool.name, phase, agentName);
  const detailTitle = detail.title || detail.href;

  // 如果 args 里有 tag 类型信息（如 agent 名）
  const tag = tool.args?.agentId as string | undefined;

  const argsPreview = expanded ? summarizeObj(tool.args as Record<string, unknown> | undefined) : '';
  const detailsPreview = expanded ? summarizeObj(tool.details as Record<string, unknown> | undefined) : '';
  const progressText = !tool.done && !shouldShowLiveFileCard(tool) ? fileProgressText(tool.progress) : '';

  return (
    <>
      <div
        className={`${styles.toolIndicator}${tool.done ? ` ${styles.toolIndicatorClickable}` : ''}`}
        data-tool={tool.name}
        data-done={String(tool.done)}
        onClick={tool.done ? () => setExpanded(v => !v) : undefined}
      >
        <span className={styles.toolDesc}>{label}</span>
        {detail.text && (
          detail.href ? (
            <span
              className={`${styles.toolDetail} ${styles.toolDetailLink}`}
              title={detailTitle}
              onClick={(e) => handleDetailClick(e, detail)}
            >
              {detail.text}
            </span>
          ) : (
            <span className={styles.toolDetail} title={detailTitle}>{detail.text}</span>
          )
        )}
        {tag && <span className={styles.toolTag}>{tag}</span>}
        {tool.done ? (
          <span className={`${styles.toolStatus} ${tool.success ? styles.toolStatusDone : styles.toolStatusFailed}`}>
            {tool.success ? '✓' : '✗'}
          </span>
        ) : (
          <span className={styles.toolDots} />
        )}
        {tool.done && (
          <span className={styles.toolExpandArrow}>{expanded ? '▾' : '▸'}</span>
        )}
      </div>
      {progressText && (
        <div className={styles.toolProgressRow}>
          <span className={styles.toolProgressText}>{progressText}</span>
          <span className={styles.toolProgressPulse} />
        </div>
      )}
      {expanded && (
        <div className={styles.toolExpandedDetails}>
          <div className={styles.toolExpandedLabel}>tool: <code>{tool.name}</code></div>
          {argsPreview && (
            <div className={styles.toolExpandedSection}>
              <div className={styles.toolExpandedLabel}>args:</div>
              <pre className={styles.toolExpandedPre}>{argsPreview}</pre>
            </div>
          )}
          {detailsPreview && (
            <div className={styles.toolExpandedSection}>
              <div className={styles.toolExpandedLabel}>details:</div>
              <pre className={styles.toolExpandedPre}>{detailsPreview}</pre>
            </div>
          )}
        </div>
      )}
    </>
  );
});
