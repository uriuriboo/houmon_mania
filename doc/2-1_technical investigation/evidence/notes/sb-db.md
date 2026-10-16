# 調査メモ sb-db: Supabase(Postgres) 側の設計要素の事実確認と実機検証

- 作成日: 2026-10-16
- 対象要件: F-02, F-13, F-21〜F-24, F-40〜F-42, N-01〜N-05, N-10, L-01〜L-06 / 着手事項 検証6
- 調査環境: Windows 11 / Node v20.11.1 / PGlite 0.5.10 (**PostgreSQL 18.6**, wasm32) / Supabase CLI 2.121.0 (npm devDependency)
- 実験ディレクトリ: `scratchpad\sb-db-pglite\`（PGlite 検証）, `scratchpad\sb-db-cli\`（CLI 検証）
- **重要な注意**: PGlite の結果は WASM・シングルプロセス・PG18・ロケール `C.UTF-8`(libc) のもの。Supabase 本番は PG17.x・ネイティブ・ICU `en-US` で、性能・ロケール依存の挙動（lower()/pg_trgm の文字分類）に差がありうる。
- Docker が無いため `supabase start`（ローカルスタック）は起動できていない。Vault / pg_cron / Auth Admin API のローカル実機確認は「未確定事項」に手順を残した。

---

## 0. 結論サマリ（設計判断に効くもの）

1. **Data API の既定 GRANT 廃止**（新規プロジェクトは 2026-05-30 から、既存プロジェクトも **2026-10-30** から）。`public` に作ったテーブルは anon/authenticated/service_role に自動 GRANT されなくなる。マイグレーションでテーブルごとに GRANT を明示する必要がある。一方、**関数の EXECUTE は PostgreSQL の既定で PUBLIC に付く**ので、RPC 関数ごとに `revoke ... from public, anon` が必須。`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` は**効かない**（PG の仕様。PGlite でも確認済み。Supabase の Hardening ドキュメントにはこの文が載っている）。
2. **Vault は pgsodium に依存しなくなった**（vault 0.3.x、公式ドキュメントにも明記）。暗号鍵はプロジェクトごとのルートキー（DB の外に置かれる）。`service_role` には vault スキーマの USAGE、secrets/decrypted_secrets の SELECT/DELETE、create/update_secret の EXECUTE が付与済み（supabase/postgres の初期マイグレーション）。`vault` スキーマは Data API に公開されないので、**service_role だけが EXECUTE できるラッパー RPC** を `public` に置く形になる。トークンを読む RPC を authenticated に開放すると N-02 違反になる。ローカルの鍵はコンテナ初回起動時に /dev/urandom から生成されるため、本番とは別の鍵になる（L-06 は自然に満たす。ただし Supabase CLI の実機では未確認）。
3. **生成列**: `lower(normalize(..., NFKC))` と、IMMUTABLE ラッパー経由の `text[]` 連結を使った **STORED 生成列は作成できる**（PGlite で確認）。`array_to_string` を直接書くと `generation expression is not immutable` で失敗する。落とし穴が 2 つある。① `pg_catalog.normalize(s, NFKC)` と「スキーマ修飾＋キーワード形式」で書くと `column "nfkc" does not exist` になる（`normalize(s, NFKC)` か `pg_catalog.normalize(s, 'NFKC')` と書く）。② PG18 では生成列の既定が VIRTUAL で、VIRTUAL ではユーザー定義関数を使えないため、`STORED` を必ず明示する。
4. **エスケープは NFKC の後で行う**: NFKC で全角の `％＿＼` や `﹪﹨` が `% _ \` に変わる。エスケープを先にして後から正規化すると、全角％がワイルドカードとして効いてしまう（PGlite で誤マッチを再現）。また `İ` の lower() 結果が JS と PG で異なる。そのため**クエリ語の正規化は DB 側で、データ側と同じ関数を使う**こと。
5. **plpgsql による AST→WHERE の組み立てと `EXECUTE format(...) USING terms` は動作する**（PGlite）。SQL 文字列に入るのは固定断片と整数添字 `$1[n]` だけにした。未知の type、非文字列の value、空語、制御文字、101 文字超の語、深さ超過、子要素 10 万件、語数超過はすべて 22023 で拒否できた。SQL 断片を含む語はリテラルとして扱われた。RPC は authenticated なら誰でも任意の JSON で直接呼べるため、**検証は DB 側で必須**。
6. **性能（PGlite 参考値）**: 1 ユーザー 3 万件を user_id インデックス＋LIKE フィルタで処理すると 50〜300 ms。**ILIKE は LIKE の 2.5〜4.5 倍遅い**。UTF-8 DB の ILIKE は行ごとに lower() を呼ぶためで、正規化済み列には LIKE を使うのがよい。**raw(約 1.2 KB) を同じ行に持つとヒープが約 4 倍**（94 MB→24 MB）になり、走査ページ数が増える。対策は raw の別テーブル化、または被覆インデックス `INCLUDE (search_text)` と 2 段階クエリ。`toast_tuple_target=256` は 2 KB 未満の行には効かなかった。
7. **pg_trgm と日本語**: PGlite では CJK からトライグラムを抽出できた（漢字・かな・「ー」「々」は語文字、「・」は非語文字）。ただし **1〜2 文字の語（駅・渋谷・寿司など）は抽出できるトライグラムが無く、インデックス全件走査に退化する**。また per-user 検索ではプランナが GIN を選ばなかった。**MVP では trigram インデックス不要**。pg_bigm は Supabase に無い（PGroonga はある）。Supabase 本番 PG17 は ICU `en_US.UTF-8` で initdb され、`LC_CTYPE=en_US.UTF-8`（ビルドスクリプトから推定）。
8. **Windows のローカル開発**: Supabase CLI 2.121.0 は npm devDependency で Windows でも動く（`supabase init` を実行して確認）。ただし `supabase start` は Docker か Podman が無いと即エラーになる（実測）。2026-10-14 発表の Docker 不要「native runtime」は **Linux(glibc≥2.35)/macOS 14+ のみ**（実験的機能）。L-01 の「Docker Compose ベース」という表現は不正確な可能性がある。CLI が docker/podman を使って自分でコンテナを起動・管理し、利用者は compose ファイルを書かない（第三者記事では「CLI が Compose 相当の構成を管理する」とされ、公式の明確な記述は見当たらない＝推測）。要件の本質は「Docker 互換ランタイムが必須」という点。

---

## 1. Supabase Vault（F-02, N-02, L-06）

### 1.1 API（supabase/vault リポジトリ `sql/supabase_vault--0.3.0.sql` より。0.3.1 は SQL 変更なし）
```sql
vault.create_secret(new_secret text, new_name text = NULL, new_description text = '', new_key_id uuid = NULL) returns uuid  -- SECURITY DEFINER, search_path=''
vault.update_secret(secret_id uuid, new_secret text = NULL, new_name text = NULL, new_description text = NULL, new_key_id uuid = NULL) returns void
-- new_key_id は「unused」とコメントされている (0.3.0 以降は固定 key_id=0 + 行ごとの nonce)
vault.secrets            -- id uuid PK, name (NULL でない場合は一意), description, secret(base64 暗号文), key_id, nonce, created_at, updated_at
vault.decrypted_secrets  -- 参照時に復号するビュー (decrypted_secret 列)。AEAD の追加データに行の id を使うため、別行へコピーすると復号に失敗する
REVOKE ALL ON FUNCTION vault._crypto_aead_det_*, vault.create_secret, vault.update_secret FROM PUBLIC;
```
- 削除用の専用関数は無い。`delete from vault.secrets where id = ...` で消す（postgres と service_role に DELETE 権限あり。1.3 参照）。
- 制御ファイルは `default_version = '0.3.1'`、`module_pathname = '$libdir/supabase_vault'`。暗号関数は `AS 'MODULE_PATHNAME', 'pgsodium_crypto_aead_det_encrypt_by_id'` で、Vault 自身の共有ライブラリに含まれる（関数名は pgsodium 由来）。

### 1.2 pgsodium 非推奨化の影響
- 公式の pgsodium ページ: 「Supabase **does not recommend** the usage of pgsodium as it will be deprecated. Use Supabase Vault instead.」「Vault doesn't depend on pgsodium and is not affected by this deprecation.」
- アップグレードスクリプト 0.2.8→0.3.0 は、key_id の FK、デフォルト値、暗号化トリガー、pgsodium の SECURITY LABEL を除去している。**TCE(透過的列暗号化) と pgsodium の鍵管理機能は使わない**こと（公式に非推奨）。
- Vault と pgsodium は同じ形式・同じ場所のプロジェクトルートキーを共有している。

### 1.3 権限（supabase/postgres `migrations/db/migrations/20221207154255_create_pgsodium_and_vault.sql`）
- `postgres`(WITH GRANT OPTION): vault スキーマ USAGE、vault.secrets / decrypted_secrets の SELECT・DELETE・TRUNCATE・REFERENCES、create_secret / update_secret / _crypto_aead_det_decrypt の EXECUTE
- `service_role`: vault スキーマ USAGE、secrets / decrypted_secrets の SELECT・DELETE、create_secret / update_secret / _crypto_aead_det_decrypt の EXECUTE
- `anon` / `authenticated`: 付与なし
- `vault` スキーマは Data API の公開スキーマ（既定は `public`, `graphql_public`）に含まれない。コミュニティでは「vault を公開スキーマに加えるな」との回答がある。
- 公式 RLS ドキュメント: security definer 関数を公開スキーマに作るな（Data API から作成者権限で呼べてしまう）。
- → 定石は 2 案。
  - (a) `public` に **security invoker** のラッパーを置き、EXECUTE を **service_role のみ**にする。service_role 自身が vault 権限を持つので invoker で足りる。
  - (b) `private` スキーマに security definer の実体を置き、public の invoker 関数から呼ぶ。
  - トークンを返す関数を authenticated に開放しないこと（N-02）。

### 1.4 鍵管理（L-06）とバックアップ
- 公式 Vault ドキュメントの記述:
  - 暗号鍵は DB と同じ場所には保存されない。Supabase がプロジェクトごとに一意の鍵を管理する。
  - Management API が 64 桁 hex のルートキーを返す（`/v1/projects/{ref}/pgsodium`、PUT で設定も可能）。
  - 手動の pg_dump/pg_restore で新プロジェクトへ移すと新しい鍵になり、旧鍵をコピーするまで復号できない。
  - Branching やプロジェクト間リストアでは鍵がコピーされる。
- ルートキーのローテーション（トラブルシューティング記事）: Management API の PUT で行うが、**ローテーション後は旧データを復号できない**。Vault のシークレットは再登録が必要になる。この設計では全ユーザーの再連携に相当する。
- CLI 2.121.0 には `supabase encryption get-root-key --project-ref` / `update-root-key` がある（リモートプロジェクトのルートキー操作。`cli-help-encryption.txt`）。
- CLI リファレンスによると、`supabase migration squash` はデータ文を落とすため、Vault の暗号化シークレットは手で入れ直す必要がある。
- Docker イメージ側: `pgsodium_getkey_urandom.sh` が `/etc/postgresql-custom/pgsodium_root.key` が無ければ `/dev/urandom` の 32 バイトで生成する。`vault.getkey_script` も同じスクリプトを指している（`Dockerfile-17`）。
  - self-hosted のガイドでは、この鍵は db-config の名前付きボリュームにあり、ボリュームを消すと Vault の内容は復元不能になるとしている。
  - → **ローカルと本番は別の鍵**になる（L-06）。CLI のローカルスタックでボリューム名が具体的に何かは未確認（推測）。
- `config.toml` の `[db.vault]`（例 `secret_key = "env(SECRET_VALUE)"`）について、CLI 2.121.0 の `db push --help` は「**Vault secrets from config.toml are updated before migrations unless --skip-vault is set.**」と表示する。→ ローカル用の値を `[db.vault]` に書いて `db push` すると、**本番 Vault の同名シークレットを上書きする**おそれがある。本設計（ユーザーごとのトークンを実行時に作る）では `[db.vault]` を使わないか、`--skip-vault` を運用ルールにする。

### 1.5 推奨ラッパー（Supabase 実機では未検証。PGlite には vault が無い）
```sql
-- トークン本体は Vault に置き、テーブルには secret の id だけを持つ
create table public.foursquare_accounts (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  fsq_user_id     text not null unique,
  token_secret_id uuid,                 -- vault.secrets.id。連携解除(F-03)で即削除し null にする
  connected_at    timestamptz not null default now(),
  disconnected_at timestamptz,          -- アカウント単位のソフトデリート起点 (F-40)
  last_synced_at  timestamptz
);
alter table public.foursquare_accounts enable row level security;
create policy fsq_select_own on public.foursquare_accounts for select to authenticated
  using ((select auth.uid()) = user_id);
-- 列単位 GRANT で token_secret_id を authenticated から隠す (2026-10-30 以降は GRANT 明示が必須)
grant select (user_id, fsq_user_id, connected_at, disconnected_at, last_synced_at)
  on public.foursquare_accounts to authenticated;
grant select, insert, update, delete on public.foursquare_accounts to service_role;

create or replace function public.fsq_token_get(p_user_id uuid) returns text
language sql stable security invoker set search_path = '' as $$
  select s.decrypted_secret
    from public.foursquare_accounts a
    join vault.decrypted_secrets s on s.id = a.token_secret_id
   where a.user_id = p_user_id and a.disconnected_at is null
$$;
revoke all on function public.fsq_token_get(uuid) from public, anon, authenticated;
grant execute on function public.fsq_token_get(uuid) to service_role;
-- 同様に fsq_token_upsert(user_id, fsq_user_id, token) は create_secret / update_secret を、
-- fsq_token_delete(user_id) は delete from vault.secrets を使う。いずれも service_role のみに EXECUTE を付与する。
```

### 1.6 アプリ側 AES-GCM との比較（試作 `07_aesgcm.mjs`、Node20 の Web Crypto で動作確認）
| 観点 | Supabase Vault | アプリ側 AES-256-GCM（Web Crypto） |
|---|---|---|
| 鍵の所在 | Supabase 管理のルートキー（DB 外）。Management API で取得・設定できる | 環境変数（Netlify / Workers の secret）。ローカルと本番で別の値を持てる（L-06） |
| ローテーション | ルートキーを差し替えると旧データは復号不可。全シークレットの再登録が必要 | 暗号文に kid を持たせれば、旧鍵で復号して新鍵で再暗号化する段階移行ができる（試作で確認） |
| 改ざん・行コピー対策 | AEAD の追加データ=行 id（組込み） | 追加データに user_id を入れれば同等（試作: 他ユーザーの AAD では OperationError） |
| ダンプ・移行 | 暗号文のまま出力される。別プロジェクトでは鍵コピーが必要 | 暗号文は可搬。鍵さえあればどこでも復号できる |
| 実行環境 | DB 内で完結。アプリ側に鍵を持たない | Cloudflare Workers でも Node でも `crypto.subtle` の AES-GCM が使える（Workers 公式表で ✓） |
| リスク | ラッパー関数の権限設計ミス、`[db.vault]` と `db push` の上書き | 鍵の漏えい＝全トークンの漏えい。アプリサーバーに鍵を置く |
| 要件適合 | 要件定義書（N-02「Supabase Vault 等」、7 章「シークレット管理: Supabase Vault」）と一致 | N-02 の「等」に含まれる |

試作の出力（out_07.txt）:
```
ciphertext: v2.af7LdMq_PdUiIsi4.EFmc3mHoM8t9uFeG5As4CFpr2H_4mOv68X2avmXb6Q5vqSufp050XxejrkQbQ6U-kK3w (88 chars)
decrypt (same user): FSQ_ACCESS_TOKEN_EXAMPLE_0123456789
decrypt with other user AAD -> OperationError (行コピー攻撃を検出)
decrypt tampered -> OperationError (改ざん検出)
old-key blob decrypt (rotation 中も旧 kid で復号可): FSQ_ACCESS_TOKEN_EXAMPLE_0123456789
```

---

## 2. pg_cron（F-42）

- 可用性: `postgresql.conf.j2` の `shared_preload_libraries` に `pg_cron` と `supabase_vault` が入っている。Docker イメージ（ローカル CLI・self-hosted）とホスト環境で共通の設定と思われる（推測、medium）。DB の `timezone = 'UTC'`。
- 有効化（公式 Cron ドキュメント）: `create extension pg_cron with schema pg_catalog;`。ドキュメントでは続けて `grant usage on schema cron to postgres; grant all privileges on all tables in schema cron to postgres;` を実行している。
  - supabase/postgres 側にも pg_cron 作成時に権限を付与するイベントトリガー関数 `extensions.grant_pg_cron_access()` がある。
  - その中で **postgres の cron.job 権限は SELECT のみ**（20231020 マイグレーション）。
  - 2026-07-30 のマイグレーションで `cron.job_run_details` の TRIGGER 権限も剥奪された。→ ジョブ操作は `cron.schedule / alter_job / unschedule` 関数で行い、cron.job への直接 DML はしない。
- Supabase Cron は pg_cron のダッシュボード UI（「Under the hood, Supabase Cron uses the pg_cron Postgres database extension」）。ジョブは同じ `cron.job` に入る。**ダッシュボードで作ったジョブはマイグレーションに残らない**。→ ジョブはマイグレーション（または declarative schema）でのみ定義する。
- 挙動（公式 quickstart / pg_cron README）:
  - 同名で `cron.schedule` するとジョブを置き換える（upsert）。`db reset` で何度流しても冪等。
  - ジョブは**スケジュールしたユーザーの権限**で、スケジュールしたデータベースで動く。
  - タイムゾーン既定は GMT。JST 03:15 なら `'15 18 * * *'`。
  - 秒指定 `'30 seconds'` も可。`cron.max_running_jobs` の既定は 32。
  - `cron.job_run_details` は自動では掃除されない → 掃除ジョブを併設する。
  - 推奨: 同時実行 8 本以下、1 ジョブ 10 分以内。
- マイグレーション内での定義: 可能。pg-delta（2.121.0 の既定の差分エンジン）は名前付きジョブを拡張設定として追跡し、生成するマイグレーションでは `cron.schedule_in_database(...)` / `cron.unschedule(...)` を使う。migra（旧エンジン）の扱いは不明。
- **PGlite 検証（08_purge_proc.mjs）**:
  - バッチごとに COMMIT するプロシージャは、**SET 句（`set search_path = ''`）を付けると `2D000 invalid transaction termination`** になる（PG の仕様）。→ パージ用プロシージャには SET 句を付けず、参照をすべてスキーマ修飾する。
  - 明示的なトランザクション内からの CALL でも同じエラーになる。pg_cron はトップレベルで実行するので問題ない想定。
  - 1.2 万行を 5000 行バッチで削除: 256 ms。
```sql
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('purge-disconnected-checkins', '15 18 * * *', $$call private.purge_disconnected_checkins(5000, 100)$$);
select cron.schedule('cron-run-details-cleanup', '0 19 * * *', $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);
```

---

## 3. pg_trgm と日本語・検索性能（F-21, F-22, N-05）

### 3.1 Supabase のロケール
- supabase/postgres `ansible/tasks/setup-postgres.yml`:
  - PG17 は `initdb --locale-provider=icu --encoding=UTF-8 --icu-locale=en_US.UTF-8`、環境変数 `LC_ALL/LC_CTYPE=en_US.UTF-8`。
  - PG15 系は locale-provider 指定なし（libc、`en_US.UTF-8`）。
  - `Dockerfile-17` も同じ `POSTGRES_INITDB_ARGS`。
- → 本番・ローカルとも、DB の既定照合は ICU `en-US`、`datctype` は `en_US.UTF-8` と推定（**実機で要確認**）。
- PG17 の pg_trgm は語の判定に `t_isalnum()` を使う。中身は DB の ctype が C なら 1 バイトの isalnum、それ以外は **libc の iswalnum**（`ts_locale.c`）。en_US.UTF-8(glibc) では CJK も英数字扱いになるはず（推測）。

### 3.2 PGlite での pg_trgm（03_trgm.mjs、`datctype=C.UTF-8`）
```
"ramen"         n=6  ["  r"," ra","ame","en ","men","ram"]
"ＲＡＭＥＮ"    n=6  [ハッシュ化トライグラム 0x... ×6]   ← 全角のままだと ramen と一致しない (正規化後に使う必要)
"ラーメン"      n=5  ["0xadac30","0xfae2d9","0xfd0f1b"," wB","0x515302"]
"渋谷のラーメン" n=8
"渋谷"          n=3  /  "駅" n=2  /  "ー" n=2  /  "々" n=2  /  "・" n=0 (非語文字)
similarity('ラーメン二郎','ラーメン')=0.5, word_similarity=0.8
```
- 非 ASCII のトライグラムは 3 バイトのハッシュ（0x...）で格納される。
- GIN(gin_trgm_ops)、2 万行、`enable_seqscan=off` の結果:

| パターン | Bitmap Index Scan の返却行 | Recheck で除外された行 | 評価 |
|---|---|---|---|
| `%駅%`(1 文字) | 20000 | 17500 | 全件走査に退化 |
| `%渋谷%`(2 文字) | 20000 | 15000 | 全件走査に退化 |
| `%ra%` | 20000 | 17500 | 全件走査に退化 |
| `%ラーメン%` / `%ram%` / `%渋谷のラ%` | 2500（ちょうどヒット数） | 0 | 有効 |

- 公式ドキュメントにも「a pattern with no extractable trigrams will degenerate to a full-index scan」とある。
- pg_bigm: supabase/postgres の `nix/ext` に**無い**。PGroonga はある（公式ドキュメントで日本語対応をうたい、`&@~` で AND/OR/-NOT、LIKE にもインデックスが効く）。

### 3.3 per-user 検索の性能（PGlite 参考値、04_perf.mjs / 06_narrow.mjs）
データ: U1 3 万件＋他 9 ユーザー各 1 万件（計 12 万行、表 188 MB）。search_text の平均は 110 B、raw は平均 1178 B、1 行あたり約 1.58 KB。

**e-1: RPC `search_checkins`（limit 50、`count(*) over()` で総件数付き、authenticated U1）の中央値**
| クエリ | 時間 | ヒット |
|---|---|---|
| 渋谷 | 172.8 ms | 3934 |
| 駅 | 266.5 ms | 12409 |
| ラーメン | 182.3 ms | 2257 |
| ラーメン OR (カフェ AND 渋谷) | 277.1 ms | 2540 |
| blue bottle | 151.2 ms | 691 |
| 該当なし | 153.9 ms | 0 |
| 8 語 ((4 OR)&(4 OR)) | 277.1 ms | 3891 |

**e-2: 直接 SQL（中央値）**
| パターン | LIKE+LIMIT50 | LIKE count | ILIKE count |
|---|---|---|---|
| %渋谷% | 116.6 | 96.5 | **432.1** |
| %ラーメン% | 161.7 | 166.4 | **414.8** |
| %blue bottle% | 123.1 | 123.2 | **253.0** |
| %存在しないキーワード% | 90.3 | 90.7 | **310.4** |
- 比較用の U1 全件 count(*): 54 ms。
- 原因: PG の `like.c` では、マルチバイトエンコーディングか ICU のとき、ILIKE は**パターンと各行の文字列の両方に lower() をかける**（「In the multi-byte case we don't have much choice :-(. Also, ICU does not support single-character case folding」）。→ 正規化済み列には LIKE を使う。要件の「ILIKE」は「大文字小文字を吸収した部分一致」と読み替える。

**EXPLAIN（%渋谷%, LIMIT 50）**: `InitPlan (select auth.uid())` → `Bitmap Index Scan on checkins_pkey (user_id = InitPlan)` 30000 行 → `Bitmap Heap Scan`（Filter 適用、Heap Blocks 6004）→ `top-N heapsort`。Execution Time 361 ms（EXPLAIN ANALYZE のオーバーヘッドを含む）。

**e-3**: GIN(search_text gin_trgm_ops) は作成に 21 秒・18 MB かかったが、**プランナは使わなかった**（user_id の Bitmap を選択）。

**e-4: キーセット・ページング** — 3000 件目以降の 50 件: keyset 25.8 ms、OFFSET 93.5 ms。

**e-6: RLS ポリシーの書き方**
- `(select auth.uid()) = user_id`: 132.8 ms
- `auth.uid() = user_id`（包まない）: **577.5 ms**（4.3 倍）
- 包まない場合でも、明示フィルタ `c.user_id = (select auth.uid())` を併用すれば 127.4 ms。

**06: 走査ページ数を減らす工夫（U1 3 万件＋他 3 万件）**
| 構成 | ヒープ | count(%渋谷%) | 備考 |
|---|---|---|---|
| A: raw をインラインで保持 | 94 MB | 133〜152 ms | 約 12,000 ページを走査 |
| B: A＋`toast_tuple_target=256` | 94 MB（変化なし） | （キャッシュ差のみ） | 1.6 KB 行は TOAST 対象外（`TOAST_TUPLE_THRESHOLD`≈2 KB 未満では toaster が呼ばれない） |
| D: raw を別テーブルへ | **24 MB** | 51〜57 ms | 3,090 ページ |
| C: A＋被覆インデックス `(user_id, created_at desc, id desc) INCLUDE (search_text) WHERE deleted_at IS NULL` | 索引 12 MB | **50 ms** | Index Only Scan、Heap Fetches 0、764 ページ |
- RPC と同じ形（window＋ORDER BY＋LIMIT）だと、C でも他の列が要るため seq scan に戻った（228〜282 ms）。
- 「2 段階 CTE」（ヒットのキーだけ index-only で集め、50 件だけ本体を引く）にすると **60〜91 ms**。

**ネイティブでの見積り（推測）**: PGlite(WASM) はネイティブ PG より数倍遅い。キャッシュに載っていれば、3 万件／ユーザーで数十 ms 程度と見込む。ただし**コールドキャッシュ**では A 構成だとユーザーあたり約 47 MB をディスクから読む可能性がある。小さいコンピュートでは N-05（数百 ms）を超えるリスクがあるので、D か C を推奨する。Supabase 実機での計測が必要（未確定事項参照）。

---

## 4. normalize / 生成列 / IMMUTABLE（F-22, F-23）

- `normalize(text, form)`:
  - PG17 の `pg_proc.dat` で provolatile 指定なし＝**IMMUTABLE**（oid 4350）。PGlite(PG18) でも `i`。
  - 「This function can only be used when the server encoding is UTF8」。Supabase は initdb で `--encoding=UTF-8`。
- `array_to_string`: PG17 の `pg_proc.dat` で `provolatile => 's'`（STABLE）。
- 生成列の制約（PG18 ドキュメント）:
  - 生成式に使えるのは IMMUTABLE 関数のみ。他の生成列は参照できない。
  - **PG18 では既定が VIRTUAL**。VIRTUAL 生成列はユーザー定義関数・型を参照できない（STORED にはこの制約が無い）。
- Supabase の PG バージョン:
  - 新規プロジェクトは PG17（17.6 系から 17.11 へ。15.19/17.11 のマイナーリリースは 2026-09 下旬から展開）。
  - CLI 2.121.0 のローカルイメージは `supabase/postgres 17.11.0.004`（`supabase services` で確認）。
  - PG18 は 2026-05 時点のメンテナ発言で「eventually in 2026」。

### 4.1 PGlite 検証結果（01_normalize_generated.mjs）
```
[FAIL] b-0 array_to_string() を生成列で直接使用: generation expression is not immutable
[FAIL] b-1a pg_catalog.normalize(s, NFKC) [修飾+キーワード形式]: column "nfkc" does not exist
[OK]   b-1b normalize(s, NFKC) [非修飾キーワード形式] + search_path=''
[OK]   b-1c pg_catalog.normalize(s, 'NFKC') [修飾+文字列リテラル]
[OK]   a-1 + b-2 STORED 生成列 (lower(normalize(.., NFKC)) + ラッパー経由の text[] 連結)   attgenerated='s'
[FAIL] a-2 (PG18) VIRTUAL 生成列でユーザー定義関数: generation expression uses user-defined function
[OK]   a-4 STORED 生成列で SQL ラッパー関数 private.normalize_for_search() を使用
[FAIL] a-5 生成列へ直接 INSERT: cannot insert a non-DEFAULT value into column "search_text"
```
採用した定義（schema.sql より）:
```sql
create or replace function private.immutable_array_to_string(arr text[], sep text)
returns text language sql immutable parallel safe set search_path = ''
as $$ select pg_catalog.array_to_string(arr, sep) $$;

search_text text generated always as (
  lower(normalize(
    coalesce(venue_name,'') || E'\n' || coalesce(shout,'') || E'\n' || coalesce(address,'') || E'\n' ||
    coalesce(city,'') || E'\n' || coalesce(state,'') || E'\n' || coalesce(country,'') || E'\n' ||
    private.immutable_array_to_string(categories, E'\n')
  , NFKC))
) stored
```
- 区切りに改行を使い、語側で制御文字を拒否する。これで語がフィールド境界をまたいでマッチしない。
- 生成列の実値の例: `"starbucks coffee 渋谷tsutaya店\n新作フラペチーノ1\n宇田川町21−6\n渋谷区\n東京都\n日本\ncoffee shop\nカフェ"`
- categories を UPDATE すると search_text も追随することを確認した。

### 4.2 正規化結果（lower(normalize(x, NFKC))、PG と JS の比較）
| 入力 | 結果 | 備考 |
|---|---|---|
| ＡＢＣ１２３ｘｙｚ | abc123xyz | |
| ｶﾞｯﾂﾘﾗｰﾒﾝ / ﾊﾟﾝｹｰｷ | ガッツリラーメン / パンケーキ | 濁点・半濁点は合成される |
| スターバックス　コーヒー（全角スペース） | 半角スペースに | NBSP も半角スペースになる |
| ①②⑩⑳ | 121020 | 区切りが消える点に注意 |
| ㈱㈲（株） | (株)(有)(株) | |
| ℃㌔㎏㍻ | °cキロkg平成 | |
| Ⅻⅳ / ﬁﬂ | xiiiv / fifl | |
| CAFÉ ÉCOLE Ångström / Cafe+U+0301 | café école ångström / café | |
| **STRAßE İstanbul** | PG: `straße istanbul` / JS: `straße i̇stanbul` | **PG と JS で差異** |
| **１００％＿ＯＦＦ＼ / ﹪﹨** | `100%_off\` / `%\` | **LIKE のメタ文字になる** |
| ～〜 | ~〜 | 波ダッシュ U+301C は残る |
| ー－ｰ‐− | ー-ー‐− | U+2010 / U+2212 は残る（住所のハイフンゆれ） |
| らーめん ラーメン | 変化なし | **かな／カナは統一されない**（F-23 の範囲外） |

### 4.3 エスケープ順序の検証（02_search_builder.mjs c-3）
```
'100%'      -> a4 のみ (a5 "100xOFF" にマッチしない)
'１００％'   -> a4 のみ (正規化 → エスケープの順なのでリテラル扱い)
'snake_case'-> a6 のみ / 'c:\path' -> a8 / '\' -> a8
x') OR 1=1 -- -> a9 のみ (リテラル)
誤った順序 (エスケープ → 正規化) で '１００％' を検索した件数: 2   ← a5 まで誤マッチ
```

---

## 5. AST → WHERE 句ビルダー（F-21, N-10）と RLS・権限（N-01）

### 5.1 中間 AST と生成 SQL（c-1 の出力）
```
AST : {"type":"or","children":[{"type":"term","value":"ラーメン"},{"type":"and","children":[{"type":"term","value":"ｶﾌｪ"},{"type":"term","value":"渋谷"}]}]}
SQL : (c.search_text LIKE $1[1] OR (c.search_text LIKE $1[2] AND c.search_text LIKE $1[3]))
terms: ['%ラーメン%', '%カフェ%', '%渋谷%']
AST2: and(or(A,B), or(C, and(D,E)))
SQL2: ((c.search_text LIKE $1[1] OR c.search_text LIKE $1[2]) AND (c.search_text LIKE $1[3] OR (c.search_text LIKE $1[4] AND c.search_text LIKE $1[5])))
```
実装のポイント（schema.sql の `private.search_ast_to_sql` / `public.search_checkins`）:
- 再帰関数は `inout p_terms text[], out p_sql text` を持ち、子を順に処理しながら terms 配列を伸ばす。SQL 文字列には `format('c.search_text LIKE $1[%s]', cardinality(p_terms))` で**整数添字だけ**を埋め込む。
- 実行は次の形。`$1[n]` 形式のパラメータ添字は EXECUTE ... USING で問題なく使えた。
```sql
return query execute format($q$ select ... from public.checkins c
   where c.user_id = (select auth.uid()) and c.deleted_at is null and %s
   order by c.created_at desc, c.id desc limit $2 offset $3 $q$, v_where)
using v_terms, p_limit, p_offset;
```
- 上限: 深さ 8、語 16、子要素 16、語長 100、limit 1..100、offset 0..100000。エラーはすべて SQLSTATE 22023。
- RPC 関数は `security invoker`（RLS がそのまま効く）＋ `set search_path = ''`。

### 5.2 不正 AST の拒否（c-4）
```
[拒否] 未知の type (not)            22023 unsupported search node type
[拒否] 未知の type (SQL 断片)       22023 unsupported search node type
[拒否] field 指定 (liqe Tag 相当)   22023 unsupported search node type
[拒否] value が数値/オブジェクト/欠落 22023 term value must be a string
[拒否] 空文字                       22023 empty search term
[拒否] 制御文字 (改行)              22023 search term contains control characters
[拒否] 長すぎる語 (101文字)         22023 search term too long (max 100 chars)
[拒否] children が配列でない / 空    22023 children must be an array / children count must be 1..16
[拒否] ルートが配列 / 文字列        22023 invalid search node
[拒否] children 10万件              22023 children count must be 1..16 (376ms: 大半は JSON 転送とパース)
[拒否] 語が 20 個 (上限16)          22023 too many search terms (max 16)
深さ別: and 7 段=受理、8〜400 段=22023 too deeply nested、600 段以上=PGlite の jsonb パーサが WASM スタック溢れ
        (RangeError。PGlite 固有。インスタンスは継続利用可。ネイティブ PG では check_stack_depth で通常のエラーになる想定=推測)
```
→ アプリ側（Next.js）でもクエリ文字列の長さ（例 500 文字）と AST の大きさを事前に制限するのが望ましい。

### 5.3 RLS・権限（c-5, c-6, 05_default_privs）
- U1 で `select count(*) from checkins` → 9（他人の行は見えない）。U2 で「渋谷」→ b1 のみ。sub の無い authenticated → 0 件。
- anon で `search_checkins` → `42501 permission denied for function search_checkins`。
- EXPLAIN（c-7）: `InitPlan 1 → Index Scan using checkins_user_created_idx, Index Cond: (user_id = (InitPlan 1).col1), Filter: (search_text ~~ '%渋谷%')`。
- **生成列が参照する関数の EXECUTE を PUBLIC から revoke すると、INSERT するロールで `42501 permission denied for function immutable_array_to_string`** になった。EXECUTE だけ付与すれば成功する（スキーマ USAGE は不要）。→ 純粋なヘルパーは PUBLIC のままにするか、書き込みロール（service_role）に EXECUTE を付ける。
- ALTER DEFAULT PRIVILEGES の検証:
```
0) 既定のまま作成                                         anon_exec=true
1) ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ... FROM PUBLIC 後   anon_exec=true   ← 効かない
2) ALTER DEFAULT PRIVILEGES (global) REVOKE ... FROM PUBLIC 後           anon_exec=false
3) (2の後) IN SCHEMA public GRANT ... TO anon, authenticated            anon_exec=true
4) 関数ごとに REVOKE FROM public, anon, authenticated                   anon_exec=false
```
- PG 公式: 「per-schema default privileges can only add privileges to the global setting, not remove privileges granted by it」。
- Supabase の Hardening ドキュメントには、効かない `alter default privileges for role postgres in schema public revoke execute on functions from public;` が載っている。Discussion #45329 でも「anon が実行できた」との報告があり、PostgREST メンテナが「PostgreSQL の既定なので意図的に扱っていない」と回答している。

### 5.4 Supabase の RLS ベストプラクティス（公式）
- ポリシーで使う列にインデックスを張る（btree の先頭列であること）。
- `auth.uid()` を `(select auth.uid())` で包む（initPlan 化）。ベンチ例: 179→9。
- `to authenticated` を指定する。170→<0.1。
- クエリ側にも明示フィルタを入れる。171→9。
- 他テーブル参照は security definer 関数で、ただし非公開スキーマに置く。
- Advisors の lint: 0003_auth_rls_initplan, 0011_function_search_path_mutable, 0013_rls_disabled_in_public, 0028/0029（security definer 関数が anon/authenticated から実行可能）。
- 関数の推奨（公式 Database Functions）: security invoker を優先する。definer にするなら `search_path` を設定する。`revoke execute ... from public; revoke ... from anon;` を行い、必要なロールにだけ grant する。
- タイムアウト: anon 3 s、authenticated 8 s、service_role は authenticator の 8 s を継承。関数に `set statement_timeout = '4s'` 句を付けると Data API 経由でも有効（公式 Timeouts）。
- secret key（`sb_secret_...`）は service_role（BYPASSRLS）として動く。ただし**リクエストにユーザーのアクセストークンが付いているとそのユーザーとして評価される**（公式 RLS）。旧 anon/service_role キーは 2026 年末までに廃止予定（公式 API keys）。

### 5.5 Data API 既定 GRANT の変更（公式 changelog #45329）
- タイムライン:
  - 2026-04-28: 作成時にオプトアウト可能に。
  - 2026-05-18: pg_graphql が既定で無効に。
  - 2026-05-30: 新規プロジェクトの既定に。
  - **2026-10-30: 既存プロジェクトにも適用**。
- 既存テーブルの GRANT は維持される。新規テーブルには `grant select ... to authenticated` などの明示が必要。シーケンスも同様。
- CLI の `[api] auto_expose_new_tables` は CLI v2.102.0 で追加された一時設定で、**2026-10-30 に削除予定**（メンテナ発言）。2.121.0 の init テンプレートではコメントアウトされている。
- 関数については公式 changelog に具体的な SQL が無い。PG 既定の PUBLIC EXECUTE は残る。

---

## 6. Supabase CLI（L-01〜L-05, 検証6）

### 6.1 実測（scratchpad\sb-db-cli）
```
npm view supabase dist-tags → latest 2.121.0 (2026-10-15), beta 2.121.1-beta.6, next 3.0.0-next.15
npm install supabase@2.121.0 --save-dev → @supabase/cli-windows-x64 (supabase.exe 113MB + supabase-go.exe 41MB) を optionalDependency で取得
package.json: "repository.directory": "apps/cli"（TypeScript/Bun 製 CLI + Go サイドカー。依存に @supabase/pg-delta 1.0.0-alpha.59 など）
supabase --version → 2.121.0
supabase start → {"_tag":"Error","error":{"code":"DockerLifecycleInspectError","message":"failed to inspect container health: docker: command not found (podman also not found) — install Docker Desktop or Podman and ensure it is on PATH"}}
supabase services → supabase/postgres 17.11.0.004, gotrue v2.197.0, postgrest v16.4, realtime v2.143.4, storage-api v1.82.1, studio 2026.10.12-sha-3699278, postgres-meta v0.100.0, supavisor 2.9.13
```
- インストール方法（公式）:
  - Windows は Scoop（`scoop bucket add supabase https://github.com/supabase/scoop-bucket.git; scoop install supabase`）か、npm の devDependency（`npm install supabase --save-dev` → `npx supabase`）。
  - **npm/npx で使う場合は Node.js 20 以上が必要**。今回は 20.11.1 で動作した。
- コンテナランタイム（公式）: Docker Desktop / Rancher Desktop / Podman が Windows 対応。OrbStack / colima は macOS のみ。
  - Docker Desktop は企業規模によっては有償なので、Podman Desktop や Rancher Desktop も候補になる。ライセンス条件はここでは調べていない。
- **native runtime**（ブログ 2026-10-14、CLI v2.119.0+、実験的機能）:
  - 有効化は `SUPABASE_EXPERIMENTAL_STACK=1 supabase init` または `[experimental] stack = true`、起動は `supabase start --runtime native`。
  - 対応は Linux(amd64/arm64, glibc≥2.35) と macOS 14+(Apple silicon) のみ。Windows の記載は無い。WSL2(Ubuntu 22.04+) で動くかは未確認。

### 6.2 `supabase init` が生成した config.toml（抜粋、2.121.0）
```toml
[api]  port = 54321, schemas = ["public","graphql_public"], extra_search_path = ["public","extensions"], max_rows = 1000
# auto_expose_new_tables = true   (コメントアウト)
[db]   port = 54322, shadow_port = 54320, major_version = 17
# [db.vault]
# secret_key = "env(SECRET_VALUE)"
[db.migrations] enabled = true, schema_paths = []
[db.seed] enabled = true, sql_paths = ["./seed.sql"]
[studio] port = 54323
[local_smtp] port = 54324 (Mailpit)
[auth] site_url = "http://127.0.0.1:3000", additional_redirect_urls = ["https://127.0.0.1:3000"], jwt_expiry = 3600
#   signing_keys_path = "./signing_keys.json" (コメントアウト)
[experimental.pgdelta] enabled = true   # db diff / db pull の既定エンジンは pg-delta (false で migra)
```
- `env()` で参照する値は、プロジェクトルートの `.env` から読まれる（公式 Managing config）。

### 6.3 マイグレーション運用（`--help` と公式ドキュメント）
- `migration new <name>` / `migration up` / `migration list|repair|squash|fetch|down`
- `db reset`: ローカル DB を作り直し、全マイグレーションを適用してから seed を流す。`--no-seed`、`--sql-paths`、`--last n` あり。**`--linked` でリモートをリセットできてしまう点に注意**。
- `db diff`: migrations から作ったシャドウ DB とライブ DB を比較する。`-f` で保存。`supabase/schemas` の宣言ファイルは比較の基準に入らない。エンジンは `--use-pg-delta` / `--use-migra`。
- `db push`: `--include-seed`、`--include-roles`、`--dry-run`、**`--skip-vault`**（指定しないと config.toml の Vault シークレットを先に更新する）。
- 履歴テーブルは `supabase_migrations.schema_migrations`。リモートを直接変更すると `db push` の同期エラーになる。直接変えた場合は `db pull` で取り込む。
- diff で捕捉されないもの:
  - DML（insert/update/delete）。Vault シークレットや cron 以外の行データもこれに含まれる。
  - migra の場合はさらに、view の owner/grants、security_invoker、alter policy、列権限、コメントなど。
  - → **GRANT/REVOKE・RLS ポリシー・cron.schedule・関数権限はマイグレーションに手書きする**運用が安全。
- seed: `supabase start` の初回と `db reset` のたびに、マイグレーション適用後に実行される（公式 Seeding）。
- 型生成: `supabase gen types --local`（既定 `--lang typescript`）、`--project-id`、`--db-url`、`--schema`。
- `.env.local` の生成: `supabase status -o env --override-name api.url=NEXT_PUBLIC_SUPABASE_URL`。ローカルでは publishable（`sb_publishable_...`）と secret（`sb_secret_...`）が表示される（公式 Getting started）。
- テスト: `supabase test db`（pgTAP）。RLS の回帰テストに使える。

---

## 7. ソフトデリート（F-40〜F-42）の実測（04_perf.mjs e-5、PGlite）
- 行単位のソフトデリート（`update checkins set deleted_at=...`、3 万行）: **8,364 ms**。復元（null に戻す）: **6,980 ms**。
  - 幅の広い行（raw 1.2 KB インライン）とインデックス更新が効いている。WASM なのでネイティブではかなり速いと見込むが（推測）、デッドタプルが 3 万発生する。
- 物理削除（主キーで 5000 行ずつ、計 3 万行・7 回）: 1,255 ms。プロシージャ版（12,000 行、COMMIT を挟む）: 256 ms。
- → 案: **アカウント単位のソフトデリート**（`foursquare_accounts.disconnected_at`）。解除・復元は 1 行の更新で済む。猶予中の非表示は RPC 側や RLS 側で `(select private.is_account_active())` のような initPlan 化した関数で判定する。パージはアカウント単位でバッチ DELETE する（08_purge_proc.mjs で試作）。
  - 要件のデータモデルにある `checkins.deleted_at` を残すかは基本設計で決める。

---

## 8. 推奨（基本設計への入力）

1. 検索列: STORED の `search_text` ＝ `lower(normalize(… , NFKC))`。text[] は IMMUTABLE ラッパー経由で連結し、区切りは改行。照合は **LIKE**（ILIKE ではない）。クエリ語は DB 関数 `private.normalize_for_search` で正規化してからエスケープする。
2. 検索 RPC:
   - `public.search_checkins(p_ast jsonb, …)` を security invoker・`set search_path=''`・必要なら `set statement_timeout` 付きで作る。
   - EXECUTE は authenticated のみ（`revoke … from public, anon`）。
   - DB 側で AST を厳格に検証する。WHERE には `c.user_id = (select auth.uid())` を明示する。
   - 総件数は 1 ページ目だけ計算するか、2 段階 CTE にする。深いページはキーセット方式を検討する。
3. テーブル:
   - `checkins` は細く保つ。raw は `checkin_raws` に分離する。F-33 の raw 上書きでも本体行を書き換えずに済む。
   - 分離しない場合は被覆インデックス `INCLUDE (search_text)` を使う。
   - PK は `(user_id, id)`。インデックスは `(user_id, created_at desc, id desc)`。
   - trigram インデックスは作らない（MVP）。
4. RLS: 全テーブルで `enable row level security`。ポリシーは `to authenticated using ((select auth.uid()) = user_id)`。**2026-10-30 以降を前提に GRANT を明示**し、token 列は列単位 GRANT か別テーブルで隠す。
5. トークン: Vault（`token_secret_id` を保持）と service_role 専用のラッパー RPC 群（get/upsert/delete）。`[db.vault]` は使わないか `db push --skip-vault`。代替は AES-GCM＋kid（比較は 1.6）。
6. パージ: pg_cron＋SET 句なしのプロシージャ（バッチごとに COMMIT）。`job_run_details` の掃除ジョブを併設し、ジョブはマイグレーションで定義する。
7. ローカル: Windows では Docker Desktop / Podman / Rancher Desktop のいずれかが必須。CLI は devDependency でバージョンを固定する。

---

## 9. 未確定事項と実地検証の手順

1. **Supabase 本番・ローカルのロケールと pg_trgm**: 両方で以下を実行する。
   ```sql
   select datcollate, datctype, datlocprovider, datlocale /*PG17*/ from pg_database where datname = current_database();
   select show_trgm('渋谷のラーメン'), show_trgm('駅'), lower('İSTANBUL'), lower(normalize('ＡＢＣ', NFKC));
   ```
2. **Vault の権限**（ローカル・本番）:
   ```sql
   select has_function_privilege('service_role','vault.create_secret(text,text,text,uuid)','execute'),
          has_table_privilege('service_role','vault.decrypted_secrets','select'),
          has_table_privilege('service_role','vault.secrets','delete'),
          has_schema_privilege('authenticated','vault','usage');
   ```
   その後、service_role のキーで supabase-js から `rpc('fsq_token_get')` が通ること、publishable キーとユーザー JWT では 42501 になることを確認する。
3. **ローカルの Vault 鍵**: `supabase start` 後に `docker volume ls` と `docker exec <db> ls -l /etc/postgresql-custom` で鍵ファイルの所在を確認する。`supabase stop --no-backup` → `start` で鍵が再生成されるか、本番の Management API `GET /v1/projects/{ref}/pgsodium` の値と異なるかも確認する（L-06）。
4. **pg_cron（ローカル）**: マイグレーションに `create extension pg_cron with schema pg_catalog` と `cron.schedule(...)` を書き、`supabase db reset` → `select * from cron.job` で再作成されることを確認する。`'* * * * *'` の一時ジョブで `cron.job_run_details` に成功が記録されることも確認する（ローカルの timezone=UTC）。`supabase db diff` で cron ジョブが差分に出るか（pg-delta）も見る。
5. **性能（N-05）**: Supabase 実機（想定するコンピュートサイズ）に `gen_data.sql` 相当で 3 万件×複数ユーザーを投入する。`explain (analyze, buffers)` で次を計測する: RPC、LIKE と ILIKE、raw の同居と分離、被覆インデックス、コールドキャッシュ（再起動直後）。
6. **Data API 既定 GRANT**: 2026-10-30 以降に作ったテーブル・関数について、`\dp` と `\df+` で anon/authenticated の権限を確認する。CLI 2.121.0 のローカルでの既定（`auto_expose_new_tables` 未設定時）も `select has_table_privilege('anon','public.x','select')` で確認する。
7. **関数レベルの `statement_timeout`** が PostgREST v16 の RPC で効くかを、`pg_sleep` を使った関数で確認する。
8. **Windows の native runtime**: WSL2 Ubuntu 22.04+（glibc 2.35）で `SUPABASE_EXPERIMENTAL_STACK=1` → `supabase start --runtime native` が動くか確認する。Docker 不要化の可否が決まる。
9. **ICU 照合下の lower() と JS の差異**（İ など）が実データで問題になるか。生成列とクエリの両方で DB 関数を使えば一貫するが、Next.js 側で事前に正規化して比較する箇所を作らないこと。

---

## 10. 参考 URL
- Vault: https://supabase.com/docs/guides/database/vault / https://github.com/supabase/vault / https://raw.githubusercontent.com/supabase/vault/main/sql/supabase_vault--0.3.0.sql / https://raw.githubusercontent.com/supabase/vault/main/sql/supabase_vault--0.2.8--0.3.0.sql / https://raw.githubusercontent.com/supabase/vault/main/supabase_vault.control
- pgsodium 非推奨: https://supabase.com/docs/guides/database/extensions/pgsodium
- Vault 権限: https://raw.githubusercontent.com/supabase/postgres/develop/migrations/db/migrations/20221207154255_create_pgsodium_and_vault.sql
- ルートキーのローテーション: https://supabase.com/docs/guides/troubleshooting/issues-with-rotating-pgsodium-and-vault-root-encryption-keys-efeb47
- 鍵生成スクリプト: https://raw.githubusercontent.com/supabase/postgres/develop/ansible/files/pgsodium_getkey_urandom.sh.j2 / Dockerfile: https://raw.githubusercontent.com/supabase/postgres/develop/Dockerfile-17
- initdb ロケール: https://raw.githubusercontent.com/supabase/postgres/develop/ansible/tasks/setup-postgres.yml / postgresql.conf: https://raw.githubusercontent.com/supabase/postgres/develop/ansible/files/postgresql_config/postgresql.conf.j2
- 拡張一覧: https://github.com/supabase/postgres/tree/develop/nix/ext / PGroonga: https://supabase.com/docs/guides/database/extensions/pgroonga
- pg_cron: https://supabase.com/docs/guides/cron / https://supabase.com/docs/guides/cron/install / https://supabase.com/docs/guides/cron/quickstart / https://github.com/citusdata/pg_cron / https://raw.githubusercontent.com/supabase/postgres/develop/migrations/db/migrations/20260730000000_revoke_trigger_on_cron_tables_from_postgres.sql
- pg_trgm: https://www.postgresql.org/docs/17/pgtrgm.html / ts_locale.c: https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/tsearch/ts_locale.c / like.c: https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/utils/adt/like.c
- normalize / 生成列: https://www.postgresql.org/docs/17/functions-string.html / https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/include/catalog/pg_proc.dat / https://www.postgresql.org/docs/18/ddl-generated-columns.html
- 既定権限: https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html
- RLS: https://supabase.com/docs/guides/database/postgres/row-level-security / https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv / Advisors: https://supabase.com/docs/guides/database/database-advisors / 関数: https://supabase.com/docs/guides/database/functions / Hardening: https://supabase.com/docs/guides/database/hardening-data-api / タイムアウト: https://supabase.com/docs/guides/database/postgres/timeouts / API キー: https://supabase.com/docs/guides/api/api-keys / ロール: https://supabase.com/docs/guides/database/postgres/roles
- Data API の既定変更: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically / https://github.com/orgs/supabase/discussions/45329
- PG バージョン: https://github.com/orgs/supabase/discussions/42681 / https://supabase.com/changelog/46080-self-hosted-supabase-upgrading-from-pg-15-to-17-breaking-change / https://releasebot.io/updates/supabase
- CLI: https://supabase.com/docs/guides/local-development/cli/getting-started / https://supabase.com/docs/guides/local-development/cli/config / https://supabase.com/docs/guides/local-development/diff-engines / https://supabase.com/docs/guides/local-development/declarative-database-schemas / https://supabase.com/docs/guides/deployment/database-migrations / https://supabase.com/docs/guides/local-development/seeding-your-database / https://supabase.com/docs/guides/local-development/managing-config / https://github.com/supabase/cli / https://supabase.com/blog/local-supabase-project-per-agent-with-or-without-docker
- PostgREST の論理演算子（代替案の参考）: https://raw.githubusercontent.com/PostgREST/postgrest/main/docs/references/api/tables_views.rst
- Cloudflare Workers の Web Crypto: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/

---

## 付録: スクリプト一覧と実行方法
`scratchpad\sb-db-pglite\` で `npm install`（@electric-sql/pglite 0.5.10）してから `node <script>` を実行する。出力は `out_NN.txt` に保存済み。
| ファイル | 内容 |
|---|---|
| 00_env.mjs | PGlite のバージョン・エンコーディング・ロケール・volatility |
| schema.sql | 検証用スキーマ（auth と各ロールの模擬＋本番マイグレーション案: 生成列、RLS、GRANT、AST ビルダー、検索 RPC） |
| gen_data.sql | ダミーチェックイン生成（表記ゆれを含む。raw は約 1.2 KB） |
| 01_normalize_generated.mjs | 検証 a/b（生成列、正規化表、落とし穴） |
| 02_search_builder.mjs | 検証 c（AST→SQL、エスケープ、不正 JSON、RLS・権限、EXPLAIN） |
| 03_trgm.mjs | 検証 d（show_trgm、語長別の GIN 挙動） |
| 04_perf.mjs | 検証 e（RPC 性能、LIKE と ILIKE、GIN、キーセット、RLS の包み方、ソフトデリート） |
| 05_default_privs.mjs | ALTER DEFAULT PRIVILEGES と関数 EXECUTE |
| 06_narrow.mjs | ヒープ幅の比較（raw 同居、toast_tuple_target、raw 分離、被覆インデックス、2 段階 CTE） |
| 07_aesgcm.mjs | アプリ側 AES-GCM の試作 |
| 08_purge_proc.mjs | pg_cron 用パージプロシージャ（SET 句と COMMIT の制約） |
`scratchpad\sb-db-cli\`: `init-test\supabase\config.toml`（2.121.0 の init 結果）、`cli-help.txt`（各サブコマンドの help）、`cli-help-encryption.txt`、`start-out.txt`（Docker 無しでのエラー）、`services-out.txt`。
