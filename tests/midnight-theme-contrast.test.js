import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function readThemeToken(css, token) {
  const match = css.match(new RegExp(`--${token}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`missing --${token}`);
  return match[1];
}

function luminance(hex) {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('midnight theme contrast', () => {
  it('keeps small text and accent readable on dark surfaces', () => {
    const css = fs.readFileSync(path.join(ROOT, 'desktop/src/themes/midnight.css'), 'utf8');
    const bg = readThemeToken(css, 'bg');
    const bgCard = readThemeToken(css, 'bg-card');

    expect(contrast(readThemeToken(css, 'text'), bgCard)).toBeGreaterThanOrEqual(5.5);
    expect(contrast(readThemeToken(css, 'text-light'), bg)).toBeGreaterThanOrEqual(4);
    expect(contrast(readThemeToken(css, 'text-muted'), bgCard)).toBeGreaterThanOrEqual(3);
    expect(contrast(readThemeToken(css, 'accent'), bg)).toBeGreaterThanOrEqual(3);
  });

  it('uses a dark text token for the light social-platform sidebar button', () => {
    const styles = fs.readFileSync(path.join(ROOT, 'desktop/src/styles.css'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'desktop/src/themes/midnight.css'), 'utf8');

    expect(styles).toContain('color: var(--sidebar-bridge-card-text, var(--text-muted));');
    expect(contrast(readThemeToken(css, 'sidebar-bridge-card-text'), '#9DA6AC')).toBeGreaterThanOrEqual(4.5);
  });

  it('adds a high-contrast dark variant with stronger readable colors', () => {
    const styles = fs.readFileSync(path.join(ROOT, 'desktop/src/styles.css'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'desktop/src/themes/midnight-contrast.css'), 'utf8');
    const bg = readThemeToken(css, 'bg');
    const bgCard = readThemeToken(css, 'bg-card');

    expect(styles).toContain('html:not([data-theme="midnight"]):not([data-theme="midnight-contrast"])');
    expect(contrast(readThemeToken(css, 'text'), bgCard)).toBeGreaterThanOrEqual(9);
    expect(contrast(readThemeToken(css, 'text-light'), bg)).toBeGreaterThanOrEqual(8);
    expect(contrast(readThemeToken(css, 'text-muted'), bgCard)).toBeGreaterThanOrEqual(6);
    expect(contrast(readThemeToken(css, 'accent'), bg)).toBeGreaterThanOrEqual(6);
  });

  it('keeps dark theme cards aligned with their theme surfaces', () => {
    const styles = fs.readFileSync(path.join(ROOT, 'desktop/src/react/settings/Settings.module.css'), 'utf8');

    expect(styles).toContain('.theme-card[data-theme="midnight"]');
    expect(styles).toContain('background: #3B4A54;');
    expect(styles).toContain('.theme-card[data-theme="midnight-contrast"]');
    expect(styles).toContain('background: #26343D;');
  });
});
