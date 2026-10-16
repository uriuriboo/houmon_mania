// Prototype: platform-agnostic rate limiting + grace-period purge implemented in Postgres.
// Runs on PGlite (WASM Postgres) to validate SQL semantics. pg_cron itself is NOT available in PGlite.
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const log = (label, v) => console.log(label.padEnd(58), typeof v === "string" ? v : JSON.stringify(v));

const ver = await db.query("select version()");
log("postgres version:", ver.rows[0].version);

// --- minimal Supabase-like scaffolding ---------------------------------------------------
await db.exec(`
  create schema if not exists auth;
  create schema if not exists private;
  -- emulate auth.uid(): Supabase reads it from the JWT claims of the request
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  -- fixed-window counters (one row per bucket x subject x window)
  create table private.rate_limit_counters (
    bucket       text        not null,
    subject      uuid        not null,
    window_start timestamptz not null,
    hits         integer     not null default 0,
    primary key (bucket, subject, window_start)
  );

  -- returns true if the call is allowed; counts the call atomically (UPSERT)
  create or replace function private.consume_rate_limit(
    p_bucket text, p_subject uuid, p_limit integer, p_window_seconds integer
  ) returns boolean
  language plpgsql
  security definer
  set search_path = ''
  as $$
  declare
    v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
    v_hits integer;
  begin
    insert into private.rate_limit_counters as c (bucket, subject, window_start, hits)
    values (p_bucket, p_subject, v_window, 1)
    on conflict (bucket, subject, window_start)
    do update set hits = c.hits + 1
    returning c.hits into v_hits;
    return v_hits <= p_limit;
  end;
  $$;

  create table public.checkins (
    id          text primary key,
    user_id     uuid not null,
    venue_name  text,
    created_at  timestamptz not null default now(),
    deleted_at  timestamptz
  );

  -- search RPC skeleton: rate limit is enforced INSIDE the DB, keyed by auth.uid()
  create or replace function public.search_checkins(p_limit integer default 20, p_offset integer default 0)
  returns setof public.checkins
  language plpgsql
  security invoker
  as $$
  begin
    if auth.uid() is null then
      raise exception 'not authenticated' using errcode = '28000';
    end if;
    if not private.consume_rate_limit('search', auth.uid(), 30, 60) then
      -- On Supabase/PostgREST, raising sqlstate 'PGRST' with a JSON detail lets you choose the HTTP status (e.g. 429).
      raise exception 'rate limit exceeded' using errcode = 'P0429', hint = 'retry after the current 60s window';
    end if;
    return query
      select * from public.checkins
      where user_id = auth.uid() and deleted_at is null
      order by created_at desc
      limit p_limit offset p_offset;
  end;
  $$;

  -- grace-period purge (F-42): condition-based => idempotent, missed runs self-heal
  create or replace function private.purge_expired_checkins(p_batch integer default 1000, p_max_batches integer default 1000)
  returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
  declare
    v_total integer := 0;
    v_n integer;
    i integer := 0;
  begin
    loop
      delete from public.checkins
      where ctid in (
        select ctid from public.checkins
        where deleted_at is not null and deleted_at < now() - interval '14 days'
        limit p_batch
      );
      get diagnostics v_n = row_count;
      v_total := v_total + v_n;
      i := i + 1;
      exit when v_n = 0 or i >= p_max_batches;
    end loop;
    return v_total;
  end;
  $$;
`);

// --- test 1: rate limit (30 per 60s window per user) --------------------------------------
const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";
await db.exec(`insert into public.checkins (id, user_id, venue_name)
  select 'c'||g, '${userA}', 'venue '||g from generate_series(1,50) g;`);

let allowed = 0, denied = 0, firstDeniedAt = null;
for (let i = 1; i <= 35; i++) {
  try {
    await db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userA]);
      await tx.query(`select count(*) from public.search_checkins(20, 0)`);
    });
    allowed++;
  } catch (e) {
    denied++;
    if (!firstDeniedAt) firstDeniedAt = { call: i, code: e.code, message: e.message };
  }
}
log("[rate-limit] userA 35 calls -> allowed/denied:", { allowed, denied, firstDeniedAt });

// another user is not affected
await db.transaction(async (tx) => {
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userB]);
  const r = await tx.query(`select count(*)::int as n from public.search_checkins(20, 0)`);
  log("[rate-limit] userB first call (independent bucket):", { ok: true, rows: r.rows[0].n });
});

// unauthenticated call is rejected before touching counters
try {
  await db.query(`select * from public.search_checkins(20,0)`);
} catch (e) {
  log("[auth] unauthenticated call ->", { code: e.code, message: e.message });
}

// GET-style (read-only) transaction cannot record a hit -> must call RPC via POST (supabase-js rpc() default)
try {
  await db.transaction(async (tx) => {
    await tx.query(`set transaction read only`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userB]);
    await tx.query(`select count(*) from public.search_checkins(20, 0)`);
  });
  log("[read-only] unexpected success", "");
} catch (e) {
  log("[read-only] RPC inside READ ONLY tx ->", { code: e.code, message: e.message });
}

const counters = await db.query(`select bucket, subject, hits from private.rate_limit_counters order by subject`);
log("[rate-limit] counters:", counters.rows);

// --- test 2: purge expired soft-deleted rows ------------------------------------------------
await db.exec(`
  insert into public.checkins (id, user_id, venue_name, deleted_at)
    select 'old'||g, '${userB}', 'expired', now() - interval '20 days' from generate_series(1,3000) g;
  insert into public.checkins (id, user_id, venue_name, deleted_at)
    select 'grace'||g, '${userB}', 'in grace', now() - interval '3 days' from generate_series(1,1000) g;
`);
const before = await db.query(`select
  count(*) filter (where deleted_at < now() - interval '14 days')::int as expired,
  count(*) filter (where deleted_at >= now() - interval '14 days')::int as in_grace,
  count(*) filter (where deleted_at is null)::int as active from public.checkins`);
log("[purge] before:", before.rows[0]);
const t0 = performance.now();
const purged = await db.query(`select private.purge_expired_checkins(1000) as n`);
log("[purge] purged rows (batch=1000):", { purged: purged.rows[0].n, ms: +(performance.now() - t0).toFixed(1) });
const after = await db.query(`select
  count(*) filter (where deleted_at < now() - interval '14 days')::int as expired,
  count(*) filter (where deleted_at >= now() - interval '14 days')::int as in_grace,
  count(*) filter (where deleted_at is null)::int as active from public.checkins`);
log("[purge] after:", after.rows[0]);
const again = await db.query(`select private.purge_expired_checkins(1000) as n`);
log("[purge] second run (idempotent):", { purged: again.rows[0].n });

await db.close();
