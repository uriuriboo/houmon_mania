// ビルド後に、各 HTML へ CSP を <meta http-equiv="Content-Security-Policy"> として埋め込む(基本設計 10.2)。
//
// Next.js の静的書き出しは、ページの HTML にインラインスクリプトを含め、その内容はビルドごとに変わる。
// Vercel の vercel.json はビルドの前に読まれるため、ビルドで変わるハッシュをヘッダに入れられない。そこで、
// インラインスクリプトのハッシュを計算して、各 HTML の先頭に meta の CSP として書き込む。
// meta では効かない frame-ancestors と、ワーカーのスクリプトに付ける CSP は vercel.json のヘッダで付ける。
//
//   node scripts/inject-csp.mjs [outDir]
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] ?? 'out');

/** 画面(HTML)の CSP。外部への通信先は自サイトだけ、画像は自サイトと Foursquare の画像 CDN だけ(P-1、P-7) */
const buildPolicy = (scriptHashes, styleHashes) =>
  [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.map((h) => `'sha256-${h}'`).join(' ')}`.trim(),
    `style-src 'self' ${styleHashes.map((h) => `'sha256-${h}'`).join(' ')}`.trim(),
    "img-src 'self' data: blob: https://*.4sqi.net",
    "connect-src 'self'",
    "worker-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.html') ? [p] : [];
  });

const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('base64');

if (!fs.existsSync(outDir)) {
  console.error(`inject-csp: ${outDir} がありません。先に next build を実行してください。`);
  process.exit(1);
}

const files = walk(outDir);
let problems = 0;
for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/giu, '');

  const scriptHashes = new Set();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    const attrs = m[1];
    if (/\bsrc\s*=/iu.test(attrs)) continue;
    // type="application/json" などのデータブロックは実行されないため不要
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/iu.exec(attrs)?.[1]?.toLowerCase();
    if (type && type !== 'text/javascript' && type !== 'module') continue;
    scriptHashes.add(sha256(m[2]));
  }
  const styleHashes = new Set();
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)) styleHashes.add(sha256(m[1]));

  // style 属性は style-src 'self' では効かない(静的な HTML には含めない方針)
  const styleAttrs = html.match(/<[a-z][^>]*\sstyle\s*=\s*["'][^"']+["']/giu) ?? [];
  if (styleAttrs.length > 0) {
    problems += styleAttrs.length;
    console.warn(`inject-csp: ${path.relative(outDir, file)} に style 属性が ${styleAttrs.length} 個あります(CSP で無視されます): ${styleAttrs[0].slice(0, 120)}`);
  }

  const meta = `<meta http-equiv="Content-Security-Policy" content="${buildPolicy([...scriptHashes], [...styleHashes])}"/>`;
  // 文字コードの指定の直後(なければ <head> の直後)に入れる。どのスクリプトよりも前に置く
  if (/<meta charSet="utf-8"\/?>/iu.test(html)) html = html.replace(/(<meta charSet="utf-8"\/?>)/iu, `$1${meta}`);
  else html = html.replace(/<head([^>]*)>/iu, `<head$1>${meta}`);
  fs.writeFileSync(file, html);
  console.log(`inject-csp: ${path.relative(outDir, file)} (inline scripts: ${scriptHashes.size}, inline styles: ${styleHashes.size})`);
}
if (problems > 0) process.exitCode = 1;
