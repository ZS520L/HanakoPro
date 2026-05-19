import data from './theme-registry-data.json';

export interface ThemeEntry {
  cssPath: string;
  backgroundColor: string;
  i18nName: string;
  i18nMode: string;
}

export type ThemeId = keyof typeof data.themes;
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

export const STORAGE_KEY = data.storageKey;
export const DEFAULT_THEME = data.defaultTheme as ThemeId;
export const AUTO_LIGHT_DEFAULT = data.autoLightDefault as ThemeId;
export const AUTO_DARK_DEFAULT = data.autoDarkDefault as ThemeId;
export const LEGACY_THEME_ALIASES = Object.freeze({ ...data.legacyThemeAliases }) as Readonly<Record<string, ThemeId>>;
export const PAPER_TEXTURE_BLOCKED_THEME_IDS = Object.freeze([...data.paperTextureBlockedThemeIds]) as ReadonlyArray<ThemeId>;
export const AUTO_OPTION = Object.freeze({ ...data.autoOption }) as ThemeUIOption;

export const THEMES = Object.freeze(Object.fromEntries(
  Object.entries(data.themes).map(([k, v]) => [k, Object.freeze({ ...v })])
)) as Readonly<Record<ThemeId, ThemeEntry>>;

for (const [id, entry] of Object.entries(THEMES)) {
  if (!entry.cssPath || !entry.backgroundColor || !entry.i18nName || !entry.i18nMode) {
    throw new Error(`theme-registry: theme "${id}" is missing required fields (cssPath / backgroundColor / i18nName / i18nMode)`);
  }
  if (!/^#[0-9A-F]{6}$/i.test(entry.backgroundColor)) {
    throw new Error(`theme-registry: theme "${id}" has invalid backgroundColor "${entry.backgroundColor}" (must be 6-digit hex)`);
  }
}

export function migrateSavedTheme(raw: unknown): StoredThemeSelection {
  if (raw === 'auto') return 'auto';
  if (typeof raw !== 'string' || raw.length === 0) return DEFAULT_THEME;
  if (LEGACY_THEME_ALIASES[raw]) return LEGACY_THEME_ALIASES[raw];
  return raw in THEMES ? raw as ThemeId : DEFAULT_THEME;
}

export function resolveSavedTheme(raw: unknown, isDark: boolean): ResolvedTheme {
  const stored = migrateSavedTheme(raw);
  if (stored === 'auto') {
    return { stored, concrete: isDark ? AUTO_DARK_DEFAULT : AUTO_LIGHT_DEFAULT };
  }
  return { stored, concrete: stored };
}

export function getThemeIds(): ThemeId[] {
  return Object.keys(THEMES) as ThemeId[];
}

export function getAllUIOptions(): ThemeUIOption[] {
  const themeOpts = getThemeIds().map((id) => ({
    id,
    i18nName: THEMES[id].i18nName,
    i18nMode: THEMES[id].i18nMode,
  }));
  return [...themeOpts, { ...AUTO_OPTION }];
}

export function isPaperTextureBlockedTheme(themeId: unknown): boolean {
  return PAPER_TEXTURE_BLOCKED_THEME_IDS.includes(themeId as ThemeId);
}

const registry = {
  STORAGE_KEY,
  DEFAULT_THEME,
  AUTO_LIGHT_DEFAULT,
  AUTO_DARK_DEFAULT,
  PAPER_TEXTURE_BLOCKED_THEME_IDS,
  AUTO_OPTION,
  LEGACY_THEME_ALIASES,
  THEMES,
  migrateSavedTheme,
  resolveSavedTheme,
  getThemeIds,
  getAllUIOptions,
  isPaperTextureBlockedTheme,
};

export default registry;
