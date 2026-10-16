// 02_search_builder.mjs
// 検証 c: plpgsql で JSON 中間AST を再帰的に辿って WHERE 句を組み立て、EXECUTE format(...) USING で実行
//         LIKE ワイルドカードのエスケープ / 悪意ある JSON の拒否 / RLS・EXECUTE 権限
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

process.on('unhandledRejection', (e) => { console.error('UNHANDLED:', e?.message ?? e); process.exit(1); });

const db = await PGlite.create();
const q = async (sql, params) => (await db.query(sql, params)).rows;

await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
console.log('schema loaded');

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

// ---- サンプルデータ (service_role 相当 = superuser で投入) ----
const rows = [
  // id, user, created_at, venue_name, shout, categories, address, city
  ['a1', U1, '2026-10-01T12:00:00+09:00', 'ラーメン二郎 三田本店', '全マシ', ['ラーメン屋'], '三田2-16-4', '港区'],
  ['a2', U1, '2026-10-02T12:00:00+09:00', 'Ｓｔａｒｂｕｃｋｓ Ｃｏｆｆｅｅ 渋谷店', '新作ﾌﾗﾍﾟﾁｰﾉ', ['カフェ', 'Coffee Shop'], '宇田川町21-6', '渋谷区'],
  ['a3', U1, '2026-10-03T12:00:00+09:00', '渋谷 一蘭', null, ['ラーメン屋'], '神南1-22-7', '渋谷区'],
  ['a4', U1, '2026-10-04T12:00:00+09:00', 'セール会場', '１００％OFF!!', ['ショップ'], null, '新宿区'],
  ['a5', U1, '2026-10-05T12:00:00+09:00', 'セール会場2', '100xOFF', ['ショップ'], null, '新宿区'],
  ['a6', U1, '2026-10-06T12:00:00+09:00', 'snake_case cafe', null, ['カフェ'], null, null],
  ['a7', U1, '2026-10-07T12:00:00+09:00', 'snakeXcase cafe', null, ['カフェ'], null, null],
  ['a8', U1, '2026-10-08T12:00:00+09:00', 'C:\\path\\cafe', null, ['カフェ'], null, null],
  ['a9', U1, '2026-10-09T12:00:00+09:00', "O'Reilly Bar", "x') OR 1=1 --", ['バー'], null, null],
  ['b1', U2, '2026-10-01T12:00:00+09:00', '渋谷 ラーメン 他人', null, ['ラーメン屋'], null, '渋谷区'],
];
for (const [id, uid, ts, vn, shout, cats, addr, city] of rows) {
  await db.query(
    `insert into public.checkins (id, user_id, created_at, venue_name, shout, categories, address, city, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, uid, ts, vn, shout, cats, addr, city, JSON.stringify({ id, venue: { name: vn } })]
  );
}
console.log('inserted', rows.length, 'rows');

// ---- ヘルパ ----
const asUser = async (uid, fn) => {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: uid, role: 'authenticated' })}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`); }
};
const search = (ast, limit = 50, offset = 0) =>
  q(`select id, venue_name, total_count from public.search_checkins($1::jsonb, $2, $3)`, [JSON.stringify(ast), limit, offset]);
const debug = async (ast) => (await q(`select where_sql, terms from private.search_debug($1::jsonb)`, [JSON.stringify(ast)]))[0];
const T = (value) => ({ type: 'term', value });
const AND = (...children) => ({ type: 'and', children });
const OR = (...children) => ({ type: 'or', children });

// ---- c-1: 生成される WHERE 句 ----
console.log('\n== c-1: AST -> WHERE 句 ==');
const ast1 = OR(T('ラーメン'), AND(T('ｶﾌｪ'), T('渋谷')));
console.log('AST :', JSON.stringify(ast1));
console.log('SQL :', await debug(ast1));
const ast2 = AND(OR(T('A'), T('B')), OR(T('C'), AND(T('D'), T('E'))));
console.log('AST2:', JSON.stringify(ast2));
console.log('SQL2:', await debug(ast2));

// ---- c-2: 実行 (U1 として) ----
console.log('\n== c-2: 実行結果 (authenticated, sub=U1) ==');
await asUser(U1, async () => {
  console.log('ラーメン OR (ｶﾌｪ AND 渋谷):', await search(ast1));
  console.log('渋谷 (他人の b1 が混ざらないこと):', await search(T('渋谷')));
  console.log('STARBUCKS (全角データを半角大文字で):', await search(T('STARBUCKS')));
  console.log('フラペチーノ (半角カナデータを全角で):', await search(T('フラペチーノ')));
  console.log('ページング limit=1 offset=1 (total_count は全件数):', await search(T('渋谷'), 1, 1));
});

// ---- c-3: LIKE ワイルドカードのエスケープ ----
console.log('\n== c-3: ワイルドカードのエスケープ ==');
await asUser(U1, async () => {
  console.log("'100%'      ->", await search(T('100%')), '(a4 のみ。a5 "100xOFF" にマッチしないこと)');
  console.log("'１００％' 全角 ->", await search(T('１００％')), '(NFKC 後に % になるが、正規化→エスケープの順なのでリテラル扱い)');
  console.log("'snake_case'->", await search(T('snake_case')), '(a6 のみ。a7 snakeXcase にマッチしないこと)');
  console.log("'c:\\path'   ->", await search(T('c:\\path')), '(a8)');
  console.log("'\\'         ->", await search(T('\\')), '(バックスラッシュ単体)');
  console.log("x') OR 1=1 -- ->", await search(T("x') OR 1=1 --")), '(リテラルとして a9 のみ)');
  console.log("O'Reilly    ->", await search(T("O'Reilly")));
});
// 誤った順序 (エスケープ→正規化) だと全角％がワイルドカードになることのデモ
const wrong = await q(`
  select count(*)::int as n from public.checkins c
  where c.user_id = $1 and c.search_text like '%' || private.normalize_for_search(replace(replace(replace($2,'\\','\\\\'),'%','\\%'),'_','\\_')) || '%'`,
  [U1, '１００％ＯＦＦ'.replace('ＯＦＦ', '')]);
console.log("誤順序(エスケープ→正規化) で '１００％' を検索した件数:", wrong[0].n, '(2 なら % がワイルドカード化して a5 まで誤マッチ)');

// ---- c-4: 悪意ある/不正な JSON の拒否 ----
console.log('\n== c-4: 不正 AST の拒否 ==');
let deep = T('x');
for (let i = 0; i < 1000; i++) deep = AND(deep);
const many = OR(...Array.from({ length: 100000 }, (_, i) => T('t' + i)));
const seventeen = OR(...Array.from({ length: 4 }, () => AND(T('a'), T('b'), T('c'), T('d'), T('e'))));
const badCases = [
  ['未知の type (not)', { type: 'not', children: [T('a')] }],
  ['未知の type (SQL 断片)', { type: "term') OR (1=1", value: 'a' }],
  ['field 指定 (liqe Tag 相当)', { type: 'field', field: 'venue', value: 'a' }],
  ['value が数値', { type: 'term', value: 123 }],
  ['value がオブジェクト', { type: 'term', value: { a: 1 } }],
  ['value 欠落', { type: 'term' }],
  ['空文字', T('   ')],
  ['制御文字 (改行 = フィールド区切り)', T('ラーメン\n港区')],
  ['長すぎる語 (101文字)', T('あ'.repeat(101))],
  ['children が配列でない', { type: 'and', children: { a: 1 } }],
  ['children が空', AND()],
  ['ルートが配列', [T('a')]],
  ['ルートが文字列', 'a'],
  ['入れ子 1000 段', deep],
  ['children 10万件', many],
  ['語が 20 個 (上限16)', seventeen],
];
await asUser(U1, async () => {
  for (const [label, ast] of badCases) {
    const t0 = performance.now();
    try {
      const r = await search(ast);
      console.log(`[NG: 受理された] ${label}: ${JSON.stringify(r).slice(0, 100)}`);
    } catch (e) {
      console.log(`[拒否] ${label}: ${e.code} ${e.message} (${(performance.now() - t0).toFixed(1)}ms)`);
    }
  }
});

// ---- c-4b: 入れ子の深さ別 (PGlite の WASM スタック限界の切り分け) ----
console.log('\n== c-4b: 入れ子の深さ別 ==');
const nest = (n) => { let x = T('x'); for (let i = 0; i < n; i++) x = AND(x); return x; };
await asUser(U1, async () => {
  for (const n of [7, 8, 9, 50, 100, 200, 400, 600]) {
    const t0 = performance.now();
    try {
      const r = await search(nest(n));
      console.log(`depth(and段数)=${n}: 受理 rows=${r.length} (${(performance.now() - t0).toFixed(1)}ms)`);
    } catch (e) {
      console.log(`depth(and段数)=${n}: ${e.code ?? ''} ${e.message} (${(performance.now() - t0).toFixed(1)}ms)`);
    }
  }
  // jsonb パースのみ (関数を通さない) で深い入れ子が通るか
  for (const n of [100, 200, 400, 600, 1000]) {
    try {
      const r = await q(`select jsonb_typeof($1::jsonb) t`, [JSON.stringify(nest(n))]);
      console.log(`jsonb parse only depth=${n}: ok (${r[0].t})`);
    } catch (e) {
      console.log(`jsonb parse only depth=${n}: ${e.code ?? ''} ${e.message}`);
    }
  }
});
// WASM スタック溢れ後もインスタンスが使えるか
console.log('after overflow, select 1 =>', (await q('select 1 as x'))[0].x);

// ---- c-5: RLS と EXECUTE 権限 ----
console.log('\n== c-5: RLS / 権限 ==');
await asUser(U1, async () => {
  console.log('U1 で select count(*) from checkins:', (await q('select count(*)::int n from public.checkins'))[0].n, '(U1 の 9 件のみ見えること)');
});
await asUser(U2, async () => {
  console.log('U2 で 渋谷 検索:', await search(T('渋谷')));
});
// anon は EXECUTE 不可
await db.exec(`set role anon`);
try { await search(T('渋谷')); console.log('[NG] anon が実行できた'); }
catch (e) { console.log('anon で search_checkins:', e.code, e.message); }
await db.exec(`reset role`);
// JWT 無し (sub 無し) の authenticated
await db.exec(`set role authenticated; select set_config('request.jwt.claims', '', false);`);
try { console.log('sub 無しの authenticated:', await search(T('渋谷'))); }
catch (e) { console.log('sub 無し:', e.message); }
await db.exec(`reset role`);

// ---- c-6: 生成列が参照する関数の EXECUTE を PUBLIC から revoke した場合の INSERT ----
console.log('\n== c-6: 生成列関数の EXECUTE 権限 ==');
await db.exec(`revoke all on function private.immutable_array_to_string(text[], text) from public;`);
await db.exec(`set role service_role`);
try {
  await db.query(`insert into public.checkins (id, user_id, created_at, venue_name, raw) values ('s1', $1, now(), 'x', '{}')`, [U1]);
  console.log('service_role INSERT: 成功 (EXECUTE 権限なしでも可)');
} catch (e) {
  console.log('service_role INSERT:', e.code, e.message);
}
await db.exec(`reset role`);
// EXECUTE のみ付与 (schema private の USAGE なし)
await db.exec(`grant execute on function private.immutable_array_to_string(text[], text) to service_role;`);
await db.exec(`set role service_role`);
try {
  await db.query(`insert into public.checkins (id, user_id, created_at, venue_name, raw) values ('s2', $1, now(), 'x', '{}')`, [U1]);
  console.log('service_role INSERT (EXECUTE のみ付与, schema USAGE なし): 成功');
} catch (e) {
  console.log('service_role INSERT (EXECUTE のみ付与):', e.code, e.message);
}
await db.exec(`reset role`);
// 生成列の再計算は UPDATE でも起きる: authenticated に UPDATE 権限は無いが、service_role で categories 更新
await db.exec(`set role service_role`);
try {
  await db.query(`update public.checkins set categories = array['テスト'] where id = 's2'`);
  console.log('service_role UPDATE categories: 成功 ->', (await q(`select search_text from public.checkins where id='s2'`))[0].search_text);
} catch (e) {
  console.log('service_role UPDATE:', e.code, e.message);
}
await db.exec(`reset role`);

// ---- c-7: EXPLAIN (RLS + InitPlan) ----
console.log('\n== c-7: EXPLAIN (authenticated, U1) ==');
await asUser(U1, async () => {
  const plan = await q(`explain (costs off) select * from public.checkins c where c.search_text like '%渋谷%' order by created_at desc limit 50`);
  console.log(plan.map((r) => r['QUERY PLAN']).join('\n'));
});

await db.close();
