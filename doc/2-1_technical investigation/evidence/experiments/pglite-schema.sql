-- schema.sql : PGlite 検証用スキーマ (Supabase のマイグレーション案のたたき台)
-- 注意: PGlite には Supabase の auth スキーマ / ロールが無いので、最小限を模擬している。

-- ===== Supabase 環境の模擬 (本番では不要) =====
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- ===== ここから本番マイグレーション案 =====
create schema if not exists private;
revoke all on schema private from public;

-- text[] 連結の IMMUTABLE ラッパー (array_to_string は STABLE のため生成列で直接使えない)
create or replace function private.immutable_array_to_string(arr text[], sep text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select pg_catalog.array_to_string(arr, sep) $$;

-- 検索用正規化 (データ側・クエリ側で同一関数を使う)
-- 注意: pg_catalog.normalize(s, NFKC) と「修飾+キーワード」で書くと NFKC が列名扱いになりエラー
create or replace function private.normalize_for_search(s text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$ select pg_catalog.lower(pg_catalog.normalize(coalesce(s, ''), 'NFKC')) $$;

create table if not exists public.checkins (
  id          text        not null,          -- Foursquare checkin id
  user_id     uuid        not null,          -- 本番: references auth.users(id) on delete cascade
  created_at  timestamptz not null,
  tz_offset   integer,
  shout       text,
  venue_id    text,
  venue_name  text,
  categories  text[]      not null default '{}',
  address     text,
  city        text,
  state       text,
  country     text,
  lat         double precision,
  lng         double precision,
  photo_count integer     not null default 0,
  raw         jsonb       not null,
  deleted_at  timestamptz,
  -- フィールド区切りは改行。語がフィールド境界をまたいでマッチしない (語側で制御文字を拒否する前提)
  search_text text generated always as (
    lower(normalize(
      coalesce(venue_name, '') || E'\n' ||
      coalesce(shout, '')      || E'\n' ||
      coalesce(address, '')    || E'\n' ||
      coalesce(city, '')       || E'\n' ||
      coalesce(state, '')      || E'\n' ||
      coalesce(country, '')    || E'\n' ||
      private.immutable_array_to_string(categories, E'\n')
    , NFKC))
  ) stored,
  primary key (user_id, id)
);
-- 日時降順ページング用 (RLS の user_id 条件 + ORDER BY をこの 1 本で満たす)
create index if not exists checkins_user_created_idx
  on public.checkins (user_id, created_at desc, id desc);

alter table public.checkins enable row level security;
drop policy if exists checkins_select_own on public.checkins;
create policy checkins_select_own on public.checkins
  for select to authenticated
  using ((select auth.uid()) = user_id);
-- 2026-10-30 以降の Supabase では新規テーブルに自動 GRANT されないため明示する
grant select on public.checkins to authenticated;
grant select, insert, update, delete on public.checkins to service_role;

-- ===== AST -> WHERE 句ビルダー (再帰) =====
-- ノード: {"type":"and"|"or","children":[...]} / {"type":"term","value":"..."}
-- 返り値: p_sql = 'c.search_text LIKE $1[n]' を AND/OR/括弧で組んだ文字列、p_terms = パラメータ配列
-- SQL 文字列に入るのは固定断片と整数 n のみ。ユーザー入力は p_terms 経由で USING に渡す。
create or replace function private.search_ast_to_sql(
  p_node  jsonb,
  p_depth integer,
  inout p_terms text[],
  out   p_sql   text
)
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_max_depth    constant integer := 8;
  c_max_terms    constant integer := 16;
  c_max_children constant integer := 16;
  c_max_len      constant integer := 100;
  v_type   text;
  v_raw    text;
  v_norm   text;
  v_child  jsonb;
  v_parts  text[] := '{}';
  v_csql   text;
begin
  if p_depth > c_max_depth then
    raise exception 'search query too deeply nested (max %)', c_max_depth using errcode = '22023';
  end if;
  if p_node is null or pg_catalog.jsonb_typeof(p_node) <> 'object' then
    raise exception 'invalid search node' using errcode = '22023';
  end if;

  v_type := p_node ->> 'type';

  if v_type = 'term' then
    if pg_catalog.jsonb_typeof(p_node -> 'value') is distinct from 'string' then
      raise exception 'term value must be a string' using errcode = '22023';
    end if;
    v_raw := p_node ->> 'value';
    if pg_catalog.length(v_raw) > c_max_len then
      raise exception 'search term too long (max % chars)', c_max_len using errcode = '22023';
    end if;
    -- 正規化 -> 制御文字チェック -> エスケープ の順 (NFKC で ％＿＼ が % _ \ になるため、エスケープは必ず正規化の後)
    v_norm := pg_catalog.btrim(private.normalize_for_search(v_raw));
    if v_norm = '' then
      raise exception 'empty search term' using errcode = '22023';
    end if;
    if v_norm ~ '[[:cntrl:]]' then
      raise exception 'search term contains control characters' using errcode = '22023';
    end if;
    v_norm := pg_catalog.replace(v_norm, '\', '\\');
    v_norm := pg_catalog.replace(v_norm, '%', '\%');
    v_norm := pg_catalog.replace(v_norm, '_', '\_');
    p_terms := pg_catalog.array_append(p_terms, '%' || v_norm || '%');
    if pg_catalog.cardinality(p_terms) > c_max_terms then
      raise exception 'too many search terms (max %)', c_max_terms using errcode = '22023';
    end if;
    p_sql := pg_catalog.format('c.search_text LIKE $1[%s]', pg_catalog.cardinality(p_terms));

  elsif v_type in ('and', 'or') then
    if pg_catalog.jsonb_typeof(p_node -> 'children') is distinct from 'array' then
      raise exception 'children must be an array' using errcode = '22023';
    end if;
    if pg_catalog.jsonb_array_length(p_node -> 'children') not between 1 and c_max_children then
      raise exception 'children count must be 1..%', c_max_children using errcode = '22023';
    end if;
    for v_child in select e from pg_catalog.jsonb_array_elements(p_node -> 'children') as t(e) loop
      select r.p_terms, r.p_sql into p_terms, v_csql
        from private.search_ast_to_sql(v_child, p_depth + 1, p_terms) as r;
      v_parts := pg_catalog.array_append(v_parts, v_csql);
    end loop;
    p_sql := '(' || pg_catalog.array_to_string(v_parts, case v_type when 'and' then ' AND ' else ' OR ' end) || ')';

  else
    -- 未知の type (not / field / range 等) は明示的に拒否 (F-26)
    raise exception 'unsupported search node type' using errcode = '22023';
  end if;
end;
$$;

-- ===== 検索 RPC (security invoker: RLS がそのまま効く) =====
create or replace function public.search_checkins(
  p_ast    jsonb,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id          text,
  created_at  timestamptz,
  venue_name  text,
  categories  text[],
  shout       text,
  photo_count integer,
  total_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_terms text[] := '{}';
  v_where text;
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'limit must be 1..100' using errcode = '22023';
  end if;
  if p_offset is null or p_offset not between 0 and 100000 then
    raise exception 'offset out of range' using errcode = '22023';
  end if;

  select r.p_terms, r.p_sql into v_terms, v_where
    from private.search_ast_to_sql(p_ast, 1, v_terms) as r;

  return query execute pg_catalog.format($q$
    select c.id, c.created_at, c.venue_name, c.categories, c.shout, c.photo_count,
           count(*) over () as total_count
      from public.checkins c
     where c.user_id = (select auth.uid())
       and c.deleted_at is null
       and %s
     order by c.created_at desc, c.id desc
     limit $2 offset $3
  $q$, v_where)
  using v_terms, p_limit, p_offset;
end;
$$;

-- デバッグ用: 組み立てた WHERE 句とパラメータを返す (本番では作らない/公開しない)
create or replace function private.search_debug(p_ast jsonb, out where_sql text, out terms text[])
language plpgsql immutable set search_path = ''
as $$
begin
  terms := '{}';
  select r.p_terms, r.p_sql into terms, where_sql from private.search_ast_to_sql(p_ast, 1, terms) as r;
end;
$$;

-- ===== EXECUTE 権限の絞り込み =====
revoke all on function private.search_ast_to_sql(jsonb, integer, text[]) from public;
revoke all on function private.search_debug(jsonb) from public;
revoke all on function public.search_checkins(jsonb, integer, integer) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.search_ast_to_sql(jsonb, integer, text[]) to authenticated;
grant execute on function public.search_checkins(jsonb, integer, integer) to authenticated;
-- 生成列が参照する関数: PUBLIC から revoke すると INSERT するロールに EXECUTE が必要になる (検証 02 で確認)
