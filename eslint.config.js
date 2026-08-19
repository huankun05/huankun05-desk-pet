import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/lib/framework/**',
      'src/lib/live2d/**',
      'public/**',
      '*.html',
      '*.json',
      'src-tauri/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.es2021,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Tauri 桌面应用的开发循环依赖 webview 重载而非 React Fast Refresh，
      // 且本仓库刻意把「与组件强相关的配置/路由常量」和组件同文件导出，
      // 故允许常量导出，仅对组件+非常量混合的情况告警。
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // TypeScript handles undefined references; disable JS-level check
      'no-undef': 'off',
      // Architectural issues in App.tsx — to be fixed in Phase 1.6/1.7 refactor
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      // React Compiler is not enabled in this project; disable its preserve-memoization rule
      'react-hooks/preserve-manual-memoization': 'off',
      'no-console': 'off',
    },
  },
  {
    // 构建/校验脚本跑在 Node 下，需要 node 全局变量（console、process 等）。
    // 注意：npm run lint 只扫 src，这段主要是为了 IDE 内不误报 no-undef。
    files: ['scripts/**/*.{mjs,js}', '*.config.{mjs,js}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
  prettierConfig,
];
