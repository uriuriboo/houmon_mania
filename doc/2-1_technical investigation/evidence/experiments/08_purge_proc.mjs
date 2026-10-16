// 08_purge_proc.mjs
// F-42 物理削除バッチの試作: pg_cron から CALL する前提のプロシージャ (バッチごとに COMMIT)
// アカウント単位のソフトデリート (foursquare_accounts.disconnected_at) を前提にした版
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

process.on('unhandledRejection', (e) => { console.error('UNHANDLED:', e?.message ?? e); process.exit(1); });
const db = await PGlite.create();
const q = async (sql, params) => (await db.query(sql, params)).rows;
await db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

await db.exec(`
  create table public.foursquare_accounts (
    user_id uuid primary key,
    fsq_user_id text not null unique,
    token_secret_id uuid,             -- vault.secrets.id (本番)。連携解除時に即削除して null
    connected_at timestamptz not null default now(),
    disconnected_at timestamptz,      -- ソフトデリート (猶予期間の起点)
    last_synced_at timestamptz
  );
  create index foursquare_accounts_disconnected_idx on public.foursquare_accounts (disconnected_at) where disconnected_at is not null;

  -- 失敗例: SET 句付きプロシージャ内の COMMIT
  create or replace procedure private.purge_with_set_clause()
  language plpgsql
  set search_path = ''
  as $$ begin perform 1; commit; end; $$;

  -- 注意: SET 句 (set search_path = '' 等) を付けたプロシージャは COMMIT/ROLLBACK を実行できない (PG 仕様)。
  -- そのため本体の参照はすべてスキーマ修飾し、SET 句は付けない。
  create or replace procedure private.purge_disconnected_checkins(p_batch integer default 5000, p_max_batches integer default 100)
  language plpgsql
  as $$
  declare
    v_deleted integer;
    v_total   bigint := 0;
    v_i       integer := 0;
  begin
    loop
      with doomed as (
        select c.user_id, c.id
          from public.checkins c
          join public.foursquare_accounts a on a.user_id = c.user_id
         where a.disconnected_at < now() - interval '14 days'
         limit p_batch
      )
      delete from public.checkins c using doomed d
       where c.user_id = d.user_id and c.id = d.id;
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;
      v_i := v_i + 1;
      commit;                         -- バッチごとに確定 (長時間トランザクション・ロック回避)
      exit when v_deleted < p_batch or v_i >= p_max_batches;
    end loop;
    -- チェックインが消えたアカウント行も削除 (必要なら auth.users 側の扱いも別途)
    delete from public.foursquare_accounts a
     where a.disconnected_at < now() - interval '14 days'
       and not exists (select 1 from public.checkins c where c.user_id = a.user_id);
    raise notice 'purged % checkins in % batches', v_total, v_i;
  end;
  $$;
`);
const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222';
const gen = readFileSync(new URL('./gen_data.sql', import.meta.url), 'utf8');
await db.exec(gen.replaceAll(':uid', U1).replaceAll(':n', '12000'));
await db.exec(gen.replaceAll(':uid', U2).replaceAll(':n', '3000'));
await q(`insert into public.foursquare_accounts (user_id, fsq_user_id, disconnected_at) values ($1, 'fsq1', now() - interval '15 days'), ($2, 'fsq2', now() - interval '3 days')`, [U1, U2]);
console.log('before:', await q(`select user_id, count(*)::int n from public.checkins group by 1 order by 1`));
try { await db.exec(`call private.purge_with_set_clause()`); console.log('SET 句付きプロシージャで COMMIT: ok'); }
catch (e) { console.log('SET 句付きプロシージャで COMMIT:', e.code, e.message); }
const t0 = performance.now();
const r = await db.query(`call private.purge_disconnected_checkins(5000, 100)`);
console.log(`CALL purge: ${(performance.now() - t0).toFixed(0)}ms`, r.notices?.map?.((n) => n.message) ?? '');
console.log('after:', await q(`select user_id, count(*)::int n from public.checkins group by 1 order by 1`));
console.log('accounts:', await q(`select user_id, disconnected_at is not null as disconnected from public.foursquare_accounts order by 1`));
// トランザクション内からの CALL は COMMIT 不可 (pg_cron はトップレベルで実行するので問題ない想定)
try { await db.exec(`begin; call private.purge_disconnected_checkins(10, 1); commit;`); console.log('CALL inside txn: ok'); }
catch (e) { console.log('CALL inside explicit txn:', e.message); await db.exec('rollback').catch(() => {}); }
await db.close();
