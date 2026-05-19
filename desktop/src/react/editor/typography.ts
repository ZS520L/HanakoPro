// @ts-expect-error — shared JS module
import * as sharedEditorTypography from '../../../../shared/editor-typography.js';

export interface EditorMarkdownTypography {
  bodyFontSize: number;
  heading1FontSize: number;
  heading2FontSize: number;
  heading3FontSize: number;
  heading4FontSize: number;
  heading5FontSize: number;
  heading6FontSize: number;
  lineHeight: number;
  contentPadding: number;
}

export interface EditorTypography {
  markdown: EditorMarkdownTypography;
}

export const DEFAULT_EDITOR_TYPOGRAPHY: EditorTypography = sharedEditorTypography.DEFAULT_EDITOR_TYPOGRAPHY;

export function normalizeEditorTypography(value: unknown): EditorTypography {
  return sharedEditorTypography.normalizeEditorTypography(value);
}

export function mergeEditorTypography(base: unknown, patch: unknown): EditorTypography {
  return sharedEditorTypography.mergeEditorTypography(base, patch);
}

export function applyEditorTypography(
  value: unknown,
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
): EditorTypography {
  const typography = normalizeEditorTypography(value);
  const { markdown } = typography;

  if (!root?.style) return typography;

  root.style.setProperty('--editor-markdown-font-size', `${markdown.bodyFontSize}px`);
  root.style.setProperty('--editor-markdown-h1-font-size', `${markdown.heading1FontSize}px`);
  root.style.setProperty('--editor-markdown-h2-font-size', `${markdown.heading2FontSize}px`);
  root.style.setProperty('--editor-markdown-h3-font-size', `${markdown.heading3FontSize}px`);
  root.style.setProperty('--editor-markdown-h4-font-size', `${markdown.heading4FontSize}px`);
  root.style.setProperty('--editor-markdown-h5-font-size', `${markdown.heading5FontSize}px`);
  root.style.setProperty('--editor-markdown-h6-font-size', `${markdown.heading6FontSize}px`);
  root.style.setProperty('--editor-markdown-line-height', String(markdown.lineHeight));
  root.style.setProperty('--editor-markdown-content-padding-x', `${markdown.contentPadding}px`);

  return typography;
}
