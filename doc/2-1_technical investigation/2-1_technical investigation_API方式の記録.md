# 技術調査報告書(別冊):API 同期方式の調査記録

> [技術調査報告書 本編](2-1_technical%20investigation.md) ｜ [基本設計書](../2_basic%20design/README.md)

本書は、当初検討していた「Foursquare API でチェックインを同期する方式」の調査記録(1〜14章)である。2026-10-16 にデータ取得方式を公式エクスポートのアップロードに変更したため、3〜7章・13〜14章は現行方式には当てはまらない。**章番号は本編と通しで、変更していない**(基本設計書からの「報告書 11章」などの参照はここを指す)。

| 章 | 現行方式での扱い |
|---|---|
| 1. 結論サマリ、2. Foursquare の規約と提供状況 | 方式変更の理由。2.1 は現在も重要 |
| 3〜7章(検証1〜5) | 不要(API を使わないため) |
| 8. Supabase CLI、10. DB | ブラウザ内で完結する方式(本編16章)では Supabase を使わないため不要。10章のうち NFKC 正規化の挙動は有効 |
| **9. liqe、12. フロントエンド** | **現行方式でも有効**(12章の proxy.ts・Cache Components・Server Actions は使わない) |
| 11. ホスティング | 静的配信だけになるため大半は不要。料金(デプロイのクレジット)は有効 |
| 13. 実地検証計画、14. 要件定義書への改訂提案 | 旧版。現行は本編16.3と要件定義書 v2.0 |

---

## 1. 結論サマリ

| 区分 | 結論 | 状態 | 基本設計への反映 |
|---|---|---|---|
| **規約(追加)** | Foursquare の利用ガイドライン上、一般の開発者はチェックインデータ(ID 以外)を**サーバーに保存できない**(キャッシュ禁止) | ❌ | 当初は「書面許諾を前提条件にする」と決めたが、その後、データ取得方式を公式エクスポートのアップロードに変更したため取り下げ(15章) |
| 検証1 Swarm ログイン | 自前の OAuth 実装 + Supabase Admin API(generateLink)+ verifyOtp で、メール送信なしにセッションを発行できる(ソースコードで確認) | ⚠️ | 方式を確定。ホスト環境での動作確認をスパイクで行う |
| 検証2 差分同期 | 方式A・Bともに「過去日時の追加・編集・削除」を取りこぼす。直近の一定期間を毎回読み直すハイブリッド方式を推奨 | ⚠️ | ハイブリッド方式を暫定採用。ページングの基準(時刻カーソル/offset)は実地検証で確定 |
| 検証3 API レスポンス | 検索に必要な項目は一覧APIで揃う。詳細APIで増えるのはコメント本文など。レスポンスの形がバージョンで揺れ、地名・カテゴリ名はロケールで変わる | ⚠️ | 一覧と詳細の raw を別々に保存。ロケールは ja に固定(暫定) |
| 検証4 revoke | レガシー OAuth にトークン無効化の手段は文書化されていない。新 OAuth 2.1 の revoke が効くかは実トークンで1回確認が残る | ⚠️ | 自DBのトークンを即削除し、Foursquare 側での解除手順を案内する。S-7 で効くと確認できた場合のみ revoke を追加 |
| 検証5 localhost | redirect_uri は複数登録でき、`http://localhost` の利用例もある。照合規則は未確認 | ⚠️ | ローカル用と本番用で Foursquare プロジェクトを分ける |
| 検証6 Supabase CLI | Windows でも npm で CLI は入るが、`supabase start` には Docker か Podman が必須 | ⚠️ | Docker 導入を前提にし、代替として開発用クラウドプロジェクトを用意 |
| 検証7 liqe | 実機で検証済み。AND/OR に優先順位が無い、小文字の and/or は語になる、記号でエラーになりやすい、などの癖があり、それを吸収する規則を試作で確立した | ✅ | 検索式の仕様と処理方式を確定 |
| ホスティング(追加) | Netlify の無料プランは公開運用に不向き(上限超過で全停止)。関数は既定で米国 Ohio、リージョン変更は Pro 以上 | ✅ | Netlify を維持し、公開時に有料プランを選ぶ(2026-10-16 ユーザー決定) |
| 技術スタック(追加) | Next.js 16.4.2、React 19.3.1。Supabase の JS ライブラリなどが Node 22 以上を必須にしたため Node 22 以上が必須。Netlify と揃えて Node 24 LTS を採用 | ✅ | バージョンを確定 |

---

---

## 2. 【最重要】Foursquare の規約と提供状況

### 2.1 データ保存(キャッシュ)の規定 ❌

Foursquare の「Usage Guidelines – Personalization APIs」(2026-02-12 更新、[公式ページ](https://docs.foursquare.com/developer/reference/usage-guidelines-personalization-apis))は、Personalization API から得たデータの保持を次のように定めている(本書作成者が公式ページを直接確認)。

| 属性 | Enterprise | Pay as You Go & Sandbox(一般の開発者) |
|---|---|---|
| venue_id / photo_id / fsq_addr_id | 無期限キャッシュ可 | 無期限キャッシュ可 |
| **それ以外のすべての属性** | 端末内24時間のみ(サーバー保存不可) | **キャッシュ禁止** |

- セルフサービスの開発者は、EULA 上「Pay as You Go」に該当する(EULA §3.1 がこのガイドラインの遵守を義務付けている)。
- 文言どおりに読むと、チェックイン本体・shout・店名・住所・日時をサーバーに保存して検索することはできない。これは本アプリの中核(F-10、F-13、F-25、F-33、F-40〜F-42、N-06)と衝突する。
- 旧規約も保存に厳しかった。2017年版は「チェックインは24時間ごとに更新」「どのデータも**更新せずに**30日を超えて保持しない」「アプリを認可していない利用者のデータは3時間まで」、2019年版は「**更新せずに**24時間を超えて保持しない」だった(定期的に取り直すデータの保持は認める書き方)。無期限保存を認めた公開文書は見つからない。
- キャッシュ規定そのものに「書面の合意があれば例外とする」という文言は無い。一方、EULA の冒頭には「Foursquare と個別契約(enterprise agreement)を結んでいる場合は、その契約が優先する」旨があり、商標規定にも書面合意による例外がある。標準の Enterprise 条件でもサーバー保存は不可なので、**サーバー保存を明示的に認める個別の書面許諾(契約)を得られれば運用できる余地がある**、という位置づけになる。

> 2026-10-16 のユーザー決定(当初): 現行方式(API 同期 + DB 保存 + 検索)で設計を続け、Foursquare の書面許諾を実装着手・公開の Go/No-Go 条件とする。
> → 同日、データ取得方式を公式エクスポートのアップロードに変更したため取り下げ(15章)。2.4 の問い合わせ文案は、API 方式に戻す場合の参考として残す。

### 2.2 その他の規約上の要件 ✅

| 要件 | 内容 | 根拠 |
|---|---|---|
| Attribution | データを表示しうるすべての画面に "Powered by Foursquare" を表示する | Personalization EULA §3.2 |
| クロール防止 | データを表示するページを検索エンジンに収集させない(noindex、robots.txt) | EULA §3.3 |
| 広告・データ流通の禁止 | 取得データを広告ネットワーク、データブローカー、収益化ツールに渡さない(ユーザーの同意があっても不可)。データ表示ページに第三者の広告・計測タグを置かない | EULA §6.2 |
| 商標 | Foursquare®、Swarm™、4SQ®、Check-in™ をアプリ名・ドメインに含めない。所定の免責文を掲載する。"Powered by Foursquare" ロゴは使える | Trademark & Brand Feature Guidelines |
| venue へのリンク | 詳細画面で venue に触れる場合、`?ref=プロジェクトID` 付きでリンクし、`rel=nofollow` は付けない。検索結果一覧は視覚的なクレジットだけでよい | Visual Crediting Policy |
| プライバシーポリシー | データの取得元・用途・保存方法を明記したポリシーを公開し、Developer Console に URL を登録する | Usage Guidelines、Console の必須項目 |
| 位置情報の同意 | 位置情報を扱う場合、適切な通知と同意取得が必要 | Usage Guidelines |

### 2.3 提供状況・費用・利用上の制約

| 項目 | 内容 | 状態 |
|---|---|---|
| 提供状況 | users/self/checkins などを含む「Personalization API」は、2025年7月頃からドキュメント上「Deprecated」と表示されている。廃止日・移行先は未告知。2026年6〜10月にも実利用の報告がある | ✅ |
| 停止リスク | バージョニング文書は「数か月以上の移行期間」とするが、Master Terms は予告なしの変更・停止を認めている | ✅ |
| 費用 | checkins / users 系は無料のまま(2026-06 の料金改定でも明記)。`/v2/venues/*` は Premium(1回目から課金)、`/v2/users/X/historysearch` は Pro(月500回まで無料)なので**呼ばない** | ✅ |
| 402 エラー | 2025年に users/self/checkins が 402 Payment Required を返し、サポート対応で約2か月かかった事例がある | ⚠️ |
| 新規アカウント | 開発者登録には審査(制裁リスト照合)がある。2024年3月から登録ユーザー向けに Public Beta として提供されており、新規でも使える見込みは高いが未確認 | ⚠️ |
| ログイン手段 | Web の OAuth 画面では、Foursquare へのログインがメールまたは電話番号へのワンタイムコード方式。公式に「Facebook でのログインはネイティブ認証のみ」とあり、Facebook だけで登録した利用者は Web 連携できない可能性が高い | ⚠️ |

### 2.4 問い合わせ文案

送付先の候補: Foursquare Developer Support(support.foursquare.com のチケット)。商標・名称の相談は Brand@foursquare.com。回答は PDF などで保存し、設計書から参照する。

```text
Subject: Permission request: storing authorized users' own check-ins (Personalization API, Pay as You Go)

Hello Foursquare Developer Support,

We are developing a web application (working title: "Checkin Search") that lets Swarm users
search their own check-in history by keywords (venue name, shout, address, category) with
AND/OR conditions. The service will be publicly available. Each user connects their own
Foursquare account via the legacy OAuth2 flow (/oauth2/authenticate).

Project: [project name / project ID in the Developer Console]
Endpoints we use (only): GET /v2/users/self, GET /v2/users/self/checkins (limit=250),
GET /v2/checkins/{checkin_id}. We do not call any Premium or Pro endpoints.

To provide fast keyword search over histories of tens of thousands of check-ins, we need to
store each authorized user's own check-ins on our servers, accessible only to that user.
We understand that the Usage Guidelines for the Personalization APIs state "no caching
permitted" for attributes other than venue_id, photo_id and fsq_addr_id for Pay as You Go &
Sandbox customers. Before launching, we would like to ask whether you could grant written
permission (or offer an agreement) for the following:

1. Storing, for each user who has authorized our app, the check-in objects returned by the
   endpoints above (including shout, created time, and embedded venue name/address/categories)
   for as long as the user keeps the connection, solely to provide search over that user's
   own history.
2. Retaining that data for 14 days after the user disconnects (so it can be restored if they
   reconnect), and then permanently deleting it. Users can also request immediate deletion.
3. Any conditions you require (refresh frequency, attribution placement, plan or contract
   type, fees).
4. If the Personalization API is discontinued or our access ends, whether we may keep the
   stored data so that each user can continue to search it, or whether it must be deleted.
5. Storing, for display only, the data returned by the check-in details endpoint (photos,
   likes and comments, which may include names of the user's friends). We do not store the
   signed share URL (checkinShortUrl).

Our safeguards:
- Data is visible only to the user who owns it. It is never shared with other users or third
  parties, and never used for advertising or data brokerage.
- Access tokens are encrypted at rest and never sent to browsers.
- "Powered by Foursquare" attribution on every page that displays the data; these pages are
  not indexable by search engines.
- A privacy policy that explains how we source, use and store user data, and explicit user
  consent before syncing location history.

We also have two technical questions:
a. Is there a supported way to revoke a legacy OAuth2 access token from our side when a user
   disconnects?
b. Is there a timeline for the deprecation of the Personalization API (v2 user endpoints)?

Thank you for your time. We look forward to your reply.

Best regards,
[Name / organization / contact]
```

和訳の要点:

- 認可した利用者本人のチェックイン(shout、日時、店名・住所・カテゴリを含む)を、その本人の検索のためだけに、連携中はサーバーに保存してよいか。
- 連携解除後14日間の保持(復元用)と、その後の完全削除でよいか。
- 必要な条件(更新頻度、表示、契約種別、費用)は何か。
- API が停止した場合や契約が終了した場合に、保存データを検索用に残してよいか(Master Terms §14 は契約終了時の破棄を求めているため)。
- 詳細API の結果(写真・いいね・友達のコメントなど第三者の情報を含む)を表示用に保存してよいか。共有用の署名付き URL は保存しない。
- 当方の保護策(本人のみ閲覧、第三者提供・広告利用なし、トークン暗号化、Attribution 表示、noindex、プライバシーポリシーと同意取得)。
- 技術的な質問2点(トークン無効化の手段、Personalization API の廃止予定)。

### 2.5 許諾が得られない場合の代替案

| 案 | 概要 | 課題 |
|---|---|---|
| エクスポート取込方式 | Foursquare 公式のデータエクスポート(Settings → Privacy Settings → "Initiate Data Download Request"。ZIP のリンクがメールで届く)を、利用者本人がアップロードして検索する。詳細は `doc/2-1_technical investigation/evidence/findings/export.md` | API のキャッシュ規定は「API が返したデータ」が対象のため、及ばない可能性が高い(要法務確認。ベニュー名などは個人的・非商用の利用許諾)。**チェックインの venue は {id, name, url} だけで、住所・市区町村・カテゴリは含まれない**(確度 high)。座標の有無は情報が矛盾。自動同期はできず、更新には再申請(2〜3日、最大7日)と再アップロードが必要 |
| 保存しない方式 | 検索のたびに API から全件を取得して照合する | 数万件で毎回数百リクエストが必要になり、レート制限(500回/時)と応答時間の両面で非現実的 |

---

---

## 3. 検証1: Swarm ログイン(OAuth と Supabase セッション発行)

### 3.1 Foursquare OAuth2 の仕様 ✅(反証チェック済み)

| 項目 | 内容 |
|---|---|
| 種別 | Developer Console 上で「Legacy」扱いの OAuth2(認可コード方式) |
| 認可 URL | `https://foursquare.com/oauth2/authenticate`(client_id, response_type=code, redirect_uri)。旧 v2 文書によれば、認可済みの利用者は同意画面なしで戻り、`/oauth2/authorize` は毎回同意を求める(実挙動は未確認、S-1 で確認) |
| トークン URL | `https://foursquare.com/oauth2/access_token`(client_id, client_secret, grant_type=authorization_code, redirect_uri, code)。サーバー間で実行。公式例は GET + クエリ。ダミー値では POST(フォーム)もハンドラに届いたが、メソッドを区別しない実装である可能性があり、正規の資格情報で POST が使えるかは未確認 |
| 応答 | `{"access_token": "..."}` のみ。公式文書は「permanent access token」(無期限)と表現 |
| refresh / スコープ / PKCE | refresh は非対応(`unsupported_grant_type`)。スコープと PKCE は文書に記載なし |
| state | 現行の公式文書には記載が無い。主要な OSS ライブラリが state 検証を有効にしたまま使っているため、そのまま返る可能性が高い(未確認) |
| API 呼び出し | `Authorization: Bearer <token>` ヘッダが使える(実測)。URL にトークンを載せない |
| users/self | `response.user.id`(文字列)、firstName、lastName、photo{prefix, suffix} など。email は空のことがある → 識別キーは id のみを使う |
| Console の登録項目 | Project URL、Privacy Policy URL、Redirect URL(複数可)が必須 |

### 3.2 Supabase セッション発行方式の比較 ✅(単独調査・ソースコードで確認)

| 方式 | 評価 | 理由 |
|---|---|---|
| **(a) Admin API でユーザー作成 → generateLink(magiclink)→ サーバーで verifyOtp** | **採用** | メールは送信されない(generateLink はリンク情報を返すだけ)。合成メールアドレスも形式チェックのみで受理される。「サインアップ無効」「メールプロバイダ無効」の設定は admin 経路と verify では参照されないため、公開のメール系入口を閉じたまま運用できる |
| (b) サーバーだけが知るパスワードで signInWithPassword | 不採用 | メールプロバイダの有効化が必須になり、公開のメール系入口も開く。利用者が自分でパスワードを変えるとログインが壊れる。鍵の漏えいで全アカウントが乗っ取られる |
| (c) 自前で JWT を署名 | 不採用 | リフレッシュトークンとセッション管理が無い。非対称鍵への移行後は鍵の扱いが煩雑 |
| (d) Supabase Custom OAuth Provider(2026-05 追加) | 不採用(将来検討) | userinfo のトップレベルに `sub` が必須だが、Foursquare の users/self は入れ子構造のためそのままでは失敗する(Open な issue あり)。さらに Foursquare のトークン(provider_token)がセッション Cookie に入ってブラウザへ送られ、N-02 に反する |

### 3.3 採用方式の注意点

| 項目 | 内容 |
|---|---|
| クライアントの分離 | secret key のクライアントは、ユーザーセッションがあれば RLS が効き、無ければ RLS をバイパスする(実験で確認)。Cookie 連携のクライアントに secret key を渡すと、Cookie が欠けたときに黙って特権になる。**用途別に3つに分ける**: ユーザー権限(publishable key + Cookie)、管理用(secret key、Cookie 非連携、サーバー専用)、セッション発行用(secret key で verifyOtp → 結果をユーザー権限クライアントの setSession で Cookie 化) |
| IP 単位のレート制限 | Supabase Auth の `/verify` は IP あたり30回/5分、`/token`(リフレッシュ)は150回/5分。サーバーから呼ぶとサーバーの IP に集中する。対策は `Sb-Forwarded-For` ヘッダで利用者 IP を渡すことと、上限値の引き上げ。**`Sb-Forwarded-For` は secret key で呼ぶ場合だけ有効**(publishable key では無視される。新規プロジェクトでは設定で有効化が必要)。そのため、publishable key のクライアントが自動で行うトークンのリフレッシュ(`/token`)はサーバーの IP で数えられる。利用者 IP は Netlify の `x-nf-client-connection-ip` から取る想定(根拠は Netlify フォーラムの回答のみで要確認。`x-forwarded-for` の左端は偽装されうる) |
| 合成メール | 自前ドメインのサブドメイン + ランダムなローカル部(例 `u_<uuid>@users.<自ドメイン>`)。Foursquare ユーザーIDを推測できる形で入れない |
| 識別情報の置き場所 | `user_metadata` は利用者が自由に書き換えられるため、認可に使わない。Foursquare ユーザーIDの正は自前テーブル(一意制約)に置く |
| 同時ログイン | 同じユーザーで generateLink が並行すると、先のリンクが無効になる。1回だけ再試行する |
| 認証確認 | 通常は `getClaims()`(JWT の署名を手元で検証、通信なし)。連携解除などの重要操作では `getUser()`(Auth サーバーに問い合わせ、失効済みセッションを検出できる) |
| サインアウト | scope は global(全端末)/ local(この端末)/ others。削除されるのはリフレッシュトークンで、発行済みのアクセストークンは有効期限まで有効 |
| Cookie | `@supabase/ssr` の cookieOptions で httpOnly を指定でき、実際に反映される(実験で確認)。公式は「サーバー側だけで処理する従来型の Web アプリなら可能」としている |
| ライブラリの版 | @supabase/supabase-js 2.118.0、@supabase/ssr 0.12.7。**supabase-js 2.110.0 以降は Node 22 以上が必須**で、Node 20 ではクライアント生成時に例外になる(実験で確認) |
| API キー | 新体系の publishable key(`sb_publishable_…`)と secret key(`sb_secret_…`)を使う。旧 anon / service_role キーは2026年末までに廃止予定で、2025年11月以降の新規プロジェクトには存在しない |

### 3.4 F-05(OAuth なしの再ログイン)

- ログアウト後に本人を確認する手段は、Foursquare OAuth か、端末に残した長期の資格情報しかない。要件どおり「OAuth の再実行なし」で再開するには、**端末記憶トークン**が必要になる。
- 案: 32バイトの乱数を httpOnly Cookie に保存し、DB にはハッシュのみを保存する。使うたびに差し替え(ローテーション)、古い値の再利用を検知したら全失効する。再開時は保存済みの Foursquare トークンで users/self を呼び、有効性と本人の一致を確認する。
- リスク: 共有端末では、ログアウト後も他人が再ログインできる。**要件オーナーの明示的な受け入れが必要。**
- 代替案: `/oauth2/authenticate` は認可済みの利用者を同意画面なしで即座に戻すため、「OAuth は再実行するが、ワンクリックで再ログインできる」形でも体験はほぼ同じになる(実挙動は未確認)。

### 3.5 未確認事項

- 本番相当の Supabase プロジェクトで、サインアップ無効・メールプロバイダ無効のまま方式(a)が動くか。
- 合成メールのドメインがホスト環境で受理されるか。
- `Sb-Forwarded-For` の実際の挙動と、無料プランで設定・上限変更ができるか。
- Foursquare の state の返却、拒否時のパラメータ、`/authenticate` の自動リダイレクト。

手順は「13. 実地検証計画」の S-1、S-3。

---

---

## 4. 検証2: 差分同期

### 4.1 パラメータの文書化状況(単独調査)

| パラメータ | 現行ドキュメント | 旧ドキュメント(2016〜2021) | 2026年の実利用報告 |
|---|---|---|---|
| v | 必須 | 必須 | — |
| limit | 最大250(既定20) | 最大250 | — |
| offset | あり(上限の記載なし) | あり | 深くページングできるかは報告が食い違う(下記) |
| sort | **記載なし** | newestfirst / oldestfirst | oldestfirst は「古い順の取得」ではなく、ページ内の並びを逆にするだけ |
| afterTimestamp | **記載なし** | あり | 機能する(複数の稼働例) |
| beforeTimestamp | **記載なし** | あり | 機能する。境界は包含(その時刻ちょうどのものを含む) |

- 期間を絞っても `response.checkins.count` は全件数のまま。
- offset の深さ: 「約7,400件・13,714件まで正常に取得できた」という報告と、「数百件を超えると先頭ページを繰り返す」「約2,500件で打ち切られる」という報告がある。条件の違いによる可能性があり、実アカウントで確認が必要。

### 4.2 方式A・方式B の盲点

方式A(offset で新しい順に取得し、既知のIDに達したら打ち切る)も、方式B(afterTimestamp で前回以降だけ取得する)も、次の3つを検知できない。
- 過去の日時で後から登録したチェックイン(Swarm には過去のチェックインを追加する機能がある)
- 既存チェックインの編集(shout の修正、写真の追加など。作成日時は変わらない)
- チェックインの削除

偽 API でのシミュレーション(6,063件)では、A・B とも未取得が1〜2件、削除の取り残しが1件発生した(`experiments/sync-sim-output.txt`)。

### 4.3 推奨方式(ハイブリッド) ⚠️

| 項目 | 内容 |
|---|---|
| 差分同期 | 毎回「保存済みの最新日時 − N日(14〜30日)」以降を読み直す。範囲の下限はアプリ側で判定し、afterTimestamp は転送量を減らす最適化として付けるだけにする |
| 件数照合 | 読み直しの後、API の総件数と DB の件数を比べ、ずれていれば全件同期を起動する |
| 定期全件同期 | 範囲外での追加と削除が同数だと件数照合でも検知できないため、利用者操作の「全件再同期」と、一定期間ごとの全件同期を用意する |
| 削除の確認 | 調査では「一覧から消えたチェックインは、詳細 API が `400 Invalid checkin id` を返すことを確認してから削除する」実装例があった。ただし同期中に詳細 API を呼ぶと F-15・N-04 に反するため、基本設計では「取得件数が総件数と一致して正常に完了した全件同期でのみ、見つからなかったものを削除する」方式にした(基本設計 9.2.2) |
| 全件同期のページング | beforeTimestamp(前ページの最古の時刻)を主にし、ページが進まない(同じIDが続く、最古の時刻が下がらない)場合は offset に切り替える。進捗は「取得した一意件数 ÷ 総件数」 |

シミュレーションでは、範囲内の追加・削除は1回の読み直しで解消し、範囲外の後付け登録は件数のずれから全件読み直しに移って回収できた。

### 4.4 未確認事項

offset の深さ、afterTimestamp の境界(包含か排他か)、後付け登録したチェックインの createdAt が訪問時刻か登録時刻か、編集時の一覧の変化。手順は S-2(`spikes/probe.mjs` の T1〜T6)。

---

---

## 5. 検証3: API レスポンス

### 5.1 一覧の項目(単独調査)

| 項目 | 内容・欠損の傾向 |
|---|---|
| id, createdAt(UNIX 秒), timeZoneOffset(分) | 常にある |
| type | checkin / shout / venueless |
| shout | コメントが無いとキー自体が無い(公式例では20%のみ) |
| venue | venue が無いチェックインでは、トップレベルの location{name, lat, lng} が入ることがある。自宅などの非公開 venue は住所が欠けやすく、座標がぼかされることがある(isFuzzed) |
| venue.location | address(約75%)、city(約90%)、state、country、cc、postalCode、lat、lng、formattedAddress |
| venue.categories | name、shortName、icon{prefix, suffix}、primary |
| photos | {count, items[]}。一覧では items が省略されることがある(旧ドキュメントの記述、未確認) |
| comments | 一覧では count のみ |
| likes, private, visibility, source, with, createdBy, sticker, event, editableUntil | 任意項目 |

### 5.2 詳細 API(`/v2/checkins/{id}`)で増える項目

user、canonicalUrl、checkinShortUrl(署名付きの共有URL。友達限定の閲覧制限を回避できるため**表示・共有しない**)、comments.items(本文・投稿者)、score(コイン)、overlaps など。**検索対象(店名・shout・住所・カテゴリ)は一覧で揃う**ため、F-15 の方針は妥当。削除済みの ID には 400 `Invalid checkin id` が返る。

### 5.3 形の揺れとロケール

- `venue.location.formattedAddress` が、バージョン(v)によって文字列の配列だったり、`{text, entities}` のオブジェクトだったりする。抽出処理は両方に対応させ、v は固定値にする。
- 店名・地名・カテゴリ名はロケールで変わる。`Accept-Language` で ja などを指定でき、未指定だと地名は「その国で最も一般的な言語」になる。英語で取得するとカテゴリが「Ramen Restaurant」になり、日本語の検索語に当たらないと推測される。実データでは、番地がローマ字(「4 Chome-2-8 Shibakoen」)で市区町村とカテゴリが日本語という混在例もあり、ja に固定しても番地は日本語にならない可能性がある。**ロケールは ja に固定する(暫定、S-2 の T7 で確認)**。途中で変える場合は全件の取り直しが必要。

### 5.4 画像 URL ✅

- 写真: prefix + サイズ + suffix。サイズは original、`300x300`(任意の幅x高さ)、`cap300`、`width960` など。
- カテゴリアイコン: prefix + {32, 44, 64, 88, 120} + suffix。`bg_` を付けると灰色背景。
- 認証なしで取得でき、リファラ制限も無い(Fastly CDN)。直接表示できる。

### 5.5 データ量の見積り

raw は1件あたり約1.7〜2.7KB、行全体で3〜4KB。3万件の利用者で約90〜120MB(推測)。Supabase の無料プランは DB 500MB なので、件数の多い利用者が数人で上限に届く。

---

---

## 6. 検証4: トークンの無効化(revoke) ⚠️(反証チェック済み)

- レガシー OAuth に revoke/deauthorize は文書化されていない。`/oauth2/revoke` などは存在しないパスと同じ 404 を返す。
- 新しい OAuth 2.1 サーバー(Swarm MCP 用)には `https://api.foursquare.com/oauth21/revoke` がある。クライアント認証なしで 200 を返す実装だが、**レガシーのトークンに効くかは未確認**(トークン体系が違うため効かない見込み)。実トークンで「revoke → users/self が 401 になるか」を1回試せば判定できる。
- 利用者が Foursquare 側で連携を解除する画面として、`app.foursquare.com/settings/connections` が実在する(中身は未確認)。

**結論**: F-03 は「自DBの暗号化トークンを即削除し、Foursquare 側の解除画面へ案内する」とする。N-09 は、文書化された手段が無いため現時点では実施しない(「実現不可」とは断定しない)。S-7 で効くと確認できた場合だけ、revoke 呼び出しを追加する。

---

---

## 7. 検証5: ローカルでの OAuth ⚠️

- Developer Console の Redirect URL は複数登録できる(Console の実装で確認)。
- 2025〜2026年の OSS で `http://localhost:8765/callback` や `http://localhost` を登録して使っている例があり、localhost は使える可能性が高い。
- 完全一致か前方一致か、HTTPS が必須かは未確認。HTTPS が必須なら `next dev --experimental-https`(mkcert)で `https://localhost:3000` を使う。
- ローカル用と本番用で Foursquare プロジェクト(Client ID / Secret)を分ける。Netlify のデプロイプレビューはホスト名が変わるため OAuth を通さず、OAuth を試す検証環境には固定ドメインを用意する。

---

---

## 8. 検証6: Supabase CLI ローカルスタック ⚠️(単独調査)

| 項目 | 結果 |
|---|---|
| CLI の導入 | npm の devDependency(supabase 2.121.0)で Windows にも入る。`init` と `help` は動作確認済み |
| `supabase start` | Docker か Podman が無いと即エラー(実測)。Docker 不要の native runtime(実験的)は Linux/macOS のみ |
| ローカルの構成 | PostgreSQL 17.11、Auth(GoTrue)v2.197.0、PostgREST v16.4。ポートは API 54321、DB 54322、Studio 54323、Mailpit 54324 |
| マイグレーション | `migration new` → `db reset`(ローカル、適用後に seed)→ `db push`(本番)。権限調整や DML は差分検出(`db diff`)で拾えないことがあるため、手書きで管理する |
| Vault | pgsodium から独立(0.3.x)。service_role には Vault の権限が付与済み。ルートキーはプロジェクトごとに DB の外で管理され、ローカルスタックは初回起動時に乱数で生成する(=本番と別の鍵、L-06)。**ルートキーをローテーションすると旧データは復号できない** → 全利用者の再連携が必要になる。`db push` は config.toml の Vault 設定でリモートを上書きするため、config.toml では Vault を使わない |
| pg_cron | Supabase の事前ロード対象に含まれ、マイグレーションで `create extension pg_cron with schema pg_catalog` と `cron.schedule(名前, …)` を定義できる。同名の登録は上書き。既定のタイムゾーンは GMT。実行履歴は自動削除されない。無料プランのプロジェクトは1週間アクセスが無いと一時停止し、cron も止まる |
| Data API の権限変更 | **2026-10-30 から既存プロジェクトでも、新規テーブルが anon/authenticated/service_role に自動で GRANT されなくなる。** マイグレーションに GRANT を明記する必要がある。関数の EXECUTE は PostgreSQL 既定の PUBLIC 付与が残る |
| 既定権限の落とし穴 | `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` は効果が無い(PGlite で確認。Supabase の公式ドキュメントに載っている書き方だが効かない)。関数ごとに revoke/grant する |
| 要件の表現 | L-01 の「Docker Compose ベース」は、利用者が compose を書くわけではないため「Docker 互換ランタイムが必要」と改めるのが正確。L-03 の「anon key・service role key」は「publishable key・secret key」に改める |

---

---

## 9. 検証7: liqe による検索式のパース ✅

### 9.1 バージョンと保守状況

liqe 3.8.7(最終リリース 2026-06-11)。README 上は個人プロジェクト扱い。3.8.3 以前は数字で始まる語(`3丁目`、`7-Eleven`、`1号店` など)を解析できない(3.8.4 のリリースノート「support parsing strings starting with numbers」)。過去版での手元確認では 3.8.1 以前は日本語の語もエラーになった。**検証済みの 3.8.7 に固定する**。

### 9.2 パース結果の要点(150ケースを実測)

| 観点 | 結果 |
|---|---|
| 基本 | `ラーメン カフェ`(暗黙 AND)、`A AND B`、`A OR B`、`A OR (B AND C)` は期待どおり |
| **優先順位** | **AND と OR に優先順位が無く、左から順に結合する**。`A OR B AND C` は `(A OR B) AND C`、`ラーメン 渋谷 OR 新宿` は `(ラーメン 渋谷) OR 新宿` になる |
| 小文字の演算子 | `a and b`、`a or b` は演算子ではなく検索語になる。`&&`、`||` は構文エラー |
| 全角 | 全角スペース・全角括弧は区切りとして認識しない。パース前に半角へ置き換えれば期待どおりになる |
| 引用符 | `"一蘭 渋谷"` は1語。閉じていない引用符はエラー。`「」`、`“”` は引用符として扱われない |
| フィールド指定など | `venue:一蘭`(フィールド)、`count:>5`(比較)、`[1 TO 5]`(範囲)、`/re/`(正規表現)、`NOT A`・`-A`(否定)はそれぞれ別の構文として認識される → すべて検出してエラーにできる |
| ワイルドカード | `ラーメン*` は `*` を含む普通の語として返る(印は無い) |
| 記号でのエラー | `H&M`、`McDonald's`、`100%`、`C++`、`12:30`、`https://…`、`a/b`、`Hello!` などは、引用符で囲まないと構文エラーになる。引用符で囲めば語として扱える |
| NFKC を先にかけた場合 | `㈱` が `(株)` になって括弧扱いでエラー、`12：30` が `12:30` になってエラーなど、副作用がある → **入力全体には NFKC をかけない** |
| 括弧と空白 | `A AND(B OR C)`、`(A)B`、`A(B)` のように括弧が語に密着していると構文エラーになる。括弧の前後には空白が必要 |
| 性能 | 現実的な長さ(200文字程度)なら 1ms 前後。ただし引用符なしの長い1語では処理時間が長さの2乗で増える(1万文字の1語で約6.7秒、実測)→ **パース前に長さを制限する** |

### 9.3 検索式の規則(試作で確立)

| 規則 | 内容 |
|---|---|
| パース前の正規化 | 空白類(全角スペース・改行・タブなど)を半角スペースに、全角括弧を半角に、全角・スマートの二重引用符を `"` に置き換える(1文字→1文字なので、エラー位置がずれない)。語そのものの NFKC 正規化はパース後に行う |
| 演算子 | 大文字の AND / OR のみ(全角の ＡＮＤ も可)。小文字の and/or はエラーにして大文字での入力を促す(語として検索したい場合は引用符で囲む) |
| AND と OR の混在 | 同じ括弧の階層で AND(暗黙を含む)と OR を混ぜたらエラーにし、括弧を付けた例を示す(例: `ラーメン AND (渋谷 OR 新宿)`) |
| 未対応構文 | フィールド指定・比較・範囲・正規表現・否定(NOT、`-語`)・ワイルドカード(`*`、`?`)はエラー(F-26)。メッセージで引用符による回避方法を案内する |
| 記号 | 構文エラーの位置の文字に応じて、「記号を含む語は "H&M" のように引用符で囲んでください」などの具体的な案内を出す |
| 括弧の空白 | 括弧が語に密着している場合は、「括弧の前後には空白を入れてください」と案内する |
| 上限 | 入力200文字、1語50文字、語数10、括弧の入れ子5段(アプリ側)。DB 側でも語数16、1語100文字、深さ8で再検証する |
| 解釈の表示 | 実際に検索した条件を「解釈: ラーメン AND (渋谷 OR 新宿)」のように表示する |
| 簡約 | 同じ演算子の入れ子は平坦化し、同じ語の重複は除く |

### 9.4 SQL 生成と DB での検証(PGlite)

- 中間AST(`{type:'and'|'or', children}` / `{type:'term', value}`)を DB 関数に渡し、関数の中で WHERE 句を組み立てて `EXECUTE … USING 語の配列` で実行する方式が動作した。SQL 文字列に入るのは固定の断片と配列の添字だけ。
- `x') OR 1=1 --` や `'); DROP TABLE checkins; --` は普通の語として扱われた。不正な中間AST(未知の type、深すぎる入れ子、語数超過、空語など)はすべて DB 側で拒否できた。
- 試作(TypeScript)の生成結果、DB 関数の結果、JS の参照評価の3つが、29ケースすべてで一致した(`prototypes/search-e2e-pglite-result.txt`)。
- **NFKC は全角の ％ ＿ ＼ を LIKE の特殊文字に変える。** エスケープは必ず正規化の後に、DB の中で行う(順序を逆にすると誤マッチすることを再現した)。

---

---

## 10. 追加調査: DB の正規化・性能・権限(単独調査、PGlite)

| 項目 | 結果 |
|---|---|
| 生成列 | `lower(normalize(…, NFKC))` を使った STORED 生成列は作れる。`array_to_string` と `concat_ws` は IMMUTABLE でないため使えない → IMMUTABLE な SQL ラッパー関数を通す。`pg_catalog.normalize(s, NFKC)` という書き方はエラーになる |
| 正規化の結果 | 全角英数→半角、半角カナ→全角、全角スペース→半角、①→1、㈱→(株) など。**ひらがなとカタカナ、〜と～は統一されない**(F-23 の範囲外) |
| LIKE と ILIKE | 正規化・小文字化済みの列に対しては LIKE で十分。ILIKE は 2.5〜6.5倍遅い(PGlite、語数などの条件による)。結果は同一(6ケースで件数一致を確認) |
| pg_trgm | 日本語からもトライグラムは作れるが、1〜2文字の語(「駅」「渋谷」)ではインデックスが全件走査に退化し、利用者単位の検索ではプランナが選ばなかった → **MVP では作らない**。将来の高速化は PGroonga(Supabase で利用可。pg_bigm は無い) |
| 性能 | 1利用者5万件で、総件数の計算を含む検索が 200〜300ms(PGlite の参考値。ネイティブの PostgreSQL では数十ms程度と推測。未計測で S-6 で確認)。RLS の条件を `(select auth.uid())` と書くと 4.3倍速い |
| raw の置き場所 | raw を検索用テーブルと同じ行に持つと、テーブルが約4倍に膨らみ走査が遅くなる → **raw は別テーブルに分ける** |
| RLS と LIMIT | RLS 経由だと、索引順に読んで50件で打ち切る最適化が効かず、全件を並べ替える(127ms 対 7ms)。ただし総件数の計算(F-31)で全件の評価は結局必要になるため、差は総件数の計算に吸収される。実機計測で判断する |
| ソフトデリート | 3万行の deleted_at を一括更新すると 8.4秒、復元に 7.0秒かかった(PGlite)→ **アカウント単位のフラグで管理する方が軽い** |
| レート制限 | DB 関数でユーザー単位の固定ウィンドウを実装できた(31回目で拒否)。読み取り専用トランザクションでは記録できないため、RPC は POST で呼ぶ(supabase-js の既定)。拒否時は例外で増分もロールバックされる |
| 物理削除 | 1,000件ずつのバッチ削除で 3,000件を 368ms、再実行は0件(冪等)。バッチごとに COMMIT するプロシージャには `SET` 句を付けられない(付けると COMMIT がエラーになる)→ 参照をすべてスキーマ修飾する |
| タイムアウト | 関数に `set statement_timeout` を付けると、REST 経由でも有効(公式) |

---

---

## 11. 追加調査: ホスティング ✅(反証チェック済み)

| 項目 | Netlify | Cloudflare Workers(参考) |
|---|---|---|
| Next.js 対応 | 公式アダプタで App Router、Server Actions、Route Handlers、Middleware、ISR を「Full Support」 | OpenNext 経由。Next.js 16 の proxy.ts は実験的対応(メンテナは「サポートする意図はない」と発言) |
| 実行時間 | 同期関数60秒(公式、変更不可)。ただし 2025-09-04 より前に作ったアカウント(レガシープラン)では10秒のままという報告がある | CPU 時間(待ち時間は含まない)で Free 10ms、Paid 30秒 |
| リージョン | 既定は米国 Ohio。変更は Pro 以上(東京 nrt を選べる) | 利用者の最寄り拠点 |
| 料金 | クレジット制(2025-09-04 以降に作成したアカウントのみ)では、Free は月300クレジットの上限で、**超えるとチームの全サイトが停止**し、追加購入もできない。本番デプロイ1回で15クレジット消費(全プラン)。Personal $9/月(1,000クレジット)、Pro $20/月。それ以前のアカウントはレガシープラン(関数 12.5万回/サイト/月、帯域 100GB/月など)のままで、クレジット制への移行は一方向 | Paid $5/月〜 |
| レート制限 | コードで定義するルールのみ。集計単位は「IP + ドメイン」だけでユーザー単位は不可。Next.js アダプタが作る関数には設定を付けられない | Rate Limiting binding(結果整合で精度は緩い) |
| Middleware / proxy | Edge Functions(Deno)上で動き、CPU 50ms/リクエストなどの制限がある。proxy.ts のバンドル不具合 issue(#3562・#3575・#3560)が未解決。Windows でのローカルビルドの報告が多いが、Netlify CI 相当のビルドでの報告もあり、クラウドビルドで回避できるかは未確認 | 実験的対応、未解決 issue 多数 |
| 環境変数 | UI/CLI/API で設定したものだけが関数から見える。スコープの限定は Pro 以上 | — |
| Windows | クラウド側でビルドできる(上記の proxy.ts の不具合が回避できるかは 15.3 の S-4 で確認) | 完全サポートは保証されず WSL/CI 推奨 |

**結論(2026-10-16 ユーザー決定)**: Netlify を維持し、公開時にプランを決める。候補は Personal + Supabase も Ohio(us-east-2)に置く構成か、Pro + 関数を東京に置き Supabase も東京にする構成。**関数と DB は同じリージョンに置く**(Ohio↔東京は往復約136ms で、DB への問い合わせのたびに加算されるため)。レート制限と定期削除は DB 側で実装し、移植性を保つ。同期の1リクエストは10秒以内に収める(レガシープランの報告値に合わせる)。

---

---

## 12. 追加調査: フロントエンド技術スタック ✅(単独調査、一部実機)

| 項目 | 結果 |
|---|---|
| Next.js | 最新 16.4.2。**2026-10-14 のセキュリティ更新(Server Actions への DoS など)のため 16.4.1 以上が必須** |
| Next.js 16 の変更 | middleware.ts は proxy.ts に改名(Node.js ランタイム固定)。cookies()/headers()/params/searchParams は await 必須。Turbopack が既定。`next lint` は廃止(ESLint を直接使う)。typedRoutes は安定版。Cache Components は 16.4 で推奨になり、Next.js 17 で既定化の予定 |
| React | 19.3.1。React Compiler 1.0 は安定版だが既定で無効 |
| Node.js | Node 20 は 2026-04-30 に EOL。supabase-js(2.110 以降)、Vitest 5、Playwright、jsdom 30 などが Node 22 以上を要求し、Node 20.11 では supabase-js がクライアント生成時に例外になる(2.109 でも同様)。ESLint 10 も Node 20.11 では動かない(要件は ^20.19 / ^22.13 / 24 以上)→ Node 22 以上が必須。Netlify の関数のフォールバックと揃えるため **Node 24 LTS(24.22.0)を開発・本番の共通基準にする**。なお Node 24 は 2026-10-20 に Maintenance LTS に移り、Node 26 が 2026-10-28 に LTS になる(Node 26 は AWS Lambda での正式対応後に再評価) |
| TypeScript | 7.0.2 は JS API が無く typescript-eslint が非対応 → 6.0.3 に固定 |
| UI | Tailwind CSS 4.3.3。shadcn/ui(CLI 4.21.5)は 2026-07 から Base UI が既定。必要なコンポーネント(pagination、card、badge、sheet、dialog、skeleton、progress、toast、alert、empty など)はすべてある |
| ダークモード | next-themes は 2025-03 以降更新が無く、React 19 で警告が出る問題が未解決 → MVP では OS 設定に追従する CSS のみ |
| 日本語フォント | Windows でも 2025年4月から Noto Sans JP が標準搭載された。Web フォント(Noto Sans JP)は約5.3MB・124ファイルになる → システムフォントを使う |
| 日時表示 | `Intl.DateTimeFormat` にオフセット文字列(`+09:00`)を渡す方式は Node 22 未満や古いブラウザでエラー → 「UNIX 時刻 + オフセット分」を UTC として整形する方式を使う |
| テスト | Vitest 5.0.5(Node 22.12 以上)、Playwright 1.64.1 |
| その他 | `next dev` がプロジェクト直下に AGENTS.md を自動生成する(設定で無効化可) |

---

---

## 13. 実地検証(スパイク)計画(API 方式。15.3 に置き換え済み)

API 方式で計画したもの。方式変更により、S-0〜S-2・S-7 は不要になった。S-3〜S-6 に相当する内容は 15.3 に引き継いでいる。

| ID | 内容 | 合格条件 | 対応する検証 |
|---|---|---|---|
| S-0 | Foursquare への書面照会(2.4 の文案) | 保存と14日保持について書面で許諾を得る | 規約 |
| S-1 | Foursquare 開発者登録 → プロジェクト作成 → 実アカウントで OAuth → users/self、users/self/checkins?limit=250、checkins/{id} | 402/403 が出ずに取得できる。state がそのまま返る。拒否時の戻り値を記録する | 検証1・5 |
| S-2 | `spikes/probe.mjs` を3,000件以上のアカウントで実行(T1〜T10) | offset の深さ、afterTimestamp/beforeTimestamp の境界、ロケール差、詳細との差分、1ページの所要時間(p50/p95)と応答サイズを記録する | 検証2・3 |
| S-3 | Supabase(本番相当の検証プロジェクト)で、サインアップ無効・メールプロバイダ無効のまま createUser → generateLink → verifyOtp | セッションが発行され、メールが送信されない。公開のメール系エンドポイントが拒否される | 検証1 |
| S-4 | Docker 導入後、ローカルスタックで Vault・pg_cron・権限・ロケールを確認 | 3.3・8章の想定どおりに動く | 検証6 |
| S-5 | Netlify に最小アプリをデプロイ | 同期関数の実際のタイムアウト、proxy.ts でのセッション更新、ビルドの成否、日本からの応答時間を記録する | ホスティング |
| S-6 | Supabase に1利用者3〜5万件の fixture を投入して検索を計測 | 総件数を含む検索がサーバー処理で数百ms以内(N-05) | 性能 |
| S-7 | 実トークンで `/oauth21/revoke` を試す | 呼んだ後に users/self が 401 になれば revoke を採用、ならなければ不採用 | 検証4 |

---

---

## 14. 要件定義書への改訂提案

| 要件ID | 現行 | 改訂案 | 理由 |
|---|---|---|---|
| (新規) | — | Foursquare からの書面許諾(データ保存)を、実装着手・公開の前提条件として追加 | 2.1 |
| F-03 | アクセストークンを即座に無効化・削除 | 自DBの暗号化トークンを即削除し、Foursquare 側の解除画面へ案内する | 6章(revoke 手段なし) |
| N-09 | 可能であれば Foursquare 側でも無効化 | 文書化された手段が無いため、現時点では実施しない(S-7 で効く場合のみ追加) | 6章 |
| 7章 | 同期処理は Server Action(初回)+ ログイン時差分同期 | ブラウザが繰り返し呼ぶ Route Handler で、1リクエスト = Foursquare API 1回に分割する | Server Actions はクライアントから1件ずつ順番に実行され、繰り返し呼ぶ処理に向かない。関数のタイムアウトを避けるため |
| F-05 | 保存済みトークンで OAuth なしに再開 | 端末記憶方式で実現し、共有端末のリスクを受け入れる。または「再同意不要のワンクリック再ログイン」に読み替える(要件オーナーの判断) | 3.4 |
| F-10 | offset で全件取得 | 時刻カーソル(beforeTimestamp)を主、offset を副とする(S-2 で確定) | 4.1 |
| F-12 | 方式A/B のどちらか | 直近一定期間の読み直し + 件数照合 + 全件再同期のハイブリッド方式 | 4.2〜4.3 |
| F-14 | レート制限・トークン失効時は再連携を促す | エラー種別で分ける。トークン失効は再連携、レート制限は待って自動再開、日次上限は翌日再開 | レート制限は再連携しても解消しない |
| F-21 | ILIKE の組み合わせ | 正規化・小文字化した列に LIKE を使う(大文字小文字を区別しない点は同じ) | 10章(ILIKE は2.5〜6.5倍遅い) |
| 5章 | checkins.raw、checkins.deleted_at | raw は別テーブル。ソフトデリートはアカウント単位 | 10章 |
| 7章 | — | Next.js 16.4.x、Node.js 24 LTS などのバージョンを明記 | 12章 |
| L-01 | Docker Compose ベース | Docker 互換ランタイム(Docker Desktop / Podman / Rancher Desktop)が必要 | 8章 |
| L-03 | anon key・service role key | publishable key・secret key | 3.3 |

---
