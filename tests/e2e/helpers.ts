import { expect, type Page } from '@playwright/test';

// 1x1 の透明な PNG
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export type Watch = { cspViolations: string[]; consoleErrors: string[]; externalRequests: string[]; googleRequests: string[] };

/**
 * テストの共通準備。
 * - 写真の画像 CDN へのリクエストはローカルで応答する(外部に接続しない)
 * - CSP の違反と、コンソールのエラーを記録する
 * - 自サイトと画像 CDN 以外へのリクエストを記録する(あってはならない)
 * - Google アナリティクスへのリクエストは、別に記録する(位置履歴を扱わない 3 ページだけにある。analytics.spec.ts で確かめる)。スクリプトは空のものを返し、外部に接続しない
 */
export const watchPage = async (page: Page): Promise<Watch> => {
  const w: Watch = { consoleErrors: [], cspViolations: [], externalRequests: [], googleRequests: [] };
  await page.route(/^https:\/\/[a-z0-9-]+\.4sqi\.net\//u, (route) => route.fulfill({ body: PIXEL, contentType: 'image/png', status: 200 }));
  // Vercel Web Analytics のスクリプト(本番では Vercel が /_vercel/insights/ で配信する)。ローカルの配信には無いため、空のものを返す
  await page.route('**/_vercel/insights/**', (route) => route.fulfill({ body: '', contentType: 'text/javascript', status: 200 }));
  await page.route(/^https:\/\/www\.googletagmanager\.com\//u, (route) => route.fulfill({ body: '', contentType: 'text/javascript', status: 200 }));
  page.on('request', (req) => {
    const u = new URL(req.url());
    if (/(^|\.)(googletagmanager\.com|google-analytics\.com|analytics\.google\.com)$/u.test(u.hostname)) {
      w.googleRequests.push(req.url());
      return;
    }
    if (u.hostname !== 'localhost' && !u.hostname.endsWith('.4sqi.net') && u.protocol !== 'data:' && u.protocol !== 'blob:') w.externalRequests.push(req.url());
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') w.consoleErrors.push(msg.text());
  });
  await page.exposeFunction('__reportCsp', (s: string) => w.cspViolations.push(s));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __reportCsp: (s: string) => void }).__reportCsp(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return w;
};

export const expectClean = (w: Watch) => {
  expect(w.cspViolations, 'CSP violations').toEqual([]);
  expect(w.externalRequests, 'external requests').toEqual([]);
  // 404 などのネットワークエラー以外のエラーが無いこと
  expect(w.consoleErrors.filter((e) => !/Failed to load resource/u.test(e)), 'console errors').toEqual([]);
};

/** ZIP を選んで分析し、取り込む */
export const importZip = async (page: Page, zipPath: string) => {
  await page.goto('/import');
  await page.locator('input[type=file][accept*=".zip"]').setInputFiles(zipPath);
  await expect(page.getByRole('button', { name: '取り込む' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '取り込む' }).click();
  await expect(page.getByText('取り込みが完了しました')).toBeVisible({ timeout: 30_000 });
  // 自分のタブの取り込みを「別のタブで実行中」と誤って表示しないこと
  await expect(page.getByText('別のタブで取り込み・削除の実行中です')).toHaveCount(0);
};
