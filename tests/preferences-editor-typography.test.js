import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PreferencesManager } from '../core/preferences-manager.js';

function makePrefs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hana-prefs-editor-'));
  return new PreferencesManager({
    userDir: path.join(root, 'user'),
    agentsDir: path.join(root, 'agents'),
  });
}

describe('PreferencesManager editor typography preferences', () => {
  it('returns normalized editor defaults when no preference exists', () => {
    const prefs = makePrefs();

    expect(prefs.getEditor()).toEqual({
      markdown: {
        bodyFontSize: 16,
        heading1FontSize: 24,
        heading2FontSize: 20,
        heading3FontSize: 18,
        heading4FontSize: 16,
        heading5FontSize: 15,
        heading6FontSize: 14,
        lineHeight: 1.72,
        contentPadding: 24,
      },
    });
  });

  it('saves partial editor typography preferences through the editor key', () => {
    const prefs = makePrefs();

    prefs.setEditor({
      markdown: {
        bodyFontSize: 18,
        lineHeight: 1.9,
      },
    });

    expect(prefs.getEditor()).toEqual({
      markdown: {
        bodyFontSize: 18,
        heading1FontSize: 24,
        heading2FontSize: 20,
        heading3FontSize: 18,
        heading4FontSize: 16,
        heading5FontSize: 15,
        heading6FontSize: 14,
        lineHeight: 1.9,
        contentPadding: 24,
      },
    });
    expect(prefs.getPreferences().editor.markdown.bodyFontSize).toBe(18);
  });
});
