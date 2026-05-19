import { useStore } from '../stores';
import type { ContentBlock } from '../stores/chat-types';

export function extractSelectedTexts(sessionPath: string, selectedIds: readonly string[]): string {
  const session = useStore.getState().chatSessions[sessionPath];
  if (!session) return '';
  const texts: string[] = [];
  for (const item of session.items) {
    if (item.type !== 'message') continue;
    if (!selectedIds.includes(item.data.id)) continue;
    if (item.data.role === 'user') {
      if (item.data.text) texts.push(item.data.text);
    } else {
      const textBlocks = (item.data.blocks || []).filter(
        (b): b is ContentBlock & { type: 'text' } => b.type === 'text'
      );
      if (textBlocks.length > 0) {
        const tmp = document.createElement('div');
        tmp.innerHTML = textBlocks.map(b => b.html).join('\n');
        texts.push(tmp.innerText.trim());
      }
    }
  }
  return texts.join('\n\n');
}
