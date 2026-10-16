// 検証2/検証3 用 実地プローブ (GET のみ。書き込み系 API は呼ばない)
// 使い方 (PowerShell):
//   $env:FSQ_TOKEN = "<access_token>"; node probe.mjs .\probe-out
// 出力: probe-out/ に各レスポンス JSON と summary.json を保存 (トークンは保存しない)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKEN = process.env.FSQ_TOKEN;
const OUT = process.argv[2] ?? './probe-out';
const V = process.env.FSQ_V ?? '20260801'; // 固定値。設計で決めた v を入れる
const BASE = 'https://api.foursquare.com/v2';
if (!TOKEN) { console.error('FSQ_TOKEN is not set'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const summary = { v: V, startedAt: new Date().toISOString(), tests: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, params = {}, headers = {}, label = null) {
  const qs = new URLSearchParams({ v: V, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
  const url = `${BASE}${path}?${qs}`;
  const t0 = performance.now();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', ...headers } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const rl = { limit: res.headers.get('x-ratelimit-limit'), remaining: res.headers.get('x-ratelimit-remaining'), reset: res.headers.get('x-ratelimit-reset') };
  let json = null; try { json = JSON.parse(text); } catch {}
  if (label) writeFileSync(join(OUT, `${label}.json`), text);
  await sleep(400); // 500 req/h/トークン を十分下回るよう間隔を空ける
  return { status: res.status, ms, bytes: Buffer.byteLength(text), rl, json, meta: json?.meta };
}
const items = (r) => r.json?.response?.checkins?.items ?? [];
const ids = (r) => items(r).map((x) => x.id);
const ts = (r) => items(r).map((x) => x.createdAt);

// T1: 既定 (limit 未指定) と limit=250, limit=251/500 の挙動
const d = await get('/users/self/checkins', {}, {}, 't1_default');
const l250 = await get('/users/self/checkins', { limit: 250 }, {}, 't1_limit250');
const l251 = await get('/users/self/checkins', { limit: 251 });
const l500 = await get('/users/self/checkins', { limit: 500 });
const total = l250.json?.response?.checkins?.count;
summary.tests.T1_limit = { total, default: items(d).length, l250: items(l250).length, l250_ms: l250.ms, l250_bytes: l250.bytes, l251: { status: l251.status, n: items(l251).length, meta: l251.meta }, l500: { status: l500.status, n: items(l500).length, meta: l500.meta }, rateLimitHeaders: l250.rl };
summary.tests.T1_order_newest_first = ts(l250).every((t, i, a) => i === 0 || a[i - 1] >= t);

// T2: offset 深追い (先頭ページの繰り返しや上限の有無)
const off = {};
for (const o of [250, 500, 1000, 2000, 2500, 2750, 5000, 10000].filter((o) => !total || o < total)) {
  const r = await get('/users/self/checkins', { limit: 250, offset: o });
  const first = items(r)[0];
  off[o] = { status: r.status, n: items(r).length, firstId: first?.id, firstCreatedAt: first?.createdAt, sameAsPage0: first?.id === items(l250)[0]?.id, ms: r.ms };
}
summary.tests.T2_offset = off;

// T3: sort=oldestfirst は「選択」か「並べ替えのみ」か
const s5n = await get('/users/self/checkins', { limit: 5, sort: 'newestfirst' });
const s5o = await get('/users/self/checkins', { limit: 5, sort: 'oldestfirst' });
summary.tests.T3_sort = { newest: ids(s5n), oldest: ids(s5o), oldestIsReverseOfNewest: JSON.stringify(ids(s5o)) === JSON.stringify([...ids(s5n)].reverse()) };

// T4/T5: afterTimestamp / beforeTimestamp の境界 (包含/排他) と count の変化
const pivot = items(l250)[10];
if (pivot) {
  const T = pivot.createdAt;
  const a0 = await get('/users/self/checkins', { limit: 250, afterTimestamp: T });
  const a1 = await get('/users/self/checkins', { limit: 250, afterTimestamp: T - 1 });
  const b0 = await get('/users/self/checkins', { limit: 250, beforeTimestamp: T });
  const b1 = await get('/users/self/checkins', { limit: 250, beforeTimestamp: T - 1 });
  summary.tests.T4_after = { T, pivotId: pivot.id, after_T_includesPivot: ids(a0).includes(pivot.id), after_Tm1_includesPivot: ids(a1).includes(pivot.id), after_T_n: items(a0).length, after_T_count: a0.json?.response?.checkins?.count, minCreatedAt_after_T: Math.min(...ts(a0)) };
  summary.tests.T5_before = { before_T_includesPivot: ids(b0).includes(pivot.id), before_Tm1_includesPivot: ids(b1).includes(pivot.id), before_T_count: b0.json?.response?.checkins?.count, maxCreatedAt_before_T: Math.max(...ts(b0)) };
}

// T6: beforeTimestamp カーソルで 3 ページ歩いて単調減少・重複を確認
{
  let cursor = null; const seen = new Set(); const pages = [];
  for (let i = 0; i < 3; i++) {
    const r = await get('/users/self/checkins', cursor ? { limit: 250, beforeTimestamp: cursor } : { limit: 250 });
    const its = items(r); if (!its.length) break;
    const dup = its.filter((x) => seen.has(x.id)).length; its.forEach((x) => seen.add(x.id));
    const oldest = Math.min(...its.map((x) => x.createdAt));
    pages.push({ n: its.length, dup, newest: Math.max(...its.map((x) => x.createdAt)), oldest, ms: r.ms });
    cursor = oldest; // 包含なら同秒分は次ページで重複 → id で除外
  }
  summary.tests.T6_beforeCursor = pages;
}

// T7: locale (Accept-Language / locale=) による表記差
const lj = await get('/users/self/checkins', { limit: 20 }, { 'Accept-Language': 'ja' }, 't7_lang_ja');
const le = await get('/users/self/checkins', { limit: 20 }, { 'Accept-Language': 'en' }, 't7_lang_en');
const ln = await get('/users/self/checkins', { limit: 20 }, {}, 't7_lang_none');
const pick = (r) => items(r).slice(0, 5).map((x) => ({ id: x.id, name: x.venue?.name, city: x.venue?.location?.city, country: x.venue?.location?.country, cat: x.venue?.categories?.[0]?.name }));
summary.tests.T7_locale = { ja: pick(lj), en: pick(le), none: pick(ln) };

// T8: m=swarm でのキー差分
const ms = await get('/users/self/checkins', { limit: 5, m: 'swarm' }, {}, 't8_m_swarm');
const keysOf = (o) => Object.keys(o ?? {}).sort();
summary.tests.T8_m_swarm = { topKeys_m: keysOf(items(ms)[0]), topKeys_plain: keysOf(items(l250)[0]), locKeys_m: keysOf(items(ms)[0]?.venue?.location), locKeys_plain: keysOf(items(l250)[0]?.venue?.location) };

// T9: 詳細 API を 3 件 (写真あり/コメントありを優先) 取得 → keydiff.mjs で比較
const cand = [...items(l250)].sort((a, b) => (b.comments?.count ?? 0) + (b.photos?.count ?? 0) - (a.comments?.count ?? 0) - (a.photos?.count ?? 0)).slice(0, 3);
summary.tests.T9_details = [];
for (const c of cand) {
  const r = await get(`/checkins/${c.id}`, {}, {}, `t9_detail_${c.id}`);
  summary.tests.T9_details.push({ id: c.id, status: r.status, ms: r.ms, bytes: r.bytes, rl: r.rl, keys: keysOf(r.json?.response?.checkin) });
}
// T10: 存在しない ID の詳細 (削除済み相当のエラー形)
const bad = await get('/checkins/000000000000000000000000');
summary.tests.T10_invalid_id = { status: bad.status, meta: bad.meta };

summary.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
