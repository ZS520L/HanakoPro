/**
 * AssistantMessage — 助手消息，遍历 ContentBlock 按类型渲染
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StreamingMarkdownContent } from './StreamingMarkdownContent';
import { MoodBlock } from './MoodBlock';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolGroupBlock } from './ToolGroupBlock';
import { PluginCardBlock } from './PluginCardBlock';
import { SubagentCard } from './SubagentCard';
import { SettingsConfirmCard } from './SettingsConfirmCard';
import { MessageActions } from './MessageActions';
import { BLOCK_RENDERERS } from './block-renderers';
import { FileOutputActions } from './FileOutputActions';
const lazyScreenshot = () => import('../../utils/screenshot').then(m => m.takeScreenshot);
import type { ChatMessage, ContentBlock } from '../../stores/chat-types';
import { useStore } from '../../stores';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import { openFilePreview, openSkillPreview } from '../../utils/file-preview';
import { openMediaViewerForRef } from '../../utils/open-media-viewer';
import { buildFileRefId, isImageOrSvgExt } from '../../utils/file-kind';
import { openPreview } from '../../stores/preview-actions';
import { selectIsStreamingSession, selectSelectedIdsBySession } from '../../stores/session-selectors';
import { extractSelectedTexts } from '../../utils/message-text';
import { AgentAvatar, resolveAgentDisplayInfo } from '../../utils/agent-display';
import { useI18n } from '../../hooks/use-i18n';
import { revertTurn } from '../../stores/revert-turn-action';
import styles from './Chat.module.css';

/* eslint-disable @typescript-eslint/no-explicit-any */

function hasFileWriteIntent(content: string): boolean {
  const lower = content.toLowerCase();
  if (lower.includes('write 工具') || lower.includes('write工具') || lower.includes('write tool')) return true;
  if ((content.includes('写入') || content.includes('创建')) && content.includes('文件')) return true;
  return lower.includes('content 参数') || lower.includes('content parameter');
}

function hasActiveFileWriteTool(blocks: ContentBlock[]): boolean {
  return blocks.some(block => block.type === 'tool_group' && block.tools.some(tool => (
    (tool.name === 'write' || tool.name === 'edit') && !tool.done && !!tool.progress
  )));
}

/**
 * 收集一个 tool_group 里"主动操作"过的 terminal session id。
 * 与 ToolGroupBlock 内部的 activeIds 判定保持一致 —— 必须出现 terminal_create 或 terminal_write。
 */
function activeTerminalIdsInGroup(block: ContentBlock): string[] {
  if (block.type !== 'tool_group') return [];
  const ids: string[] = [];
  for (const tool of block.tools) {
    if (tool.name !== 'terminal_create' && tool.name !== 'terminal_write') continue;
    const id =
      (tool.details && typeof (tool.details as Record<string, unknown>).id === 'string'
        ? (tool.details as Record<string, string>).id
        : undefined) ??
      (tool.args && typeof (tool.args as Record<string, unknown>).id === 'string'
        ? (tool.args as Record<string, string>).id
        : undefined);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * 为每个 block 计算"在它之前已被画过的 terminal session id 集合"，
 * 让后续同会话的 tool_group 不再重复渲染同一个终端卡片。
 */
function computeTerminalExclusionsPerBlock(blocks: ContentBlock[]): Array<Set<string>> {
  const claimed = new Set<string>();
  return blocks.map(block => {
    const snapshot = new Set(claimed);
    for (const id of activeTerminalIdsInGroup(block)) claimed.add(id);
    return snapshot;
  });
}

/**
 * 终端会话输出快照（聚合自整条 assistant message 的所有 tool_group）。
 * 用于：被去重屏蔽的后续 tool_group 里 wait/read 工具捕获的 output 快照，
 * 要回灌到唯一被渲染的那张卡上，否则重启后历史对话里的终端卡都会变成"(暂无输出…)"
 * —— PTY 已死、WS 接不上、自身又没 captured output。
 */
export interface TerminalAggregate {
  staticOutput?: string;
  staticAlive?: boolean;
  staticExitCode?: number | null;
  outputTruncated?: boolean;
  sliceFrom?: number;
  sliceTo?: number;
  title?: string;
  cwd?: string;
}

const TERMINAL_OUTPUT_PRIORITY: Record<string, number> = {
  terminal_wait: 3,
  terminal_read: 2,
  terminal_create: 1,
};

/**
 * 扫整条 assistant message，把每个 session id 的最佳输出快照聚合到一个 Map。
 * 优先级：terminal_wait > terminal_read > terminal_create。同优先级取最后一次。
 * cursor 范围合并：取所有 candidateFrom 的最小值 / candidateTo 的最大值。
 */
function computeTerminalAggregates(blocks: ContentBlock[]): Map<string, TerminalAggregate> {
  const map = new Map<string, TerminalAggregate>();
  const sourceById = new Map<string, string>(); // 当前快照来自哪个工具
  for (const block of blocks) {
    if (block.type !== 'tool_group') continue;
    for (const tool of block.tools) {
      if (!tool.name.startsWith('terminal_')) continue;
      const details = tool.details as Record<string, unknown> | undefined;
      const args = tool.args as Record<string, unknown> | undefined;
      const id =
        (details && typeof details.id === 'string' ? details.id : undefined) ??
        (args && typeof args.id === 'string' ? args.id : undefined);
      if (!id) continue;
      const agg: TerminalAggregate = map.get(id) ?? {};
      const out = details && typeof details.output === 'string' ? details.output : undefined;
      if (typeof out === 'string') {
        const incoming = TERMINAL_OUTPUT_PRIORITY[tool.name] ?? 0;
        const current = sourceById.has(id) ? (TERMINAL_OUTPUT_PRIORITY[sourceById.get(id) as string] ?? 0) : -1;
        if (incoming >= current) {
          agg.staticOutput = out;
          agg.staticAlive = typeof details?.alive === 'boolean' ? (details.alive as boolean) : agg.staticAlive;
          agg.staticExitCode = (details?.exitCode as number | null | undefined) ?? agg.staticExitCode ?? null;
          agg.outputTruncated = !!(details?.outputTruncated) || agg.outputTruncated;
          sourceById.set(id, tool.name);
        }
      }
      if (!agg.title && typeof details?.title === 'string') agg.title = details.title as string;
      if (!agg.cwd && typeof details?.cwd === 'string') agg.cwd = details.cwd as string;
      // cursor 范围
      const fromCands: number[] = [];
      const toCands: number[] = [];
      if (tool.name === 'terminal_create' && typeof details?.cursor === 'number') fromCands.push(details.cursor as number);
      if (tool.name === 'terminal_write') {
        if (typeof details?.cursorBefore === 'number') fromCands.push(details.cursorBefore as number);
        if (typeof details?.cursor === 'number') toCands.push(details.cursor as number);
      }
      if (tool.name === 'terminal_wait') {
        if (typeof details?.sinceCursor === 'number') fromCands.push(details.sinceCursor as number);
        if (typeof details?.cursor === 'number') toCands.push(details.cursor as number);
      }
      if (tool.name === 'terminal_read' && typeof details?.cursor === 'number') toCands.push(details.cursor as number);
      for (const v of fromCands) if (agg.sliceFrom === undefined || v < agg.sliceFrom) agg.sliceFrom = v;
      for (const v of toCands) if (agg.sliceTo === undefined || v > agg.sliceTo) agg.sliceTo = v;
      map.set(id, agg);
    }
  }
  return map;
}

function translatedOrFallback(key: string, fallback: string): string {
  const value = window.t?.(key);
  return value && value !== key ? value : fallback;
}

const FileWriteIntentHint = memo(function FileWriteIntentHint() {
  return (
    <div className={styles.liveFileWriteCard} data-failed="false">
      <div className={styles.liveFileWriteHeader}>
        <span className={styles.liveFileWriteSpinner} />
        <span className={styles.liveFileWriteName}>
          {translatedOrFallback('thinking.fileWritePreparing', '正在准备写入文件内容')}
        </span>
      </div>
      <div className={styles.liveFileWritePreview}>
        <span className={styles.liveFileWritePlaceholder}>
          {translatedOrFallback('thinking.fileWriteWaitingPreview', '正在等待文件名和内容预览')}
        </span>
      </div>
    </div>
  );
});

interface Props {
  message: ChatMessage;
  showAvatar: boolean;
  sessionPath: string;
  agentId?: string | null;
  readOnly?: boolean;
  messageRef?: (element: HTMLDivElement | null) => void;
  isLatestAssistantMessage?: boolean;
  precedingUserTimestamp?: number | string;
}

export const AssistantMessage = memo(function AssistantMessage({ message, showAvatar, sessionPath, agentId, readOnly = false, messageRef, isLatestAssistantMessage = false, precedingUserTimestamp }: Props) {
  const { t } = useI18n();
  const agents = useStore(s => s.agents);
  const globalAgentName = useStore(s => s.agentName) || 'Hanako';
  const globalYuan = useStore(s => s.agentYuan) || 'hanako';
  const isStreaming = useStore(s => selectIsStreamingSession(s, sessionPath));
  const selectedIds = useStore(s => selectSelectedIdsBySession(s, sessionPath));
  const isSelected = selectedIds.includes(message.id);

  // Resolve agent identity from agentId prop; fall back to global values
  const displayInfo = resolveAgentDisplayInfo({
    id: agentId || null,
    agents,
    fallbackAgentName: globalAgentName,
    fallbackAgentYuan: globalYuan,
  });
  const displayName = displayInfo.displayName;
  const displayYuan = displayInfo.yuan || globalYuan;

  const blocks = useMemo(
    () => (message.blocks || []).filter(block => block.type !== 'session_confirmation' || block.surface !== 'input'),
    [message.blocks],
  );
  const activeFileWriteTool = useMemo(() => hasActiveFileWriteTool(blocks), [blocks]);
  const terminalExclusions = useMemo(() => computeTerminalExclusionsPerBlock(blocks), [blocks]);
  const terminalAggregates = useMemo(() => computeTerminalAggregates(blocks), [blocks]);

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const ids = selectSelectedIdsBySession(useStore.getState(), sessionPath);
    let text: string;
    if (ids.length > 0) {
      text = extractSelectedTexts(sessionPath, ids);
    } else {
      const textBlocks = blocks.filter(
        (b): b is ContentBlock & { type: 'text' } => b.type === 'text'
      );
      if (textBlocks.length === 0) return;
      // eslint-disable-next-line no-restricted-syntax
      const tmp = document.createElement('div');
      tmp.innerHTML = textBlocks.map(b => b.html).join('\n');
      text = tmp.innerText.trim();
    }
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [blocks, sessionPath]);

  const handleScreenshot = useCallback(async () => {
    const fn = await lazyScreenshot();
    fn(message.id, sessionPath);
  }, [message.id, sessionPath]);

  const [reverting, setReverting] = useState(false);
  const [revertArmed, setRevertArmed] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRevert = useCallback(async () => {
    if (reverting || isStreaming) return;
    // Two-click confirm: first click arms, second click (within 2 s) executes.
    // Avoids window.confirm() which breaks Electron keyboard focus on Windows.
    if (!revertArmed) {
      setRevertArmed(true);
      revertTimerRef.current = setTimeout(() => setRevertArmed(false), 2000);
      return;
    }
    if (revertTimerRef.current) { clearTimeout(revertTimerRef.current); revertTimerRef.current = null; }
    setRevertArmed(false);
    setReverting(true);
    try {
      const sinceTs = precedingUserTimestamp ?? message.timestamp ?? 0;
      await revertTurn(sessionPath, sinceTs);
    } finally {
      setReverting(false);
    }
  }, [reverting, isStreaming, revertArmed, sessionPath, precedingUserTimestamp, message.timestamp]);

  // 用前一条用户消息时间戳；若不可用则用本条 assistant 消息时间戳；再不行用 0（仅回退对话，不还原文件）
  const revertSinceTs = precedingUserTimestamp ?? message.timestamp ?? 0;
  const canRevert = isLatestAssistantMessage && !readOnly && !isStreaming;

  return (
    <div className={`${styles.messageGroup} ${styles.messageGroupAssistant}${isSelected ? ` ${styles.messageGroupSelected}` : ''}`}
         ref={messageRef}
         data-message-id={message.id}>
      {showAvatar && (
        <div className={styles.avatarRow}>
          <AgentAvatar
            info={displayInfo}
            className={`${styles.avatar} ${styles.hanaAvatar}`}
            alt={displayName}
          />
          <span className={styles.avatarName}>{displayName}</span>
        </div>
      )}
      <div className={`${styles.message} ${styles.messageAssistant}`}>
        {blocks.map((block, i) => (
          <ContentBlockView
            key={`block-${i}`}
            block={block}
            agentName={displayName}
            agentId={agentId}
            yuan={displayYuan}
            sessionPath={sessionPath}
            messageId={message.id}
            blockIdx={i}
            isStreaming={isStreaming}
            hasActiveFileWriteTool={activeFileWriteTool}
            excludeTerminalIds={terminalExclusions[i]}
            terminalAggregates={terminalAggregates}
          />
        ))}
      </div>
      {canRevert && (
        <div className={styles.assistantRevertRow}>
          <button
            className={`${styles.assistantRevertBtn}${revertArmed ? ` ${styles.assistantRevertBtnArmed}` : ''}`}
            onClick={handleRevert}
            disabled={reverting}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6" />
              <path d="M3 13a9 9 0 0 1 2.64-6.36A9 9 0 0 1 21 12" />
            </svg>
            <span>{reverting ? '...' : revertArmed ? t('chat.revertConfirmShort') || '确定撤回？' : t('chat.revertTurn')}</span>
          </button>
        </div>
      )}
      {!readOnly && (
        <MessageActions
          messageId={message.id}
          sessionPath={sessionPath}
          onCopy={handleCopy}
          onScreenshot={handleScreenshot}
          copied={copied}
          isStreaming={isStreaming}
        />
      )}
    </div>
  );
});

// ── ContentBlock 分发 ──

const ContentBlockView = memo(function ContentBlockView({ block, agentName, agentId, yuan: _yuan, sessionPath, messageId, blockIdx, isStreaming, hasActiveFileWriteTool: hasActiveFileWriteToolProp = false, excludeTerminalIds, terminalAggregates }: {
  block: ContentBlock;
  agentName: string;
  agentId?: string | null;
  yuan: string;
  sessionPath: string;
  messageId: string;
  blockIdx: number;
  isStreaming: boolean;
  hasActiveFileWriteTool?: boolean;
  excludeTerminalIds?: Set<string>;
  terminalAggregates?: Map<string, TerminalAggregate>;
}) {
  switch (block.type) {
    case 'thinking': {
      const showFileWriteHint = !block.sealed && hasFileWriteIntent(block.content) && !hasActiveFileWriteToolProp;
      return (
        <>
          <ThinkingBlock content={block.content} sealed={block.sealed || showFileWriteHint} />
          {showFileWriteHint && <FileWriteIntentHint />}
        </>
      );
    }
    case 'mood':
      return <MoodBlock yuan={block.yuan} text={block.text} />;
    case 'vision_progress':
      return <VisionProgressBlock block={block} />;
    case 'tool_group':
      return <ToolGroupBlock tools={block.tools} collapsed={block.collapsed} agentName={agentName} excludeTerminalIds={excludeTerminalIds} terminalAggregates={terminalAggregates} />;
    case 'text':
      return <StreamingMarkdownContent html={block.html} source={block.source} active={isStreaming} />;
    case 'file':
      return (
        <FileBlock
          block={block}
          sessionPath={sessionPath}
          messageId={messageId}
          blockIdx={blockIdx}
        />
      );
    case 'screenshot':
      return (
        <ScreenshotBlock
          block={block}
          sessionPath={sessionPath}
          messageId={messageId}
          blockIdx={blockIdx}
        />
      );
    default: {
      const Renderer = BLOCK_RENDERERS[block.type];
      return Renderer ? <Renderer block={block} agentId={agentId} /> : null;
    }
  }
});

// ── 简单子块组件（物种 B，统一接受 { block: any }） ──

const VisionProgressBlock = memo(function VisionProgressBlock({ block }: { block: Extract<ContentBlock, { type: 'vision_progress' }> }) {
  const responseRef = useRef<HTMLPreElement | null>(null);
  const done = block.phase === 'done';
  const failed = block.phase === 'error';
  const responseText = block.error || block.response || '';
  const modelName = block.model?.id || '视觉模型';
  const provider = block.model?.provider ? ` · ${block.model.provider}` : '';
  const targetName = block.targetModel?.id || '当前文本模型';
  const elapsed = typeof block.elapsedMs === 'number' && Number.isFinite(block.elapsedMs)
    ? `${(block.elapsedMs / 1000).toFixed(block.elapsedMs >= 10_000 ? 0 : 1)}s`
    : '';
  const imageLabel = block.imageCount && block.imageCount > 1
    ? `${block.resourceLabel || '图片'} ${block.imageIndex || 1}/${block.imageCount}`
    : (block.resourceLabel || '图片');
  const summary = failed
    ? '辅助视觉失败'
    : done
      ? (block.reused ? '复用辅助视觉结果' : '辅助视觉已返回')
      : '辅助视觉正在分析';

  useEffect(() => {
    const el = responseRef.current;
    if (!el || !responseText) return;
    el.scrollTop = el.scrollHeight;
  }, [responseText]);

  return (
    <details className={styles.visionProgressCard} open={!done && !failed}>
      <summary className={styles.visionProgressSummary}>
        {!done && !failed ? <span className={styles.visionProgressSpinner} /> : <span className={styles.visionProgressDot} data-error={failed ? 'true' : 'false'} />}
        <span className={styles.visionProgressTitle}>{summary}</span>
        <span className={styles.visionProgressMeta}>{modelName}{provider}{elapsed ? ` · ${elapsed}` : ''}</span>
      </summary>
      <div className={styles.visionProgressBody}>
        <div className={styles.visionProgressGrid}>
          <span>对象</span>
          <strong>{imageLabel}</strong>
          <span>视觉模型</span>
          <strong>{modelName}{provider}</strong>
          <span>递交给</span>
          <strong>{targetName}</strong>
        </div>
        {block.question && (
          <div className={styles.visionProgressSection}>
            <div className={styles.visionProgressLabel}>问了什么</div>
            <pre>{block.question}</pre>
          </div>
        )}
        {responseText && (
          <div className={styles.visionProgressSection}>
            <div className={styles.visionProgressLabel}>{failed ? '错误' : '返回了什么'}</div>
            <pre ref={responseRef}>{responseText}</pre>
          </div>
        )}
      </div>
    </details>
  );
});

const EXT_LABELS: Record<string, string> = {
  pdf: 'PDF', doc: 'Word', docx: 'Word', xls: 'Excel', xlsx: 'Excel',
  ppt: 'Presentation', pptx: 'Presentation', md: 'Markdown', txt: 'Text',
  html: 'HTML', htm: 'HTML', css: 'Stylesheet', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  js: 'JavaScript', ts: 'TypeScript', jsx: 'React', tsx: 'React',
  py: 'Python', rs: 'Rust', go: 'Go', java: 'Java', rb: 'Ruby', php: 'PHP',
  c: 'C', cpp: 'C++', h: 'Header', sh: 'Shell', sql: 'SQL', xml: 'XML',
  csv: 'CSV', svg: 'SVG', skill: 'Skill',
  png: 'Image', jpg: 'Image', jpeg: 'Image', gif: 'Image', webp: 'Image',
};

// file / image block

interface FileBlockCtx {
  sessionPath: string;
  messageId: string;
  blockIdx: number;
}

const ImageOutputCard = memo(function ImageOutputCard({ filePath, label, ext, status, ctx }: { filePath: string; label: string; ext: string; status?: string; ctx: FileBlockCtx }) {
  const [failed, setFailed] = useState(false);
  const displayName = label || filePath.split('/').pop() || filePath;

  if (status === 'expired') return <FileOutputCard filePath={filePath} label={label} ext={ext} status={status} ctx={ctx} />;
  if (failed) return <FileOutputCard filePath={filePath} label={label} ext={ext} status={status} ctx={ctx} />;

  return (
    <div
      className={styles.imageOutputCard}
      onClick={() => openFilePreview(filePath, label, ext, {
        origin: 'session',
        sessionPath: ctx.sessionPath,
        messageId: ctx.messageId,
        blockIdx: ctx.blockIdx,
      })}
      style={{ cursor: 'pointer' }}
    >
      <img
        src={window.platform?.getFileUrl?.(filePath) ?? ''}
        alt={displayName}
        className={styles.imageOutputPreview}
        onError={() => setFailed(true)}
        draggable={false}
      />
    </div>
  );
});

const FileOutputCard = memo(function FileOutputCard({ filePath, label, ext, status, ctx }: { filePath: string; label: string; ext: string; status?: string; ctx: FileBlockCtx }) {
  const expired = status === 'expired';
  const expiredLabel = window.t('chat.fileExpired');
  const handlePreview = () => {
    if (expired) return;
    openFilePreview(filePath, label, ext, {
      origin: 'session',
      sessionPath: ctx.sessionPath,
      messageId: ctx.messageId,
      blockIdx: ctx.blockIdx,
    });
  };

  const displayName = label || filePath.split('/').pop() || filePath;
  const typeLabel = expired ? expiredLabel : (EXT_LABELS[ext] || ext.toUpperCase());

  return (
    <div
      className={`${styles.fileOutputCard}${expired ? ` ${styles.fileOutputExpired}` : ` ${styles.fileOutputPreviewable}`}`}
      onClick={handlePreview}
      style={{ cursor: expired ? 'default' : 'pointer' }}
      aria-disabled={expired}
    >
      <div className={styles.fileOutputIcon}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </div>
      <div className={styles.fileOutputInfo}>
        <div className={styles.fileOutputName}>{displayName}</div>
        <div className={styles.fileOutputType}>
          {typeLabel}{!expired && ext ? ` \u00b7 ${ext.toUpperCase()}` : ''}
        </div>
      </div>
      {!expired && (
        <FileOutputActions filePath={filePath} displayName={displayName} />
      )}
    </div>
  );
});

const FileBlock = memo(function FileBlock({ block, sessionPath, messageId, blockIdx }: {
  block: any;
  sessionPath: string;
  messageId: string;
  blockIdx: number;
}) {
  const ctx: FileBlockCtx = { sessionPath, messageId, blockIdx };
  // 扩展名识别统一走中心表（inferKindByExt via isImageOrSvgExt）
  return isImageOrSvgExt(block.ext)
    ? <ImageOutputCard filePath={block.filePath} label={block.label} ext={block.ext} status={block.status} ctx={ctx} />
    : <FileOutputCard filePath={block.filePath} label={block.label} ext={block.ext} status={block.status} ctx={ctx} />;
});

// COMPAT(create_artifact, remove no earlier than v0.133):
// Old sessions may still contain `artifact` content blocks. New preview
// surface consumes them as PreviewItem records.

const LegacyArtifactBlock = memo(function LegacyArtifactBlock({ block }: { block: any }) {
  const handleClick = () => {
    const previewItem = {
      id: block.artifactId,
      type: block.artifactType,
      title: block.title,
      content: block.content,
      language: block.language,
      fileId: block.fileId,
      filePath: block.filePath,
      ext: block.ext,
      mime: block.mime,
      kind: block.kind,
      storageKind: block.storageKind,
      status: block.status,
      missingAt: block.missingAt,
    };
    openPreview(previewItem);
  };
  const expired = block.status === 'expired';

  return (
    <div className={styles.legacyArtifactCard} onClick={handleClick} style={{ cursor: 'pointer' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
      </svg>
      <span>{block.title || block.artifactType}</span>
      {expired && <span className={styles.legacyArtifactExpiredBadge}>{window.t('chat.fileExpired')}</span>}
    </div>
  );
});

// plugin_card block

const PluginCardWrapper = memo(function PluginCardWrapper({ block, agentId }: { block: any; agentId?: string | null }) {
  return <PluginCardBlock card={block.card} agentId={agentId} />;
});

// screenshot block

const ScreenshotBlock = memo(function ScreenshotBlock({ block, sessionPath, messageId, blockIdx }: {
  block: any;
  sessionPath: string;
  messageId: string;
  blockIdx: number;
}) {
  // screenshot 无 path 但 id 由 buildFileRefId 生成，与 selectSessionFiles 一致，能命中 session 图片序列
  const handleClick = () => {
    const id = buildFileRefId({
      source: 'session-block-screenshot',
      sessionPath,
      messageId,
      blockIdx,
      path: '',
    });
    openMediaViewerForRef({
      id,
      kind: 'image',
      source: 'session-block-screenshot',
      name: `screenshot-${messageId}-${blockIdx}.png`,
      path: '',
      mime: block.mimeType,
      sessionMessageId: messageId,
      inlineData: { base64: block.base64, mimeType: block.mimeType },
    }, { origin: 'session', sessionPath });
  };

  return (
    <div className={styles.browserScreenshot} onClick={handleClick} style={{ cursor: 'pointer' }}>
      <img src={`data:${block.mimeType};base64,${block.base64}`} alt={window.t('chat.browserScreenshot')} />
    </div>
  );
});

// skill block

const SkillBlock = memo(function SkillBlock({ block }: { block: any }) {
  const skillFilePath = typeof block.installedSkillSource?.filePath === 'string'
    ? block.installedSkillSource.filePath
    : block.skillFilePath;
  return (
    <div className={styles.skillCard} onClick={() => openSkillPreview(block.skillName, skillFilePath)} style={{ cursor: 'pointer' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
      <span>{block.skillName}</span>
    </div>
  );
});

// cron_confirm block

const CronConfirmBlock = memo(function CronConfirmBlock({ block }: { block: any }) {
  const [status, setStatus] = useState(block.status);
  const label = (block.jobData.label as string) || (block.jobData.prompt as string)?.slice(0, 40) || '';

  const handleApprove = async () => {
    try {
      if (block.confirmId) {
        await hanaFetch(`/api/confirm/${block.confirmId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'confirmed' }),
        });
      } else {
        await hanaFetch('/api/desk/cron', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'add', ...block.jobData }),
        });
      }
      setStatus('approved');
    } catch { /* silent */ }
  };

  const handleReject = async () => {
    if (block.confirmId) {
      try {
        await hanaFetch(`/api/confirm/${block.confirmId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'rejected' }),
        });
      } catch { /* silent */ }
    }
    setStatus('rejected');
  };

  if (status !== 'pending') {
    return (
      <div className={styles.cronConfirmCard}>
        <div className={styles.cronConfirmTitle}>{label}</div>
        <div className={`${styles.cronConfirmStatus} ${status === 'approved' ? styles.cronConfirmStatusApproved : styles.cronConfirmStatusRejected}`}>
          {status === 'approved' ? window.t('common.approved') : window.t('common.rejected')}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.cronConfirmCard}>
      <div className={styles.cronConfirmTitle}>{label}</div>
      <div className={styles.cronConfirmActions}>
        <button className={`${styles.cronConfirmBtn} ${styles.cronConfirmBtnApprove}`} onClick={handleApprove}>{window.t('common.approve')}</button>
        <button className={`${styles.cronConfirmBtn} ${styles.cronConfirmBtnReject}`} onClick={handleReject}>{window.t('common.reject')}</button>
      </div>
    </div>
  );
});

// settings_confirm block

const SettingsConfirmBlock = memo(function SettingsConfirmBlock({ block }: { block: any }) {
  return <SettingsConfirmCard {...block} />;
});

// ── 注册所有物种 B 渲染器 ──
// 注：`file` 与 `screenshot` 需 session 上下文（sessionPath/messageId/blockIdx），
// 统一走 ContentBlockView 的 switch 内联分发，不注册到全局表中。
BLOCK_RENDERERS['subagent'] = SubagentCard;
BLOCK_RENDERERS['artifact'] = LegacyArtifactBlock;
BLOCK_RENDERERS['plugin_card'] = PluginCardWrapper;
BLOCK_RENDERERS['skill'] = SkillBlock;
BLOCK_RENDERERS['cron_confirm'] = CronConfirmBlock;
BLOCK_RENDERERS['settings_confirm'] = SettingsConfirmBlock;
