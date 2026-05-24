/**
 * InputArea — 聊天输入区域 React 组件
 *
 * 子组件拆分到 ./input/ 目录。
 * 斜杠命令逻辑在 ./input/slash-commands.ts。
 */

import { useState, useEffect, useRef, useCallback, useMemo, type Ref } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { useStore } from '../stores';
import { selectPreviewItems, selectActiveTabId } from '../stores/preview-slice';
import { selectSessionFiles } from '../stores/selectors/file-refs';
import { isImageFile, isVideoFile } from '../utils/format';
import { fetchConfig } from '../hooks/use-config';
import { useI18n } from '../hooks/use-i18n';
import { ensureSession, loadSessions } from '../stores/session-actions';
import { loadDeskFiles, searchDeskFiles, toggleJianSidebar } from '../stores/desk-actions';
import { getWebSocket } from '../services/websocket';
import { collectUiContext } from '../utils/ui-context';
import { formatQuotedSelectionForPrompt } from '../utils/quoted-selection';
import type { ThinkingLevel } from '../stores/model-slice';
import { SlashCommandMenu } from './input/SlashCommandMenu';
import { FileMentionMenu } from './input/FileMentionMenu';
import { InputStatusBars } from './input/InputStatusBars';
import { InputContextRow } from './input/InputContextRow';
import { InputControlBar } from './input/InputControlBar';
import type { PermissionMode } from './input/PlanModeButton';
import { SessionConfirmationPrompt } from './input/SessionConfirmationPrompt';
import { serializeEditor } from '../utils/editor-serializer';
import {
  buildFileMentionItems,
  mergeEditorFileRefs,
  type FileMentionItem,
} from '../utils/file-mention-items';
import { useSkillSlashItems } from '../hooks/use-slash-items';
import { notifyPasteUploadFailure } from '../utils/paste-upload-feedback';
import { extractPlainUrlPaste } from '../utils/plain-url-paste';
import { createInputEditorExtensions } from './input/input-editor-extensions';
import {
  evaluateChatImageSendPreflight,
  evaluateChatVideoSendPreflight,
  notifyTextModelImageBlocked,
  notifyTextModelVideoBlocked,
} from '../utils/chat-image-send-preflight';
import { openProviderModelSettings } from '../utils/model-settings-navigation';
import {
  XING_PROMPT, executeDiary, executeCompact, buildSlashCommands, getSlashMatches,
  resolveSlashSubmitSelection,
  type SlashItem,
} from './input/slash-commands';
import { attachFilesFromPaths } from '../MainContent';
import { hanaFetch } from '../hooks/use-hana-fetch';
import styles from './input/InputArea.module.css';
import type { DeskSearchResult, TodoItem } from '../types';
import type { ChatListItem, SessionConfirmationBlock } from '../stores/chat-types';

const EMPTY_TODOS: TodoItem[] = [];
const EMPTY_FILE_REFS: readonly import('../types/file-ref').FileRef[] = Object.freeze([]);

function chatVideoMimeTypeForName(name: string, fallback?: string): string {
  if (fallback?.startsWith('video/')) return fallback;
  const ext = name.toLowerCase().replace(/^.*\./, '');
  const mimeMap: Record<string, string> = {
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
  };
  return mimeMap[ext] || 'video/mp4';
}

function chatImageMimeTypeForName(name: string, fallback?: string): string {
  if (fallback?.startsWith('image/')) return fallback;
  const ext = name.toLowerCase().replace(/^.*\./, '');
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  };
  return mimeMap[ext] || 'image/png';
}

interface FileMentionRange {
  from: number;
  to: number;
  query: string;
}

interface InputKeyEvent {
  key: string;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  preventDefault: () => void;
}

function findLatestInputSessionConfirmation(items: ChatListItem[] | undefined, confirmId?: string, pendingOnly?: boolean): SessionConfirmationBlock | null {
  if (!items) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.type !== 'message' || item.data.role !== 'assistant') continue;
    const blocks = item.data.blocks || [];
    for (let j = blocks.length - 1; j >= 0; j--) {
      const block = blocks[j];
      if (block.type !== 'session_confirmation' || block.surface !== 'input') continue;
      if (confirmId && block.confirmId !== confirmId) continue;
      if (pendingOnly && block.status !== 'pending') continue;
      return block;
    }
  }
  return null;
}

function findFileMentionRange(editor: Editor | null): FileMentionRange | null {
  if (!editor?.state?.selection) return null;
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const before = selection.$from.parent.textBetween(0, selection.$from.parentOffset, '\n', '\n');
  const atIndex = before.lastIndexOf('@');
  if (atIndex < 0) return null;
  if (atIndex > 0 && /\S/.test(before[atIndex - 1])) return null;
  const query = before.slice(atIndex + 1);
  if (/[\s@]/.test(query)) return null;
  return {
    from: selection.from - query.length - 1,
    to: selection.from,
    query,
  };
}

function editorHasInlineNode(editor: Editor | null, nodeType: string): boolean {
  if (!editor?.state?.doc) return false;
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === nodeType) {
      found = true;
      return false;
    }
    return !found;
  });
  return found;
}

export type { SlashItem };

interface InputAreaProps {
  cardRef?: Ref<HTMLDivElement>;
}

// ── 主组件 ──

export function InputArea({ cardRef }: InputAreaProps) {
  return <InputAreaInner cardRef={cardRef} />;
}

interface InputAreaInnerProps {
  cardRef?: Ref<HTMLDivElement>;
}

function InputAreaInner({ cardRef }: InputAreaInnerProps) {
  const { t, locale } = useI18n();

  // Zustand state
  const isStreaming = useStore(s => s.streamingSessions.includes(s.currentSessionPath || ''));
  const connected = useStore(s => s.connected);
  const pendingNewSession = useStore(s => s.pendingNewSession);
  const pendingSessionSwitchPath = useStore(s => s.pendingSessionSwitchPath);
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const compacting = useStore(s => currentSessionPath ? s.compactingSessions.includes(currentSessionPath) : false);
  const compressForking = useStore(s => currentSessionPath ? s.compressForkingSessions.includes(currentSessionPath) : false);
  const screenshotBusy = useStore(s => s.screenshotTaskCount > 0);
  const screenshotProgress = useStore(s => s.screenshotProgress);
  const inlineError = useStore(s => s.inlineErrors[s.currentSessionPath || ''] ?? null);
  const sessionTodos = useStore(s => (s.currentSessionPath && s.todosBySession[s.currentSessionPath]) || EMPTY_TODOS);
  const sessionFiles = useStore(s => (s.currentSessionPath ? selectSessionFiles(s, s.currentSessionPath) : EMPTY_FILE_REFS));
  const attachedFiles = useStore(s => s.attachedFiles);
  const docContextAttached = useStore(s => s.docContextAttached);
  const quotedSelection = useStore(s => s.quotedSelection);
  const deskFiles = useStore(s => s.deskFiles);
  const deskBasePath = useStore(s => s.deskBasePath);
  const deskCurrentPath = useStore(s => s.deskCurrentPath);
  const previewItems = useStore(selectPreviewItems);
  const activeTabId = useStore(selectActiveTabId);
  const previewOpen = useStore(s => s.previewOpen);
  const models = useStore(s => s.models);
  const modelsLoadState = useStore(s => s.modelsLoadState);
  const agentYuan = useStore(s => s.agentYuan);
  const welcomeVisible = useStore(s => s.welcomeVisible);
  const thinkingLevel = useStore(s => s.thinkingLevel);
  const setThinkingLevel = useStore(s => s.setThinkingLevel);
  const addToast = useStore(s => s.addToast);
  const removeToast = useStore(s => s.removeToast);

  const sessionModel = useStore(s => s.currentSessionPath ? s.sessionModelsByPath[s.currentSessionPath] : undefined);
  const globalModelInfo = useMemo(() => models.find(m => m.isCurrent), [models]);
  const matchedSessionModel = useMemo(() => {
    if (!sessionModel?.id || !sessionModel.provider) return undefined;
    return models.find(m => m.id === sessionModel.id && m.provider === sessionModel.provider);
  }, [models, sessionModel]);
  const currentModelInfo = matchedSessionModel
    ? { ...matchedSessionModel, ...sessionModel }
    : (sessionModel && models.length === 0 ? sessionModel : globalModelInfo);
  // input 数组缺失视为未知；只有显式 text-only 的模型才在 UI 上标记“辅助视觉”。
  const supportsVision = !Array.isArray(currentModelInfo?.input) || currentModelInfo.input.includes("image");
  const modelSwitching = useStore(s => s.modelSwitching);
  const currentSessionItems = useStore(s => s.currentSessionPath ? s.chatSessions[s.currentSessionPath]?.items : undefined);
  const currentDraft = useStore(s => s.currentSessionPath ? (s.drafts[s.currentSessionPath] || '') : '');
  const inputEditorResetTrigger = useStore(s => s.inputEditorResetTrigger);
  const pendingSessionConfirmation = useMemo(() => {
    return findLatestInputSessionConfirmation(currentSessionItems, undefined, true);
  }, [currentSessionItems]);

  // Local state
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('operate');
  const [sending, setSending] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashSelected, setSlashSelected] = useState(0);
  const [slashBusy, setSlashBusy] = useState<string | null>(null);
  const [slashResult, setSlashResult] = useState<{ text: string; type: 'success' | 'error'; deskDir?: string } | null>(null);
  const [visibleSessionConfirmation, setVisibleSessionConfirmation] = useState<SessionConfirmationBlock | null>(null);
  const [sessionConfirmationExiting, setSessionConfirmationExiting] = useState(false);

  const isComposing = useRef(false);
  const pasteHandlerRef = useRef<(event: ClipboardEvent) => boolean>(() => false);
  const keyDownHandlerRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const slashBtnRef = useRef<HTMLButtonElement>(null);
  const slashDismissedTextRef = useRef<string | null>(null);
  const fileMentionSearchSeqRef = useRef(0);
  const handledInputFocusTriggerRef = useRef('');
  const [inputText, setInputText] = useState('');
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [fileSelected, setFileSelected] = useState(0);
  const [fileMentionRange, setFileMentionRange] = useState<FileMentionRange | null>(null);
  const [fileMentionQuery, setFileMentionQuery] = useState('');
  const [fileMentionSearchResults, setFileMentionSearchResults] = useState<DeskSearchResult[]>([]);
  const [fileMentionBusy, setFileMentionBusy] = useState(false);
  const [completingTodos, setCompletingTodos] = useState(false);

  useEffect(() => {
    if (pendingSessionConfirmation) {
      setVisibleSessionConfirmation(pendingSessionConfirmation);
      setSessionConfirmationExiting(false);
      return;
    }
    if (!visibleSessionConfirmation || sessionConfirmationExiting) return;

    const resolved = findLatestInputSessionConfirmation(currentSessionItems, visibleSessionConfirmation.confirmId);
    setVisibleSessionConfirmation(resolved || visibleSessionConfirmation);
    setSessionConfirmationExiting(true);
  }, [currentSessionItems, pendingSessionConfirmation, sessionConfirmationExiting, visibleSessionConfirmation]);

  useEffect(() => {
    if (!sessionConfirmationExiting) return;
    const timer = window.setTimeout(() => {
      setVisibleSessionConfirmation(null);
      setSessionConfirmationExiting(false);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [sessionConfirmationExiting]);

  // ── 全局 inline notice（截图等非斜杠命令的轻提示）──
  useEffect(() => {
    const handler = (e: Event) => {
      const { text, type, deskDir } = (e as CustomEvent).detail;
      setSlashResult({ text, type, deskDir });
      setTimeout(() => setSlashResult(null), 3000);
    };
    window.addEventListener('hana-inline-notice', handler);
    return () => window.removeEventListener('hana-inline-notice', handler);
  }, []);

  // ── Welcome 模式 placeholder tip（mount、i18n ready、每次 welcome 重新激活时随机一条） ──
  const pickRandomWelcomeTip = useCallback((): string => {
    const tipsRaw: unknown = t('welcome.placeholderTips');
    const tips = Array.isArray(tipsRaw)
      ? tipsRaw.filter((tip): tip is string => typeof tip === 'string' && tip.length > 0)
      : [];
    if (tips.length === 0) return '';
    return tips[Math.floor(Math.random() * tips.length)];
  }, [t]);

  const [welcomeTip, setWelcomeTip] = useState<string>(() =>
    welcomeVisible ? pickRandomWelcomeTip() : '',
  );

  // Zustand actions
  const addAttachedFile = useStore(s => s.addAttachedFile);
  const removeAttachedFile = useStore(s => s.removeAttachedFile);
  const clearAttachedFiles = useStore(s => s.clearAttachedFiles);
  const setDocContextAttached = useStore(s => s.setDocContextAttached);
  const setDraft = useStore(s => s.setDraft);
  const clearDraft = useStore(s => s.clearDraft);

  const prevWelcomeVisibleRef = useRef(welcomeVisible);
  const prevLocaleRef = useRef(locale);
  useEffect(() => {
    const wasVisible = prevWelcomeVisibleRef.current;
    const previousLocale = prevLocaleRef.current;
    prevWelcomeVisibleRef.current = welcomeVisible;
    prevLocaleRef.current = locale;

    if (!welcomeVisible) {
      if (welcomeTip) setWelcomeTip('');
      return;
    }

    // false→true（重新进入欢迎页）、locale ready/切换，或 mount 时 i18n 还没 ready 现在能拿到
    if (!wasVisible || previousLocale !== locale || !welcomeTip) {
      const tip = pickRandomWelcomeTip();
      if (tip) setWelcomeTip(tip);
    }
  }, [welcomeVisible, locale, welcomeTip, pickRandomWelcomeTip]);

  // ── Placeholder ──
  const placeholderRef = useRef('');
  const getEditorPlaceholder = useCallback(() => placeholderRef.current, []);
  const placeholder = (() => {
    if (welcomeVisible && welcomeTip) return welcomeTip;
    const yuanPh = t(`yuan.placeholder.${agentYuan}`);
    return (yuanPh && !yuanPh.startsWith('yuan.')) ? yuanPh : t('input.placeholder');
  })();
  placeholderRef.current = placeholder;

  // ── TipTap editor ──
  const editor = useEditor(
    {
      extensions: createInputEditorExtensions(getEditorPlaceholder),
      editorProps: {
        attributes: {
          class: styles['input-box'],
          id: 'inputBox',
          spellcheck: 'false',
        },
        handlePaste: (_view, event) => pasteHandlerRef.current(event),
        handleKeyDown: (_view, event) => keyDownHandlerRef.current(event),
      },
    },
    [inputEditorResetTrigger],
  );

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta('input-placeholder-refresh', placeholder));
  }, [editor, placeholder]);

  // When editor is rebuilt (new reference), clear the handled key so
  // the focus effect fires again for the fresh instance.
  const prevEditorRef = useRef(editor);
  useEffect(() => {
    if (editor && editor !== prevEditorRef.current) {
      handledInputFocusTriggerRef.current = '';
    }
    prevEditorRef.current = editor;
  }, [editor]);

  // Focus trigger from store
  const inputFocusTrigger = useStore(s => s.inputFocusTrigger);
  useEffect(() => {
    if (inputFocusTrigger <= 0 || !editor || editor.isDestroyed) return;
    const focusKey = `${inputEditorResetTrigger}:${inputFocusTrigger}`;
    if (handledInputFocusTriggerRef.current === focusKey) return;
    handledInputFocusTriggerRef.current = focusKey;
    // 120 ms delay: give the rebuilt editor DOM time to settle after
    // useEditor recreation, and also let the Electron BrowserWindow
    // regain OS-level input focus after a native confirm() dialog.
    const timer = window.setTimeout(() => {
      if (editor.isDestroyed) return;
      // Restore Electron window-level focus (lost after native dialogs)
      window.focus();
      if (typeof editor.setEditable === 'function' && !editor.isEditable) {
        editor.setEditable(true);
      }
      editor.commands.focus('end');
      editor.view.dom.focus();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [inputFocusTrigger, inputEditorResetTrigger, editor]);

  // Doc context
  const currentDoc = useMemo(() => {
    if (!previewOpen || !activeTabId) return null;
    const art = previewItems.find(a => a.id === activeTabId);
    if (!art?.filePath) return null;
    return { path: art.filePath, name: art.title || art.filePath.split('/').pop() || '' };
  }, [previewOpen, activeTabId, previewItems]);
  const hasDoc = !!currentDoc;

  // doc 消失时同步清 attach，避免悬空的 docContextAttached 干扰 hasContent / 发送态
  useEffect(() => {
    if (!hasDoc && docContextAttached) setDocContextAttached(false);
  }, [hasDoc, docContextAttached, setDocContextAttached]);

  // ── 统一命令发送 ──

  const sendAsUser = useCallback(async (text: string, displayText?: string): Promise<boolean> => {
    const ws = getWebSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const _s = useStore.getState();
    if (_s.streamingSessions.includes(_s.currentSessionPath || '')) return false;
    if (_s.pendingSessionSwitchPath) return false;

    if (pendingNewSession) {
      const ok = await ensureSession();
      if (!ok) return false;
      loadSessions();
    }

    ws.send(JSON.stringify({
      type: 'prompt',
      text,
      sessionPath: useStore.getState().currentSessionPath,
      uiContext: collectUiContext(useStore.getState()),
      displayMessage: { text: displayText ?? text },
    }));
    return true;
  }, [pendingNewSession]);

  // ── 斜杠命令 ──

  const diaryFn = useCallback(() => {
    executeDiary(t, addToast, removeToast, () => { editor?.commands.clearContent(); }, setSlashMenuOpen)();
  }, [t, addToast, removeToast, editor]);
  const xingFn = useCallback(async () => {
    editor?.commands.clearContent();
    setSlashMenuOpen(false);
    await sendAsUser(XING_PROMPT);
  }, [sendAsUser, editor]);
  const compactFn = useCallback(async () => {
    await executeCompact(setSlashBusy, () => { editor?.commands.clearContent(); }, setSlashMenuOpen)();
  }, [editor]);

  const skillItems = useSkillSlashItems();

  // 注：/stop /new /reset 仅走 bridge 平台（TG/Feishu/...）；桌面端有 GUI，菜单不暴露这些命令。
  // buildSlashCommands 第 5 参留作未来 web/mobile 端需要时再注入。后端 WS 通道 (type:'slash')
  // 和 REST /api/commands 保留作扩展面，不影响现有桌面 UX。
  const slashCommands = useMemo(
    () => [...buildSlashCommands(t, diaryFn, xingFn, compactFn), ...skillItems],
    [diaryFn, xingFn, compactFn, t, skillItems],
  );

  const filteredCommands = useMemo(() => {
    if (!inputText.startsWith('/')) return slashCommands;
    return getSlashMatches(inputText, slashCommands);
  }, [inputText, slashCommands]);

  useEffect(() => {
    setSlashSelected(index => Math.min(index, Math.max(filteredCommands.length - 1, 0)));
  }, [filteredCommands.length]);

  const fileMentionItems = useMemo(() => buildFileMentionItems({
    query: fileMentionQuery,
    attachedFiles,
    sessionFiles,
    deskFiles,
    deskBasePath,
    deskCurrentPath,
    searchResults: fileMentionSearchResults,
  }), [
    attachedFiles,
    deskBasePath,
    deskCurrentPath,
    deskFiles,
    fileMentionQuery,
    fileMentionSearchResults,
    sessionFiles,
  ]);

  const dismissSlashMenu = useCallback(() => {
    const text = editor?.getText().trim() ?? inputText.trim();
    slashDismissedTextRef.current = text.startsWith('/') ? text : null;
    setSlashMenuOpen(false);
  }, [editor, inputText]);

  const openSlashMenu = useCallback(() => {
    slashDismissedTextRef.current = null;
    setSlashMenuOpen(true);
  }, []);

  useEffect(() => {
    if (!fileMenuOpen) {
      setFileMentionSearchResults([]);
      setFileMentionBusy(false);
      return;
    }

    const query = fileMentionQuery.trim();
    const seq = ++fileMentionSearchSeqRef.current;
    if (!query) {
      setFileMentionSearchResults([]);
      setFileMentionBusy(false);
      return;
    }

    setFileMentionBusy(true);
    const timer = window.setTimeout(() => {
      searchDeskFiles(query)
        .then((results) => {
          if (fileMentionSearchSeqRef.current === seq) setFileMentionSearchResults(results);
        })
        .catch((err: unknown) => {
          if (fileMentionSearchSeqRef.current === seq) setFileMentionSearchResults([]);
          console.warn('[file-mention] search failed', err);
        })
        .finally(() => {
          if (fileMentionSearchSeqRef.current === seq) setFileMentionBusy(false);
        });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [fileMentionQuery, fileMenuOpen]);

  useEffect(() => {
    if (fileSelected < fileMentionItems.length) return;
    setFileSelected(Math.max(0, fileMentionItems.length - 1));
  }, [fileMentionItems.length, fileSelected]);

  const handleSlashToggle = useCallback(() => {
    if (slashMenuOpen) dismissSlashMenu();
    else openSlashMenu();
  }, [slashMenuOpen, dismissSlashMenu, openSlashMenu]);

  const handleAttach = useCallback(async () => {
    const paths = await window.platform?.selectFiles?.();
    if (paths && paths.length > 0) await attachFilesFromPaths(paths);
  }, []);

  // Sync editor text to React state (drives hasInput / canSend) + slash menu detection + draft save
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      const text = editor.getText();
      setInputText(text);
      if (slashDismissedTextRef.current && slashDismissedTextRef.current !== text.trim()) {
        slashDismissedTextRef.current = null;
      }
      const slashMatches = getSlashMatches(text, slashCommands);
      const fileMention = findFileMentionRange(editor);
      if (fileMention) {
        setFileMentionRange(fileMention);
        setFileMentionQuery(fileMention.query);
        setFileMenuOpen(true);
        setFileSelected(0);
        setSlashMenuOpen(false);
      } else {
        setFileMenuOpen(false);
        setFileMentionRange(null);
        setFileMentionQuery('');
      }
      if (!fileMention && slashMatches.length > 0 && slashDismissedTextRef.current !== text.trim()) {
        setSlashMenuOpen(true);
        setSlashSelected(0);
      } else {
        setSlashMenuOpen(false);
      }
      // 保存草稿到 store
      if (currentSessionPath) {
        setDraft(currentSessionPath, text);
      }
      // 内容超出可见区域时，自动滚动到光标位置
      requestAnimationFrame(() => editor.commands.scrollIntoView());
    };
    editor.on('update', handler);
    return () => { editor.off('update', handler); };
  }, [editor, currentSessionPath, setDraft, slashCommands]);

  // 切换 session 时恢复草稿
  useEffect(() => {
    if (!editor || !currentSessionPath) return;
    if (typeof editor.setEditable === 'function' && !editor.isEditable) {
      editor.setEditable(true);
    }
    const draft = currentDraft;
    const current = editor.getText();
    setInputText(draft);
    if (draft !== current) {
      if (!draft) {
        editor.commands.setContent('', { emitUpdate: false });
      } else {
        const doc = {
          type: 'doc' as const,
          content: draft.split('\n').map(line => ({
            type: 'paragraph' as const,
            content: line ? [{ type: 'text' as const, text: line }] : [],
          })),
        };
        editor.commands.setContent(doc, { emitUpdate: false });
      }
    }
  }, [editor, currentDraft, currentSessionPath]);

  // 点击外部关闭斜杠菜单
  useEffect(() => {
    if (!slashMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (slashMenuRef.current?.contains(e.target as Node)) return;
      if (slashBtnRef.current?.contains(e.target as Node)) return;
      dismissSlashMenu();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dismissSlashMenu, slashMenuOpen]);

  useEffect(() => {
    if (!fileMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (fileMenuRef.current?.contains(e.target as Node)) return;
      setFileMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [fileMenuOpen]);

  // Can send?
  const hasContent = inputText.trim().length > 0 || attachedFiles.length > 0 || docContextAttached || !!quotedSelection
    || editorHasInlineNode(editor, 'skillBadge')
    || editorHasInlineNode(editor, 'fileBadge');
  const hasUsableModel = !!currentModelInfo;
  const canSend = hasContent && connected && !isStreaming && !modelSwitching && !pendingSessionSwitchPath && hasUsableModel && !compressForking;
  const modelNoticeText = modelsLoadState === 'error'
    ? t('model.loadFailedHint')
    : (modelsLoadState === 'empty' || (modelsLoadState === 'idle' && models.length === 0))
      ? t('model.noneConfiguredHint')
      : (modelsLoadState === 'ready' && models.length > 0 && !currentModelInfo)
        ? t('model.notSelectedHint')
        : '';

  const loadVisionAuxiliaryConfig = useCallback(async () => {
    const res = await hanaFetch('/api/preferences/models');
    const data = await res.json();
    return {
      enabled: data?.models?.vision_enabled === true,
      model: data?.models?.vision || null,
    };
  }, []);

  // ── Paste image ──
  // 与拖拽对齐：剪贴板图片同样落盘到 uploads 目录，入 store 的形态和拖拽完全一致
  // （只有 path/name/isDirectory，没有 base64Data）。是否走 vision 桥由发送阶段的
  // visionAuxiliary 标记统一决定，handlePaste 不再做能力判断。
  const handlePaste = useCallback((e: ClipboardEvent): boolean => {
    const items = e.clipboardData?.items;
    if (items) {
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue;
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return true;
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result as string;
          const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
          if (!match) return;
          const [, mimeType, base64Data] = match;
          const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : (mimeType.split('/')[1] || 'png');
          const name = `${t('input.pastedImage')}.${ext}`;
          try {
            const res = await hanaFetch('/api/upload-blob', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                base64Data,
                mimeType,
                ...(useStore.getState().currentSessionPath ? { sessionPath: useStore.getState().currentSessionPath } : {}),
              }),
            });
            const data = await res.json();
            const upload = data?.uploads?.[0];
            if (upload?.dest) {
              addAttachedFile({ fileId: upload.fileId, path: upload.dest, name: upload.name || name, isDirectory: false });
            } else {
              notifyPasteUploadFailure(t, upload?.error);
              console.warn('[paste] upload-blob failed', upload?.error || data);
            }
          } catch (err) {
            notifyPasteUploadFailure(t, err);
            console.warn('[paste] upload-blob error', err);
          }
        };
        reader.readAsDataURL(file);
        return true;
      }
    }

    const plainUrlPaste = extractPlainUrlPaste(e.clipboardData);
    if (plainUrlPaste && editor) {
      e.preventDefault();
      editor.commands.insertContent(plainUrlPaste);
      return true;
    }
    return false;
  }, [addAttachedFile, editor, t]);

  pasteHandlerRef.current = handlePaste;

  // ── Load thinking level once server port is ready + listen for plan mode sync ──
  const activeServerConnection = useStore(s => s.activeServerConnection);
  useEffect(() => {
    if (activeServerConnection) {
      fetchConfig()
        .then(d => { if (d.thinking_level) setThinkingLevel(d.thinking_level as ThinkingLevel); })
        .catch((err: unknown) => console.warn('[InputArea] load config failed', err));
    }

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setPermissionMode((detail.mode || (detail.enabled ? 'read_only' : 'operate')) as PermissionMode);
    };
    window.addEventListener('hana-plan-mode', handler);
    return () => window.removeEventListener('hana-plan-mode', handler);
  }, [activeServerConnection, setThinkingLevel]);

  // ── Handle slash selection (builtin vs skill) ──
  const handleSlashSelect = useCallback((item: SlashItem) => {
    slashDismissedTextRef.current = null;
    if (item.type === 'builtin') {
      item.execute();
      return;
    }
    if (!editor) return;
    editor.chain()
      .clearContent()
      .insertContent({ type: 'skillBadge', attrs: { name: item.name } })
      .insertContent(' ')
      .focus()
      .run();
    setSlashMenuOpen(false);
  }, [editor]);

  const handleFileMentionSelect = useCallback((item: FileMentionItem) => {
    if (!editor || !fileMentionRange) return;
    editor.chain()
      .focus()
      .deleteRange({ from: fileMentionRange.from, to: fileMentionRange.to })
      .insertContent({
        type: 'fileBadge',
        attrs: {
          fileId: item.fileId || null,
          path: item.path,
          name: item.name,
          isDirectory: !!item.isDirectory,
          mimeType: item.mimeType || null,
        },
      })
      .insertContent(' ')
      .run();
    setFileMenuOpen(false);
    setFileMentionRange(null);
    setFileMentionQuery('');
  }, [editor, fileMentionRange]);

  // ── Send message ──
  const handleSend = useCallback(async () => {
    if (!editor) return;
    const editorJson = editor.getJSON();
    const { text: rawText, skills, fileRefs } = serializeEditor(editorJson);
    const text = rawText.trim();

    const slashSelection = resolveSlashSubmitSelection({
      text,
      skills,
      commands: slashCommands,
      selectedIndex: slashSelected,
      dismissedText: slashDismissedTextRef.current,
    });
    if (slashSelection) {
      handleSlashSelect(slashSelection);
      return;
    }

    const inputFiles = mergeEditorFileRefs(attachedFiles, fileRefs);
    const hasFiles = inputFiles.length > 0;
    if ((!text && !hasFiles && !docContextAttached && !useStore.getState().quotedSelection) || !connected) return;
    if (isStreaming) return;
    if (sending) return;
    if (modelSwitching) return;
    if (useStore.getState().pendingSessionSwitchPath) return;
    setSending(true);

    try {
      if (pendingNewSession) {
        const ok = await ensureSession();
        if (!ok) return;
        loadSessions();
      }

      // 分离原生媒体和普通附件；后端决定图片视觉桥、视频原生能力或显式报错。
      const imageFiles = hasFiles ? inputFiles.filter(f => !f.isDirectory && isImageFile(f.name)) : [];
      const videoFiles = hasFiles ? inputFiles.filter(f => !f.isDirectory && isVideoFile(f.name)) : [];
      const otherFiles = hasFiles ? inputFiles.filter(f => f.isDirectory || (!isImageFile(f.name) && !isVideoFile(f.name))) : [];

      const imagePreflight = await evaluateChatImageSendPreflight({
        attachments: inputFiles,
        model: currentModelInfo,
        loadVisionAuxiliaryConfig,
      });
      if (!imagePreflight.ok) {
        notifyTextModelImageBlocked({
          t,
          addToast: useStore.getState().addToast,
          openSettings: () => openProviderModelSettings(currentModelInfo?.provider),
        });
        return;
      }
      const videoPreflight = await evaluateChatVideoSendPreflight({
        attachments: inputFiles,
        model: currentModelInfo,
      });
      if (!videoPreflight.ok) {
        notifyTextModelVideoBlocked({
          t,
          addToast: useStore.getState().addToast,
          openSettings: () => openProviderModelSettings(currentModelInfo?.provider),
        });
        return;
      }

      let finalText = text;
      if (otherFiles.length > 0) {
        const fileBlock = otherFiles.map(f => f.isDirectory ? `[目录] ${f.path}` : `[附件] ${f.path}`).join('\n');
        finalText = text ? `${text}\n\n${fileBlock}` : fileBlock;
      }

      // 图片 / 视频读 base64。统一走 platform 层：Electron 里 platform 代理到 hana，
      // Web/PWA 里 platform 代理到 HTTP fallback。
      const platform = window.platform;
      const images: Array<{ type: 'image'; data: string; mimeType: string }> = [];
      const videos: Array<{ type: 'video'; data: string; mimeType: string }> = [];
      const imageBase64Map = new Map<string, { base64Data: string; mimeType: string }>();
      const videoBase64Map = new Map<string, { base64Data: string; mimeType: string }>();
      for (const img of imageFiles) {
        try {
          if (img.base64Data && img.mimeType) {
            images.push({ type: 'image', data: img.base64Data, mimeType: img.mimeType });
          } else {
            const base64 = await platform?.readFileBase64?.(img.path);
            if (base64) {
              const mimeType = chatImageMimeTypeForName(img.name, img.mimeType);
              imageBase64Map.set(img.path, { base64Data: base64, mimeType });
              images.push({ type: 'image', data: base64, mimeType });
            } else {
              throw new Error(`failed to read image attachment: ${img.path}`);
            }
          }
        } catch (err) {
          console.warn('[input] failed to read image attachment', err);
          useStore.getState().addToast(t('input.imageReadFailed'), 'error', 6000, {
            dedupeKey: `image-read-failed:${img.path}`,
          });
          return;
        }
      }
      for (const video of videoFiles) {
        try {
          if (video.base64Data && video.mimeType) {
            const mimeType = chatVideoMimeTypeForName(video.name, video.mimeType);
            videos.push({ type: 'video', data: video.base64Data, mimeType });
          } else {
            const base64 = await platform?.readFileBase64?.(video.path);
            if (base64) {
              const mimeType = chatVideoMimeTypeForName(video.name, video.mimeType);
              videoBase64Map.set(video.path, { base64Data: base64, mimeType });
              videos.push({ type: 'video', data: base64, mimeType });
            } else {
              throw new Error(`failed to read video attachment: ${video.path}`);
            }
          }
        } catch (err) {
          console.warn('[input] failed to read video attachment', err);
          useStore.getState().addToast(t('input.videoReadFailed'), 'error', 6000, {
            dedupeKey: `video-read-failed:${video.path}`,
          });
          return;
        }
      }

      // 文档上下文
      let docForRender: { path: string; name: string } | null = null;
      if (docContextAttached && currentDoc) {
        finalText = finalText ? `${finalText}\n\n[参考文档] ${currentDoc.path}` : `[参考文档] ${currentDoc.path}`;
        docForRender = currentDoc;
      }
      if (docContextAttached) setDocContextAttached(false);

      // 引用片段
      const qs = useStore.getState().quotedSelection;
      if (qs) {
        const quoteStr = formatQuotedSelectionForPrompt(qs);
        finalText = finalText ? `${finalText}\n\n${quoteStr}` : quoteStr;
      }

      const allFiles = [...(hasFiles ? inputFiles : [])];
      if (docForRender) allFiles.push({ path: docForRender.path, name: docForRender.name });

      editor.commands.clearContent();
      if (currentSessionPath) clearDraft(currentSessionPath);
      clearAttachedFiles();
      const qs2 = useStore.getState().quotedSelection;
      if (qs2) useStore.getState().clearQuotedSelection();

      const ws = getWebSocket();
      const wsMsg: Record<string, unknown> = {
        type: 'prompt',
        text: finalText,
        sessionPath: useStore.getState().currentSessionPath,
        uiContext: collectUiContext(useStore.getState()),
        displayMessage: {
          text,
          skills: skills.length > 0 ? skills : undefined,
          quotedText: qs?.text,
          attachments: allFiles.length > 0 ? allFiles.map(f => {
            const cached = imageBase64Map.get(f.path);
            const cachedVideo = videoBase64Map.get(f.path);
            const imageFile = !f.isDirectory && isImageFile(f.name);
            return {
              fileId: f.fileId,
              path: f.path,
              name: f.name,
              isDir: !!f.isDirectory,
              mimeType: f.mimeType || cached?.mimeType || cachedVideo?.mimeType || undefined,
              visionAuxiliary: imageFile && !supportsVision,
            };
          }) : undefined,
        },
      };
      if (images.length > 0) wsMsg.images = images;
      if (videos.length > 0) wsMsg.videos = videos;
      if (skills.length > 0) wsMsg.skills = skills;
      ws?.send(JSON.stringify(wsMsg));
    } finally {
      setSending(false);
    }
  }, [editor, attachedFiles, docContextAttached, connected, isStreaming, sending, pendingNewSession, currentDoc, clearAttachedFiles, clearDraft, currentSessionPath, setDocContextAttached, slashCommands, slashSelected, handleSlashSelect, supportsVision, currentModelInfo, loadVisionAuxiliaryConfig, modelSwitching, t]);

  // ── Steer ──
  const handleSteer = useCallback(async () => {
    if (!editor) return;
    const text = editor.getText().trim();
    if (!text || !isStreaming) return;
    const ws = getWebSocket();
    if (!ws) return;
    editor.commands.clearContent();
    const sp = useStore.getState().currentSessionPath;
    if (sp) clearDraft(sp);
    ws.send(JSON.stringify({ type: 'interrupt_prompt', text, sessionPath: sp, uiContext: collectUiContext(useStore.getState()), displayMessage: { text } }));
  }, [editor, isStreaming, clearDraft]);

  // ── Stop ──
  const handleStop = useCallback(() => {
    const ws = getWebSocket();
    if (!isStreaming || !ws) return;
    ws.send(JSON.stringify({ type: 'abort', sessionPath: useStore.getState().currentSessionPath }));
  }, [isStreaming]);

  // ── Key handler ──
  const handleEditorKeyDown = useCallback((e: InputKeyEvent): boolean => {
    if (e.defaultPrevented) return false;
    if (fileMenuOpen && (fileMentionItems.length > 0 || fileMentionBusy)) {
      if (e.key === 'ArrowDown' && fileMentionItems.length > 0) {
        e.preventDefault();
        setFileSelected(i => (i + 1) % fileMentionItems.length);
        return true;
      }
      if (e.key === 'ArrowUp' && fileMentionItems.length > 0) {
        e.preventDefault();
        setFileSelected(i => (i - 1 + fileMentionItems.length) % fileMentionItems.length);
        return true;
      }
      if ((e.key === 'Tab' || e.key === 'Enter') && fileMentionItems.length > 0) {
        e.preventDefault();
        const item = fileMentionItems[fileSelected];
        if (item) handleFileMentionSelect(item);
        return true;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setFileMenuOpen(false);
        return true;
      }
    }
    if (slashMenuOpen && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSelected(i => (i + 1) % filteredCommands.length); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashSelected(i => (i - 1 + filteredCommands.length) % filteredCommands.length); return true; }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        const cmd = filteredCommands[slashSelected] || filteredCommands[0];
        if (cmd) handleSlashSelect(cmd);
        return true;
      }
      if (e.key === 'Escape') { e.preventDefault(); dismissSlashMenu(); return true; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !isComposing.current && !e.isComposing) {
      e.preventDefault();
      if (isStreaming && (editor?.getText().trim())) handleSteer(); else handleSend();
      return true;
    }
    return false;
  }, [
    dismissSlashMenu,
    fileMentionBusy,
    fileMentionItems,
    fileMenuOpen,
    fileSelected,
    filteredCommands,
    handleFileMentionSelect,
    handleSend,
    handleSteer,
    handleSlashSelect,
    isStreaming,
    editor,
    slashMenuOpen,
    slashSelected,
  ]);

  keyDownHandlerRef.current = handleEditorKeyDown as (event: KeyboardEvent) => boolean;

  const handleSlashResultClick = useCallback(() => {
    if (!slashResult?.deskDir) return;
    toggleJianSidebar(true);
    loadDeskFiles('', slashResult.deskDir);
  }, [slashResult?.deskDir]);

  const handleCompleteTodos = useCallback(async () => {
    const path = currentSessionPath;
    if (!path || completingTodos || sessionTodos.length === 0) return;
    if (isStreaming) {
      addToast(t('common.completeTodosWhileStreaming'), 'warning', 4000, {
        dedupeKey: 'todo-complete-streaming',
      });
      return;
    }
    setCompletingTodos(true);
    try {
      await hanaFetch('/api/sessions/todos/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      useStore.getState().setSessionTodosForPath(path, []);
      useStore.getState().bumpTodosLiveVersion(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('409') || message.includes('session is streaming') || message.includes('session_busy')) {
        addToast(t('common.completeTodosWhileStreaming'), 'warning', 4000, {
          dedupeKey: 'todo-complete-streaming',
        });
      } else {
        addToast(message, 'error', 6000);
      }
    } finally {
      setCompletingTodos(false);
    }
  }, [addToast, completingTodos, currentSessionPath, isStreaming, sessionTodos.length, t]);

  return (
    <>
      <InputStatusBars
        slashBusy={slashBusy}
        slashBusyLabel={slashCommands.find(c => c.name === slashBusy)?.busyLabel || t('common.executing')}
        compacting={compacting}
        compactingLabel={t('chat.compacting')}
        screenshotBusy={screenshotBusy}
        screenshotLabel={t('common.screenshotInProgress')}
        screenshotPageLabel={screenshotProgress && screenshotProgress.totalPages > 0
          ? t('common.screenshotProgressPage', {
            current: screenshotProgress.currentPage,
            total: screenshotProgress.totalPages,
          })
          : null}
        screenshotProgress={screenshotProgress}
        inlineError={inlineError}
        slashResult={slashResult}
        onResultClick={slashResult?.deskDir ? handleSlashResultClick : undefined}
      />
      <InputContextRow
        attachedFiles={attachedFiles}
        removeAttachedFile={removeAttachedFile}
        hasQuotedSelection={!!quotedSelection}
        sessionTodos={sessionTodos}
        onCompleteTodos={handleCompleteTodos}
        completingTodos={completingTodos}
        completeTodosDisabled={isStreaming}
        completeTodosDisabledTitle={isStreaming ? t('common.completeTodosWhileStreaming') : undefined}
      />
      <div className={styles['slash-menu-anchor']} ref={slashMenuRef}>
        {slashMenuOpen && filteredCommands.length > 0 && (
          <SlashCommandMenu commands={filteredCommands} selected={slashSelected} busy={slashBusy}
            onSelect={handleSlashSelect} onHover={(i) => setSlashSelected(i)} />
        )}
      </div>
      <div className={styles['slash-menu-anchor']} ref={fileMenuRef}>
        {fileMenuOpen && (fileMentionItems.length > 0 || fileMentionBusy) && (
          <FileMentionMenu
            items={fileMentionItems}
            selected={fileSelected}
            busy={fileMentionBusy}
            onSelect={handleFileMentionSelect}
            onHover={(i) => setFileSelected(i)}
          />
        )}
      </div>
      <div className={styles['input-stack']}>
        {visibleSessionConfirmation && (
          <SessionConfirmationPrompt
            block={visibleSessionConfirmation}
            exiting={sessionConfirmationExiting}
          />
        )}
        <div className={styles['input-wrapper']} ref={cardRef}>
          {modelNoticeText && (
            <div className={styles['model-status-bar']}>
              <span className={styles['model-status-text']}>{modelNoticeText}</span>
              <button
                type="button"
                className={styles['model-status-action']}
                onClick={() => openProviderModelSettings(currentModelInfo?.provider)}
              >
                {models.length > 0 ? t('model.selectAction') : t('model.configureAction')}
              </button>
            </div>
          )}
          <div
            onMouseDown={() => {
              if (!editor || editor.isDestroyed) return;
              if (typeof editor.setEditable === 'function' && !editor.isEditable) {
                editor.setEditable(true);
              }
              if (!editor.isFocused) {
                editor.commands.focus('end');
              }
            }}
            onKeyDown={(event) => {
              if (!event.defaultPrevented) handleEditorKeyDown(event);
            }}
            onCompositionStart={() => { isComposing.current = true; }}
            onCompositionEnd={() => { isComposing.current = false; }}
          >
            <EditorContent editor={editor} />
          </div>
          <InputControlBar
            t={t}
            onAttach={handleAttach}
            slashBtnRef={slashBtnRef}
            onSlashToggle={handleSlashToggle}
            permissionMode={permissionMode}
            onPermissionModeChange={setPermissionMode}
            planModeLocked={false}
            showThinking={currentModelInfo?.reasoning !== false}
            thinkingLevel={thinkingLevel}
            onThinkingChange={setThinkingLevel}
            modelXhigh={(sessionModel ? (sessionModel.xhigh ?? models.find(m => m.id === sessionModel.id && m.provider === sessionModel.provider)?.xhigh) : globalModelInfo?.xhigh) ?? false}
            models={models}
            modelsLoadState={modelsLoadState}
            sessionModel={sessionModel}
            isStreaming={isStreaming}
            hasInput={!!inputText.trim()}
            canSend={canSend}
            onSend={handleSend}
            onSteer={handleSteer}
            onStop={handleStop}
          />
        </div>
      </div>
    </>
  );
}
