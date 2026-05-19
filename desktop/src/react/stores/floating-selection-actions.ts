import { useStore } from './index';
import type { QuotedSelection } from './input-slice';
import { ensureSession, loadSessions } from './session-actions';
import { getWebSocket } from '../services/websocket';
import { collectUiContext } from '../utils/ui-context';
import { formatQuotedSelectionForPrompt } from '../utils/quoted-selection';

export async function sendFloatingSelectionPrompt(text: string, selection: QuotedSelection): Promise<boolean> {
  const promptText = text.trim();
  if (!promptText) return false;

  let state = useStore.getState();
  if (state.streamingSessions.includes(state.currentSessionPath || '')) return false;

  if (state.pendingNewSession) {
    const ok = await ensureSession();
    if (!ok) return false;
    loadSessions();
  }

  const ws = getWebSocket();
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;

  state = useStore.getState();
  const quoteStr = formatQuotedSelectionForPrompt(selection);
  const finalText = `${promptText}\n\n${quoteStr}`;

  ws.send(JSON.stringify({
    type: 'prompt',
    text: finalText,
    sessionPath: state.currentSessionPath,
    uiContext: collectUiContext(state),
    displayMessage: {
      text: promptText,
      quotedText: selection.text,
    },
  }));
  return true;
}
