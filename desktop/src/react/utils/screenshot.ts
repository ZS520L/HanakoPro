// desktop/src/react/utils/screenshot.ts
import { useStore } from '../stores';
import { selectSelectedIdsBySession } from '../stores/session-selectors';
import { extractScreenshotPayload, buildThemeName, type ScreenshotPayload } from './screenshot-extract';
import { readScreenshotSegmentVisibleCharLimit, splitScreenshotMessages } from './screenshot-segments';
import type { ChatMessage } from '../stores/chat-types';
import {
  appendConnectionAuth,
  buildConnectionUrl,
  createLocalServerConnection,
} from '../services/server-connection';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function dispatchInlineNotice(text: string, type: 'success' | 'error', deskDir?: string) {
  window.dispatchEvent(new CustomEvent('hana-inline-notice', {
    detail: { text, type, deskDir },
  }));
}

type StoreSnapshot = ReturnType<typeof useStore.getState>;
type ScreenshotRenderPayload = ScreenshotPayload & {
  saveDir?: string | null;
  segmentIndex?: number;
  segmentTotal?: number;
};

interface ScreenshotRenderResult {
  success: boolean;
  error?: string;
  dir?: string;
}

interface AvatarCache {
  assistant: string | null;
  user: string | null;
}

function beginScreenshotProgress(totalBlocks: number, totalPages: number): () => void {
  const state = useStore.getState() as StoreSnapshot & {
    beginScreenshotTask?: (progress: {
      completedBlocks: number;
      totalBlocks: number;
      currentPage: number;
      totalPages: number;
    }) => void;
    endScreenshotTask?: () => void;
  };
  state.beginScreenshotTask?.({
    completedBlocks: 0,
    totalBlocks,
    currentPage: totalPages > 0 ? 1 : 0,
    totalPages,
  });

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    const latest = useStore.getState() as StoreSnapshot & { endScreenshotTask?: () => void };
    latest.endScreenshotTask?.();
  };
}

function updateScreenshotProgress(progress: {
  completedBlocks?: number;
  currentPage?: number;
}) {
  const state = useStore.getState() as StoreSnapshot & {
    updateScreenshotProgress?: (progress: {
      completedBlocks?: number;
      currentPage?: number;
    }) => void;
  };
  state.updateScreenshotProgress?.(progress);
}

async function resolveAvatarCache(state: StoreSnapshot): Promise<AvatarCache> {
  const [assistant, user] = await Promise.all([
    state.currentAgentId
      ? fetchAvatarAsDataUrl('assistant', state.currentAgentId).catch(() => null)
      : Promise.resolve(null),
    fetchAvatarAsDataUrl('user', null).catch(() => null),
  ]);
  return { assistant, user };
}

async function buildScreenshotPayloadForMessages(
  messages: ChatMessage[],
  theme: string,
  state: StoreSnapshot,
  avatars: AvatarCache,
  imageCache: Map<string, string>,
  segment: { index: number; total: number },
): Promise<ScreenshotRenderPayload> {
  const payload = extractScreenshotPayload(messages, theme) as ScreenshotRenderPayload;
  payload.saveDir = state.homeFolder || null;
  if (segment.total > 1) {
    payload.segmentIndex = segment.index;
    payload.segmentTotal = segment.total;
  }

  if (!payload.messages) return payload;

  const assistantName = state.agentName || 'Hanako';
  const userName = state.userName || '我';

  for (const msg of payload.messages) {
    if (msg.role === 'assistant') {
      msg.name = assistantName;
      msg.avatarDataUrl = avatars.assistant;
    } else {
      msg.name = userName;
      msg.avatarDataUrl = avatars.user;
    }

    for (const block of msg.blocks) {
      if (block.type !== 'image' || !block.content || block.content.startsWith('data:')) continue;
      const cached = imageCache.get(block.content);
      if (cached) {
        block.content = cached;
        continue;
      }
      try {
        const dataUrl = await fetchImageAsDataUrl(block.content);
        imageCache.set(block.content, dataUrl);
        block.content = dataUrl;
      } catch { /* keep original content; broken image is preferable to failing the whole screenshot */ }
    }
  }

  return payload;
}

/**
 * 截图指定消息并保存到文件（离屏渲染管线）。
 */
export async function takeScreenshot(targetMessageId: string, sessionPath: string): Promise<void> {
  const state = useStore.getState();
  const ids = selectSelectedIdsBySession(state, sessionPath);
  const messageIds = ids.length > 0 ? ids : [targetMessageId];

  // 1. 从 store 提取消息数据
  const session = state.chatSessions[sessionPath];
  if (!session) return;

  const messages: ChatMessage[] = [];
  for (const item of session.items) {
    if (item.type !== 'message') continue;
    if (messageIds.includes(item.data.id)) {
      messages.push(item.data);
    }
  }
  if (messages.length === 0) return;

  // 2. 读取截图设置
  const color = localStorage.getItem('hana-screenshot-color') || 'light';
  const width = localStorage.getItem('hana-screenshot-width') || 'mobile';
  const theme = buildThemeName(color, width);

  const t = window.t ?? ((p: string) => p);
  const hana = (window as any).hana;
  if (!hana?.screenshotRender) {
    dispatchInlineNotice(t('common.screenshotFailed'), 'error');
    return;
  }

  const segmentLimit = readScreenshotSegmentVisibleCharLimit();
  const chunks = splitScreenshotMessages(messages, segmentLimit);
  const endProgress = beginScreenshotProgress(messages.length, chunks.length);
  try {
    const avatars = await resolveAvatarCache(state);
    const imageCache = new Map<string, string>();
    const results: ScreenshotRenderResult[] = [];
    let completedBlocks = 0;

    for (let i = 0; i < chunks.length; i += 1) {
      updateScreenshotProgress({ currentPage: i + 1 });
      const payload = await buildScreenshotPayloadForMessages(
        chunks[i],
        theme,
        state,
        avatars,
        imageCache,
        { index: i + 1, total: chunks.length },
      );
      const result = await hana.screenshotRender(payload) as ScreenshotRenderResult;
      if (!result.success) {
        throw new Error(result.error || t('common.screenshotFailed'));
      }
      results.push(result);
      completedBlocks += chunks[i].length;
      updateScreenshotProgress({ completedBlocks });
    }

    const saveDir = results.find(result => result.dir)?.dir;
    const savedText = chunks.length > 1
      ? t('common.screenshotSavedMultiple', { count: chunks.length })
      : t('common.screenshotSaved');
    dispatchInlineNotice(savedText, 'success', saveDir);
  } catch (err) {
    dispatchInlineNotice(`${t('common.screenshotFailed')}: ${getErrorMessage(err)}`, 'error');
  } finally {
    endProgress();
  }
}

/**
 * Markdown 编辑器截图（纯文章模式）。
 */
export async function takeArticleScreenshot(markdown: string): Promise<void> {
  const color = localStorage.getItem('hana-screenshot-color') || 'light';
  const width = localStorage.getItem('hana-screenshot-width') || 'mobile';
  const theme = buildThemeName(color, width);

  const t = window.t ?? ((p: string) => p);
  const hana = (window as any).hana;
  if (!hana?.screenshotRender) {
    dispatchInlineNotice(t('common.screenshotFailed'), 'error');
    return;
  }

  const homeFolder = useStore.getState().homeFolder || null;
  const endProgress = beginScreenshotProgress(1, 1);
  try {
    const result = await hana.screenshotRender({
      mode: 'article',
      theme,
      markdown,
      saveDir: homeFolder,
    });

    if (result.success) {
      updateScreenshotProgress({ completedBlocks: 1 });
      dispatchInlineNotice(t('common.screenshotSaved'), 'success', result.dir);
    } else {
      dispatchInlineNotice(`${t('common.screenshotFailed')}: ${result.error}`, 'error');
    }
  } catch (err) {
    dispatchInlineNotice(`${t('common.screenshotFailed')}: ${getErrorMessage(err)}`, 'error');
  } finally {
    endProgress();
  }
}

// ── 辅助：fetch 图片转 data URL ──

async function fetchImageAsDataUrl(filePath: string): Promise<string> {
  const url = window.platform?.getFileUrl?.(filePath) ?? '';
  const resp = await fetch(url);
  const blob = await resp.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function fetchAvatarAsDataUrl(role: string, agentId: string | null): Promise<string | null> {
  const port = await (window as any).hana?.getServerPort?.();
  const token = await (window as any).hana?.getServerToken?.();
  const connection = createLocalServerConnection({ serverPort: port, serverToken: token });
  if (!connection || !connection.token) return null;

  const path = role === 'user'
    ? '/api/avatar/user'
    : `/api/agents/${agentId}/avatar`;

  const resp = await fetch(buildConnectionUrl(connection, path), {
    headers: appendConnectionAuth(connection),
  });
  if (!resp.ok) return null;
  const blob = await resp.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}
