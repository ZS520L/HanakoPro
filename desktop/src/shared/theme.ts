/**
 * theme.ts — 共享主题系统（IIFE 打包入口）
 *
 * 由 vite.config.theme.js 打包成 desktop/dist-renderer/lib/theme.js，
 * 被 4 个 HTML（index / onboarding / settings / browser-viewer）通过
 * <script src="lib/theme.js"> 引入。执行时序与原 lib/theme.js 一致。
 *
 * 所有主题元信息来自 theme-registry ESM adapter，这里不再镜像任何常量表。
 */
import registry, { type ThemeId } from './theme-registry';
import {
  loadPaperTexturePreference,
  setPaperTexturePreference,
} from './appearance-preferences';

const themeSheet = document.getElementById('themeSheet') as HTMLLinkElement | null;

function systemIsDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyConcreteTheme(concrete: string): void {
  const entry = registry.THEMES[concrete as ThemeId];
  if (!entry) return;
  document.documentElement.setAttribute('data-theme', concrete);
  if (themeSheet) themeSheet.href = entry.cssPath;
  loadPaperTexturePreference();
  (window as unknown as { hana?: { syncWindowTheme?: (theme: string) => void } }).hana?.syncWindowTheme?.(concrete);
}

let systemThemeListener: ((e: MediaQueryListEvent) => void) | null = null;

function setTheme(name: string): void {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  if (systemThemeListener) {
    mql.removeEventListener('change', systemThemeListener);
    systemThemeListener = null;
  }

  const { stored, concrete } = registry.resolveSavedTheme(name, systemIsDark());
  applyConcreteTheme(concrete);

  if (stored === 'auto') {
    systemThemeListener = () => {
      applyConcreteTheme(registry.resolveSavedTheme('auto', systemIsDark()).concrete);
    };
    mql.addEventListener('change', systemThemeListener);
  }

  localStorage.setItem(registry.STORAGE_KEY, stored);
}

function loadSavedTheme(): void {
  const raw = localStorage.getItem(registry.STORAGE_KEY);
  setTheme(registry.migrateSavedTheme(raw));
}

/* ── 衬线体 / 无衬线体切换 ── */
function setSerifFont(enabled: boolean): void {
  document.body.classList.toggle('font-sans', !enabled);
  localStorage.setItem('hana-font-serif', enabled ? '1' : '0');
}

function loadSavedFont(): void {
  const saved = localStorage.getItem('hana-font-serif');
  // 默认开启衬线体（saved === null → 首次使用）
  const enabled = saved !== '0';
  document.body.classList.toggle('font-sans', !enabled);
}

/* ── 纸质纹理开关 ── */
function setPaperTexture(enabled: boolean): void {
  setPaperTexturePreference(enabled);
}

function loadSavedPaperTexture(): void {
  loadPaperTexturePreference();
}

// 暴露给 WS 事件处理器（设置工具远程切换主题用）
window.setTheme = setTheme;
window.applyTheme = setTheme;
window.loadSavedTheme = loadSavedTheme;
window.setSerifFont = setSerifFont;
window.loadSavedFont = loadSavedFont;
window.setPaperTexture = setPaperTexture;
window.loadSavedPaperTexture = loadSavedPaperTexture;

// 首屏自动加载
loadSavedTheme();
loadSavedFont();
loadSavedPaperTexture();
