import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import registry from '../desktop/src/shared/theme-registry.cjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const THEME_IDS = registry.getThemeIds();

const SKIP_DIRS = [
  'node_modules',
  'dist',
  'dist-renderer',
  'dist-server',
  'dist-server-bundle',
  '.cache',
  'vendor',
  '.git',
];

// Files explicitly allowed to contain theme id string literals.
// - theme-registry.cjs / .d.cts: the single source of truth itself
// - Tests that reference ids directly for white-box validation
// - onboarding/constants.ts: onboarding UI layer owns its own theme-list UX decision
//   (auto at position 3 + new-warm-paper excluded is a product/UX choice,
//   not a data-mirroring bug; see Task 8 of theme-registry refactor plan)
const ALLOWED_FILES = new Set([
  'desktop/src/shared/theme-registry.cjs',
  'desktop/src/shared/theme-registry.d.cts',
  'desktop/src/react/onboarding/constants.ts',
  'tests/theme-registry.test.js',
  'tests/theme-registry-structural.test.js',
  'tests/theme-registry-contract.test.js',
  'tests/theme-html-default.test.js',
]);

const CHECKED_EXTS = new Set(['.js', '.cjs', '.ts', '.tsx', '.mjs']);

function walk(dir, collected = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.some((s) => full.endsWith(s))) continue;
      walk(full, collected);
    } else {
      collected.push(full);
    }
  }
  return collected;
}

function relPath(p) {
  return path.relative(ROOT, p).replace(/\\/g, '/');
}

describe('theme-registry structural constraint', () => {
  it('全局 styles.css 持有默认字体 token，主题可按需覆盖', () => {
    const stylesPath = path.join(ROOT, 'desktop/src/styles.css');
    const content = fs.readFileSync(stylesPath, 'utf8');

    expect(content).toContain("--font-ui: 'Inter'");
    expect(content).toContain("--font-serif: 'EB Garamond', 'Noto Serif SC'");
    expect(content).toContain("--font-mono: 'JetBrains Mono'");
    const fontImportIndex = content.indexOf("new-warm-paper-fonts.css");
    expect(fontImportIndex).toBeGreaterThanOrEqual(0);
    expect(fontImportIndex).toBeLessThan(content.indexOf(':root'));
  });

  it('除 registry 和白名单外，不允许任何文件出现主题 id 字符串字面量', () => {
    const SCAN_ROOTS = [
      path.join(ROOT, 'desktop/src'),
      path.join(ROOT, 'lib'),
      path.join(ROOT, 'core'),
      path.join(ROOT, 'server'),
    ].filter((d) => fs.existsSync(d));

    const TOP_LEVEL_FILES = [
      path.join(ROOT, 'desktop/main.cjs'),
      path.join(ROOT, 'desktop/preload.cjs'),
    ].filter((f) => fs.existsSync(f));

    const files = [
      ...SCAN_ROOTS.flatMap((d) => walk(d)),
      ...TOP_LEVEL_FILES,
    ];

    const violations = [];
    for (const file of files) {
      const ext = path.extname(file);
      if (!CHECKED_EXTS.has(ext)) continue;
      const rel = relPath(file);
      if (ALLOWED_FILES.has(rel)) continue;

      const content = fs.readFileSync(file, 'utf8');
      for (const id of THEME_IDS) {
        // Match as a string literal in single or double quotes.
        const escaped = id.replace(/-/g, '\\-');
        const re = new RegExp(`(['"])${escaped}\\1`);
        if (re.test(content)) {
          violations.push(`${rel}: 出现 "${id}" 字面量`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `发现 ${violations.length} 处硬编码主题 id 字面量，应改为从 theme-registry 导入：\n` +
        violations.map((v) => '  ' + v).join('\n'),
      );
    }
  });

  it('renderer TypeScript 不直接导入 CommonJS registry', () => {
    const SCAN_ROOTS = [
      path.join(ROOT, 'desktop/src/shared'),
      path.join(ROOT, 'desktop/src/react'),
    ].filter((d) => fs.existsSync(d));

    const files = SCAN_ROOTS.flatMap((d) => walk(d));
    const violations = [];
    for (const file of files) {
      if (!['.ts', '.tsx'].includes(path.extname(file))) continue;
      const rel = relPath(file);
      if (rel.includes('/__tests__/') || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (/from\s+['"][^'"]+\.cjs['"]/.test(content) || /import\(\s*['"][^'"]+\.cjs['"]\s*\)/.test(content)) {
        violations.push(`${rel}: renderer source imports a .cjs module`);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        'Renderer source must import the ESM theme registry adapter instead of .cjs:\n' +
        violations.map((v) => '  ' + v).join('\n'),
      );
    }
  });
});
