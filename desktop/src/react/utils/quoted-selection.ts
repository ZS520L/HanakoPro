import type { QuotedSelection } from '../stores/input-slice';

export const QUOTE_ORIGINAL_START = '[引用原文]';
export const QUOTE_ORIGINAL_END = '[/引用原文]';

export function formatQuotedSelectionForPrompt(sel: QuotedSelection): string {
  if (sel.sourceFilePath && sel.lineStart != null && sel.lineEnd != null) {
    return [
      `[引用片段] ${sel.sourceTitle}（第${sel.lineStart}-${sel.lineEnd}行，共${sel.charCount}字）路径: ${sel.sourceFilePath}`,
      QUOTE_ORIGINAL_START,
      sel.text,
      QUOTE_ORIGINAL_END,
    ].join('\n');
  }
  return `[引用片段] ${sel.text}`;
}
