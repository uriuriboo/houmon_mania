import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // 読み込んだ値を HTML として挿入しない(基本設計 5.5・10.1)
      'react/no-danger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // 写真は検証済みの URL を <img referrerpolicy="no-referrer"> で直接表示する(next/image は使わない。9.4)
      '@next/next/no-img-element': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'doc/**',
    'data-export-*/**',
    'local-data/**',
    'playwright-report/**',
    'test-results/**',
  ]),
]);

export default eslintConfig;
