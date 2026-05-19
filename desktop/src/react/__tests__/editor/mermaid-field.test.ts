/**
 * @vitest-environment jsdom
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mermaidDecoField, collectMermaidCodeBlocks } from '../../editor/mermaid-field';
import { __setMermaidLoaderForTests } from '../../utils/mermaid-renderer';

describe('mermaid editor live preview', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    __setMermaidLoaderForTests(async () => ({
      initialize: vi.fn(),
      render: vi.fn(async (id: string, source: string) => ({
        svg: `<svg data-id="${id}"><text>${source}</text></svg>`,
      })),
    }));
  });

  afterEach(() => {
    __setMermaidLoaderForTests(null);
  });

  it('collects inactive mermaid fenced code blocks', () => {
    const blocks = collectMermaidCodeBlocks([
      'intro',
      '```mermaid',
      'graph TD',
      '  A-->B',
      '```',
    ].join('\n'), new Set());

    expect(blocks).toEqual([
      expect.objectContaining({
        from: 6,
        source: 'graph TD\n  A-->B',
      }),
    ]);
  });

  it('skips mermaid blocks while the cursor is inside the block', () => {
    const blocks = collectMermaidCodeBlocks([
      '```mermaid',
      'graph TD',
      '  A-->B',
      '```',
    ].join('\n'), new Set([2]));

    expect(blocks).toEqual([]);
  });

  it('provides a block widget for inactive mermaid code blocks', () => {
    const state = EditorState.create({
      doc: [
        'intro',
        '```mermaid',
        'graph TD',
        '  A-->B',
        '```',
      ].join('\n'),
      extensions: [mermaidDecoField],
    });
    const specs: unknown[] = [];

    state.field(mermaidDecoField).between(0, state.doc.length, (_from, _to, deco) => {
      if ((deco.spec as { block?: boolean }).block) specs.push(deco.spec);
    });

    expect(specs).toHaveLength(1);
  });

  it('reveals mermaid source when the rendered widget is clicked', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: [
          'intro',
          '```mermaid',
          'graph TD',
          '  A-->B',
          '```',
        ].join('\n'),
        extensions: [mermaidDecoField],
      }),
    });

    const widget = parent.querySelector('.cm-mermaid-widget');
    expect(widget).toBeInstanceOf(HTMLElement);

    widget?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(view.state.selection.main.head).toBe(6);
    expect(view.state.field(mermaidDecoField).size).toBe(0);

    view.destroy();
  });
});
