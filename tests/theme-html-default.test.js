import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import registry from '../desktop/src/shared/theme-registry.cjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const HTMLS = [
  'desktop/src/index.html',
  'desktop/src/onboarding.html',
  'desktop/src/settings.html',
  'desktop/src/viewer-window.html',
  'desktop/src/browser-viewer.html',
];

describe('HTML 首屏默认 CSS 与 registry.DEFAULT_THEME 对齐', () => {
  it.each(HTMLS)('%s 的 <link id="themeSheet"> href 等于 DEFAULT_THEME 的 cssPath', (rel) => {
    const full = path.join(ROOT, rel);
    expect(fs.existsSync(full), `HTML 文件不存在: ${full}`).toBe(true);
    const html = fs.readFileSync(full, 'utf8');

    // Two attribute orderings: id before href, or href before id.
    const m = html.match(
      /<link[^>]*?(?:id=["']themeSheet["'][^>]*?href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*?id=["']themeSheet["'])[^>]*>/
    );
    expect(m, `${rel} 未找到 <link id="themeSheet">`).toBeTruthy();

    const href = m[1] || m[2];
    const expected = registry.THEMES[registry.DEFAULT_THEME].cssPath;
    expect(href).toBe(expected);
  });
});
