import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

/**
 * CSP 集中管理：
 * 所有窗口的 CSP 策略统一定义在此，Vite 构建/开发时注入。
 * HTML 源文件中保留 CSP meta tag 作为 fallback（loadFile 回退路径）。
 *
 * 修改 CSP 时只改这里，然后同步更新 HTML 源文件。
 */
const CSP_PROFILES: Record<string, string> = {
  // 主窗口：需要 API 连接、图片、字体（KaTeX）、iframe（artifacts）
  'index.html':
    "default-src 'self'; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; img-src 'self' data: file: http://127.0.0.1:*; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; frame-src blob: data: http://127.0.0.1:* http://localhost:*",
  // 设置窗口：需要 API 连接、图片、字体
  'settings.html':
    "default-src 'self'; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; img-src 'self' data: file: http://127.0.0.1:*; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:",
  // Onboarding：需要 API 连接、图片、字体
  'onboarding.html':
    "default-src 'self'; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; img-src 'self' data: file: http://127.0.0.1:*; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:",
  // 以下窗口不加载第三方字体，保持严格策略
  'splash.html':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' file:",
  'browser-viewer.html':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' file:",
  'viewer-window.html':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: file:",
  // 终端窗口：需要 WS/HTTP 到 server，xterm 使用 inline style
  'terminal.html':
    "default-src 'self'; connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:",
  'desktop-pet.html':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data: file:",
};

function injectCsp(): Plugin {
  return {
    name: 'hana-inject-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const filename = path.basename(ctx.filename);
        const profile = CSP_PROFILES[filename];
        if (!profile) return html;

        let csp = profile;
        // Dev 模式放宽：React Refresh 需要 unsafe-inline，Vite HMR 需要 ws
        if (process.env.NODE_ENV !== 'production') {
          csp = csp.replace(
            /script-src 'self'/,
            "script-src 'self' 'unsafe-inline'",
          );
          if (csp.includes('connect-src')) {
            csp = csp.replace(
              /connect-src 'self'/,
              "connect-src 'self' ws://localhost:5173",
            );
          }
        }

        return html.replace(
          /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*\/?>/,
          `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
        );
      },
    },
  };
}

/**
 * 保留旧 CSS link 标签：
 * Vite 默认会把 <link rel="stylesheet" href="..."> 打包进 bundle。
 * 渐进迁移期间，styles.css 和 themes/*.css 必须保持为独立文件
 * （theme.js 运行时动态切换 themeSheet 的 href）。
 *
 * 做法：在 HTML 处理前把旧 CSS link 替换成占位符，build 后再还原。
 */
function preserveLegacyCss(): Plugin {
  const CSS_PLACEHOLDER_RE = /<!--HANA_CSS:(.*?)-->/g;
  return {
    name: 'hana-preserve-legacy-css',
    enforce: 'pre',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // 把 <link rel="stylesheet" href="..."> 替换成 HTML 注释占位符
        // 保留 id 等属性
        return html.replace(
          /<link\s+rel="stylesheet"\s+href="([^"]+)"([^>]*)>/g,
          (_match, href, rest) => `<!--HANA_CSS:${href}${rest}-->`
        );
      },
    },
  };
}

function restoreLegacyCss(): Plugin {
  return {
    name: 'hana-restore-legacy-css',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // 把占位符还原为 <link> 标签
        return html.replace(
          /<!--HANA_CSS:(.*?)-->/g,
          (_match, content) => {
            // content 是 "styles.css" 或 "themes/warm-paper.css" id="themeSheet"
            const parts = content.split(/\s+/);
            const href = parts[0];
            const rest = parts.slice(1).join(' ');
            return `<link rel="stylesheet" href="${href}"${rest ? ' ' + rest : ''}>`;
          }
        );
      },
    },
  };
}

/**
 * Vite dev server 直接服务 source HTML 时，theme helper 不能再依赖 dist-renderer/lib/theme.js。
 * 开发模式把旧 script 标签重写到 source theme.ts，保持和 build:theme 同一份实现。
 */
function useSourceThemeInDev(): Plugin {
  return {
    name: 'hana-use-source-theme-in-dev',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(
          /<script\s+src="lib\/theme\.js"><\/script>/g,
          '<script type="module" src="/shared/theme.ts"></script>',
        );
      },
    },
  };
}

/**
 * Build 后复制旧文件到 dist-renderer/：
 * 旧 JS 模块、CSS、主题、资源、语言包等，
 * 在渐进迁移完成前还需要从 dist-renderer/ 加载。
 */
function copyLegacyFiles(): Plugin {
  return {
    name: 'hana-copy-legacy-files',
    closeBundle() {
      const srcDir = path.resolve(__dirname, 'desktop/src');
      const outDir = path.resolve(__dirname, 'desktop/dist-renderer');

      const dirs = ['lib', 'modules', 'themes', 'assets', 'locales'];
      const files = ['styles.css', 'animations.css'];

      for (const dir of dirs) {
        const src = path.join(srcDir, dir);
        const dest = path.join(outDir, dir);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest, { recursive: true });
        }
      }

      for (const file of files) {
        const src = path.join(srcDir, file);
        const dest = path.join(outDir, file);
        if (fs.existsSync(src)) {
          fs.cpSync(src, dest);
        }
      }
    },
  };
}

export default defineConfig({
  root: 'desktop/src',
  base: './',
  plugins: [
    preserveLegacyCss(),
    react(),
    injectCsp(),
    useSourceThemeInDev(),
    restoreLegacyCss(),
    copyLegacyFiles(),
  ],
  resolve: {
    alias: {
      '@hana/plugin-protocol': path.resolve(__dirname, 'packages/plugin-protocol/src/index.ts'),
      '@hana/plugin-sdk': path.resolve(__dirname, 'packages/plugin-sdk/src/index.ts'),
      '@hana/plugin-runtime': path.resolve(__dirname, 'packages/plugin-runtime/src/index.ts'),
      '@hana/plugin-components': path.resolve(__dirname, 'packages/plugin-components/src/index.ts'),
      '@': path.resolve(__dirname, 'desktop/src/react'),
    },
  },
  css: {
    modules: {
      // hana-* 是 animations.css 全局 keyframe 命名空间，不要被 CSS Modules hash 化。
      // 否则模块文件里的 animation: hana-popout 会变成 animation: _hana-popout_xxxx，
      // 跟全局 @keyframes hana-popout 对不上，浏览器静默忽略，动画完全不会播。
      generateScopedName(name: string, filename: string): string {
        if (name.startsWith('hana-')) return name;
        const hash = crypto.createHash('md5').update(filename + '|' + name).digest('hex').slice(0, 5);
        return `_${name}_${hash}`;
      },
    },
  },
  build: {
    outDir: '../dist-renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'desktop/src/index.html'),
        settings: path.resolve(__dirname, 'desktop/src/settings.html'),
        onboarding: path.resolve(__dirname, 'desktop/src/onboarding.html'),
        splash: path.resolve(__dirname, 'desktop/src/splash.html'),
        'browser-viewer': path.resolve(__dirname, 'desktop/src/browser-viewer.html'),
        'viewer-window': path.resolve(__dirname, 'desktop/src/viewer-window.html'),
        terminal: path.resolve(__dirname, 'desktop/src/terminal.html'),
        'desktop-pet': path.resolve(__dirname, 'desktop/src/desktop-pet.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    root: path.resolve(__dirname),
  },
});
