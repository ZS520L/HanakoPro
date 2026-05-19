"use strict";

/**
 * theme-registry.cjs — CommonJS adapter for main.cjs / preload.cjs / Node tests.
 *
 * Theme data lives in theme-registry-data.json. Renderer TypeScript imports
 * theme-registry.ts so Vite dev never serves this CJS module to the browser.
 */

const data = require("./theme-registry-data.json");

const STORAGE_KEY = data.storageKey;
const DEFAULT_THEME = data.defaultTheme;
const AUTO_LIGHT_DEFAULT = data.autoLightDefault;
const AUTO_DARK_DEFAULT = data.autoDarkDefault;
const LEGACY_THEME_ALIASES = Object.freeze({ ...data.legacyThemeAliases });
const PAPER_TEXTURE_BLOCKED_THEME_IDS = Object.freeze([...data.paperTextureBlockedThemeIds]);
const AUTO_OPTION = Object.freeze({ ...data.autoOption });

const THEMES = Object.freeze(Object.fromEntries(
  Object.entries(data.themes).map(([k, v]) => [k, Object.freeze({ ...v })])
));

// Spec-required startup assertion: every theme entry must have all 4 fields.
// Fails at module-load time so misconfigurations surface clearly in every process.
for (const [id, entry] of Object.entries(THEMES)) {
  if (!entry.cssPath || !entry.backgroundColor || !entry.i18nName || !entry.i18nMode) {
    throw new Error(`theme-registry: theme "${id}" is missing required fields (cssPath / backgroundColor / i18nName / i18nMode)`);
  }
  if (!/^#[0-9A-F]{6}$/i.test(entry.backgroundColor)) {
    throw new Error(`theme-registry: theme "${id}" has invalid backgroundColor "${entry.backgroundColor}" (must be 6-digit hex)`);
  }
}

/** 合法值原样返回（含 'auto'），非法 / null / undefined → DEFAULT_THEME。不主动覆写 localStorage。 */
function migrateSavedTheme(raw) {
  if (raw === "auto") return "auto";
  if (typeof raw !== "string" || raw.length === 0) return DEFAULT_THEME;
  if (LEGACY_THEME_ALIASES[raw]) return LEGACY_THEME_ALIASES[raw];
  return THEMES[raw] ? raw : DEFAULT_THEME;
}

/** 输入：localStorage 原始值 + 系统深色？
 *  输出：{ stored: 应保存回 localStorage 的值, concrete: 实际渲染主题 id } */
function resolveSavedTheme(raw, isDark) {
  const stored = migrateSavedTheme(raw);
  if (stored === "auto") {
    return { stored, concrete: isDark ? AUTO_DARK_DEFAULT : AUTO_LIGHT_DEFAULT };
  }
  return { stored, concrete: stored };
}

function getThemeIds() {
  return Object.keys(THEMES);
}

function getAllUIOptions() {
  const themeOpts = getThemeIds().map((id) => ({
    id,
    i18nName: THEMES[id].i18nName,
    i18nMode: THEMES[id].i18nMode,
  }));
  return [...themeOpts, { ...AUTO_OPTION }];
}

function isPaperTextureBlockedTheme(themeId) {
  return PAPER_TEXTURE_BLOCKED_THEME_IDS.includes(themeId);
}

module.exports = {
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
