# 14_result.json (agent a29862716ec4e1374)

## TOPIC: sb-db: Supabase(Postgres) 側の設計要素の事実確認と実機検証（Vault / pg_cron / pg_trgm と日本語 / NFKC 生成列 / RLS・RPC 権限 / Supabase CLI on Windows ＋ PGlite 実機検証）

### summary
公式ドキュメント、supabase/postgres と supabase/vault のソース、PostgreSQL のソース・ドキュメントで事実を確認しました。あわせて、PGlite 0.5.10（PostgreSQL 18.6 / WASM / C.UTF-8）で検証 a〜e を実施し、Supabase CLI 2.121.0 を npm で入れて init / help / start を実行しました。

結論:
(1) STORED 生成列 `lower(normalize(...,NFKC))` と、IMMUTABLE ラッパー経由の text[] 連結は作成できます。落とし穴は 2 つです。`pg_catalog.normalize(s, NFKC)` と書くとエラーになること、PG18 では生成列の既定が VIRTUAL なことです。
(2) plpgsql で AST を再帰的に辿り、`EXECUTE format(...) USING terms` で実行する方式は動作しました。悪意ある JSON は全種 22023 で拒否でき、SQL 断片はリテラルとして扱われました。NFKC で全角の ％＿＼ がワイルドカード文字に変わるため、エスケープは必ず正規化の後に DB 側で行う必要があります。
(3) 1 ユーザー 3 万件の検索は PGlite で 50〜300ms でした。ILIKE は LIKE の 2.5〜4.5 倍遅く、raw JSONB を同じ行に持つとヒープが約 4 倍になります。pg_trgm は 1〜2 文字の語でインデックス全件走査に退化し、per-user 検索ではプランナに選ばれませんでした。
(4) Vault は pgsodium 非依存（0.3.x）で、service_role には vault 権限が付与済みです。ルートキーはプロジェクトごとで DB の外にあり、ローテーションすると旧データは復号できません。
(5) 2026-10-30 から既存プロジェクトでもテーブルの自動 GRANT が無くなります。一方、関数の EXECUTE は PUBLIC 既定のまま残り、スキーマ単位の ALTER DEFAULT PRIVILEGES では外せません（PGlite で確認）。
(6) Windows では `supabase start` に Docker か Podman が必須です（実測）。Docker 不要の native runtime は Linux/macOS のみです。

Supabase 実機（ロケール、Vault 権限、ローカル鍵、pg_cron、性能）の確認は、手順を open_questions に記載しました。

### findings

- **[F01] CRITICAL (high)** Supabase の Data API 既定 GRANT が廃止される。新規プロジェクトは 2026-05-30 から、既存プロジェクトも 2026-10-30 から、public の新規テーブルとシーケンスは anon/authenticated/service_role に自動 GRANT されない。関数の EXECUTE は PostgreSQL 既定の PUBLIC 付与が残る
  - detail: 公式 changelog #45329 のタイムライン:
- 2026-04-28: オプトアウトが可能に
- 2026-05-18: pg_graphql が既定で無効に
- 2026-05-30: 新規プロジェクトの既定に
- 2026-10-30: 既存プロジェクトに適用

既存テーブルの GRANT は維持される。新規テーブルはマイグレーションで `grant select ... to authenticated` 等を明示しないと、Data API から 42501 になる。

関数については公式 changelog に SQL が無い。Discussion #45329 で PostgREST メンテナ(steve-chavez, 2026-08-08)が、PUBLIC への EXECUTE は「PostgreSQL の既定なので意図的に扱っていない」と回答している。

CLI の `[api] auto_expose_new_tables` は v2.102.0 で追加された一時設定で、2026-10-30 に削除予定(メンテナ発言)。CLI 2.121.0 の init テンプレートではコメントアウトされていた。

設計への影響: 全テーブルの GRANT と、全 RPC 関数の `revoke execute ... from public, anon` をマイグレーションに手書きする。
  - sources: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically , https://github.com/orgs/supabase/discussions/45329 , https://supabase.com/docs/guides/database/hardening-data-api

- **[F02] CRITICAL (high)** `ALTER DEFAULT PRIVILEGES [FOR ROLE x] IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` は効果が無い。PUBLIC の EXECUTE を外すには、スキーマ指定なしの global 形式か、関数ごとの REVOKE が必要。Supabase の Hardening ドキュメントには効かない形式が掲載されている
  - detail: PG17 の公式ドキュメントに次の記述がある: "per-schema default privileges can only add privileges to the global setting, not remove privileges granted by it"。

PGlite で検証した結果(05_default_privs.mjs):
- 既定: anon_exec=true
- per-schema の REVOKE 後: anon_exec=true(変化なし)
- global の REVOKE 後: anon_exec=false
- 関数ごとの REVOKE from public, anon, authenticated: anon_exec=false

Supabase の Hardening the Data API ページには `alter default privileges for role postgres in schema public revoke execute on functions from public;` が載っている。Discussion #45329 にも、これで anon の実行を防げなかったという報告がある。

→ RPC ごとに revoke/grant を明示するのが確実。
  - sources: https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html , https://supabase.com/docs/guides/database/hardening-data-api , https://github.com/orgs/supabase/discussions/45329

- **[F03] CRITICAL (high)** Supabase Vault(0.3.x)は pgsodium に依存しない。service_role は vault を直接使える権限を持つが、vault スキーマは Data API に公開されない。トークン操作は service_role だけが EXECUTE できる public のラッパー RPC で行う必要がある
  - detail: 公式 pgsodium ページ: "Vault doesn't depend on pgsodium and is not affected by this deprecation." pgsodium 本体と TCE は非推奨。

vault の SQL(0.3.0、制御ファイルは default_version 0.3.1):
- `create_secret(new_secret text, new_name text=NULL, new_description text='', new_key_id uuid=NULL) returns uuid`
- `update_secret(secret_id uuid, new_secret text=NULL, new_name text=NULL, new_description text=NULL, new_key_id uuid=NULL)`
- いずれも SECURITY DEFINER・search_path=''。new_key_id は unused。
- 暗号関数は `MODULE_PATHNAME`(=$libdir/supabase_vault)の C 関数で、`REVOKE ALL ... FROM PUBLIC` 済み。
- decrypted_secrets ビューは AEAD の追加データに行 id を使う。
- 削除用の関数は無く、`delete from vault.secrets` で削除する。

supabase/postgres の初期マイグレーション 20221207154255 で付与される権限:
- postgres: vault スキーマの USAGE、secrets/decrypted_secrets の SELECT・DELETE ほか、create/update_secret の EXECUTE(WITH GRANT OPTION)
- service_role: vault スキーマの USAGE、secrets/decrypted_secrets の SELECT・DELETE、create/update_secret・_crypto_aead_det_decrypt の EXECUTE
- anon/authenticated: 付与なし

公式 RLS ドキュメントは「security definer 関数を公開スキーマに作るな」としている。そのため、public に security invoker の関数を置き、EXECUTE を service_role のみにする案が適する。トークンを返す関数を authenticated に開放すると N-02 違反になる。

Supabase 実機での権限確認は未実施。
  - sources: https://supabase.com/docs/guides/database/extensions/pgsodium , https://supabase.com/docs/guides/database/vault , https://raw.githubusercontent.com/supabase/vault/main/sql/supabase_vault--0.3.0.sql , https://raw.githubusercontent.com/supabase/vault/main/supabase_vault.control , https://raw.githubusercontent.com/supabase/postgres/develop/migrations/db/migrations/20221207154255_create_pgsodium_and_vault.sql , https://supabase.com/docs/guides/database/postgres/row-level-security

- **[F04] (medium)** Vault のルートキーはプロジェクトごとに DB の外で管理される。Docker イメージでは初回起動時に /dev/urandom から鍵を生成するため、ローカルと本番は別の鍵になる(L-06)。ただし `db push` は config.toml の [db.vault] でリモートのシークレットを上書きする
  - detail: 公式 Vault ドキュメント:
- 鍵は DB と同じ場所に保存されない。
- Management API `/v1/projects/{ref}/pgsodium` で 64 桁 hex のルートキーを取得・設定できる。
- 手動の pg_dump/restore で新プロジェクトへ移すと新しい鍵になり、旧鍵をコピーするまで復号できない。

Dockerfile-17 では `vault.getkey_script` と `pgsodium.getkey_script` が `pgsodium_getkey_urandom.sh` を指す。このスクリプトは `/etc/postgresql-custom/pgsodium_root.key` が無ければ 32 バイトの乱数で生成する。self-hosted のガイドでは鍵は db-config ボリュームにある。

→ ローカルと本番で鍵は別になる。CLI のローカルスタックでのボリューム名と永続性は未確認(推測)。

CLI 2.121.0 の `db push --help` には「Vault secrets from config.toml are updated before migrations unless --skip-vault is set」とある。CLI には `supabase encryption get-root-key / update-root-key` もある。
  - sources: https://supabase.com/docs/guides/database/vault , https://raw.githubusercontent.com/supabase/postgres/develop/Dockerfile-17 , https://raw.githubusercontent.com/supabase/postgres/develop/ansible/files/pgsodium_getkey_urandom.sh.j2 , https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17

- **[F05] (high)** Vault のルートキーをローテーションすると、旧キーで暗号化したシークレットは復号できなくなる。全シークレットの再登録が必要になる
  - detail: Supabase のトラブルシューティング記事: ローテーションは Management API の /pgsodium への PUT で行う。"After rotation, you can no longer decrypt legacy data." Vault のシークレットは再暗号化か再登録が必要。

この設計では全ユーザーの Foursquare トークンが失われ、再連携が必要になることを意味する。

比較: アプリ側 AES-GCM なら、暗号文に kid を持たせて段階的に移行できる。07_aesgcm.mjs で旧 kid の暗号文を復号できることを確認した。
  - sources: https://supabase.com/docs/guides/troubleshooting/issues-with-rotating-pgsodium-and-vault-root-encryption-keys-efeb47 , https://supabase.com/docs/guides/database/vault

- **[F06] CRITICAL (high)** [PGlite 検証 a/b] `lower(normalize(..., NFKC))` と、IMMUTABLE ラッパー経由の text[] 連結を使った STORED 生成列は作成できる。`array_to_string` を直接使うと失敗する。`pg_catalog.normalize(s, NFKC)` も失敗する
  - detail: PGlite 0.5.10(PG18.6)の結果。Supabase 本番の PG17 とは差がありうる。
- `array_to_string` を直接使用: `generation expression is not immutable`
- `pg_catalog.normalize(s, NFKC)`(スキーマ修飾＋キーワード形式): `column "nfkc" does not exist`
- `normalize(s, NFKC)` と `pg_catalog.normalize(s,'NFKC')` は OK
- `private.immutable_array_to_string(text[],text)`(sql, immutable, set search_path='')を含む STORED 列: OK(attgenerated='s')
- categories を UPDATE すると search_text も追随した
- 生成列への直接 INSERT は拒否された
- PG18 では生成列の既定が VIRTUAL。VIRTUAL ではユーザー定義関数を参照すると `generation expression uses user-defined function` になる → STORED を明示する

カタログの根拠:
- PG17 の pg_proc.dat で normalize(oid 4350)は provolatile 指定なし＝IMMUTABLE
- array_to_string は provolatile 's'
- normalize には「server encoding is UTF8」が必要。Supabase の initdb は --encoding=UTF-8
  - sources: https://www.postgresql.org/docs/17/functions-string.html , https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/include/catalog/pg_proc.dat , https://www.postgresql.org/docs/18/ddl-generated-columns.html , https://raw.githubusercontent.com/supabase/postgres/develop/ansible/tasks/setup-postgres.yml

- **[F07] CRITICAL (high)** [PGlite 検証 a/c] NFKC で全角の ％＿＼ や ﹪﹨ は LIKE のメタ文字 % _ \ に変わる。エスケープは正規化の後に行う必要がある。順序を逆にすると誤マッチすることを再現した
  - detail: PGlite の結果。正規化はおおむね期待どおりだった。
- ＡＢＣ１２３ → abc123
- ｶﾞｯﾂﾘﾗｰﾒﾝ → ガッツリラーメン
- 全角スペース → 半角スペース
- ①②⑩⑳ → 121020
- ㈱ → (株)
- ℃㌔㎏㍻ → °cキロkg平成
- Ⅻ → xii
- CAFÉ → café

ただし次の点に注意が必要。
- `１００％＿ＯＦＦ＼` は `100%_off\` になる
- 正規化してからエスケープすると、'１００％' は a4 のみにマッチした(リテラル扱い)
- エスケープしてから正規化すると 2 件(a5 '100xOFF' に誤マッチ)
- 'İ' の lower 結果は PG(libc C.UTF-8)が 'i'、JS が 'i̇' で異なる。ICU 照合の本番ではさらに異なる可能性がある
- ひらがなとカタカナ、〜(U+301C)、−(U+2212)、‐(U+2010)は NFKC では統一されない

→ クエリ語は Next.js 側で正規化せず、データ側と同じ DB 関数 `private.normalize_for_search` で正規化してからエスケープする。LIKE の既定エスケープ文字はバックスラッシュ。
  - sources: https://www.postgresql.org/docs/17/functions-string.html , https://www.postgresql.org/docs/17/functions-matching.html

- **[F08] CRITICAL (high)** [PGlite 検証 c] JSON の中間 AST を plpgsql で再帰的に辿って `c.search_text LIKE $1[n]` 形式の WHERE を組み立て、`EXECUTE format(...) USING terms_array` で実行できた。不正な AST は 22023 で拒否できた
  - detail: 実行例:
- AST `or(term ラーメン, and(term ｶﾌｪ, term 渋谷))`
- 生成された WHERE: `(c.search_text LIKE $1[1] OR (c.search_text LIKE $1[2] AND c.search_text LIKE $1[3]))`
- terms: `['%ラーメン%','%カフェ%','%渋谷%']`

SQL 文字列に入るのは固定の断片と整数添字だけで、語は USING で渡す。

拒否できたもの(すべて 22023): type not/field/SQL 断片、数値やオブジェクトの value、value 欠落、空語、改行を含む語、101 文字の語、children が非配列・空・10 万件、ルートが配列・文字列、深さ 8 段超、語 17 個以上。

`x') OR 1=1 --` はリテラルとしてマッチした。600 段以上の入れ子は PGlite の jsonb パーサが WASM スタック溢れ(PGlite 固有)を起こした。

RPC は authenticated なら PostgREST 経由で任意の JSON を渡して直接呼べるため、DB 側での検証は必須。

構成: `security invoker` と `set search_path=''`、`where c.user_id=(select auth.uid())` を明示、`revoke ... from public, anon`、`grant ... to authenticated`。

確認結果:
- anon で呼ぶと 42501 permission denied
- U1 からは U2 の行が見えない
- sub の無い authenticated は 0 件
  - sources: https://www.postgresql.org/docs/17/plpgsql-statements.html , https://supabase.com/docs/guides/database/functions , https://supabase.com/docs/guides/database/postgres/row-level-security

- **[F09] CRITICAL (medium)** [PGlite 検証 e] 1 ユーザー 3 万件(全 12 万行)の検索は、user_id インデックスと LIKE フィルタで 50〜300ms(PGlite 参考値)。ILIKE は LIKE の 2.5〜4.5 倍遅い
  - detail: RPC(limit 50、count(*) over())の中央値:
- 渋谷: 172.8ms
- 駅: 266.5ms
- ラーメン: 182.3ms
- ラーメン OR (カフェ AND 渋谷): 277.1ms
- 該当なし: 153.9ms
- 8 語: 277.1ms

count のみの比較(LIKE / ILIKE):
- 渋谷: 96.5 / 432.1ms
- ラーメン: 166.4 / 414.8ms
- 該当なし: 90.7 / 310.4ms

プラン: InitPlan(auth.uid()) → Bitmap Index Scan(user_id) → Filter → top-N heapsort。

PG の like.c では、マルチバイトか ICU のとき ILIKE がパターンと各行の両方に lower() をかける("In the multi-byte case we don't have much choice")。正規化済みの列には LIKE で十分。

ネイティブ PG ではキャッシュ時に数十 ms と見込む(推測)。Supabase 実機での計測は未実施。
  - sources: https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/utils/adt/like.c , https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv

- **[F10] (medium)** [PGlite] raw(平均 1.2KB)を checkins の行内に持つとヒープが約 4 倍(94MB→24MB)になり、検索で走査するページ数が増える。toast_tuple_target=256 は効かなかった。raw の別テーブル化か被覆インデックスで改善した
  - detail: U1 3 万件＋他 3 万件で比較した(1 行あたり平均 1583B、うち raw 1178B、search_text 110B)。
- A: raw をインラインで保持。count 133〜152ms、約 12,000 ページ
- B: A に toast_tuple_target=256。ヒープは 94MB のまま変化なし。2KB 未満の行では toaster が呼ばれないため(推測、PG の heap_prepare_insert の TOAST_TUPLE_THRESHOLD 判定による)
- D: raw を別テーブルへ分離。ヒープ 24MB、count 51〜57ms
- C: 被覆インデックス `(user_id, created_at desc, id desc) INCLUDE (search_text) WHERE deleted_at IS NULL`。Index Only Scan、Heap Fetches 0、764 ページ、count 50ms

RPC と同じ形(window＋ORDER BY＋LIMIT)だと他の列が要るため seq scan に戻る。ヒットのキーだけ集める 2 段階 CTE にすると 60〜91ms になった。

コールドキャッシュの場合、A 構成だとユーザーあたり約 47MB を読む可能性がある(推測)。F-33 の raw 上書きでも、分離していれば本体行を書き換えずに済む。
  - sources: https://www.postgresql.org/docs/17/sql-createtable.html , https://www.postgresql.org/docs/17/indexes-index-only-scans.html

- **[F11] CRITICAL (high)** [PGlite 検証 d] pg_trgm は CJK からトライグラムを抽出できた(非 ASCII はハッシュ化)。しかし 1〜2 文字の語では抽出できるトライグラムが無く、GIN インデックスの全件走査に退化する。per-user 検索ではプランナが GIN を選ばなかった
  - detail: show_trgm の結果:
- 'ramen': 6 個 ["  r"," ra","ame","en ","men","ram"]
- 'ＲＡＭＥＮ': 別のハッシュ 6 個(正規化後に使う必要がある)
- 'ラーメン': 5 個、'渋谷のラーメン': 8 個、'渋谷': 3 個、'駅': 2 個
- 'ー' と '々' は語文字、'・' は 0 個

GIN の検証(2 万行):
- %駅%、%渋谷%、%ra%: Bitmap Index Scan が全 20000 行を返し、Recheck で 15000〜17500 行を除外
- %ラーメン%、%ram%: ヒット数ちょうど 2500 行で、インデックスが有効

公式ドキュメントにも "a pattern with no extractable trigrams will degenerate to a full-index scan" とある。12 万行への GIN 作成は 21 秒・18MB かかったが、per-user クエリでは使われなかった。

→ MVP では trigram インデックス不要。

PGlite は datctype=C.UTF-8(libc)。本番の挙動は F12 を参照。
  - sources: https://www.postgresql.org/docs/17/pgtrgm.html , https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/tsearch/ts_locale.c

- **[F12] (medium)** Supabase の PG17 は ICU en_US.UTF-8 で initdb され、LC_CTYPE=en_US.UTF-8 で動く。PG17 の pg_trgm は libc の iswalnum で語文字を判定するため、本番でも CJK を語文字として扱うと見込まれる(推測)。pg_bigm は無く、PGroonga はある
  - detail: supabase/postgres の setup-postgres.yml(PG17 タスク)は `initdb --locale-provider=icu --encoding=UTF-8 --icu-locale=en_US.UTF-8` で、環境変数 LC_ALL/LC_CTYPE は en_US.UTF-8。Dockerfile-17 も同じ POSTGRES_INITDB_ARGS。

PG17 の ts_locale.c: t_isalnum は「clen==1 か database_ctype_is_c なら isalnum、それ以外は char2wchar して iswalnum」。

拡張の有無: supabase/postgres の nix/ext に pg_bigm は無く、pgroonga はある。公式 PGroonga ページは日本語対応と、`&@~` での AND/OR/-NOT を記載している。

既存プロジェクトの実際の datctype と、glibc の en_US.UTF-8 での CJK 分類は実機で要確認。
  - sources: https://raw.githubusercontent.com/supabase/postgres/develop/ansible/tasks/setup-postgres.yml , https://raw.githubusercontent.com/supabase/postgres/develop/Dockerfile-17 , https://raw.githubusercontent.com/postgres/postgres/REL_17_STABLE/src/backend/tsearch/ts_locale.c , https://github.com/supabase/postgres/tree/develop/nix/ext , https://supabase.com/docs/guides/database/extensions/pgroonga

- **[F13] CRITICAL (high)** Windows では Supabase CLI 2.121.0 を npm の devDependency で導入して動かせる(init / help は確認済み)。ただし `supabase start` は Docker か Podman が無いと即エラーになる。Docker 不要の native runtime(v2.119.0+、実験的)は Linux(glibc≥2.35)/macOS 14+ のみ
  - detail: 実測の内容:
- npm の latest は 2.121.0(2026-10-15)。next は 3.0.0-next.15
- @supabase/cli-windows-x64(supabase.exe 113MB＋supabase-go.exe 41MB)が入る
- `supabase start` の出力: `DockerLifecycleInspectError: failed to inspect container health: docker: command not found (podman also not found) — install Docker Desktop or Podman and ensure it is on PATH`
- `supabase services`: postgres 17.11.0.004、gotrue v2.197.0、postgrest v16.4

公式ドキュメント:
- npm/npx で使う場合は Node.js 20 以上が必要
- Windows のランタイムは Docker Desktop / Rancher Desktop / Podman
- Scoop でも導入できる

公式ブログ(2026-10-14): native runtime は `SUPABASE_EXPERIMENTAL_STACK=1` と `supabase start --runtime native` で使う。WSL2 での可否は未確認。

L-01 の「Docker Compose ベース」は、利用者が compose を書くわけではないという意味で不正確な可能性がある(推測)。
  - sources: https://supabase.com/docs/guides/local-development/cli/getting-started , https://supabase.com/blog/local-supabase-project-per-agent-with-or-without-docker , https://www.npmjs.com/package/supabase , https://github.com/supabase/cli

- **[F14] (high)** CLI 2.121.0 の `supabase init` は、major_version=17、site_url=http://127.0.0.1:3000、additional_redirect_urls=["https://127.0.0.1:3000"] の config.toml を生成する。diff の既定エンジンは pg-delta
  - detail: 生成された config.toml(scratchpad\sb-db-cli\init-test\supabase\config.toml)の主な値:
- `[api]` port 54321、schemas [public, graphql_public]、extra_search_path [public, extensions]、max_rows 1000
- `# auto_expose_new_tables = true`(コメントアウト)
- `[db]` port 54322、shadow_port 54320、major_version 17
- `# [db.vault] secret_key = "env(SECRET_VALUE)"`
- `[db.seed]` sql_paths ["./seed.sql"]
- studio 54323、Mailpit 54324
- `[auth]` jwt_expiry 3600、`# signing_keys_path`
- `[experimental.pgdelta] enabled = true`(false にすると migra)

env() で参照する値は、プロジェクトルートの .env から読まれる(公式)。L-03 の .env.local は `supabase status -o env --override-name api.url=NEXT_PUBLIC_SUPABASE_URL` で生成できる。ローカルの鍵は publishable(sb_publishable_...)と secret(sb_secret_...)。
  - sources: https://supabase.com/docs/guides/local-development/cli/config , https://supabase.com/docs/guides/local-development/managing-config , https://supabase.com/docs/guides/local-development/diff-engines

- **[F15] (high)** マイグレーション運用は migration new/up、db reset(マイグレーション適用後に seed)、db diff、db push(--include-seed/--skip-vault/--dry-run)の流れになる。DML、Vault シークレット、手作業の権限調整は diff で捕捉されないことがあるため、手書きが安全
  - detail: CLI 2.121.0 の help より:
- `db diff`: migrations から作ったシャドウ DB とライブ DB を比較する。supabase/schemas の宣言ファイルは比較の基準に含まれない
- `db reset --linked`: リモートをリセットできてしまう(要注意)
- `migration repair`: 履歴テーブルだけを変更する
- `gen types --local`(既定は typescript)
- `test db`(pgTAP)

公式ドキュメントより:
- 履歴テーブルは supabase_migrations.schema_migrations
- リモートを直接変更すると db push が失敗する。その場合は db pull で取り込む
- seed は supabase start の初回と db reset のたびに実行される
- declarative schema では DML はエラー
- migra は view の grants、security_invoker、alter policy、列権限、コメントを捕捉しない
- pg-delta は既定権限由来の GRANT/REVOKE を出力することがある
- migration squash は Vault シークレットを落とす
  - sources: https://supabase.com/docs/guides/deployment/database-migrations , https://supabase.com/docs/guides/local-development/declarative-database-schemas , https://supabase.com/docs/guides/local-development/seeding-your-database , https://supabase.com/docs/guides/local-development/diff-engines

- **[F16] (high)** pg_cron は Supabase の shared_preload_libraries に含まれ、マイグレーション内で `create extension pg_cron with schema pg_catalog` と `cron.schedule(名前, ...)` を書いて定義できる。同名での schedule は upsert で、既定タイムゾーンは GMT
  - detail: postgresql.conf.j2 の shared_preload_libraries に pg_cron と supabase_vault が含まれる。DB の timezone は 'UTC'。

公式ドキュメントより:
- install: `create extension pg_cron with schema pg_catalog` と grant
- quickstart: 同名ジョブは「replace the existing job via upsert」
- 秒指定は 15.1.1.61 以降
- job_run_details は自動で掃除されない
- 推奨は同時実行 8 本以下、1 ジョブ 10 分以内
- Supabase Cron は pg_cron の UI。ダッシュボードで作ったジョブはマイグレーションに残らない

pg_cron の README: ジョブはスケジュールしたユーザーの権限で、スケジュールした DB で動く。既定は GMT、max_running_jobs は 32。

supabase/postgres のマイグレーションでは、postgres の cron.job 権限は SELECT のみ。2026-07-30 に job_run_details の TRIGGER 権限も剥奪された → ジョブは関数 API で操作する。

pg-delta は名前付きジョブを追跡する。ローカル CLI での動作は未確認。
  - sources: https://raw.githubusercontent.com/supabase/postgres/develop/ansible/files/postgresql_config/postgresql.conf.j2 , https://supabase.com/docs/guides/cron , https://supabase.com/docs/guides/cron/install , https://supabase.com/docs/guides/cron/quickstart , https://github.com/citusdata/pg_cron , https://raw.githubusercontent.com/supabase/postgres/develop/migrations/db/migrations/20260730000000_revoke_trigger_on_cron_tables_from_postgres.sql

- **[F17] (high)** [PGlite] SET 句(`set search_path = ''` など)を付けたプロシージャでは COMMIT が `2D000 invalid transaction termination` になる。バッチごとに COMMIT するパージ用プロシージャには SET 句を付けず、参照をすべてスキーマ修飾する
  - detail: 08_purge_proc.mjs での結果:
- SET 句付きのプロシージャで COMMIT: 2D000
- SET 句なしの `private.purge_disconnected_checkins(5000,100)`: 1.2 万行を 3 バッチで 256ms。猶予 14 日超のアカウントのみ削除され、3 日のアカウントは残った
- 明示的なトランザクション内からの CALL: 同じエラー

pg_cron はトップレベルで実行するので問題ない想定(Supabase quickstart の例も `CALL do_something()`)。

lint 0011(function_search_path_mutable)との兼ね合いは要確認。PG の CREATE PROCEDURE ドキュメントにも、SET 句がある場合はトランザクション制御文を実行できないと記載がある。
  - sources: https://www.postgresql.org/docs/17/sql-createprocedure.html , https://supabase.com/docs/guides/cron/quickstart , https://supabase.com/docs/guides/database/database-advisors

- **[F18] (medium)** [PGlite] 行単位のソフトデリート(3 万行の UPDATE)は 8.4 秒、復元は 7.0 秒かかった。物理削除(5000 行ずつ)は 1.3 秒。アカウント単位のフラグ方式のほうが軽い
  - detail: 04_perf.mjs e-5 の結果(WASM のためネイティブより遅い)。行単位の UPDATE は幅の広い行(raw インライン)の再書き込みとインデックス更新を伴い、デッドタプルが 3 万発生する。

アカウント単位の案:
- `foursquare_accounts.disconnected_at` を 1 行更新するだけで解除・復元できる(F-40/F-41)
- 猶予中の非表示は RPC か RLS で initPlan 化した関数により判定する
- パージはアカウント単位でバッチ DELETE する(F-42)

要件のデータモデルにある checkins.deleted_at を残すかは基本設計で判断する。ネイティブでの所要時間は推測。
  - sources: https://www.postgresql.org/docs/17/routine-vacuuming.html

- **[F19] (high)** RLS ポリシーで auth.uid() を `(select auth.uid())` で包むと、PGlite でも 4.3 倍速かった(577.5ms→132.8ms)。明示フィルタを併用しても同等に速い(127ms)
  - detail: e-6 の結果: 包まない場合、プランは Filter に auth.uid() の展開式を行ごとに評価していた。包んだ場合は InitPlan で 1 回だけ評価された。

Supabase 公式のベンチ: 179→9(wrap)、171→9(明示フィルタ)、170→<0.1(TO authenticated)。

Advisors の関連 lint: 0003_auth_rls_initplan、0011_function_search_path_mutable、0013_rls_disabled_in_public、0028/0029(security definer 関数が anon/authenticated から実行可能)。
  - sources: https://supabase.com/docs/guides/database/postgres/row-level-security , https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv , https://supabase.com/docs/guides/database/database-advisors

- **[F20] (high)** [PGlite] 生成列が参照する関数の EXECUTE を PUBLIC から revoke すると、INSERT するロール(service_role)で 42501 になる。EXECUTE だけ付与すれば成功する(スキーマ USAGE は不要)
  - detail: 02_search_builder.mjs c-6 の結果:
- `revoke all on function private.immutable_array_to_string from public` の後、service_role の INSERT は `permission denied for function immutable_array_to_string`
- `grant execute ... to service_role` のみで成功した
- UPDATE でも生成列は再計算された

→ 純粋なヘルパー関数は PUBLIC のままにするか、書き込みロールへの EXECUTE 付与をマイグレーションに含める。
  - sources: https://www.postgresql.org/docs/17/ddl-priv.html

- **[F21] (medium)** [PGlite] 深いページの取得はキーセット方式(created_at,id) < カーソルのほうが OFFSET より速い(25.8ms 対 93.5ms)。総件数(count(*) over())は全ヒットの評価が必要
  - detail: e-4 の結果: 「渋谷」の 3000 件目以降の 50 件。keyset では Bitmap Index Scan on checkins_user_created_idx の Index Cond に ROW 比較が入った。

F-31 の件数表示を毎ページ計算すると、全ヒットの走査が毎回発生する。1 ページ目だけ計算する、または 2 段階 CTE にする案がある。
  - sources: https://www.postgresql.org/docs/17/queries-limit.html

- **[F22] (high)** 新しい API キーは publishable(sb_publishable_、anon/authenticated)と secret(sb_secret_、service_role で BYPASSRLS)。旧 anon/service_role キーは 2026 年末までに廃止予定。secret キーでもユーザーの JWT が付くとそのユーザーとして RLS が評価される
  - detail: 公式 API keys: publishable と secret は JWT ではなく、apikey ヘッダで送る。

公式 RLS: "A secret key bypasses RLS only when the request has no user access token."

→ Next.js サーバーでトークン操作 RPC を呼ぶ supabase クライアントは、ユーザーセッションと共有しない専用インスタンスにする。L-03 の .env.local の変数名も新キー前提で設計する。
  - sources: https://supabase.com/docs/guides/api/api-keys , https://supabase.com/docs/guides/database/postgres/row-level-security

- **[F23] (high)** 既定の statement_timeout は anon 3s、authenticated 8s(service_role は authenticator の 8s を継承)。関数に付けた `set statement_timeout` 句は Data API 経由でも有効
  - detail: 公式 Timeouts ページに「add a set statement_timeout TO '4s' clause to the create or replace function definition. This works with the Database REST API」とある。

検索 RPC に `set statement_timeout = '3s'` などを付けて DoS の上限にできる。PostgREST v16 での実動作は未確認。
  - sources: https://supabase.com/docs/guides/database/postgres/timeouts

- **[F24] (medium)** Supabase の新規プロジェクトは PostgreSQL 17(17.6 系から 17.11 へ)。CLI 2.121.0 のローカルイメージは supabase/postgres 17.11.0.004。PG18 はまだ提供されていない
  - detail: 情報源:
- Discussion #42681(2026-05-04 のメンテナ発言): CLI と self-hosted の PG18 は「not very soon, but eventually in 2026」
- releasebot と changelog: 15.19/17.11 のマイナーリリースを 2026-09 下旬から展開
- self-hosted の既定は 2026-06 に 15 から 17 へ移行
- PG17 イメージには timescaledb/plv8/plcoffee/plls(changelog によっては pgjwt も)が含まれない

PGlite 0.5.10 は PG18.6 のため、VIRTUAL 生成列や EXPLAIN 出力の差に注意する。
  - sources: https://github.com/orgs/supabase/discussions/42681 , https://supabase.com/changelog/46080-self-hosted-supabase-upgrading-from-pg-15-to-17-breaking-change , https://releasebot.io/updates/supabase

- **[F25] (high)** Vault の代替案として、アプリ側で AES-256-GCM(Web Crypto)を使う方式も実現できる。Node20 と Cloudflare Workers の両方で crypto.subtle の AES-GCM が使え、AAD=user_id と kid 付きの形式で改ざん・行コピー検出とローテーションができる
  - detail: 07_aesgcm.mjs で次を確認した。
- 暗号文は `kid.iv.ct` で 88 文字
- 同じユーザーなら復号できる
- 他ユーザーの AAD では OperationError
- 改ざんすると OperationError
- 旧 kid の暗号文も復号できる

Cloudflare Workers の公式表で AES-GCM の encrypt/decrypt/importKey は ✓。

トレードオフ: 鍵がアプリサーバーの環境変数に置かれる(漏えい＝全トークン漏えい)。一方で可搬性と段階的ローテーションでは Vault より優れる。要件(N-02「Supabase Vault 等」、7 章)では Vault が第一候補。
  - sources: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ , https://supabase.com/docs/guides/database/vault

- **[F26] (low)** 検索をアプリ側で PostgREST フィルタ(or=(...,and(...)))に変換する代替案もある。ただし予約文字の二重引用符処理や、ワイルドカード * と % のエスケープが絡み、RPC 方式より壊れやすい(推測)
  - detail: PostgREST は `or=(age.eq.14,not.and(age.gte.11,age.lte.17))` のような入れ子の論理演算をサポートする。予約文字を含む値は二重引用符で囲み、like/ilike では * を % の別名として使える。

liqe の AST をこの形式に変換することは可能だが、利用者入力の , ( ) " * % _ \ をすべて正しく扱う必要がある。plpgsql RPC 方式(F08)のほうが SQL 断片を完全に固定できる。
  - sources: https://raw.githubusercontent.com/PostgREST/postgrest/main/docs/references/api/tables_views.rst

### recommendations
- 検索列は STORED 生成列 `search_text = lower(normalize(… , NFKC))` にする。STORED を明示し(PG18 では既定が VIRTUAL)、categories は IMMUTABLE ラッパー `private.immutable_array_to_string(text[],text)` 経由で連結し、区切りは改行(E'\n')にする。照合には LIKE を使う。正規化済みの列に ILIKE を使うと 2.5〜4.5 倍遅い。
- クエリ語の正規化とエスケープは DB 側で行う。データ側と同じ関数 `private.normalize_for_search` を使い、正規化 → 制御文字チェック → エスケープ(\ → % → _ の順)とする。Next.js 側で正規化・エスケープした値を比較に使わない(全角％や İ の差異で誤マッチするため)。
- 検索 RPC `public.search_checkins(p_ast jsonb, ...)` は次の構成にする: security invoker、`set search_path=''`(必要なら statement_timeout も)、WHERE に `c.user_id=(select auth.uid())` を明示、AST の厳格な検証(深さ・語数・語長・子要素数・type の許可リスト・制御文字)、`EXECUTE format(...) USING terms`。EXECUTE は authenticated のみに付与する(`revoke ... from public, anon`)。Next.js 側でもクエリ長と AST の大きさを事前に制限する。
- 2026-10-30 の Data API 既定変更を前提に、マイグレーションへ全テーブルの GRANT と全関数の revoke/grant を明示する。`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ... FROM PUBLIC` には頼らない(効かない)。pgTAP(`supabase test db`)で anon/authenticated/service_role の権限と RLS の回帰テストを用意する。
- トークンは Vault に保存し、foursquare_accounts には token_secret_id(uuid)だけを持つ。get/upsert/delete のラッパー RPC は public に security invoker で置き、EXECUTE は service_role のみにする。token_secret_id は列単位 GRANT か別テーブルで authenticated から隠す。`[db.vault]` は使わない(使う場合は `db push --skip-vault` を運用ルールにする)。ルートキーのローテーションは全ユーザーの再連携になる点を運用設計に明記する。
- checkins は細く保つ。raw JSONB は checkin_raws(user_id, checkin_id, raw, fetched_at)に分離する。分離しない場合は被覆インデックス `(user_id, created_at desc, id desc) INCLUDE (search_text) WHERE deleted_at IS NULL` と 2 段階 CTE を使う。PK は (user_id, id)。pg_trgm/GIN は MVP では作らない。将来の高速化候補は PGroonga(pg_bigm は Supabase に無い)。
- 総件数は 1 ページ目だけ計算する(またはヒット ID を 2 段階で集める)。深いページはキーセット方式(created_at,id)を検討する。
- 連携解除の猶予はアカウント単位の `foursquare_accounts.disconnected_at` で管理する案を基本設計で検討する。行単位の deleted_at の一括更新は重い。パージは pg_cron と SET 句なしのプロシージャ(バッチごとに COMMIT、参照はすべてスキーマ修飾)で行い、JST 03:15 なら '15 18 * * *'(GMT)とする。`cron.job_run_details` の掃除ジョブも併設し、ジョブはマイグレーションでのみ定義する。
- ローカル開発: Windows では Docker Desktop / Podman / Rancher Desktop のいずれかが必須。Supabase CLI は devDependency でバージョンを固定する(例 2.121.0、Node 20+)。L-01 の「Docker Compose ベース」は「Docker 互換ランタイム必須」と表現を改める。`.env.local` は `supabase status -o env --override-name ...` で生成し、新しい publishable/secret キーを前提にする。
- 基本設計の前に、open_questions の 1・2・4・5(本番ロケールと pg_trgm、Vault 権限、pg_cron のローカル動作、Supabase 実機での性能計測)を消化する。

### open_questions
- Supabase 本番とローカルの実際のロケール、および pg_trgm と lower() の挙動。手順: 両環境で `select datcollate, datctype, datlocprovider, datlocale from pg_database where datname=current_database();` と `select show_trgm('渋谷のラーメン'), show_trgm('駅'), lower('İSTANBUL'), lower(normalize('ＡＢＣ', NFKC));` を実行し、PGlite の結果(03_trgm/01_normalize)と比較する。
- Vault の権限が本番・ローカルとも想定どおりか。手順: `select has_function_privilege('service_role','vault.create_secret(text,text,text,uuid)','execute'), has_table_privilege('service_role','vault.decrypted_secrets','select'), has_table_privilege('service_role','vault.secrets','delete'), has_schema_privilege('authenticated','vault','usage');` を実行する。続いてラッパー RPC を作り、secret キーの supabase-js からは成功し、publishable キー＋ユーザー JWT では 42501 になることを確認する。
- ローカル CLI スタックの Vault ルートキーの所在・永続性と、本番鍵との相違(L-06)。手順: `supabase start` 後に `docker volume ls` と `docker exec <db コンテナ> ls -l /etc/postgresql-custom` を確認する。シークレットを作成してから `supabase stop` / `start`(--no-backup の有無)後に復号できるかを見る。本番は `supabase encryption get-root-key --project-ref <ref>` と値が異なることを確認する(値自体は記録しない)。
- pg_cron がローカル CLI と本番で、マイグレーションから定義・実行できるか。手順: マイグレーションに `create extension if not exists pg_cron with schema pg_catalog;` と `select cron.schedule('t','* * * * *',$$select 1$$);` を書く。`supabase db reset` → `select * from cron.job; select * from cron.job_run_details order by start_time desc limit 5;` で確認し、`supabase db diff` でジョブが差分に出るか(pg-delta)も見る。本番には db push 後に同じ確認をしてテストジョブを unschedule する。
- N-05 の実測。手順: 想定するコンピュートサイズ(Micro/Small)の Supabase で、gen_data.sql 相当(1 ユーザー 3 万件 × 10 ユーザー)を投入する。`explain (analyze, buffers)` で次を計測する: RPC、LIKE と ILIKE、raw の同居と分離、被覆インデックス、再起動直後のコールドキャッシュ。数百 ms 以内に収まるか、どの構成が必要かを決める。
- 2026-10-30 以降(および CLI 2.121.0 のローカル既定)で、新規テーブル・関数の権限が実際にどうなるか。手順: マイグレーションで GRANT 無しのテーブルと関数を作り、`select has_table_privilege('anon','public.t','select'), has_function_privilege('anon','public.f()','execute');` を確認する。
- 関数レベルの `set statement_timeout` が PostgREST v16 の RPC で効くか。手順: `create function public.slow() returns void language sql set statement_timeout='1s' as $$select pg_sleep(3)$$;` を authenticated で rpc 呼び出しし、57014 になるかを確認する。
- Windows で Docker を入れずに済むか。手順: WSL2 Ubuntu 22.04+(glibc 2.35)で `npm i -D supabase@2.121.0` → `SUPABASE_EXPERIMENTAL_STACK=1 npx supabase init` → `npx supabase start --runtime native` を実行し、Auth/PostgREST/Vault/pg_cron が動くか確認する(実験的機能)。Docker を使う場合は、社内ポリシーとライセンスに照らして Docker Desktop / Podman / Rancher Desktop のどれを使うかを決める。
- 連携解除の猶予を、要件のデータモデルにある行単位の checkins.deleted_at で実装するか、アカウント単位の foursquare_accounts.disconnected_at に寄せるか(要件の解釈と基本設計の判断)。
- liqe の AST から中間 AST({type:and|or|term})への変換で、NOT・フレーズ・ワイルドカード(*)をどう扱うか。F-26 に従ってエラーにするか(検証7のテーマとの整合)。

### artifacts
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\research\sb-db.md
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\schema.sql
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\gen_data.sql
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\00_env.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\01_normalize_generated.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\02_search_builder.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\03_trgm.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\04_perf.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\05_default_privs.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\06_narrow.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\07_aesgcm.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\08_purge_proc.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\out_00.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\out_01.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\out_02.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\out_03.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\out_04.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\out_05.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\out_06.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\out_07.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-pglite\out_08.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-cli\init-test\supabase\config.toml
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-cli\cli-help.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-cli\cli-help-encryption.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-cli\start-out.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\sb-db-cli\services-out.txt
