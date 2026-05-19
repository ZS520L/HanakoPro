import registry from './theme-registry';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;
type PaperTextureTheme = string | null | undefined;

export const PAPER_TEXTURE_STORAGE_KEY = 'hana-paper-texture';
export const PAPER_TEXTURE_CLASS = 'paper-texture';
export const LEGACY_NO_PAPER_TEXTURE_CLASS = 'no-paper-texture';

function getCurrentTheme(): string | null {
  if (typeof document === 'undefined') return null;
  return document.documentElement.getAttribute('data-theme');
}

export function isPaperTextureEnabled(storage: PreferenceStorage = window.localStorage): boolean {
  return storage.getItem(PAPER_TEXTURE_STORAGE_KEY) === '1';
}

export function isPaperTextureBlockedTheme(theme: PaperTextureTheme = getCurrentTheme()): boolean {
  return registry.isPaperTextureBlockedTheme(theme);
}

export function isPaperTextureEffectivelyEnabled(
  enabled: boolean,
  theme: PaperTextureTheme = getCurrentTheme(),
): boolean {
  return enabled && !isPaperTextureBlockedTheme(theme);
}

export function applyPaperTextureClass(
  enabled: boolean,
  body: HTMLElement = document.body,
  theme: PaperTextureTheme = getCurrentTheme(),
): void {
  body.classList.toggle(PAPER_TEXTURE_CLASS, isPaperTextureEffectivelyEnabled(enabled, theme));
  body.classList.remove(LEGACY_NO_PAPER_TEXTURE_CLASS);
}

export function setPaperTexturePreference(
  enabled: boolean,
  storage: PreferenceStorage = window.localStorage,
  body: HTMLElement = document.body,
  theme: PaperTextureTheme = getCurrentTheme(),
): void {
  applyPaperTextureClass(enabled, body, theme);
  storage.setItem(PAPER_TEXTURE_STORAGE_KEY, enabled ? '1' : '0');
}

export function loadPaperTexturePreference(
  storage: PreferenceStorage = window.localStorage,
  body: HTMLElement = document.body,
  theme: PaperTextureTheme = getCurrentTheme(),
): boolean {
  const enabled = isPaperTextureEnabled(storage);
  applyPaperTextureClass(enabled, body, theme);
  return enabled;
}
