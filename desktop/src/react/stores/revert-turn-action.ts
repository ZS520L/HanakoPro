import { useStore } from './index';
import {
  requireServerConnection,
  appendConnectionAuth,
  buildConnectionUrl,
} from '../services/server-connection';
import { loadMessages } from './session-actions';
import type { ChatListItem, ChatMessage } from './chat-types';

/**
 * Revert the latest assistant turn — restore files to pre-edit state
 * and branch the conversation back (remove the assistant response).
 *
 * @param sessionPath  Current session path
 * @param sinceTs      Timestamp of the user message that triggered the assistant turn;
 *                     all file checkpoints created after this are restored.
 */
export async function revertTurn(
  sessionPath: string,
  sinceTs: number | string,
): Promise<{ ok: boolean; restoredFiles?: number }> {
  if (!sessionPath) return { ok: false };

  try {
    const state = useStore.getState();
    if (state.streamingSessions.includes(sessionPath)) return { ok: false };
    const revertedInput = findRevertedUserInput(state.chatSessions[sessionPath]?.items, sinceTs);

    const connection = requireServerConnection(state, 'revert-turn');
    const headers = appendConnectionAuth(connection, { 'content-type': 'application/json' });
    const url = buildConnectionUrl(connection, '/api/sessions/revert-turn');

    const res = await fetch(url, {
      method: 'POST',
      headers: headers as Record<string, string>,
      body: JSON.stringify({ path: sessionPath, sinceTs }),
    });
    const data = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
    if (!res.ok || !data.ok) {
      const errMsg = data.error || `Revert failed (${res.status})`;
      console.error('[revert-turn]', errMsg);
      useStore.getState().setInlineError?.(sessionPath, errMsg, 6000);
      return { ok: false };
    }
    // 后端已分支化对话树，清掉本会话缓存后 loadMessages 强制重拉
    useStore.getState().clearSession?.(sessionPath);
    await loadMessages(sessionPath);
    if (revertedInput) {
      useStore.getState().setDraft?.(sessionPath, revertedInput.text || '');
      if (useStore.getState().currentSessionPath === sessionPath) {
        useStore.getState().setAttachedFiles?.(mapAttachmentsForInput(revertedInput));
        useStore.getState().requestInputEditorReset?.();
        useStore.getState().requestInputFocus?.();
      }
    }
    return { ok: true, restoredFiles: data.restoredFiles ?? 0 };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    console.error('[revert-turn] catch:', text);
    useStore.getState().setInlineError?.(sessionPath, text, 6000);
    return { ok: false };
  }
}

function findRevertedUserInput(items: ChatListItem[] | undefined, sinceTs: number | string): ChatMessage | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const preferredMs = timestampMs(sinceTs);
  if (preferredMs > 0) {
    let best: ChatMessage | null = null;
    let bestDelta = Infinity;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (item.type !== 'message' || item.data.role !== 'user') continue;
      if (!hasAssistantAfterUser(items, i)) continue;
      const ts = timestampMs(item.data.timestamp);
      if (ts <= 0) continue;
      const delta = Math.abs(ts - preferredMs);
      if (delta < bestDelta) {
        best = item.data;
        bestDelta = delta;
      }
    }
    if (best && bestDelta <= 5 * 60 * 1000) return best;
  }

  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.type !== 'message' || item.data.role !== 'user') continue;
    if (hasAssistantAfterUser(items, i)) return item.data;
  }
  return null;
}

function hasAssistantAfterUser(items: ChatListItem[], userIdx: number): boolean {
  for (let i = userIdx + 1; i < items.length; i += 1) {
    const item = items[i];
    if (item.type !== 'message') continue;
    if (item.data.role === 'user') return false;
    if (item.data.role === 'assistant') return true;
  }
  return false;
}

function timestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function mapAttachmentsForInput(message: ChatMessage) {
  return (message.attachments || []).map(att => ({
    fileId: att.fileId,
    path: att.path,
    name: att.name,
    isDirectory: att.isDir,
    base64Data: att.base64Data,
    mimeType: att.mimeType,
  }));
}
