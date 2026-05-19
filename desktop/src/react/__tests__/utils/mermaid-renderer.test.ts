/**
 * @vitest-environment jsdom
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setMermaidLoaderForTests,
  renderMermaidDiagrams,
} from '../../utils/mermaid-renderer';

describe('renderMermaidDiagrams', () => {
  const initialize = vi.fn();
  const render = vi.fn(async (id: string, source: string) => ({
    svg: `<svg data-id="${id}"><text>${source}</text></svg>`,
  }));

  beforeEach(() => {
    document.body.innerHTML = '';
    initialize.mockClear();
    render.mockClear();
    __setMermaidLoaderForTests(async () => ({ initialize, render }));
  });

  afterEach(() => {
    __setMermaidLoaderForTests(null);
  });

  it('renders mermaid placeholders into SVG once per source', async () => {
    const container = document.createElement('div');
    container.innerHTML = [
      '<div class="mermaid-diagram">',
      '<pre class="mermaid-source"><code>graph TD\nA-->B</code></pre>',
      '<div class="mermaid-rendered"></div>',
      '</div>',
    ].join('');

    await renderMermaidDiagrams(container);

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
    }));
    expect(render).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.mermaid-rendered svg')).toBeInstanceOf(SVGElement);
    expect(container.querySelector('.mermaid-source')).toHaveAttribute('hidden');

    await renderMermaidDiagrams(container);

    expect(render).toHaveBeenCalledTimes(1);
  });

  it('keeps source visible and shows an error when mermaid rendering fails', async () => {
    render.mockRejectedValueOnce(new Error('bad diagram'));
    const container = document.createElement('div');
    container.innerHTML = [
      '<div class="mermaid-diagram">',
      '<pre class="mermaid-source"><code>graph Nope</code></pre>',
      '<div class="mermaid-rendered"></div>',
      '</div>',
    ].join('');

    await renderMermaidDiagrams(container);

    expect(container.querySelector('.mermaid-source')).not.toHaveAttribute('hidden');
    expect(container.querySelector('.mermaid-rendered')?.textContent).toContain('bad diagram');
  });
});
