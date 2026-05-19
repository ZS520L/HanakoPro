import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import registry from '../desktop/src/shared/theme-registry.cjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const THEMES_DIR = path.join(ROOT, 'desktop/src');
const LOCALES = ['zh', 'zh-TW', 'ja', 'ko', 'en'];

function resolveKey(obj, dottedKey) {
  return dottedKey.split('.').reduce((acc, k) => acc?.[k], obj);
}

describe('theme-registry data contract', () => {
  describe.each(registry.getThemeIds())('主题 "%s"', (id) => {
    const entry = registry.THEMES[id];

    it('CSS 文件存在', () => {
      const full = path.join(THEMES_DIR, entry.cssPath);
      expect(fs.existsSync(full), `missing file: ${full}`).toBe(true);
    });

    it('backgroundColor 是合法 6 位 hex', () => {
      expect(entry.backgroundColor).toMatch(/^#[0-9A-F]{6}$/i);
    });

    it.each(LOCALES)('i18nName 在 locale "%s" 有值', (locale) => {
      const localePath = path.join(ROOT, 'desktop/src/locales', `${locale}.json`);
      expect(fs.existsSync(localePath), `locale file missing: ${localePath}`).toBe(true);
      const data = JSON.parse(fs.readFileSync(localePath, 'utf8'));
      const value = resolveKey(data, entry.i18nName);
      expect(value, `locale=${locale} key=${entry.i18nName} 缺失或为空`).toBeTruthy();
    });

    it.each(LOCALES)('i18nMode 在 locale "%s" 有值', (locale) => {
      const localePath = path.join(ROOT, 'desktop/src/locales', `${locale}.json`);
      const data = JSON.parse(fs.readFileSync(localePath, 'utf8'));
      const value = resolveKey(data, entry.i18nMode);
      expect(value, `locale=${locale} key=${entry.i18nMode} 缺失或为空`).toBeTruthy();
    });
  });

  describe('AUTO_OPTION', () => {
    it.each(LOCALES)('auto i18nName 在 locale "%s" 有值', (locale) => {
      const localePath = path.join(ROOT, 'desktop/src/locales', `${locale}.json`);
      const data = JSON.parse(fs.readFileSync(localePath, 'utf8'));
      const value = resolveKey(data, registry.AUTO_OPTION.i18nName);
      expect(value, `locale=${locale} auto i18nName 缺失`).toBeTruthy();
    });

    it.each(LOCALES)('auto i18nMode 在 locale "%s" 有值', (locale) => {
      const localePath = path.join(ROOT, 'desktop/src/locales', `${locale}.json`);
      const data = JSON.parse(fs.readFileSync(localePath, 'utf8'));
      const value = resolveKey(data, registry.AUTO_OPTION.i18nMode);
      expect(value, `locale=${locale} auto i18nMode 缺失`).toBeTruthy();
    });
  });
});
