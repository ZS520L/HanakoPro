import { EditorView, Decoration } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { EditorState, StateField, RangeSetBuilder, type Transaction } from '@codemirror/state';
import { MermaidWidget } from './widgets/mermaid';

export interface MermaidCodeBlock {
  from: number;
  to: number;
  source: string;
  startLine: number;
  endLine: number;
}

const MERMAID_OPEN_RE = /^ {0,3}`{3,}\s*mermaid(?:\s+.*)?$/i;
const FENCE_CLOSE_RE = /^ {0,3}`{3,}\s*$/;

function rangeTouchesActiveLine(startLine: number, endLine: number, activeLines: Set<number>): boolean {
  for (let line = startLine; line <= endLine; line += 1) {
    if (activeLines.has(line)) return true;
  }
  return false;
}

export function collectMermaidCodeBlocks(text: string, activeLines: Set<number>): MermaidCodeBlock[] {
  const blocks: MermaidCodeBlock[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let blockStart = -1;
  let blockStartLine = -1;
  let sourceLines: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.replace(/\r$/, '');
    const lineNo = i + 1;
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;

    if (blockStart < 0) {
      if (MERMAID_OPEN_RE.test(line)) {
        blockStart = lineStart;
        blockStartLine = lineNo;
        sourceLines = [];
      }
    } else if (FENCE_CLOSE_RE.test(line)) {
      if (!rangeTouchesActiveLine(blockStartLine, lineNo, activeLines)) {
        blocks.push({
          from: blockStart,
          to: lineEnd,
          source: sourceLines.join('\n'),
          startLine: blockStartLine,
          endLine: lineNo,
        });
      }
      blockStart = -1;
      blockStartLine = -1;
      sourceLines = [];
    } else {
      sourceLines.push(line);
    }

    offset = lineEnd + (i < lines.length - 1 ? 1 : 0);
  }

  return blocks;
}

function collectActiveLines(state: EditorState): Set<number> {
  const activeLines = new Set<number>();
  if (
    state.selection.ranges.length === 1
    && state.selection.main.empty
    && state.selection.main.from === 0
  ) {
    return activeLines;
  }
  for (const range of state.selection.ranges) {
    const start = state.doc.lineAt(range.from).number;
    const end = state.doc.lineAt(range.to).number;
    for (let line = start; line <= end; line += 1) activeLines.add(line);
  }
  return activeLines;
}

function buildMermaidDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const activeLines = collectActiveLines(state);
  const blocks = collectMermaidCodeBlocks(state.doc.toString(), activeLines);

  for (const block of blocks) {
    builder.add(
      block.from,
      block.to,
      Decoration.replace({
        widget: new MermaidWidget(block.source, block.from),
        block: true,
      }),
    );
  }

  return builder.finish();
}

export const mermaidDecoField = StateField.define<DecorationSet>({
  create(state) {
    return buildMermaidDecorations(state);
  },
  update(value, tr: Transaction) {
    if (tr.docChanged || tr.selection) return buildMermaidDecorations(tr.state);
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});
