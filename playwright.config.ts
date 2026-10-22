import { defineConfig, devices } from '@playwright/test';

/**
 * E2E テスト。本番と同じ静的書き出し(out/)を、vercel.json のヘッダ(CSP を含む)を再現するサーバーで配信して試す。
 * 先に `npm run build` を実行しておく。
 */
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'ja-JP',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', testIgnore: /mobile\.spec\.ts/u, use: { ...devices['Desktop Chrome'], viewport: { height: 900, width: 1360 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/u },
  ],
  webServer: {
    command: 'node scripts/serve-out.mjs --port 4173',
    reuseExistingServer: true,
    url: 'http://localhost:4173/',
  },
});
