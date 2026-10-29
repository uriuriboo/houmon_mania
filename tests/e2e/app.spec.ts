import { expect, test } from '@playwright/test';
import { FIXTURE_FOLDER, FIXTURE_ZIP } from './global-setup';
import { expectClean, importZip, watchPage } from './helpers';

test.describe('取り込み → 検索 → 詳細 → 削除', () => {
  test('一連の操作', async ({ page }) => {
    const w = await watchPage(page);

    // トップ: データが無いので「はじめる」
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Swarm のチェックイン履歴');
    await expect(page.getByText('Foursquare Labs, Inc. が提供・承認・推奨するものではなく')).toBeVisible();
    await page.getByRole('link', { name: 'はじめる' }).click();
    await expect(page).toHaveURL(/\/import$/u);

    // 取り込み: 分析結果の確認
    await page.locator('input[type=file][accept*=".zip"]').setInputFiles(FIXTURE_ZIP);
    await expect(page.getByText(/チェックイン 1,200 件/u)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/新規 1,200 件/u)).toBeVisible();
    await page.getByRole('button', { name: '取り込む' }).click();
    await expect(page.getByText('取り込みが完了しました')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/データを消えにくくする設定/u)).toBeVisible();

    // 検索: 全件(閲覧モード)
    await page.getByRole('link', { name: '検索をはじめる' }).click();
    await expect(page.getByText(/1,200件中 1–50件/u)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-checkin-id]')).toHaveCount(50);
    // ヘッダーの鮮度の表示
    await expect(page.getByText(/最新チェックイン \d+\/\d+・取り込み \d+\/\d+/u)).toBeVisible();

    // AND 検索。現地語の店名(canonicalName)で見つかる
    await page.getByRole('searchbox', { name: '検索式' }).fill('架空ラーメン 渋谷');
    await page.getByRole('searchbox', { name: '検索式' }).press('Enter');
    await expect(page.getByText('解釈: 架空ラーメン AND 渋谷')).toBeVisible();
    await expect(page).toHaveURL(/#q=/u);
    const first = page.locator('[data-checkin-id]').first();
    await expect(first).toContainText('架空ラーメン 渋谷店');
    await expect(first).toContainText('Kakuu Ramen Shibuya');
    const total = Number((await page.getByText(/件中/u).textContent())!.replace(/[^\d].*$/u, '').replace(/,/gu, ''));
    expect(total).toBeGreaterThan(0);

    // 英字表記・全角でも同じ件数
    await page.getByRole('searchbox', { name: '検索式' }).fill('ＫＡＫＵＵ ramen shibuya');
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await expect(page.getByText(new RegExp(`^${total.toLocaleString('ja-JP')}件中`, 'u'))).toBeVisible();

    // 詳細(シート)を開いて閉じる
    await page.getByRole('searchbox', { name: '検索式' }).fill('架空ラーメン OR モックコーヒー');
    await page.getByRole('searchbox', { name: '検索式' }).press('Enter');
    await expect(page.getByText('解釈: 架空ラーメン OR モックコーヒー')).toBeVisible();
    const item = page.locator('[data-checkin-id]').first();
    const id = await item.getAttribute('data-checkin-id');
    await item.click();
    await expect(page).toHaveURL(new RegExp(`id=${id}`, 'u'));
    const sheet = page.getByRole('complementary');
    await expect(sheet.getByRole('heading', { level: 2 })).toBeVisible();
    await expect(sheet.getByText(/現地時刻 UTC/u)).toBeVisible();
    await expect(sheet.getByRole('link', { name: /Foursquare で店を見る/u })).toHaveAttribute('href', /^https:\/\/foursquare\.com\/v\/[0-9a-f]{24}$/u);
    await sheet.getByRole('button', { name: '閉じる' }).click();
    await expect(page).not.toHaveURL(/id=/u);
    await expect(item).toBeFocused();

    // 写真のあるチェックインの詳細では、検証した URL で画像を表示する
    await page.getByRole('searchbox', { name: '検索式' }).fill('');
    await page.getByRole('searchbox', { name: '検索式' }).press('Enter');
    await page.locator('[data-checkin-id]', { hasText: '写真' }).first().click();
    const img = page.getByRole('complementary').getByRole('img', { name: '写真 1' });
    await expect(img).toHaveAttribute('src', /^https:\/\/fastly\.4sqi\.net\/img\/general\/width960\//u);
    await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/id=/u);

    // ページ移動と、再読み込みでの再現
    await page.getByRole('button', { name: 'ページ 3' }).click();
    await expect(page.getByText(/1,200件中 101–150件/u)).toBeVisible();
    await expect(page).toHaveURL(/page=3/u);
    await page.reload();
    await expect(page.getByText(/1,200件中 101–150件/u)).toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect(page.getByText(/1,200件中 1–50件/u)).toBeVisible();

    // 範囲外のページは最終ページに補正
    await page.goto('/search#page=999');
    await expect(page.getByText(/1,200件中 1,151–1,200件/u)).toBeVisible({ timeout: 15_000 });

    // 詳細条件(絞り込み)。URL に残り、再読み込みでも再現する
    await page.goto('/search');
    await expect(page.getByText(/1,200件中 1–50件/u)).toBeVisible({ timeout: 15_000 });
    await page.locator('summary', { hasText: '詳細条件' }).click();
    await page.locator('#f-photo').selectOption('with');
    await expect(page).toHaveURL(/photo=1/u);
    await expect(page.getByText('絞り込み: 写真あり')).toBeVisible();
    const photoTotal = Number((await page.getByText(/件中/u).textContent())!.replace(/[^\d].*$/u, '').replace(/,/gu, ''));
    expect(photoTotal).toBeGreaterThan(0);
    expect(photoTotal).toBeLessThan(1200);
    await page.locator('label').filter({ has: page.getByRole('checkbox', { name: '土曜日' }) }).click();
    await page.locator('label').filter({ has: page.getByRole('checkbox', { name: '日曜日' }) }).click();
    await expect(page).toHaveURL(/wd=06/u);
    await expect(page.getByText('絞り込み: 日・土曜、写真あり')).toBeVisible();
    await page.reload();
    await expect(page.getByText('絞り込み: 日・土曜、写真あり')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#f-photo')).toHaveValue('with');
    await expect(page.getByRole('checkbox', { name: '土曜日' })).toBeChecked();
    // 該当なし
    await page.locator('#f-from').fill('2030-01-01');
    await expect(page.getByText('条件に一致するチェックインはありませんでした')).toBeVisible();
    await page.getByRole('button', { name: '条件をすべて解除' }).click();
    await expect(page.getByText(/1,200件中 1–50件/u)).toBeVisible();
    await expect(page).not.toHaveURL(/photo=/u);
    await expect(page.locator('#f-from')).toHaveValue('');

    // 検索式のエラー(D-4・D-5)
    await page.getByRole('searchbox', { name: '検索式' }).fill('A AND B OR C');
    await page.getByRole('searchbox', { name: '検索式' }).press('Enter');
    await expect(page.locator('#q-error')).toContainText('AND と OR を括弧なしで混ぜることはできません');
    await expect(page.getByRole('searchbox', { name: '検索式' })).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('searchbox', { name: '検索式' }).fill('ラーメン or つけ麺');
    await page.getByRole('searchbox', { name: '検索式' }).press('Enter');
    await expect(page.locator('#q-error')).toContainText('大文字の AND / OR');

    // 該当なし
    await page.getByRole('searchbox', { name: '検索式' }).fill('存在しない店名');
    await page.getByRole('searchbox', { name: '検索式' }).press('Enter');
    await expect(page.getByText('「存在しない店名」に一致するチェックインはありませんでした')).toBeVisible();

    // データ管理 → 削除
    await page.goto('/data');
    await expect(page.getByText('1,200 件', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'このブラウザのデータを削除' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
    await expect(page).toHaveURL(/\/import$/u, { timeout: 15_000 });
    await expect(page.getByText('このブラウザのデータを削除しました')).toBeVisible();
    await page.goto('/search');
    await expect(page.getByText('このブラウザにはデータがありません')).toBeVisible();

    expectClean(w);
  });

  test('展開済みのフォルダを選んで取り込み、同じものを読み込み直すと「変更なし」になる', async ({ page }) => {
    const w = await watchPage(page);
    await page.goto('/import');
    await page.locator('input[type=file][multiple]:not([accept])').setInputFiles(FIXTURE_FOLDER);
    await expect(page.getByText(/チェックイン 1,200 件/u)).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: '取り込む' }).click();
    await expect(page.getByText('取り込みが完了しました')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: '別のファイルを読み込む' }).click();
    await page.locator('input[type=file][accept*=".zip"]').setInputFiles(FIXTURE_ZIP);
    await expect(page.getByText(/変更なし 1,200 件/u)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('保存済みのデータから変更はありません')).toBeVisible();
    await page.getByRole('button', { name: 'やめる' }).click();
    await expect(page.getByText(/中止しました/u)).toBeVisible();
    expectClean(w);
  });

  test('取り込みの画面から、保存したデータを削除できる', async ({ page }) => {
    const w = await watchPage(page);
    await page.goto('/import');
    // データが無いうちは削除のボタンを出さない
    await expect(page.getByText('このブラウザにはまだデータがありません')).toBeVisible();
    await expect(page.getByRole('button', { name: 'このブラウザのデータを削除' })).toHaveCount(0);

    await page.locator('input[type=file][accept*=".zip"]').setInputFiles(FIXTURE_ZIP);
    await expect(page.getByText(/チェックイン 1,200 件/u)).toBeVisible({ timeout: 30_000 });
    // 取り込みの途中は出さない
    await expect(page.getByRole('button', { name: 'このブラウザのデータを削除' })).toHaveCount(0);
    await page.getByRole('button', { name: '取り込む' }).click();
    await expect(page.getByText('取り込みが完了しました')).toBeVisible({ timeout: 30_000 });

    await expect(page.getByText(/このブラウザに 1,200 件のチェックインを保存しています/u)).toBeVisible();
    await page.getByRole('button', { name: 'このブラウザのデータを削除' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
    await expect(page.getByText('このブラウザのデータを削除しました')).toBeVisible({ timeout: 15_000 });
    // 取り込み完了の表示と削除のボタンが消え、空の状態に戻る
    await expect(page.getByText('取り込みが完了しました')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'このブラウザのデータを削除' })).toHaveCount(0);
    await expect(page.getByText('このブラウザにはまだデータがありません')).toBeVisible();
    await page.goto('/search');
    await expect(page.getByText('このブラウザにはデータがありません')).toBeVisible();
    expectClean(w);
  });

  test('別のタブでデータを削除すると、他のタブは接続を閉じて案内を出す', async ({ context }) => {
    const a = await context.newPage();
    const wa = await watchPage(a);
    await importZip(a, FIXTURE_ZIP);
    const b = await context.newPage();
    await b.goto('/search');
    await expect(b.getByText(/1,200件中/u)).toBeVisible({ timeout: 15_000 });

    await a.goto('/data');
    await a.getByRole('button', { name: 'このブラウザのデータを削除' }).click();
    await a.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
    await expect(a).toHaveURL(/\/import$/u, { timeout: 15_000 });
    await expect(b.getByText('このブラウザのデータが、別のタブで削除されました')).toBeVisible();
    expectClean(wa);
  });

  test('取り込み完了を他のタブに知らせ、他のタブは検索用データを読み直す', async ({ context }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await b.goto('/search');
    await expect(b.getByText('このブラウザにはデータがありません')).toBeVisible({ timeout: 15_000 });
    await importZip(a, FIXTURE_ZIP);
    await expect(b.getByRole('link', { name: 'データを更新' })).toBeVisible({ timeout: 15_000 });
    await a.goto('/data');
    await a.getByRole('button', { name: 'このブラウザのデータを削除' }).click();
    await a.getByRole('dialog').getByRole('button', { name: '削除する' }).click();
    await expect(a).toHaveURL(/\/import$/u, { timeout: 15_000 });
  });
});

test('静的ページ・セキュリティヘッダ', async ({ page, request }) => {
  const w = await watchPage(page);
  for (const path of ['/about', '/privacy']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
  await expect(page.getByText(/Vercel Inc\./u)).toBeVisible();

  const res = await request.get('/search');
  expect(res.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(res.headers()['referrer-policy']).toBe('no-referrer');
  const html = await res.text();
  expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'sha256-/u);
  expect(html).not.toContain("'unsafe-inline'");
  expect(html).not.toContain("'unsafe-eval'");

  // ワーカーのスクリプトにも CSP を付ける(外部への送信を防ぐ)
  const worker = html.match(/\/_next\/static\/chunks\/[\w-]+\.js/u)![0];
  const wres = await request.get(worker);
  expect(wres.headers()['content-security-policy']).toContain("default-src 'none'; script-src 'self'; connect-src 'self'");
  expectClean(w);
});
