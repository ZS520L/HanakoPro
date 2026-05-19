import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function cssBlock(css, selector) {
  return css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{(?<body>[^}]*)\\}`))?.groups?.body || '';
}

describe('settings toggle styles', () => {
  it('keeps mini toggles aligned with the base toggle thumb geometry', () => {
    const globalCss = fs.readFileSync(path.join(ROOT, 'desktop/src/styles.css'), 'utf8');
    const settingsCss = fs.readFileSync(path.join(ROOT, 'desktop/src/react/settings/Settings.module.css'), 'utf8');

    expect(cssBlock(globalCss, '.hana-toggle')).toMatch(/width:\s*36px/);
    expect(cssBlock(globalCss, '.hana-toggle')).toMatch(/height:\s*20px/);
    expect(cssBlock(globalCss, '.hana-toggle::after')).toMatch(/left:\s*3px/);
    expect(cssBlock(globalCss, '.hana-toggle.on::after')).toMatch(/transform:\s*translateX\(16px\)/);

    expect(cssBlock(settingsCss, ':global(.hana-toggle.mini)')).toMatch(/width:\s*36px/);
    expect(cssBlock(settingsCss, ':global(.hana-toggle.mini)')).toMatch(/height:\s*20px/);
    expect(cssBlock(settingsCss, ':global(.hana-toggle.mini.on)::after')).not.toMatch(/left\s*:/);
  });
});
