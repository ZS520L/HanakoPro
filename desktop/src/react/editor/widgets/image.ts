import { EditorView, WidgetType, Decoration } from '@codemirror/view';
import type { DecoRange } from '../md-decorations';
import {
  parseImageLabel,
  resolveMarkdownImageSrc,
  type ImageDimensions,
  type MarkdownImageContext,
} from '../../utils/markdown';

export class ImageWidget extends WidgetType {
  constructor(readonly url: string, readonly alt: string, readonly dimensions: ImageDimensions | null = null) { super(); }

  eq(other: ImageWidget) {
    return this.url === other.url
      && this.alt === other.alt
      && this.dimensions?.width === other.dimensions?.width
      && this.dimensions?.height === other.dimensions?.height;
  }

  toDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-image-widget';
    const img = document.createElement('img');
    img.src = this.url;
    img.alt = this.alt;
    img.loading = 'lazy';
    if (this.dimensions?.width) img.width = Number(this.dimensions.width);
    if (this.dimensions?.height) img.height = Number(this.dimensions.height);
    img.onerror = () => {
      wrapper.innerHTML = '';
      const fallback = document.createElement('span');
      fallback.className = 'cm-image-fallback';
      fallback.textContent = this.alt || this.url;
      wrapper.appendChild(fallback);
    };
    wrapper.appendChild(img);
    return wrapper;
  }
}

export function handleImage(ctx: {
  view: EditorView;
  node: { name: string; from: number; to: number };
  activeLines: Set<number>;
  ranges: DecoRange[];
  imageContext?: MarkdownImageContext;
}) {
  const { view, node, activeLines, ranges, imageContext } = ctx;
  const line = view.state.doc.lineAt(node.from);

  // Cross-line guard: Image should be single-line
  if (view.state.doc.lineAt(node.to).number !== line.number) return;
  if (activeLines.has(line.number)) return;

  const text = view.state.doc.sliceString(node.from, node.to);
  const urlMatch = text.match(/!\[([^\]]*)\]\(([^)]+)\)/);
  if (!urlMatch) return;

  const alt = urlMatch[1];
  const rawUrl = urlMatch[2].trim().replace(/^<([\s\S]+)>$/, '$1');
  const label = parseImageLabel(alt);
  const url = resolveMarkdownImageSrc(rawUrl, imageContext);

  // Security: only allow local paths and http/https
  if (!url.startsWith('/') && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('file://')) return;

  ranges.push({
    from: node.from,
    to: node.to,
    deco: Decoration.replace({ widget: new ImageWidget(url, label.alt, label.dimensions) }),
  });
}
