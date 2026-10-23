import { expect, test } from '@playwright/test';
import { FIXTURE_ZIP } from './global-setup';
import { expectClean, importZip, watchPage } from './helpers';

test('スマホ: 詳細は全画面、ページ番号は「5 / 25」形式', async ({ page }) => {
  const w = await watchPage(page);
  await importZip(page, FIXTURE_ZIP);
  await page.getByRole('link', { name: '検索をはじめる' }).click();
  await expect(page.getByText(/1,200件中 1–50件/u)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('1 / 24')).toBeVisible();

  await page.locator('[data-checkin-id]').first().click();
  const sheet = page.getByRole('complementary');
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  const vp = page.viewportSize()!;
  expect(box!.width).toBeGreaterThanOrEqual(vp.width - 1);
  await page.screenshot({ path: 'test-results/mobile-detail.png' });
  await sheet.getByRole('button', { name: '閉じる' }).click();
  await expect(sheet).toBeHidden();
  await page.screenshot({ path: 'test-results/mobile-list.png' });

  await page.goto('/data');
  await page.getByRole('button', { name: 'このブラウザのデータを削除' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
  await expect(page).toHaveURL(/\/import$/u, { timeout: 15_000 });
  expectClean(w);
});
