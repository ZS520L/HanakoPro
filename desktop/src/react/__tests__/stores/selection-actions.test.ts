import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { beforeEach, describe, expect, it } from 'vitest';
import { captureSelection } from '../../stores/selection-actions';
import { useStore } from '../../stores';
import type { PreviewItem } from '../../types';

const previewItem: PreviewItem = {
  id: 'preview-1',
  title: 'note.md',
  type: 'markdown',
  content: '',
  filePath: '/notes/note.md',
};

describe('captureSelection', () => {
  beforeEach(() => {
    useStore.getState().clearQuotedSelection();
    useStore.setState({ selectedIdsBySession: {} } as never);
  });

  it('uses the trimmed quoted text range for lineEnd when selection includes a trailing newline', () => {
    const doc = 'alpha\nbeta\ngamma';
    const state = EditorState.create({
      doc,
      selection: { anchor: 6, head: 11 },
    });

    captureSelection(previewItem, { state } as EditorView);

    expect(useStore.getState().quotedSelection).toMatchObject({
      text: 'beta',
      sourceTitle: 'note.md',
      sourceFilePath: '/notes/note.md',
      lineStart: 2,
      lineEnd: 2,
      charCount: 4,
    });
  });

  it('sets explicit message selection per session and removes empty session entries', () => {
    const state = useStore.getState();

    state.setMessageSelection('/session/a.jsonl', ['m2', 'm1', 'm2']);

    expect(useStore.getState().selectedIdsBySession['/session/a.jsonl']).toEqual(['m2', 'm1']);

    useStore.getState().setMessageSelection('/session/a.jsonl', []);

    expect(useStore.getState().selectedIdsBySession['/session/a.jsonl']).toBeUndefined();
  });
});
