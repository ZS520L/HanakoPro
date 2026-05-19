/**
 * Hana Desktop — 全局类型声明
 *
 * 集中声明 window 上的全局属性，避免散落的 `(window as any)` 和重复的 declare global。
 */

import type { PlatformApi } from './react/types';

declare global {
  interface Window {
    // ── i18n ──
    t: (path: string, vars?: Record<string, string | number>) => string;

    // ── Platform bridge（preload 注入） ──
    platform: PlatformApi;
    hana: PlatformApi;

    // ── 日志上报 ──
    __hanaLog: (level: string, module: string, message: string) => void;

    // ── 主题（由 lib/theme.js IIFE bundle 注入） ──
    setTheme: (name: string) => void;
    // applyTheme 为 optional：ws-message-handler 运行在所有窗口中，包括不加载
    // lib/theme.js 的 viewer-window 等，这些窗口里该方法确实不存在。
    // callsite 使用 window.applyTheme?.() 是正确的防御性调用，类型须与之一致。
    applyTheme?: (name: string) => void;
    loadSavedTheme: () => void;
    setSerifFont: (enabled: boolean) => void;
    loadSavedFont: () => void;
    setPaperTexture: (enabled: boolean) => void;
    loadSavedPaperTexture: () => void;

    // ── Notification bridge ──
    showNotification?: (title: string, body: string) => void;
    updateBrowserViewer?: (data: { url: string; thumbnail?: string }) => void;

    // ── i18n loader ──
    i18n: {
      locale: string;
      defaultName: string;
      _data: Record<string, unknown>;
      _agentOverrides: Record<string, unknown>;
      load(locale: string): Promise<void>;
      setAgentOverrides(overrides: Record<string, unknown> | null): void;
      t(path: string, vars?: Record<string, string | number>): string;
    };
  }

  // theme helpers（window.* 属性，IIFE bundle 注入后可通过全局名调用）
  // 保留 declare function 以兼容 bootstrap.ts 的 typeof loadSavedTheme === 'function' 检查
  // 覆盖 bootstrap.ts 里所有 6 个有裸调用点的函数（applyTheme 无裸调用点，不在此列）
  function loadSavedTheme(): void;
  function loadSavedFont(): void;
  function loadSavedPaperTexture(): void;
  function setTheme(theme: string): void;
  function setSerifFont(enabled: boolean): void;
  function setPaperTexture(enabled: boolean): void;
}

export {};
