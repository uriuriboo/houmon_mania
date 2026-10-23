import { expect, test, type Page } from '@playwright/test';
import { expectClean, watchPage } from './helpers';

// Vercel Web Analytics は、トップ・このアプリについて・プライバシーポリシーの 3 ページだけに入れる(TODO # 16)。
// 位置履歴を扱うページ(検索・取り込み・データ管理)では、スクリプトの読み込みも、計測の送信もしない。
// ローカルの配信には /_vercel/insights/ が無いため、スクリプトは空のものに差し替えて、送信の記録(window.vaq)を見る。

const watchInsights = async (page: Page) => {
  const requested: string[] = [];
  await page.route('**/_vercel/insights/**', (route) => {
    requested.push(new URL(route.request().url()).pathname);
    return route.fulfill({ body: '', contentType: 'text/javascript', status: 200 });
  });
  return requested;
};

const pageviews = (page: Page) =>
  page.evaluate(() => {
    const q = (window as unknown as { vaq?: unknown[][] }).vaq ?? [];
    return q.filter((c) => c[0] === 'pageview').map((c) => (c[1] as { path: string }).path);
  });

test.describe('アクセス解析(Vercel Web Analytics)', () => {
  for (const path of ['/', '/about', '/privacy']) {
    test(`${path} では、自サイトのスクリプトを読み込み、ページの表示を 1 回だけ送る`, async ({ page }) => {
      const w = await watchPage(page);
      const requested = await watchInsights(page);
      await page.goto(path);
      await expect.poll(() => requested).toEqual(['/_vercel/insights/script.js']);
      expect(await pageviews(page)).toEqual([path]);
      expectClean(w);
    });
  }

  for (const path of ['/search', '/import', '/data']) {
    test(`${path} では、スクリプトを読み込まず、何も送らない`, async ({ page }) => {
      const w = await watchPage(page);
      const requested = await watchInsights(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(requested).toEqual([]);
      expect(await pageviews(page)).toEqual([]);
      expectClean(w);
    });
  }

  test('トップから検索ページへ画面内で移動しても、検索ページの表示は送らない', async ({ page }) => {
    await watchPage(page);
    await watchInsights(page);
    await page.goto('/');
    await expect.poll(() => pageviews(page)).toEqual(['/']);
    await page.locator('a[href="/search"]:visible').first().click();
    await expect(page).toHaveURL(/\/search/u);
    await page.waitForLoadState('networkidle');
    expect(await pageviews(page)).toEqual(['/']);
  });
});
