// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { extractPlainUrlPaste } from '../../utils/plain-url-paste';

function clipboard(formats: Record<string, string>): Pick<DataTransfer, 'getData'> {
  return {
    getData: (type: string) => formats[type] ?? '',
  };
}

describe('extractPlainUrlPaste', () => {
  it('turns a single rich link into its href as plain text', () => {
    const result = extractPlainUrlPaste(clipboard({
      'text/plain': 'Example Article',
      'text/html': '<a href="https://example.com/article">Example Article</a>',
    }));

    expect(result).toBe('https://example.com/article');
  });

  it('prefers text/uri-list URLs when present', () => {
    const result = extractPlainUrlPaste(clipboard({
      'text/plain': 'Example Article',
      'text/uri-list': '# copied url\nhttps://example.com/article\n',
      'text/html': '<a href="https://wrong.example/">Example Article</a>',
    }));

    expect(result).toBe('https://example.com/article');
  });

  it('uses the single rich link href even when plain text includes extra copied text', () => {
    const result = extractPlainUrlPaste(clipboard({
      'text/plain': 'Example Article\nhttps://example.com/article',
      'text/html': '<a href="https://example.com/article">Example Article</a>',
    }));

    expect(result).toBe('https://example.com/article');
  });

  it('keeps ordinary text paste on the editor default path', () => {
    const result = extractPlainUrlPaste(clipboard({
      'text/plain': 'Example Article',
      'text/html': '<p>Example Article</p>',
    }));

    expect(result).toBeNull();
  });

  it('does not collapse multi-link rich content to one arbitrary URL', () => {
    const result = extractPlainUrlPaste(clipboard({
      'text/plain': 'First Second',
      'text/html': '<a href="https://example.com/one">First</a> <a href="https://example.com/two">Second</a>',
    }));

    expect(result).toBeNull();
  });
});
