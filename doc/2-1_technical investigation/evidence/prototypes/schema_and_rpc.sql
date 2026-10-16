-- 検証用スキーマ + 検索 RPC 試作(PGlite で実行確認。Supabase 本番スキーマの確定版ではない)
-- 方針: 利用者入力は中間AST(jsonb)としてのみ受け取り、SQL 文字列には固定トークンと整数添字しか埋め込まない。
--       語は text[] として EXECUTE ... USING で渡す(N-10)。

-- ── Supabase の auth.uid() 相当のスタブ ──
create schema if not exists auth;
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- ── 生成列から呼ぶための IMMUTABLE ラッパ ──
-- array_to_string / concat_ws は STABLE 宣言のため生成列に直接使えない(要検証項目: 実際にエラーになるか下で確認)
create or replace function public.immutable_text_array_join(arr text[], sep text) returns text
language sql immutable parallel safe as $$ select array_to_string(arr, sep) $$;

create table public.checkins (
  id          text primary key,
  user_id     uuid not null,
  created_at  timestamptz not null,
  venue_name  text,
  shout       text,
  address     text,
  categories  text[] not null default '{}',
  deleted_at  timestamptz,
  search_text text generated always as (
    lower(normalize(
      coalesce(venue_name, '') || ' ' || coalesce(shout, '') || ' ' || coalesce(address, '') || ' ' ||
      public.immutable_text_array_join(categories, ' '),
    NFKC))
  ) stored
);
create index checkins_user_created_idx on public.checkins (user_id, created_at desc, id desc);

-- ── 中間AST(jsonb) → WHERE 句(SQL 文字列) + 語配列 ──
-- ノード: {"type":"term","value":"..."} / {"type":"and"|"or","children":[...]}
create or replace function public._search_where(p_node jsonb, inout p_terms text[], p_depth int, out p_sql text)
language plpgsql immutable
set search_path = ''
as $$
declare
  v_type   text := p_node->>'type';
  v_child  jsonb;
  v_parts  text[] := '{}';
  v_sub    record;
  v_value  text;
  v_pat    text;
  v_idx    int;
begin
  if p_depth > 8 then
    raise exception 'search query too deep' using errcode = '22023';
  end if;
  if v_type = 'term' then
    v_value := normalize(p_node->>'value', NFKC);
    if v_value is null or btrim(v_value) = '' or char_length(v_value) > 50 then
      raise exception 'invalid search term' using errcode = '22023';
    end if;
    -- LIKE メタ文字をエスケープ(既定のエスケープ文字は \)
    v_pat := '%' || replace(replace(replace(v_value, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_idx := array_position(p_terms, v_pat);
    if v_idx is null then
      p_terms := p_terms || v_pat;
      v_idx := cardinality(p_terms);
      if v_idx > 20 then
        raise exception 'too many search terms' using errcode = '22023';
      end if;
    end if;
    p_sql := format('(search_text ILIKE $1[%s])', v_idx);  -- %s には整数しか入らない
    return;
  elsif v_type in ('and', 'or') then
    if jsonb_typeof(p_node->'children') is distinct from 'array' or jsonb_array_length(p_node->'children') = 0 then
      raise exception 'invalid search group' using errcode = '22023';
    end if;
    for v_child in select value from jsonb_array_elements(p_node->'children') loop
      select * into v_sub from public._search_where(v_child, p_terms, p_depth + 1);
      p_terms := v_sub.p_terms;
      v_parts := v_parts || v_sub.p_sql;
    end loop;
    p_sql := '(' || array_to_string(v_parts, case v_type when 'and' then ' AND ' else ' OR ' end) || ')';
    return;
  else
    raise exception 'invalid search node type' using errcode = '22023';
  end if;
end;
$$;

-- ── 検索 RPC(SECURITY INVOKER: 呼び出しユーザーの権限 + RLS で実行) ──
create or replace function public.search_checkins(
  p_query jsonb,
  p_limit int default 50,
  p_before_created_at timestamptz default null,
  p_before_id text default null
) returns table (id text, created_at timestamptz, venue_name text)
language plpgsql stable
security invoker
set search_path = ''
as $$
declare
  v_where text := 'true';
  v_terms text[] := '{}';
  v_keyset text := '';
  r record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;
  if p_query is not null then
    if octet_length(p_query::text) > 8192 then
      raise exception 'search query too large' using errcode = '22023';
    end if;
    select * into r from public._search_where(p_query, '{}'::text[], 0);
    v_where := r.p_sql;
    v_terms := r.p_terms;
  end if;
  if p_before_created_at is not null then
    v_keyset := ' and (c.created_at, c.id) < ($3, $4)';
  end if;
  return query execute format(
    'select c.id, c.created_at, c.venue_name
       from public.checkins c
      where c.user_id = auth.uid() and c.deleted_at is null and %s%s
      order by c.created_at desc, c.id desc
      limit $2', v_where, v_keyset)
  using v_terms, p_limit, p_before_created_at, p_before_id;
end;
$$;
