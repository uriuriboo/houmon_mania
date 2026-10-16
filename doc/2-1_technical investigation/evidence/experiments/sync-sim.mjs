// 差分同期アルゴリズムのシミュレーション (偽 API で方式A / 方式B / 推奨ハイブリッドを比較)
// 偽 API の仕様: createdAt 降順 (同秒は id 降順)、beforeTimestamp=包含 (<=)、afterTimestamp=排他 (>)、
// sort は無視 (ページ内並べ替えのみ: ここでは未使用)、count は常に総数。
// オプション: offsetCap (offset>cap で先頭ページを返す: 報告されている不具合の再現), ignoreBefore/ignoreAfter (未文書化パラメータが黙って無視される場合)

let seq = 0;
const mkId = () => (++seq).toString(16).padStart(24, '0');

class FakeApi {
  constructor(checkins, opt = {}) { this.data = [...checkins]; this.opt = opt; this.calls = 0; this.hooks = []; }
  sorted() { return [...this.data].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1)); }
  list({ limit = 20, offset = 0, beforeTimestamp, afterTimestamp } = {}) {
    this.calls++;
    for (const h of this.hooks.splice(0)) h(this); // 呼び出し中に新規チェックインが入る等
    let rows = this.sorted();
    if (beforeTimestamp !== undefined && !this.opt.ignoreBefore) rows = rows.filter((c) => c.createdAt <= beforeTimestamp);
    if (afterTimestamp !== undefined && !this.opt.ignoreAfter) rows = rows.filter((c) => c.createdAt > afterTimestamp);
    let off = offset;
    if (this.opt.offsetCap !== undefined && off > this.opt.offsetCap) off = 0; // 先頭ページを繰り返す挙動
    return { count: this.data.length, items: rows.slice(off, off + Math.min(limit, 250)) };
  }
}

function makeHistory(n, startTs = 1_300_000_000) {
  const out = []; let t = startTs;
  for (let i = 0; i < n; i++) { t += 600 + ((i * 7919) % 86400); out.push({ id: mkId(), createdAt: t }); if (i % 97 === 0) out.push({ id: mkId(), createdAt: t }); } // 同秒の重複も混ぜる
  return out;
}

// ---- 初回バックフィル ----
function backfillOffset(api) {
  const got = new Map(); let offset = 0;
  for (;;) {
    const r = api.list({ limit: 250, offset });
    if (!r.items.length) break;
    const before = got.size; r.items.forEach((c) => got.set(c.id, c));
    if (got.size === before) return { got, aborted: 'no-progress(offset)' }; // 先頭ページ繰り返し検知
    if (r.items.length < 250) break;
    offset += 250;
  }
  return { got };
}
function backfillBefore(api) {
  const got = new Map(); let cursor;
  for (;;) {
    const r = api.list(cursor === undefined ? { limit: 250 } : { limit: 250, beforeTimestamp: cursor });
    if (!r.items.length) break;
    const before = got.size; r.items.forEach((c) => got.set(c.id, c));
    const oldest = Math.min(...r.items.map((c) => c.createdAt));
    if (got.size === before) { if (cursor !== undefined && oldest >= cursor) return { got, aborted: 'no-progress(before)' }; }
    if (r.items.length < 250) break;
    cursor = oldest; // 包含なので同秒は次ページで再取得 → Map で重複排除
  }
  return { got };
}
// 推奨: beforeTimestamp カーソル主体 + 無視/停滞を検知したら offset にフォールバック
function backfillHybrid(api) {
  const a = backfillBefore(api);
  if (!a.aborted && a.got.size >= api.data.length) return { ...a, strategy: 'before' };
  const b = backfillOffset(api);
  const merged = new Map([...a.got, ...b.got]);
  return { got: merged, strategy: a.aborted ? `before->${b.aborted ?? 'offset'}` : 'before+offset', aborted: b.aborted };
}

// ---- 差分同期 ----
// 方式A: offset で先頭から読み、既知 ID に当たったら停止
function diffA(api, db) {
  const added = []; let offset = 0;
  outer: for (;;) {
    const r = api.list({ limit: 250, offset });
    for (const c of r.items) { if (db.has(c.id)) break outer; added.push(c); }
    if (r.items.length < 250) break;
    offset += 250;
  }
  added.forEach((c) => db.set(c.id, c));
  return added.length;
}
// 方式B: afterTimestamp = DB 最大 createdAt (マージンなし) + beforeTimestamp で遡る
function diffB(api, db, marginSec = 0) {
  const maxTs = Math.max(...[...db.values()].map((c) => c.createdAt));
  const added = []; let cursor;
  for (;;) {
    const p = { limit: 250, afterTimestamp: maxTs - marginSec }; if (cursor !== undefined) p.beforeTimestamp = cursor;
    const r = api.list(p);
    const fresh = r.items.filter((c) => !db.has(c.id) && !added.some((x) => x.id === c.id));
    added.push(...fresh);
    if (r.items.length < 250 || !fresh.length) break;
    cursor = Math.min(...r.items.map((c) => c.createdAt));
  }
  added.forEach((c) => db.set(c.id, c));
  return added.length;
}
// 推奨ハイブリッド: 窓 = DB 最大 createdAt - lookback をクライアント側で強制 (afterTimestamp は最適化として送るだけ)
//                + count 照合で不一致なら全走査 (削除・窓外の遡及チェックイン検出)
function diffHybrid(api, db, lookbackSec = 14 * 86400) {
  const maxTs = Math.max(...[...db.values()].map((c) => c.createdAt));
  const lower = maxTs - lookbackSec;
  const seen = new Map(); let cursor; let count = 0;
  for (;;) {
    const p = { limit: 250, afterTimestamp: lower }; if (cursor !== undefined) p.beforeTimestamp = cursor;
    const r = api.list(p); count = r.count;
    const inWin = r.items.filter((c) => c.createdAt > lower);
    const before = seen.size; inWin.forEach((c) => seen.set(c.id, c));
    if (r.items.length < 250 || inWin.length < r.items.length || seen.size === before) break; // 窓の下限に到達 or 停滞
    cursor = Math.min(...r.items.map((c) => c.createdAt));
  }
  let added = 0; for (const c of seen.values()) { if (!db.has(c.id)) added++; db.set(c.id, c); }
  // 窓内で API から消えたもの = 削除候補 (詳細 API で 'Invalid checkin id' を確認してから論理削除)
  const deletedInWindow = [...db.values()].filter((c) => c.createdAt > lower && !seen.has(c.id)).map((c) => c.id);
  let reconciled = false;
  if (count !== db.size - deletedInWindow.length) { // 窓外の遡及チェックインや削除がある
    const full = backfillHybrid(api); reconciled = true;
    for (const c of full.got.values()) { if (!db.has(c.id)) added++; db.set(c.id, c); }
    for (const id of [...db.keys()]) if (!full.got.has(id)) deletedInWindow.push(id);
  }
  deletedInWindow.forEach((id) => db.delete(id));
  return { added, deleted: [...new Set(deletedInWindow)].length, reconciled };
}

function scenario(name, opt, mutate) {
  seq = 0;
  const base = makeHistory(6000);
  const out = { name };
  // バックフィル比較
  for (const [k, fn] of [['offset', backfillOffset], ['before', backfillBefore], ['hybrid', backfillHybrid]]) {
    const api = new FakeApi(base, opt);
    api.hooks.push((a) => { a.data.push({ id: mkId(), createdAt: Math.max(...a.data.map((c) => c.createdAt)) + 60 }); }); // バックフィル中に新規 1 件
    const r = fn(api);
    out[`backfill_${k}`] = { got: r.got.size, expected: api.data.length, missing: api.data.filter((c) => !r.got.has(c.id)).length, calls: api.calls, note: r.aborted ?? r.strategy ?? '' };
  }
  // 差分同期比較 (DB=完全同期済み状態から、新規・遡及・削除を発生させる)
  for (const [k, fn] of [['A_offset_stop_at_known', diffA], ['B_afterTs_noMargin', diffB], ['H_window14d_plus_count', diffHybrid]]) {
    seq = 100000;
    const api = new FakeApi(base, opt);
    const db = new Map(base.map((c) => [c.id, c]));
    mutate(api);
    const r = fn(api, db);
    const truth = new Set(api.data.map((c) => c.id));
    out[`diff_${k}`] = { result: r, missingInDb: [...truth].filter((id) => !db.has(id)).length, staleDeletedStillInDb: [...db.keys()].filter((id) => !truth.has(id)).length, calls: api.calls };
  }
  return out;
}

const now = (api) => Math.max(...api.data.map((c) => c.createdAt));
// M1: 新規5件 + 3日前の遡及1件 + 2日前の1件を削除
const M1 = (api) => {
  const t = now(api);
  const recent = api.sorted()[1]; api.data = api.data.filter((c) => c.id !== recent.id); // 直近の1件を削除 (窓内)
  for (let i = 0; i < 5; i++) api.data.push({ id: mkId(), createdAt: t + 3600 * (i + 1) });
  api.data.push({ id: mkId(), createdAt: t - 3 * 86400 });
};
// M2: M1 + 400日前の遡及チェックイン (窓外・先頭ページ外) → 件数不一致で全走査が走るか
const M2 = (api) => { M1(api); api.data.push({ id: mkId(), createdAt: now(api) - 400 * 86400 }); };
// M3: M2 + 古いチェックイン1件削除 (窓外の追加と削除が相殺し件数一致 → 定期フル走査が必要なケース)
const M3 = (api) => { M2(api); const old = api.sorted()[3000]; api.data = api.data.filter((c) => c.id !== old.id); };

const results = [];
for (const [mn, m] of [['M1(新規+窓内遡及+窓内削除)', M1], ['M2(+窓外遡及)', M2], ['M3(+窓外削除で件数相殺)', M3]]) {
  results.push(scenario(`API正常 / ${mn}`, {}, m));
}
results.push(scenario('offset が 300 超で先頭ページを返す / M2', { offsetCap: 300 }, M2));
results.push(scenario('beforeTimestamp が黙って無視される / M2', { ignoreBefore: true }, M2));
results.push(scenario('afterTimestamp が黙って無視される / M2', { ignoreAfter: true }, M2));
// 表形式で要約
for (const r of results) {
  const line = (k) => `${k}: missing=${r[k].missingInDb ?? r[k].missing} stale=${r[k].staleDeletedStillInDb ?? '-'} calls=${r[k].calls}${r[k].note ? ' ' + r[k].note : ''}${r[k].result && typeof r[k].result === 'object' ? ' ' + JSON.stringify(r[k].result) : ''}`;
  console.log(`\n## ${r.name}`);
  for (const k of Object.keys(r).filter((k) => k !== 'name')) console.log('  ' + line(k));
}
