import { useStore } from './index';
import type { ChatMessage } from './chat-types';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { collectUiContext } from '../utils/ui-context';

export async function replayLatestUserMessage(
  sessionPath: string,
  message: ChatMessage,
  replacementText?: string,
): Promise<boolean> {
  if (!sessionPath || !message?.id) return false;

  try {
    const state = useStore.getState();
    if (state.streamingSessions.includes(sessionPath)) return false;

    await hanaFetch('/api/sessions/latest-user-message/replay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path: sessionPath,
        sourceEntryId: message.sourceEntryId || null,
        clientMessageId: message.id,
        text: replacementText,
        uiContext: collectUiContext(state),
        displayMessage: {
          text: replacementText ?? message.text ?? '',
          quotedText: message.quotedText,
          attachments: message.attachments,
          skills: message.skills,
          deskContext: message.deskContext ?? null,
        },
      }),
    });
    return true;
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    useStore.getState().setInlineError?.(sessionPath, text, 6000);
    return false;
  }
}
