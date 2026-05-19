import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  // Global ignores — must be a standalone config object with only `ignores`
  {
    ignores: [
      'node_modules/',
      '**/dist/**',
      'dist-server/**',
      'dist-server-bundle/**',
      'dist-computer-use/**',
      'dist-sandbox/**',
      'desktop/dist-renderer/**',
      'desktop/native/**/.build/**',
      '.cache/**',
      '**/*.cjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Browser JS files (pre-React bootstrap layer: i18n, theme, platform)
  {
    files: ['desktop/src/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Shared CJS-style JS (loaded via require from preload.cjs; runs in preload context)
  {
    files: ['desktop/src/shared/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Node-side JS files
  {
    files: [
      'core/**/*.js',
      'hub/**/*.js',
      'index.js',
      'lib/**/*.js',
      'plugins/**/*.js',
      'scripts/**/*.{js,mjs}',
      'server/**/*.js',
      'shared/**/*.js',
      'tests/**/*.{js,ts,tsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        fetch: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },

  // Vitest files mix Node helpers with jsdom/browser primitives.
  {
    files: ['tests/**/*.{js,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Browser package TypeScript files
  {
    files: [
      'packages/plugin-sdk/src/**/*.ts',
      'packages/plugin-components/src/**/*.{ts,tsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // TypeScript/React frontend files
  {
    files: [
      'desktop/src/**/*.{ts,tsx}',
      'packages/plugin-components/src/**/*.{ts,tsx}',
    ],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // React components should render with JSX. DOM utilities, CodeMirror widgets,
  // and tests may create DOM nodes directly.
  {
    files: ['desktop/src/react/**/*.tsx'],
    ignores: [
      'desktop/src/react/**/__tests__/**',
      'desktop/src/react/**/*.test.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='document'][callee.property.name='createElement']",
          message:
            'React 组件中不要用 document.createElement，用 JSX。如确需操作 DOM（canvas/resize），加 eslint-disable 注释说明原因。',
        },
      ],
    },
  },

  // Downgrade noisy recommended rules to warnings (non-architectural, fix incrementally)
  {
    rules: {
      'no-empty': 'warn',
      'prefer-const': 'warn',
      'no-useless-escape': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },

  // 禁止绕过 adapter 直接导入 PI SDK（后端全覆盖）
  {
    files: ['core/**/*.js', 'lib/**/*.js', 'hub/**/*.js', 'server/**/*.js'],
    ignores: ['lib/pi-sdk/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['@mariozechner/*'],
          message: '请从 lib/pi-sdk/index.js 导入，不要直接引用 PI SDK 包。',
        }],
      }],
    },
  },

  // Prevent engine._ access in server routes
  {
    files: ['server/routes/**/*.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='engine'][property.name=/^_/]",
          message: '不要访问 engine 的私有方法。通过 engine 公开 API 访问。',
        },
      ],
    },
  },
];
