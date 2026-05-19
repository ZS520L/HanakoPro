import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EDITOR_TYPOGRAPHY,
  applyEditorTypography,
  normalizeEditorTypography,
} from '../../editor/typography';

function readPreviewStyles(): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'desktop/src/react/components/Preview.module.css'),
    'utf8',
  );
}

describe('editor typography settings', () => {
  it('uses Notion-like markdown defaults and preserves future heading controls', () => {
    expect(DEFAULT_EDITOR_TYPOGRAPHY.markdown.bodyFontSize).toBe(16);
    expect(DEFAULT_EDITOR_TYPOGRAPHY.markdown.heading1FontSize).toBe(24);
    expect(DEFAULT_EDITOR_TYPOGRAPHY.markdown.heading2FontSize).toBe(20);
    expect(DEFAULT_EDITOR_TYPOGRAPHY.markdown.heading3FontSize).toBe(18);
    expect(DEFAULT_EDITOR_TYPOGRAPHY.markdown.heading4FontSize).toBe(16);
    expect(DEFAULT_EDITOR_TYPOGRAPHY.markdown.heading5FontSize).toBe(15);
    expect(DEFAULT_EDITOR_TYPOGRAPHY.markdown.heading6FontSize).toBe(14);
    expect(DEFAULT_EDITOR_TYPOGRAPHY.markdown.lineHeight).toBe(1.72);
    expect(DEFAULT_EDITOR_TYPOGRAPHY.markdown.contentPadding).toBe(24);
  });

  it('normalizes partial and invalid values without mutating the defaults', () => {
    const normalized = normalizeEditorTypography({
      markdown: {
        bodyFontSize: 99,
        heading1FontSize: 10,
        heading6FontSize: 80,
        lineHeight: 'wide',
        contentPadding: -12,
      },
    });

    expect(normalized.markdown.bodyFontSize).toBe(24);
    expect(normalized.markdown.heading1FontSize).toBe(16);
    expect(normalized.markdown.heading2FontSize).toBe(20);
    expect(normalized.markdown.heading6FontSize).toBe(24);
    expect(normalized.markdown.lineHeight).toBe(1.72);
    expect(normalized.markdown.contentPadding).toBe(0);
    expect(DEFAULT_EDITOR_TYPOGRAPHY.markdown.contentPadding).toBe(24);
  });

  it('applies normalized typography as document-level CSS variables', () => {
    const values = new Map<string, string>();
    const root = {
      style: {
        setProperty: (name: string, value: string) => values.set(name, value),
        getPropertyValue: (name: string) => values.get(name) || '',
      },
    } as unknown as HTMLElement;

    applyEditorTypography({
      markdown: {
        bodyFontSize: 17,
        heading1FontSize: 26,
        heading2FontSize: 21,
        heading3FontSize: 19,
        heading4FontSize: 18,
        heading5FontSize: 17,
        heading6FontSize: 16,
        lineHeight: 1.8,
        contentPadding: 28,
      },
    }, root);

    const style = root.style;
    expect(style.getPropertyValue('--editor-markdown-font-size')).toBe('17px');
    expect(style.getPropertyValue('--editor-markdown-h1-font-size')).toBe('26px');
    expect(style.getPropertyValue('--editor-markdown-h2-font-size')).toBe('21px');
    expect(style.getPropertyValue('--editor-markdown-h3-font-size')).toBe('19px');
    expect(style.getPropertyValue('--editor-markdown-h4-font-size')).toBe('18px');
    expect(style.getPropertyValue('--editor-markdown-h5-font-size')).toBe('17px');
    expect(style.getPropertyValue('--editor-markdown-h6-font-size')).toBe('16px');
    expect(style.getPropertyValue('--editor-markdown-line-height')).toBe('1.8');
    expect(style.getPropertyValue('--editor-markdown-content-padding-x')).toBe('28px');
  });

  it('uses the editor typography variables for markdown preview font size and weight', () => {
    const css = readPreviewStyles();

    expect(css).toMatch(/:global\(\.preview-markdown\)\s*\{[\s\S]*font-size:\s*var\(--editor-markdown-font-size\)/);
    expect(css).toMatch(/:global\(\.preview-markdown\)\s*\{[\s\S]*font-weight:\s*400/);
    expect(css).toMatch(/:global\(\.preview-markdown\) h1\s*\{[\s\S]*font-size:\s*var\(--editor-markdown-h1-font-size\)[\s\S]*font-weight:\s*700/);

    for (const level of [2, 3, 4, 5, 6]) {
      expect(css).toMatch(new RegExp(
        `:global\\(\\.preview-markdown\\) h${level}\\s*\\{[\\s\\S]*font-size:\\s*var\\(--editor-markdown-h${level}-font-size\\)[\\s\\S]*font-weight:\\s*600`,
      ));
    }

    expect(css).toMatch(/:global\(\.preview-markdown\) strong\s*\{[\s\S]*font-weight:\s*700/);
  });
});
