import type { MermaidConfig } from 'mermaid';

interface MermaidRenderResult {
  svg: string;
  bindFunctions?: (element: Element) => void;
}

interface MermaidApi {
  initialize(config: MermaidConfig): void;
  render(id: string, source: string): Promise<MermaidRenderResult>;
}

type MermaidLoader = () => Promise<MermaidApi>;

const MERMAID_CONFIG: MermaidConfig = {
  startOnLoad: false,
  securityLevel: 'strict',
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let testLoader: MermaidLoader | null = null;
let idSeq = 0;

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = (async () => {
      const mermaid = testLoader
        ? await testLoader()
        : (await import('mermaid')).default;
      mermaid.initialize(MERMAID_CONFIG);
      return mermaid;
    })();
  }
  return mermaidPromise;
}

function nextMermaidId(): string {
  idSeq += 1;
  return `hana-mermaid-${idSeq}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function readSource(diagram: Element): string {
  return diagram.querySelector<HTMLElement>('.mermaid-source code')?.textContent || '';
}

function ensureRenderedElement(diagram: Element): HTMLElement {
  const existing = diagram.querySelector<HTMLElement>('.mermaid-rendered');
  if (existing) return existing;

  const rendered = document.createElement('div');
  rendered.className = 'mermaid-rendered';
  diagram.appendChild(rendered);
  return rendered;
}

async function renderMermaidDiagram(diagram: HTMLElement): Promise<void> {
  const source = readSource(diagram);
  const rendered = ensureRenderedElement(diagram);
  const sourceBlock = diagram.querySelector<HTMLElement>('.mermaid-source');
  const status = diagram.dataset.mermaidStatus;

  if (!source.trim()) return;
  if ((status === 'loading' || status === 'rendered')
      && diagram.dataset.mermaidSource === source) {
    return;
  }

  diagram.dataset.mermaidStatus = 'loading';
  diagram.dataset.mermaidSource = source;
  diagram.classList.remove('is-rendered', 'is-error');
  rendered.textContent = '';

  try {
    const mermaid = await loadMermaid();
    const { svg, bindFunctions } = await mermaid.render(nextMermaidId(), source);
    rendered.innerHTML = svg;
    bindFunctions?.(rendered);
    sourceBlock?.setAttribute('hidden', '');
    diagram.dataset.mermaidStatus = 'rendered';
    diagram.classList.add('is-rendered');
  } catch (err) {
    sourceBlock?.removeAttribute('hidden');
    rendered.textContent = `Mermaid diagram failed to render: ${errorMessage(err)}`;
    diagram.dataset.mermaidStatus = 'error';
    diagram.classList.add('is-error');
  }
}

export async function renderMermaidDiagrams(root: ParentNode | null): Promise<void> {
  if (!root) return;
  const diagrams = Array.from(root.querySelectorAll<HTMLElement>('.mermaid-diagram'));
  await Promise.all(diagrams.map(renderMermaidDiagram));
}

export function __setMermaidLoaderForTests(loader: MermaidLoader | null): void {
  testLoader = loader;
  mermaidPromise = null;
  idSeq = 0;
}
