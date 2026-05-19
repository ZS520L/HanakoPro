import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('markdown link colors', () => {
  it('uses semantic link tokens for rendered markdown and editor link text', () => {
    const styles = readFile('desktop/src/styles.css');
    const previewStyles = readFile('desktop/src/react/components/Preview.module.css');

    expect(styles).toMatch(/--link:\s*var\(--accent,\s*#537D96\)/);
    expect(styles).toMatch(/--link-hover:\s*var\(--accent-hover,\s*var\(--link\)\)/);
    expect(styles).toMatch(/--link-rgb:\s*var\(--accent-rgb,\s*83,\s*125,\s*150\)/);
    expect(styles).toMatch(/\.md-content a\s*\{[\s\S]*color:\s*var\(--link\)/);
    expect(styles).toMatch(/\.md-content a\s*\{[\s\S]*rgba\(var\(--link-rgb\),\s*0\.35\)/);
    expect(styles).toMatch(/\.md-content a:hover\s*\{[\s\S]*color:\s*var\(--link-hover\)/);

    expect(previewStyles).toMatch(/:global\(\.cm-link-text\)\s*\{[\s\S]*color:\s*var\(--link\)/);
    expect(previewStyles).toMatch(/:global\(\.cm-link-text\)\s*\{[\s\S]*rgba\(var\(--link-rgb\),\s*0\.55\)/);
  });

  it('keeps dark-theme markdown links light enough for dark surfaces', () => {
    const midnight = readFile('desktop/src/themes/midnight.css');
    const midnightContrast = readFile('desktop/src/themes/midnight-contrast.css');

    for (const css of [midnight, midnightContrast]) {
      expect(css).toMatch(/--link:\s*#B9E2FF/);
      expect(css).toMatch(/--link-hover:\s*#D7F0FF/);
      expect(css).toMatch(/--link-rgb:\s*185,\s*226,\s*255/);
    }
  });
});
