// out/ をローカルで配信する(本番の Vercel と同じヘッダ・cleanUrls を vercel.json から再現する)。
// CSP を含めた本番相当の動作確認と E2E テストに使う。
//   node scripts/serve-out.mjs [--port 4173]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { port: { type: 'string', default: '4173' } } });
const root = path.resolve('out');
const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

// vercel.json の source("/(.*)" など)を正規表現にする(このプロジェクトで使う書式だけに対応)
const toRegex = (source) =>
  new RegExp(`^${source.split('(.*)').map((s) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('(.*)')}$`, 'u');
const rules = config.headers.map((h) => ({ headers: h.headers, re: toRegex(h.source) }));

const applyHeaders = (res, pathname) => {
  const collected = new Map();
  for (const r of rules) {
    if (!r.re.test(pathname)) continue;
    for (const { key, value } of r.headers) {
      const k = key.toLowerCase();
      // 同じヘッダが複数の規則に一致した場合は、厳しい側に倒して両方送る(CSP は両方が適用される)
      collected.set(k, [...(collected.get(k) ?? []), value]);
    }
  }
  for (const [k, v] of collected) res.setHeader(k, k === 'content-security-policy' ? v : v[v.length - 1]);
};

const resolveFile = (pathname) => {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/u, '');
  const candidates = pathname.endsWith('/') ? [path.join(safe, 'index.html')] : [safe, `${safe}.html`, path.join(safe, 'index.html')];
  for (const c of candidates) {
    const p = path.join(root, c);
    if (!p.startsWith(root)) return null;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = url.pathname;
  // cleanUrls: /foo.html → /foo へリダイレクト
  if (config.cleanUrls && pathname.endsWith('.html')) {
    const clean = pathname === '/index.html' ? '/' : pathname.slice(0, -5);
    res.writeHead(308, { Location: clean + url.search });
    res.end();
    return;
  }
  if (pathname !== '/' && pathname.endsWith('/') && config.trailingSlash === false) {
    res.writeHead(308, { Location: pathname.slice(0, -1) + url.search });
    res.end();
    return;
  }
  applyHeaders(res, pathname);
  let file = resolveFile(pathname);
  let status = 200;
  if (!file) {
    file = path.join(root, '404.html');
    status = 404;
  }
  res.statusCode = status;
  res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

server.listen(Number(values.port), () => console.log(`serving out/ at http://localhost:${values.port}`));
