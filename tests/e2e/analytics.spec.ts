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

  // Google アナリティクス 4(TODO # 18)。Vercel Web Analytics と同じく、位置履歴を扱わない 3 ページだけ。
  // Google のスクリプトはこのサイトと同じオリジンで動くため、検索・取り込み・データ管理の HTML には、読み込みも CSP の許可もない。
  const cspOf = (page: Page) => page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');

  for (const path of ['/', '/about', '/privacy']) {
    test(`GA4: ${path} では、Google のスクリプトを読み込み、CSP がそれを許す`, async ({ page }) => {
      const w = await watchPage(page);
      await page.goto(path);
      await expect.poll(() => w.googleRequests.some((u) => u.startsWith('https://www.googletagmanager.com/gtag/js?id=G-'))).toBe(true);
      expect(await cspOf(page)).toContain('https://www.googletagmanager.com');
      // Cookie は保存しない設定
      expect(await page.context().cookies()).toEqual([]);
      expectClean(w);
    });
  }

  for (const path of ['/search', '/import', '/data']) {
    test(`GA4: ${path} では、Google への接続も CSP の許可もない`, async ({ page }) => {
      const w = await watchPage(page);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      expect(w.googleRequests).toEqual([]);
      const csp = await cspOf(page);
      expect(csp).not.toMatch(/google|googletagmanager/u);
      expectClean(w);
    });
  }

  test('GA4: トップから検索ページへ画面内で移動すると、ページを読み直し、Google への許可が外れる', async ({ page }) => {
    const w = await watchPage(page);
    await page.goto('/');
    await expect.poll(() => w.googleRequests.length).toBeGreaterThan(0);
    expect(await cspOf(page)).toContain('googletagmanager');
    await page.locator('a[href="/search"]:visible').first().click();
    await expect(page).toHaveURL(/\/search/u);
    // 読み直されて、検索ページの HTML の CSP になる(Google の許可は無く、Google のスクリプトも外れている)
    await expect.poll(async () => (await cspOf(page)) ?? '').not.toContain('googletagmanager');
    expect(await page.evaluate(() => Boolean((window as unknown as { __gaLoaded?: boolean }).__gaLoaded))).toBe(false);
    expectClean(w);
  });

  test('トップから検索ページへ画面内で移動しても、検索ページの表示は送らない', async ({ page }) => {
    await watchPage(page);
    await watchInsights(page);
    await page.goto('/');
    await expect.poll(() => pageviews(page)).toEqual(['/']);
    await page.locator('a[href="/search"]:visible').first().click();
    await expect(page).toHaveURL(/\/search/u);
    await page.waitForLoadState('networkidle');
    // GA4 の境界(ga-boundary.tsx)でページが読み直されるため、記録は空になる。いずれにせよ、検索ページの表示は含まれない
    expect(await pageviews(page)).not.toContain('/search');
  });
});
