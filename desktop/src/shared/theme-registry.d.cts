export interface ThemeEntry {
  cssPath: string;
  backgroundColor: string;
  i18nName: string;
  i18nMode: string;
}

export type ThemeId =
  | 'warm-paper'
  | 'midnight'
  | 'high-contrast'
  | 'grass-aroma'
  | 'contemplation'
  | 'absolutely'
  | 'delve'
  | 'deep-think'
  | 'new-warm-paper'
  | 'midnight-contrast';

export type StoredThemeSelection = ThemeId | 'auto';

export interface ThemeUIOption {
  id: ThemeId | 'auto';
  i18nName: string;
  i18nMode: string;
}

export interface ResolvedTheme {
  stored: StoredThemeSelection;
  concrete: ThemeId;
}

export const STORAGE_KEY: 'hana-theme';
export const DEFAULT_THEME: 'warm-paper';
export const AUTO_LIGHT_DEFAULT: 'warm-paper';
export const AUTO_DARK_DEFAULT: 'midnight';
export const PAPER_TEXTURE_BLOCKED_THEME_IDS: ReadonlyArray<ThemeId>;
export const AUTO_OPTION: ThemeUIOption;
export const LEGACY_THEME_ALIASES: Readonly<Record<string, ThemeId>>;
export const THEMES: Readonly<Record<ThemeId, ThemeEntry>>;

export function migrateSavedTheme(raw: unknown): StoredThemeSelection;
export function resolveSavedTheme(raw: unknown, isDark: boolean): ResolvedTheme;
export function getThemeIds(): ThemeId[];
export function getAllUIOptions(): ThemeUIOption[];
export function isPaperTextureBlockedTheme(themeId: unknown): boolean;
