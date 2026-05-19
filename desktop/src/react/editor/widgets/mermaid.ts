import { EditorView, WidgetType } from '@codemirror/view';
import { renderMermaidDiagrams } from '../../utils/mermaid-renderer';
import { escapeHtml } from '../../utils/format';

export class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly revealFrom: number,
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return this.source === other.source && this.revealFrom === other.revealFrom;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-mermaid-widget mermaid-diagram';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'button');
    wrapper.setAttribute('aria-label', 'Edit Mermaid diagram');
    wrapper.innerHTML = [
      `<pre class="mermaid-source"><code>${escapeHtml(this.source)}</code></pre>`,
      '<div class="mermaid-rendered"></div>',
    ].join('');

    const revealSource = () => {
      view.focus();
      view.dispatch({
        selection: { anchor: this.revealFrom },
        scrollIntoView: true,
      });
    };

    wrapper.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      revealSource();
    });
    wrapper.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      revealSource();
    });

    void renderMermaidDiagrams(wrapper);
    return wrapper;
  }
}
