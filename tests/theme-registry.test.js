import { describe, it, expect } from 'vitest';
import reg from '../desktop/src/shared/theme-registry.cjs';

describe('theme-registry', () => {
  it('CJS and ESM adapters expose the same public contract', async () => {
    const esm = await import('../desktop/src/shared/theme-registry.ts');

    expect(esm.STORAGE_KEY).toBe(reg.STORAGE_KEY);
    expect(esm.DEFAULT_THEME).toBe(reg.DEFAULT_THEME);
    expect(esm.AUTO_LIGHT_DEFAULT).toBe(reg.AUTO_LIGHT_DEFAULT);
    expect(esm.AUTO_DARK_DEFAULT).toBe(reg.AUTO_DARK_DEFAULT);
    expect(esm.PAPER_TEXTURE_BLOCKED_THEME_IDS).toEqual(reg.PAPER_TEXTURE_BLOCKED_THEME_IDS);
    expect(esm.AUTO_OPTION).toEqual(reg.AUTO_OPTION);
    expect(esm.LEGACY_THEME_ALIASES).toEqual(reg.LEGACY_THEME_ALIASES);
    expect(esm.THEMES).toEqual(reg.THEMES);
    expect(esm.getThemeIds()).toEqual(reg.getThemeIds());
    expect(esm.getAllUIOptions()).toEqual(reg.getAllUIOptions());
    expect(esm.migrateSavedTheme('claude-design')).toBe(reg.migrateSavedTheme('claude-design'));
    expect(esm.resolveSavedTheme('auto', true)).toEqual(reg.resolveSavedTheme('auto', true));
    expect(esm.isPaperTextureBlockedTheme('midnight')).toBe(reg.isPaperTextureBlockedTheme('midnight'));
    expect(esm.default.getThemeIds()).toEqual(reg.getThemeIds());
  });

  describe('constants', () => {
    it('STORAGE_KEY 是 "hana-theme"', () => {
      expect(reg.STORAGE_KEY).toBe('hana-theme');
    });

    it('DEFAULT_THEME 是 "warm-paper"', () => {
      expect(reg.DEFAULT_THEME).toBe('warm-paper');
    });

    it('AUTO_LIGHT_DEFAULT / AUTO_DARK_DEFAULT 都在 THEMES 表里', () => {
      expect(reg.THEMES).toHaveProperty(reg.AUTO_LIGHT_DEFAULT);
      expect(reg.THEMES).toHaveProperty(reg.AUTO_DARK_DEFAULT);
    });

    it('AUTO_OPTION 带 i18nName / i18nMode', () => {
      expect(reg.AUTO_OPTION).toEqual({
        id: 'auto',
        i18nName: 'settings.appearance.auto',
        i18nMode: 'settings.appearance.autoMode',
      });
    });
  });

  describe('THEMES 完整性', () => {
    it('恰好 10 条', () => {
      expect(Object.keys(reg.THEMES)).toHaveLength(10);
    });

    it('包含所有已知主题 id', () => {
      expect(Object.keys(reg.THEMES).sort()).toEqual([
        'absolutely', 'contemplation', 'deep-think',
        'delve', 'grass-aroma', 'high-contrast', 'midnight', 'midnight-contrast',
        'new-warm-paper', 'warm-paper',
      ]);
    });

    it.each(['warm-paper', 'midnight', 'high-contrast', 'grass-aroma',
             'contemplation', 'absolutely', 'delve', 'deep-think', 'new-warm-paper',
             'midnight-contrast'])(
      '"%s" 每条都有完整字段',
      (id) => {
        const t = reg.THEMES[id];
        expect(t).toHaveProperty('cssPath');
        expect(t).toHaveProperty('backgroundColor');
        expect(t).toHaveProperty('i18nName');
        expect(t).toHaveProperty('i18nMode');
        expect(t.cssPath).toMatch(/^themes\/[a-z-]+\.css$/);
        expect(t.backgroundColor).toMatch(/^#[0-9A-F]{6}$/i);
        expect(t.i18nName).toMatch(/^settings\.appearance\./);
        expect(t.i18nMode).toMatch(/^settings\.appearance\..+Mode$/);
      }
    );

    it('高对比暗色主题紧跟新暖纸，保证设置页显示在它右侧', () => {
      const ids = reg.getThemeIds();
      expect(ids[ids.indexOf('new-warm-paper') + 1]).toBe('midnight-contrast');
    });

    it('THEMES 及每个条目都是 frozen（防止意外 mutation）', () => {
      expect(Object.isFrozen(reg.THEMES)).toBe(true);
      for (const id of Object.keys(reg.THEMES)) {
        expect(Object.isFrozen(reg.THEMES[id])).toBe(true);
      }
    });
  });

  describe('migrateSavedTheme', () => {
    it('合法主题 id 原样返回', () => {
      expect(reg.migrateSavedTheme('warm-paper')).toBe('warm-paper');
      expect(reg.migrateSavedTheme('midnight')).toBe('midnight');
      expect(reg.migrateSavedTheme('new-warm-paper')).toBe('new-warm-paper');
    });

    it('旧新暖纸主题 id 迁移到新 id', () => {
      expect(reg.migrateSavedTheme('claude-design')).toBe('new-warm-paper');
    });

    it('"auto" 原样返回', () => {
      expect(reg.migrateSavedTheme('auto')).toBe('auto');
    });

    it('null / undefined / 空串 → DEFAULT_THEME', () => {
      expect(reg.migrateSavedTheme(null)).toBe('warm-paper');
      expect(reg.migrateSavedTheme(undefined)).toBe('warm-paper');
      expect(reg.migrateSavedTheme('')).toBe('warm-paper');
    });

    it('非法值 → DEFAULT_THEME', () => {
      expect(reg.migrateSavedTheme('cyberpunk')).toBe('warm-paper');
      expect(reg.migrateSavedTheme(42)).toBe('warm-paper');
      expect(reg.migrateSavedTheme({})).toBe('warm-paper');
    });
  });

  describe('resolveSavedTheme', () => {
    it('具体主题透传：stored == concrete', () => {
      expect(reg.resolveSavedTheme('midnight', true)).toEqual({
        stored: 'midnight', concrete: 'midnight',
      });
      expect(reg.resolveSavedTheme('grass-aroma', false)).toEqual({
        stored: 'grass-aroma', concrete: 'grass-aroma',
      });
    });

    it('auto + 深色 → { stored: auto, concrete: midnight }', () => {
      expect(reg.resolveSavedTheme('auto', true)).toEqual({
        stored: 'auto', concrete: 'midnight',
      });
    });

    it('auto + 浅色 → { stored: auto, concrete: warm-paper }', () => {
      expect(reg.resolveSavedTheme('auto', false)).toEqual({
        stored: 'auto', concrete: 'warm-paper',
      });
    });

    it('null + 浅色 → DEFAULT_THEME', () => {
      expect(reg.resolveSavedTheme(null, false)).toEqual({
        stored: 'warm-paper', concrete: 'warm-paper',
      });
    });

    it('非法值 + 深色 → DEFAULT_THEME（不走 auto）', () => {
      expect(reg.resolveSavedTheme('nope', true)).toEqual({
        stored: 'warm-paper', concrete: 'warm-paper',
      });
    });
  });

  describe('getThemeIds / getAllUIOptions', () => {
    it('getThemeIds 返回 THEMES keys', () => {
      expect(reg.getThemeIds().sort()).toEqual(Object.keys(reg.THEMES).sort());
    });

    it('getAllUIOptions 含 10 个主题 + auto', () => {
      const opts = reg.getAllUIOptions();
      expect(opts).toHaveLength(11);
      expect(opts.map(o => o.id).sort()).toContain('auto');
      expect(opts.map(o => o.id).sort()).toContain('warm-paper');
      opts.forEach(o => {
        expect(o).toHaveProperty('id');
        expect(o).toHaveProperty('i18nName');
        expect(o).toHaveProperty('i18nMode');
      });
    });

    it('getAllUIOptions 最后一项是 auto（UI 顺序约束）', () => {
      const opts = reg.getAllUIOptions();
      expect(opts[opts.length - 1].id).toBe('auto');
    });
  });
});
