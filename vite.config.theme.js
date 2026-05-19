import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 独立的 theme bundle 配置。
 * 输出固定名 dist-renderer/lib/theme.js（IIFE），让 4 个 HTML 的
 * <script src="lib/theme.js"> 无需改动。
 *
 * 必须在 build:renderer 之后执行，因为 vite.config.ts 里的
 * copyLegacyFiles 会把 desktop/src/lib/ 整个复制到 dist-renderer/lib/，
 * 此 bundle 产物会覆盖那次复制里可能存在的旧 theme.js（如果还没删源）。
 */
export default defineConfig({
  build: {
    outDir: 'desktop/dist-renderer/lib',
    emptyOutDir: false, // 不清 dist-renderer/lib 下其他 legacy 资源
    minify: true,
    sourcemap: true,
    lib: {
      entry: path.resolve(__dirname, 'desktop/src/shared/theme.ts'),
      formats: ['iife'],
      name: 'HanaTheme',
      fileName: () => 'theme.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
