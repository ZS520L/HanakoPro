import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const STYLE_FILES = [
  'desktop/src/styles.css',
  'desktop/src/react/settings/Settings.module.css',
  'desktop/src/react/ui/SelectWidget.module.css',
  'desktop/src/settings.html',
];

const CARD_TEXTURE_FILES = [
  'desktop/src/styles.css',
  'desktop/src/react/settings/Settings.module.css',
  'desktop/src/react/ui/SelectWidget.module.css',
];

describe('paper texture contract', () => {
  it.each(STYLE_FILES)('%s opts into texture with body.paper-texture', (rel) => {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');

    expect(content).toContain('body.paper-texture');
    expect(content).not.toContain('body:not(.no-paper-texture)');
  });

  it('turns off card texture brightness compensation in both dark themes', () => {
    const styles = fs.readFileSync(path.join(ROOT, 'desktop/src/styles.css'), 'utf8');

    expect(styles).toContain('--paper-texture-card-blend-mode: lighten;');
    expect(styles).toContain('html[data-theme="midnight"],\nhtml[data-theme="midnight-contrast"]');
    expect(styles).toContain('--paper-texture-card-blend-mode: normal;');
  });

  it.each(CARD_TEXTURE_FILES)('%s uses the shared card blend token', (rel) => {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf8');

    expect(content).toContain('background-blend-mode: var(--paper-texture-card-blend-mode);');
  });
});
