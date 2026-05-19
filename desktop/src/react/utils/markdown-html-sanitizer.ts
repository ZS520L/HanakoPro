const MATHML_TAGS = new Set([
  'math', 'semantics', 'annotation',
  'mrow', 'mi', 'mn', 'mo', 'mtext', 'mspace',
  'msup', 'msub', 'msubsup', 'mfrac', 'msqrt', 'mroot',
  'mover', 'munder', 'munderover',
  'mtable', 'mtr', 'mtd', 'mstyle',
  'mpadded', 'mphantom', 'menclose',
]);

const SVG_TAGS = new Set(['svg', 'path', 'line']);

const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'center',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup',
  'br', 'hr',
  'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'details', 'summary',
  'a', 'label', 'img',
  ...MATHML_TAGS,
  ...SVG_TAGS,
]);

const REMOVE_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'button',
  'textarea', 'select', 'link', 'meta', 'base',
]);

const GLOBAL_ATTRS = new Set(['title', 'style']);
const ALLOWED_CLASS_NAMES = new Set([
  'markdown-callout',
  'markdown-callout-title',
  'markdown-callout-note',
  'markdown-callout-abstract',
  'markdown-callout-info',
  'markdown-callout-todo',
  'markdown-callout-tip',
  'markdown-callout-success',
  'markdown-callout-question',
  'markdown-callout-warning',
  'markdown-callout-failure',
  'markdown-callout-danger',
  'markdown-callout-bug',
  'markdown-callout-example',
  'markdown-callout-quote',
  'mermaid-diagram',
  'mermaid-source',
  'mermaid-rendered',
  'language-mermaid',
  'is-rendered',
  'is-error',
  'task-list-item',
  'task-list-item-checkbox',
  'task-list-item-label',
  'contains-task-list',
]);
const KATEX_CLASS_NAMES = new Set([
  'katex',
  'katex-display',
  'katex-block',
  'katex-mathml',
  'katex-html',
  'base',
  'strut',
  'pstrut',
  'vlist',
  'vlist-r',
  'vlist-s',
  'vlist-t',
  'vlist-t2',
  'vlist-children',
  'mord',
  'mop',
  'mbin',
  'mrel',
  'mopen',
  'mclose',
  'mpunct',
  'minner',
  'mspace',
  'msupsub',
  'mfrac',
  'mfrac-line',
  'sqrt',
  'sqrt-sign',
  'root',
  'accent',
  'accent-body',
  'op-symbol',
  'delimsizing',
  'nulldelimiter',
  'sizing',
  'mtight',
  'text',
  'arraycolsep',
  'boxpad',
  'col-align-c',
  'col-align-l',
  'col-align-r',
  'delimcenter',
  'fbox',
  'frac-line',
  'hide-tail',
  'large-op',
  'mtable',
  'op-limits',
  'stretchy',
  'svg-align',
  'mathnormal',
  'mathit',
  'mathrm',
  'mathbf',
  'amsrm',
  'mathbb',
  'mathcal',
  'mathfrak',
  'mathtt',
  'mathscr',
  'mathsf',
  'mainrm',
]);

const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SAFE_IMAGE_URL_PROTOCOLS = new Set(['http:', 'https:', 'file:']);
const EXPLICIT_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const HTML_DIMENSION_RE = /^[1-9]\d{0,4}$/;
const MATHML_ATTRS = new Set([
  'xmlns',
  'display',
  'encoding',
  'mathvariant',
  'accent',
  'accentunder',
  'stretchy',
  'fence',
  'separator',
  'lspace',
  'rspace',
  'rowspan',
  'columnspan',
  'notation',
  'displaystyle',
  'mathcolor',
  'scriptlevel',
  'columnalign',
  'columnspacing',
  'rowspacing',
]);
const SVG_ATTRS = new Set([
  'xmlns',
  'width',
  'height',
  'viewbox',
  'preserveaspectratio',
  'd',
  'x1',
  'x2',
  'y1',
  'y2',
  'stroke-width',
]);

const ALLOWED_CSS_PROPERTIES = new Set([
  'color',
  'background',
  'background-color',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-color',
  'border-style',
  'border-width',
  'border-radius',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'text-align',
  'font-weight',
  'font-style',
  'font-size',
  'line-height',
  'letter-spacing',
  'white-space',
  'display',
  'width',
  'max-width',
  'min-width',
  'height',
  'max-height',
  'min-height',
  'top',
  'vertical-align',
]);

const ALLOWED_DISPLAY_VALUES = new Set([
  'block',
  'inline',
  'inline-block',
  'flex',
  'inline-flex',
  'grid',
  'none',
]);

const UNSAFE_CSS_VALUE_RE = /url\s*\(|expression\s*\(|@import|javascript:|vbscript:|data:|file:|behavior\s*:/i;

function sanitizeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (href.startsWith('#')) return href;
  if (!EXPLICIT_PROTOCOL_RE.test(href)) return null;

  try {
    const parsed = new URL(href);
    return SAFE_URL_PROTOCOLS.has(parsed.protocol) ? href : null;
  } catch {
    return null;
  }
}

function sanitizeImageSrc(raw: string): string | null {
  const src = raw.trim();
  if (!src || !EXPLICIT_PROTOCOL_RE.test(src)) return null;

  try {
    const parsed = new URL(src);
    return SAFE_IMAGE_URL_PROTOCOLS.has(parsed.protocol) ? src : null;
  } catch {
    return null;
  }
}

function isSafeCssValue(value: string): boolean {
  if (UNSAFE_CSS_VALUE_RE.test(value)) return false;

  const lower = value.toLowerCase();
  if (/\bfixed\b/.test(lower)) return false;
  if (/\bsticky\b/.test(lower)) return false;
  return true;
}

function sanitizeStyle(raw: string): string {
  const kept: string[] = [];

  for (const declaration of raw.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0) continue;

    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!property || !value) continue;
    if (!ALLOWED_CSS_PROPERTIES.has(property)) continue;
    if (!isSafeCssValue(value)) continue;

    if (property === 'display' && !ALLOWED_DISPLAY_VALUES.has(value.toLowerCase())) {
      continue;
    }

    kept.push(`${property}: ${value}`);
  }

  return kept.join('; ');
}

function sanitizeClass(raw: string): string {
  return raw
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => (
      ALLOWED_CLASS_NAMES.has(token)
      || KATEX_CLASS_NAMES.has(token)
      || /^reset-size\d+$/.test(token)
      || /^size\d+$/.test(token)
      || /^delim-size\d+$/.test(token)
    ))
    .join(' ');
}

function hasClass(element: Element, className: string): boolean {
  return (element.getAttribute('class') ?? '').split(/\s+/).includes(className);
}

function isInsideKatexMarkup(element: Element): boolean {
  let current = element.parentElement;
  while (current) {
    if (hasClass(current, 'katex')) return true;
    current = current.parentElement;
  }
  return false;
}

function normalizeAriaHidden(raw: string): string | null {
  const value = raw.toLowerCase();
  if (value === 'true') return 'true';
  if (value === 'false') return 'false';
  return null;
}

function sanitizeAttributes(element: Element, tagName: string): void {
  for (const attr of Array.from(element.attributes)) {
    const name = attr.name.toLowerCase();

    if (name.startsWith('on')) {
      element.removeAttribute(attr.name);
      continue;
    }

    if (tagName === 'a' && name === 'href') {
      const href = sanitizeHref(attr.value);
      if (href) {
        element.setAttribute('href', href);
        element.setAttribute('rel', 'noopener noreferrer');
      } else {
        element.removeAttribute(attr.name);
      }
      continue;
    }

    if (tagName === 'img' && name === 'src') {
      const src = sanitizeImageSrc(attr.value);
      if (src) element.setAttribute('src', src);
      else element.removeAttribute(attr.name);
      continue;
    }

    if (tagName === 'img' && name === 'alt') {
      element.setAttribute('alt', attr.value);
      continue;
    }

    if (tagName === 'img' && (name === 'width' || name === 'height')) {
      if (HTML_DIMENSION_RE.test(attr.value.trim())) {
        element.setAttribute(name, attr.value.trim());
      } else {
        element.removeAttribute(attr.name);
      }
      continue;
    }

    if (tagName === 'img' && name === 'loading') {
      element.setAttribute('loading', 'lazy');
      continue;
    }

    if (tagName === 'img' && name === 'decoding') {
      element.setAttribute('decoding', 'async');
      continue;
    }

    if (name === 'class') {
      const className = sanitizeClass(attr.value);
      if (className) element.setAttribute('class', className);
      else element.removeAttribute(attr.name);
      continue;
    }

    if (tagName === 'details' && name === 'open') {
      element.setAttribute('open', 'open');
      continue;
    }

    if (name === 'aria-hidden') {
      const normalized = normalizeAriaHidden(attr.value);
      if (normalized) element.setAttribute('aria-hidden', normalized);
      else element.removeAttribute(attr.name);
      continue;
    }

    if (MATHML_TAGS.has(tagName) && MATHML_ATTRS.has(name)) {
      if (isSafeCssValue(attr.value)) element.setAttribute(attr.name, attr.value);
      else element.removeAttribute(attr.name);
      continue;
    }

    if (SVG_TAGS.has(tagName) && SVG_ATTRS.has(name)) {
      if (isSafeCssValue(attr.value)) element.setAttribute(attr.name, attr.value);
      else element.removeAttribute(attr.name);
      continue;
    }

    if (GLOBAL_ATTRS.has(name)) {
      if (name === 'style') {
        const style = sanitizeStyle(attr.value);
        if (style) element.setAttribute('style', style);
        else element.removeAttribute(attr.name);
      }
      continue;
    }

    element.removeAttribute(attr.name);
  }
}

function unwrapElement(element: Element): void {
  const parent = element.parentNode;
  if (!parent) return;

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }
  parent.removeChild(element);
}

function sanitizeChildren(parent: ParentNode): void {
  for (const child of Array.from(parent.childNodes)) {
    sanitizeNode(child);
  }
}

function sanitizeNode(node: ChildNode): void {
  if (node.nodeType === 3) return;

  if (node.nodeType !== 1) {
    node.parentNode?.removeChild(node);
    return;
  }

  const element = node as Element;
  const tagName = element.tagName.toLowerCase();

  if (tagName === 'input') {
    if (element.getAttribute('type') === 'checkbox') {
      const checked = element.hasAttribute('checked');
      for (const attr of Array.from(element.attributes)) element.removeAttribute(attr.name);
      element.setAttribute('type', 'checkbox');
      element.setAttribute('disabled', '');
      if (checked) element.setAttribute('checked', '');
      return;
    }
    element.remove();
    return;
  }

  if (REMOVE_WITH_CONTENT.has(tagName)) {
    element.remove();
    return;
  }

  if (!ALLOWED_TAGS.has(tagName)) {
    sanitizeChildren(element);
    unwrapElement(element);
    return;
  }

  // KaTeX uses tiny SVG fragments for stretchy accents; keep SVG scoped to KaTeX output.
  if (SVG_TAGS.has(tagName) && !isInsideKatexMarkup(element)) {
    element.remove();
    return;
  }

  sanitizeAttributes(element, tagName);
  if (tagName === 'img' && !element.getAttribute('src')) {
    element.remove();
    return;
  }
  sanitizeChildren(element);
}

export function sanitizeMarkdownPreviewHtml(html: string): string {
  if (typeof document === 'undefined') {
    throw new Error('Markdown preview sanitizer requires a DOM environment');
  }

  const template = document.createElement('template');
  template.innerHTML = html;
  sanitizeChildren(template.content);
  return template.innerHTML;
}
