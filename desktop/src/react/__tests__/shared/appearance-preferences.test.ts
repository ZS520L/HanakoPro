// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LEGACY_NO_PAPER_TEXTURE_CLASS,
  PAPER_TEXTURE_CLASS,
  PAPER_TEXTURE_STORAGE_KEY,
  applyPaperTextureClass,
  isPaperTextureEnabled,
  loadPaperTexturePreference,
  setPaperTexturePreference,
} from '../../../shared/appearance-preferences';
import registry from '../../../shared/theme-registry.cjs';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('paper texture preferences', () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    storage = createStorage();
    document.body.className = '';
  });

  it('defaults to disabled and removes the legacy disable class', () => {
    document.body.classList.add(LEGACY_NO_PAPER_TEXTURE_CLASS);

    const enabled = loadPaperTexturePreference(storage, document.body);

    expect(enabled).toBe(false);
    expect(document.body.classList.contains(PAPER_TEXTURE_CLASS)).toBe(false);
    expect(document.body.classList.contains(LEGACY_NO_PAPER_TEXTURE_CLASS)).toBe(false);
  });

  it('enables texture only when the stored preference is explicit', () => {
    storage.setItem(PAPER_TEXTURE_STORAGE_KEY, '1');

    expect(isPaperTextureEnabled(storage)).toBe(true);
    expect(loadPaperTexturePreference(storage, document.body)).toBe(true);
    expect(document.body.classList.contains(PAPER_TEXTURE_CLASS)).toBe(true);
  });

  it('persists off as an explicit disabled state', () => {
    setPaperTexturePreference(true, storage, document.body);
    setPaperTexturePreference(false, storage, document.body);

    expect(storage.getItem(PAPER_TEXTURE_STORAGE_KEY)).toBe('0');
    expect(document.body.classList.contains(PAPER_TEXTURE_CLASS)).toBe(false);
  });

  it('never leaves the legacy inverted class behind', () => {
    document.body.classList.add(LEGACY_NO_PAPER_TEXTURE_CLASS);

    applyPaperTextureClass(true, document.body);

    expect(document.body.classList.contains(PAPER_TEXTURE_CLASS)).toBe(true);
    expect(document.body.classList.contains(LEGACY_NO_PAPER_TEXTURE_CLASS)).toBe(false);
  });

  it('keeps the stored preference but suppresses texture in dark themes', () => {
    setPaperTexturePreference(true, storage, document.body, registry.AUTO_DARK_DEFAULT);

    expect(storage.getItem(PAPER_TEXTURE_STORAGE_KEY)).toBe('1');
    expect(isPaperTextureEnabled(storage)).toBe(true);
    expect(document.body.classList.contains(PAPER_TEXTURE_CLASS)).toBe(false);
  });

  it('restores texture automatically when a stored preference returns to a supported theme', () => {
    storage.setItem(PAPER_TEXTURE_STORAGE_KEY, '1');

    expect(loadPaperTexturePreference(storage, document.body, registry.PAPER_TEXTURE_BLOCKED_THEME_IDS[1])).toBe(true);
    expect(document.body.classList.contains(PAPER_TEXTURE_CLASS)).toBe(false);

    expect(loadPaperTexturePreference(storage, document.body, registry.AUTO_LIGHT_DEFAULT)).toBe(true);
    expect(document.body.classList.contains(PAPER_TEXTURE_CLASS)).toBe(true);
  });
});
