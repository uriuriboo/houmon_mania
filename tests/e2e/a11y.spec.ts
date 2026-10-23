import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_ZIP } from './global-setup';
import { importZip, watchPage } from './helpers';

/**
 * アクセシビリティの自動検査(基本設計 5.5: WCAG 2.2 AA 相当が目標)。
 * 自動の検査で見つかるのは問題の一部で、スクリーンリーダーなどでの確認の代わりにはならない。
 */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const check = async (page: Page, label: string) => {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 5).map((n) => `${n.target.join(' ')} — ${n.failureSummary?.split('\n').slice(1).join(' ').trim()}`),
  }));
  expect(summary, `axe violations on ${label}`).toEqual([]);
};

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`アクセシビリティ(${colorScheme})`, () => {
    test.use({ colorScheme });

    test('データが無い状態の画面', async ({ page }) => {
      await watchPage(page);
      for (const path of ['/', '/about', '/privacy', '/import', '/search', '/data']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        await check(page, `${path} (empty)`);
      }
    });

    test('取り込み後の画面', async ({ page }) => {
      await watchPage(page);

      // 分析結果
      await page.goto('/import');
      await page.locator('input[type=file][accept*=".zip"]').setInputFiles(FIXTURE_ZIP);
      await expect(page.getByRole('button', { name: '取り込む' })).toBeVisible({ timeout: 30_000 });
      await check(page, '/import (analyzed)');
      await page.getByRole('button', { name: '取り込む' }).click();
      await expect(page.getByText('取り込みが完了しました')).toBeVisible({ timeout: 30_000 });
      await check(page, '/import (done)');

      // 検索結果・検索式のエラー・該当なし
      await page.goto('/search');
      await expect(page.getByText(/件中/u).first()).toBeVisible({ timeout: 15_000 });
      await check(page, '/search (list)');
      await page.getByRole('searchbox', { name: '検索式' }).fill('A AND B OR C');
      await page.getByRole('searchbox', { name: '検索式' }).press('Enter');
      await expect(page.locator('#q-error')).toBeVisible();
      await check(page, '/search (query error)');
      await page.getByRole('searchbox', { name: '検索式' }).fill('存在しない店名');
      await page.getByRole('searchbox', { name: '検索式' }).press('Enter');
      await expect(page.getByText(/に一致するチェックインはありませんでした/u)).toBeVisible();
      await check(page, '/search (no results)');

      // 詳細(写真あり)
      await page.getByRole('searchbox', { name: '検索式' }).fill('');
      await page.getByRole('searchbox', { name: '検索式' }).press('Enter');
      await page.locator('[data-checkin-id]', { hasText: '写真' }).first().click();
      await expect(page.getByRole('complementary').getByRole('heading', { level: 2 })).toBeVisible();
      await check(page, '/search (detail)');
      await page.keyboard.press('Escape');

      // 検索の書き方(ダイアログ)
      await page.getByRole('button', { name: '検索の書き方' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await check(page, '/search (help dialog)');
      await page.keyboard.press('Escape');

      // メニュー
      await page.getByRole('button', { name: 'メニュー' }).click();
      await expect(page.getByRole('navigation', { name: 'メニュー' })).toBeVisible();
      await check(page, 'header menu');
      await page.keyboard.press('Escape');

      // データ管理・削除の確認ダイアログ
      await page.goto('/data');
      await expect(page.getByText('使用量')).toBeVisible();
      await check(page, '/data');
      await page.getByRole('button', { name: 'このブラウザのデータを削除' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await check(page, '/data (delete dialog)');
      await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
      await expect(page).toHaveURL(/\/import$/u, { timeout: 15_000 });
    });
  });
}

test('スマホの幅でも検査する', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { height: 844, width: 390 } });
  const page = await context.newPage();
  await watchPage(page);
  await importZip(page, FIXTURE_ZIP);
  await page.goto('/search');
  await expect(page.getByText(/件中/u).first()).toBeVisible({ timeout: 15_000 });
  await check(page, '/search (mobile)');
  await page.locator('[data-checkin-id]').first().click();
  await expect(page.getByRole('complementary')).toBeVisible();
  await check(page, '/search detail (mobile)');
  await context.close();
});
