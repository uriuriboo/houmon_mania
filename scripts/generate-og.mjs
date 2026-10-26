// OGP 画像(1200×630)を public/og.png に作る。SNS で URL を共有したときのプレビューに使う静的な画像。
// 配色は画面と同じ(stone とオレンジ1色)。Swarm / Foursquare のロゴやブランドカラーは使わない(5.5)。
// 文字は実行した環境の日本語フォントで描く。文言や配色を変えたときだけ、実行し直して、できた PNG をコミットする。
//
//   node scripts/generate-og.mjs
import { chromium } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'og.png');

// 足あとのロゴ(public/icon.svg と同じ図形)
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="200" height="200"><rect width="32" height="32" rx="7" fill="#ea580c"/><ellipse cx="11.5" cy="19" rx="3.6" ry="5.2" transform="rotate(-12 11.5 19)" fill="#fff"/><circle cx="8.6" cy="11.2" r="1.3" fill="#fff"/><circle cx="11.6" cy="10.2" r="1.3" fill="#fff"/><circle cx="14.4" cy="11" r="1.2" fill="#fff"/><g fill="#fff" fill-opacity=".85"><ellipse cx="21" cy="14.5" rx="3.3" ry="4.8" transform="rotate(14 21 14.5)"/><circle cx="18.6" cy="7.4" r="1.2"/><circle cx="21.4" cy="6.9" r="1.2"/><circle cx="24" cy="8" r="1.1"/></g></svg>`;

const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; background: #0c0a09; color: #fafaf9; font-family: 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', Meiryo, sans-serif; display: flex; flex-direction: column; justify-content: center; padding: 0 96px; position: relative; }
  .bar { position: absolute; left: 0; top: 0; width: 16px; height: 630px; background: #ea580c; }
  .head { display: flex; align-items: center; gap: 40px; }
  h1 { font-size: 96px; font-weight: 800; letter-spacing: -1px; line-height: 1.1; }
  .ja { font-size: 40px; color: #fdba74; margin-top: 8px; font-weight: 600; }
  .lead { font-size: 48px; font-weight: 700; line-height: 1.45; margin-top: 56px; }
  .sub { font-size: 32px; color: #d6d3d1; margin-top: 24px; }
  .note { position: absolute; left: 96px; bottom: 44px; font-size: 24px; color: #a8a29e; }
</style><body><div class="bar"></div>
  <div class="head">${LOGO}<div><h1>Visit_Mania</h1><div class="ja">足あと検索</div></div></div>
  <div class="lead">Swarm のチェックイン履歴を、<br>店名やコメントで検索</div>
  <div class="sub">データはあなたのブラウザの中だけに保存します</div>
  <div class="note">非公式ツール ・ ログイン不要</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { height: 630, width: 1200 } });
await page.setContent(html);
await page.screenshot({ path: outFile });
await browser.close();
console.log(`generate-og: ${outFile}`);
