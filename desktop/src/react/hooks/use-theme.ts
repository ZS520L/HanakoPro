import registry from '../../shared/theme-registry';

export const THEME_LIST = registry.getThemeIds();

/**
 * 包装全局 theme 系统
 * 实际主题切换由 theme.ts（打包成 lib/theme.js IIFE）处理——通过 CSS 变量
 * 驱动，React 不需要重渲染。
 */
export function useTheme() {
  return {
    setTheme: window.setTheme,
    loadSavedTheme: window.loadSavedTheme,
    getSavedTheme: () => {
      const raw = localStorage.getItem(registry.STORAGE_KEY);
      return registry.migrateSavedTheme(raw);
    },
    themes: THEME_LIST,
  };
}
