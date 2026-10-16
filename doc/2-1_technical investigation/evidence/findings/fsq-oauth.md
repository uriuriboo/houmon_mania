# 10_result.json (agent a6ae75e89c877b90f)

## TOPIC: Foursquare(Swarm) OAuth2・アカウント連携・API利用規約 (key: fsq-oauth)

### summary
2026-10-16時点の調査結果です。v2のユーザー系エンドポイント(users/self, users/self/checkins, checkins/{id})は稼働しており、ドキュメントにも載っています。ただし、これらを含む "Personalization API" は docs トップと Developer Console の両方で "Deprecated" 表示になっています。サンセット日は告知されていません。料金面では、2026-06-01の改定後も checkins/users 系は無料のままです。ただし /v2/venues/{id} は Premium、/v2/users/X/historysearch は Pro 料金です。2025-12には users/self/checkins で 402 Payment Required が返ったという報告もあります。

OAuth は Console 上で "Legacy" 扱いの OAuth2(認可コード方式)です。
- 認可: https://foursquare.com/oauth2/authenticate
- トークン交換: https://foursquare.com/oauth2/access_token(サーバー間で実行)
- 応答は access_token のみです。refresh_token グラントは実測で unsupported_grant_type、スコープも PKCE も文書に記載がありません。

ダミー値のみで実測した結果は次のとおりです。
- レガシーには revoke 用エンドポイントがありません(/oauth2/revoke 等は 404)。このため N-09 は実現できません。
- 2026-10時点で、Swarm MCP 用の OAuth 2.1 サーバ(api.foursquare.com/oauth21/*)が公開されています。PKCE必須、スコープ、refresh_token、revocation_endpoint を備えています。ただし client_id は Client ID Metadata Document の HTTPS URL で、かつ trusted domains に載ったドメインに限られます。一般のWebアプリからは使えません。
- API のエラーは HTTP ステータスではなく meta.errorType で判定する必要があります。トークンが無いと 400 invalid_auth、無効または取消済みだと 401 invalid_auth が返ります。
- レート制限はトークンごと・1時間あたり・資源グループごとに500回です。

規約面の主な制約は次のとおりです。
- チェックインデータを表示する画面には "Powered by Foursquare" の表示が必要です。
- Swarm™/Foursquare® はアプリ名やドメインに使えません。
- クロール防止、広告ネットワークへのデータ移転禁止、プライバシーポリシー URL の登録が求められます。
- データ保存(キャッシュ)のルールは現行文書では不明瞭です。raw JSON の永続保存(F-13/N-06)は Foursquare に書面で確認することを推奨します。

redirect_uri は複数登録できます(Console 実装で確認)。http://localhost も第三者の事例から使える可能性が高いですが、完全一致か前方一致か、HTTPS が必須かは未確認です。

最大の未確認事項は、新規の Developer アカウント(審査あり)で v2 OAuth とチェックイン取得が実際に通るかです。これは最初の実地スパイクで go/no-go を判定するべきです。詳細メモ・実測ログ・Next.js 実装スケッチは artifacts のファイルにまとめています。

### findings

- **[fsq-oauth-01] CRITICAL (high)** v2ユーザー系エンドポイントは2026-10時点で稼働・文書化されているが、それを含む Personalization API はドキュメント上 Deprecated 表示。サンセット日は未発表。
  - detail: docs.foursquare.com トップの製品一覧に "Personalization API - Deprecated" とあり、隣の "Users API New!" と "Places API New!" は新APIとして表示されています。Developer Console のバンドルにも "Get Started with the Personalization API (depr)" のリンクがあります。Get User Checkins 等の個別ページは今も Public Beta 表記で、limit は最大250(既定20)、offset 指定です。本調査で /v2/users/self/checkins に無効トークンを送ると 401 invalid_auth が返り、エンドポイントは稼働しています。第三者による2026年の利用例も複数あります(shkspr.mobi 2026-06、swarm-downloader 2026-02)。サンセット日や移行先の告知は見つかりませんでした。将来停止するリスクがあるため、N-06(raw保持)の意義は大きいです。
  - sources: https://docs.foursquare.com/ , https://docs.foursquare.com/developer/reference/get-user-checkins , https://ss0.4sqi.net/developers/main.991bed132b6a42d0d1aa.js , https://shkspr.mobi/blog/2026/06/using-foursquares-api-to-post-location-checkins-to-social-media/ , https://github.com/ericblue/swarm-downloader

- **[fsq-oauth-02] CRITICAL (high)** 2026-06-01の料金改定後も checkins / users 系 v2 エンドポイントは無料。ただし /v2/users/X/historysearch は Pro、/v2/venues/X 以下は Premium の課金対象。users/self/checkins で 402 Payment Required の報告がある。
  - detail: Upcoming Places API Changes(updatedAt 2026-10-05)に "Any checkins, lists, tastes, tips, and users endpoints not mentioned in the above lists will remain free." とあります。Pro の無料枠は500 calls、超過分は $15 CPM〜です。Legacy V3 は 2026-05-15 に廃止されました。spokenlikeageek(2025-12-01)は users/self/checkins で HTTP 402 を受け、サポート対応に約2か月かかったと書いています(原因は不明)。課金クレジット不足との関連は推測です。本アプリは users/self、users/self/checkins、checkins/{id} だけを使い、詳細画面で venues/{id} を呼ばない設計にすべきです。
  - sources: https://docs.foursquare.com/developer/reference/upcoming-changes , https://foursquare.com/pricing/ , https://www.spokenlikeageek.com/2025/12/01/exporting-foursquare-check-ins-to-day-one/ , https://foursquare.com/legal/terms/enterprise-developermasterterms/

- **[fsq-oauth-03] CRITICAL (high)** レガシーOAuth2の仕様: 認可は https://foursquare.com/oauth2/authenticate(client_id, response_type=code, redirect_uri)、交換は https://foursquare.com/oauth2/access_token(client_id, client_secret, grant_type=authorization_code, redirect_uri, code)。応答は {"access_token": ...} のみで、refresh_token グラントは非対応。
  - detail: 文書上、交換はサーバー間で行い、応答は JSON の access_token のみ、API 呼び出しは Authorization: Bearer です。新 Users API 版の文書では、交換時の redirect_uri は認可時と "Must exactly match" とされています。

ダミー値による実測結果:
- GET(クエリ)と POST(フォーム)のどちらでも 400 {"error":"invalid_client"} が返り、405 ではないので両メソッドともハンドラに到達しています。
- grant_type=refresh_token と client_credentials は 400 {"error":"unsupported_grant_type"} で、refresh は使えません。
- トークンエンドポイントのエラーは RFC 6749 形式で、API 本体の meta 形式とは異なります。

スコープ・expires_in・PKCE は文書に記載がありません。旧 v2 ドキュメントの和訳によると、トークンは現状無期限で、ユーザーは設定画面からいつでも切断できます。また /authenticate は認可済みユーザーを自動でリダイレクトし、/authorize は毎回同意を求めます。
  - sources: https://docs.foursquare.com/developer/reference/v2-authentication , https://docs.foursquare.com/developer/reference/personalization-apis-authentication , https://docs.foursquare.com/fsq-developers-users/reference/authentication.md , https://docs-foursquare-api-ja.readthedocs.io/ja/latest/overview/auth.html , https://foursquare.com/oauth2/access_token

- **[fsq-oauth-04] CRITICAL (high)** レガシーOAuthのアクセストークンを無効化(revoke)するエンドポイントは存在しない。新 OAuth 2.1 サーバには revocation_endpoint があるが、trusted ドメインのクライアント専用で本アプリは使えない。よって N-09 は実現不可。
  - detail: 公式文書に revoke/deauthorize の記載はありません。

実測結果:
- foursquare.com/oauth2/revoke(GET/POST)、/oauth2/deauthorize(POST)、app.foursquare.com/oauth2/revoke(POST)はいずれも 404 でした。
- これは存在しないパス(/oauth2/doesnotexist)と同じ応答で、実在する /oauth2/access_token は 400 を返します。
- api.foursquare.com/v2 配下は、存在しないパスでもトークン検査が先に走って 401 を返すため、存在確認には使えません。

https://api.foursquare.com/.well-known/oauth-authorization-server には revocation_endpoint=https://api.foursquare.com/oauth21/revoke が載っています。しかし /oauth21/appinfo に非URLの client_id を送ると "client_id must be the HTTPS URL of a Client ID Metadata Document"、example.com を使うと "Client domain 'example.com' is not in the trusted domains list" が返ります。

このため F-03 は「自DBのトークンを即削除し、Foursquare 側での解除方法をユーザーに案内する」に変更が必要です。
  - sources: https://docs.foursquare.com/developer/reference/v2-authentication , https://foursquare.com/oauth2/revoke , https://api.foursquare.com/.well-known/oauth-authorization-server , https://api.foursquare.com/oauth21/appinfo

- **[fsq-oauth-05] (high)** 2026-10時点で Swarm MCP 用の OAuth 2.1 認可サーバ(issuer https://api.foursquare.com)が公開されている。PKCE(S256)必須、スコープ、refresh_token、introspection、revocation を備え、client は CIMD の公開クライアントのみ(DCR なし)。
  - detail: メタデータの内容:
- grant_types: authorization_code, refresh_token
- token_endpoint_auth_methods: none
- client_id_metadata_document_supported: true
- scopes: checkins:read, profile:read, offline_access, mcp:connect など16種
- JWKS: RS256(kid oauth21-key-003)

/oauth21/authorize は app.foursquare.com/oauth21/authorize(code_challenge 必須の同意画面)へ302で転送します。/oauth21/register は 404 で、動的クライアント登録はありません。

app.foursquare.com/mcp に埋め込まれた設定では、connectUrl が https://api.foursquare.com/v2/streaming/mcp/swarm-beta、toolCount は60、対応クライアントは Claude と ChatGPT です。trusted domain 制限があるため現時点では使えませんが、Foursquare が今後開放すれば PKCE/refresh/revoke への移行先になり得ます。公開時期は特定できませんでした。
  - sources: https://api.foursquare.com/.well-known/oauth-authorization-server , https://api.foursquare.com/.well-known/oauth-protected-resource , https://app.foursquare.com/mcp , https://swarmapp.com/mcp/ , https://ss1.4sqi.net/swarm/main.9ca5bc43b468cd94fdbd.js

- **[fsq-oauth-06] CRITICAL (high)** API エラーは meta.errorType で分類する必要がある。トークン欠落は HTTP 400 + invalid_auth、無効または取消済みトークンは HTTP 401 + invalid_auth で、文書の対応表(invalid_auth=401)と一部ずれる。
  - detail: 実測結果:
- GET /v2/users/self?v=20261016(トークン無し)は 400 {"meta":{"code":400,"errorType":"invalid_auth","errorDetail":"Missing access credentials. ..."},"response":{}} でした。
- 無効トークンは、oauth_token クエリでも Authorization: Bearer ヘッダでも 401 {"meta":{"code":401,"errorType":"invalid_auth","errorDetail":"OAuth token invalid or revoked."}} でした。このとき WWW-Authenticate: Bearer realm="https://foursquare.com/login" と Access-Control-Allow-Origin: * が付きます。Bearer ヘッダが解釈されることも確認できました。

文書上の errorType:
- param_error 400、endpoint_error 404、not_authorized 403、rate_limit_exceeded 403(応答本体は空)、quota_exceeded 429、deprecated 200、server_error(ステータスは不定)
- errorDetail(開発者向け)と errorMessage(ユーザー向けのローカライズ文)

F-14 の分岐は「invalid_auth なら要再連携」「rate_limit_exceeded と quota_exceeded は時間をおいて再試行」「402 は運営側の障害」とします。
  - sources: https://docs.foursquare.com/developer/reference/personalization-apis-errors , https://api.foursquare.com/v2/users/self?v=20261016 , https://api.foursquare.com/v2/users/self/checkins

- **[fsq-oauth-07] CRITICAL (high)** レート制限は OAuth トークンごと・1時間あたり・トップレベル資源グループごとに設定され、Users 500 / Checkins 500 / Lists 1000 など。超過すると 403、残量は X-RateLimit-Limit / -Remaining / -Reset で通知される。
  - detail: 文書(updatedAt 2026-02-12)の記述:
- "Foursquare rate limits any application making authenticated requests on a per hour per OAuth token basis."
- 制限はエンドポイント単位ではなく、トップレベルの資源グループ単位です。
- POST は500、Search Autocomplete は2000です。
- 超過すると 403 が返り、応答本体は空です。X-RateLimit-Reset はリセット時刻を示します。

users/self/checkins が Users グループに数えられるのは推測です。その場合、250件×500回で1時間あたり最大125,000件取得できます。無効トークンへの応答には X-RateLimit-* ヘッダは付かず、有効トークンでの付き方は未確認です。
  - sources: https://docs.foursquare.com/developer/reference/personalization-apis-rate-limits

- **[fsq-oauth-08] (high)** v パラメータは YYYYMMDD 形式で、「この日付までのAPI変更に対応済み」を意味する。全リクエストで必須で、毎回現在日付を渡してはならない。m パラメータは現行文書に記載がなく省略可。ロケールは Accept-Language で指定する。
  - detail: versioning ページの記述:
- "Under no circumstances should you always pass in the current date."
- 全呼び出しで単一の日付を使い、数か月ごとに見直して上げることを推奨しています。
- 非推奨の機能を使うと meta に errorType: deprecated(HTTP 200)が付きます。移行期間は数か月以上で、メール通知や API brownout が行われます。

m(swarm/foursquare)は旧文書にのみ記載があり、2025〜2026年の利用例は v だけで動作しています。

Accept-Language は en(既定)/es/fr/de/it/ja/th/tr/ko/ru/pt/id に対応し、未指定時は地名等がその国で最も一般的な言語になります。カテゴリ名を検索対象にするなら、同期時の言語を固定する判断が必要です。
  - sources: https://docs.foursquare.com/developer/reference/versioning , https://docs.foursquare.com/developer/reference/personalization-apis-localization , https://docs-foursquare-api-ja.readthedocs.io/ja/latest/overview/versioning.html

- **[fsq-oauth-09] CRITICAL (high)** 規約上、チェックインデータを表示する画面には "Powered by Foursquare" の表示が必要。Swarm™/Foursquare® などの商標はアプリ名やドメインに含められない。
  - detail: Personalization APIs (Self-Service) EULA(2024-02-29)の主な条項:
- §3.2: "You must provide Foursquare with branded attribution (i.e., 'Powered by Foursquare')"
- §3.3: Personalization Data を表示するページのクロール防止
- §6.2: 得られたデータを広告ネットワーク、アドエクスチェンジ、データブローカー等へ移転しない(ユーザー同意があっても不可)

Trademark & Brand Feature Guidelines の要点:
- 対象の商標は Foursquare®、Swarm™、4SQ®、Check-in™ です。
- ドメイン名・サイト名・製品名への組み込み、他の語との結合、提携や推奨を示唆する使い方が禁止されています。
- API を使うアプリには所定の免責文を表示し、"powered by Foursquare®" ロゴを使えます。

Visual Crediting Policy: venue へのリンクは ?ref=PROJECT_ID を付け、rel=nofollow は禁止です。ロゴ素材は PoweredByFSQ21.zip(取得可)です。

Usage Guidelines と Console により、プライバシーポリシーの公開と Privacy Policy URL の登録が必須です。
  - sources: https://foursquare.com/legal/terms/personalization-apis-self-service-eula/ , https://foursquare.com/legal/terms/trademark-and-brand-feature-guidelines/ , https://app.foursquare.com/legal/trademark , https://docs.foursquare.com/fsq-developers-users/reference/visual-crediting-policy.md , https://developer.foursquare.com/assets/PoweredByFSQ21.zip , https://docs.foursquare.com/developer/docs/using-oauth-authentication

- **[fsq-oauth-10] CRITICAL (medium)** 取得データを保存(キャッシュ)してよい期間のルールが現行文書では不明瞭で、自ユーザーのチェックイン raw JSON を永続保存してよいか明確な根拠がない(推測を含む)。
  - detail: 関連する文書は次のとおりで、互いに整合していません。
- Personalization EULA §3.1 は、キャッシュ制限を Account-type ごとの Usage Guidelines に委ねています。
- 現行の Usage Guidelines(Places/Users API, 2026-02-12)は Places API データについて、fsq_place_id と Photo ID 以外の属性を Pay as You Go & Sandbox では "no caching permitted" としています。
- 旧 Usage Guidelines(URL は現在トップへ302、検索インデックス上の記述)には「その他データは最大30日」「アプリを認可していないユーザーのデータは3時間まで」とありました。
- Real Time(Push)API は "cache indefinitely" を禁止しています。
- Master Terms §14 は、契約終了時に Product data を破棄するよう求めています。

認可済みユーザー本人のチェックインを無期限に保存してよいかを明示した現行条文は見つかりませんでした。チェックインに埋め込まれた venue 属性(店名・住所)が Places データ扱いになると、保存不可と読める余地があります(推測)。F-13/N-06 は書面確認が必要で、ユーザー単位の完全削除と再取得に対応できる設計にしておくべきです。
  - sources: https://foursquare.com/legal/terms/personalization-apis-self-service-eula/ , https://docs.foursquare.com/fsq-developers-places/reference/usage-guidelines.md , https://docs.foursquare.com/fsq-developers-users/reference/usage-guidelines.md , https://docs.foursquare.com/docs/usage-guidelines , https://docs.foursquare.com/developer/reference/real-time-view , https://foursquare.com/legal/terms/enterprise-developermasterterms/

- **[fsq-oauth-11] CRITICAL (medium)** 新規の Developer アカウント・新規プロジェクトで、2026-10時点で v2 OAuth とチェックイン取得が問題なく使えるかは未確認。新規登録には審査(sanctions screening)がある。
  - detail: 新規利用を不確かにしている材料:
- v2 OAuth ガイドの Legacy notice に "If you added Foursquare after 11/18/21, you automatically have access to the new version (v3) of the API." とあり、新規アカウントの v2 可否があいまいです。
- 新 Users API 文書では 3rd Party OAuth が "Note: this is for enterprise customers only." とされています。
- Console のバンドルには新規登録時の "We are currently processing your application." という表示と、審査状態(pending/notscreened/screened/failed)があります。
- 第三者の2026年の issue(tsu-nera/dailybuild#92)も、新規アプリ登録が通るかを未確認としています。

使えることを示す材料:
- OAuth タイル(Client Id/Secret、Redirect URL)は表示モードに関係なく全プロジェクトで描画されます。
- 2026年の個人ツールで v2 OAuth が使われています。

ここが不可なら構想全体が成立しないため、最初の go/no-go 判定項目です(推測を含む)。
  - sources: https://docs.foursquare.com/developer/docs/using-oauth-authentication , https://docs.foursquare.com/fsq-developers-users/reference/authentication.md , https://ss0.4sqi.net/developers/main.991bed132b6a42d0d1aa.js , https://github.com/tsu-nera/dailybuild/issues/92 , https://github.com/mjanssen19/His-Story

- **[fsq-oauth-12] (high)** Developer Console での Client ID/Secret 取得手順と名称: Create New Project → Project Settings の "OAuth Authentication" セクションに "Client Id" / "Client Secret" があり、Reset Client Secret で再発行できる。ユーザー認証には Project URL・Privacy Policy URL・Redirect URL の3つが必須。
  - detail: 公式手順(Start a New Project, Using OAuth Authentication, いずれも updatedAt 2026-02-12)で確認しました。Console の公開バンドル解析で分かったこと:
- 設定ページのURLは /developers/orgs/:orgId/projects/:projectId/settings です。
- OAuth 欄のツールチップは "Legacy Foursquare API uses OAuth to authenticate."(別モードでは "Used for 3rd Party Application Account Linking")です。
- 保存APIは v2/apps/{id}/edit で、フィールドは applicationUri, privacyPolicyUri, callbackUri(配列)です。
- Push API 設定と Push Secret もあります。

Personalization API 専用のキー名はありません。Places/Users API 用の Service API Key とは別物です。
  - sources: https://docs.foursquare.com/developer/docs/create-a-new-project , https://docs.foursquare.com/developer/docs/using-oauth-authentication , https://ss0.4sqi.net/developers/main.991bed132b6a42d0d1aa.js

- **[fsq-oauth-13] (medium)** redirect_uri は複数登録できる。http://localhost も登録・利用できる可能性が高いが、完全一致か前方一致か、HTTPS が必須かは公式に記載がない。
  - detail: Console の Redirect URL 欄は isMulti/isCreatable の複数入力で、クライアント側の検証は「空でない・重複しない」だけです(サーバ側の検証は不明)。旧文書にも「複数のリダイレクトURIを登録でき redirect_uri で指定」とあります。

第三者の手順では、His-Story(2026)と foursquare-to-dayone(2025-12)が http://localhost:8765/callback、swarm-downloader(2026-02)が http://localhost を使っており、localhost が動く間接証拠です。

HTTPS が必須だった場合は、Next.js 公式の next dev --experimental-https(mkcert で https://localhost:3000)で回避できます。外部から到達させる必要がある場合だけ cloudflared/ngrok を使います。
  - sources: https://ss0.4sqi.net/developers/main.991bed132b6a42d0d1aa.js , https://docs-foursquare-api-ja.readthedocs.io/ja/latest/overview/auth.html , https://github.com/mjanssen19/His-Story , https://github.com/ericblue/swarm-downloader , https://github.com/williamsdb/foursquare-to-dayone , https://nextjs.org/docs/app/api-reference/cli/next

- **[fsq-oauth-14] (medium)** state パラメータがコールバックにそのまま返るかは公式に記載がない。間接証拠からは返る可能性が高い(推測)。
  - detail: 間接証拠は次のとおりです。
- next-auth v4 は OAuth2 の既定を checks=["state"] としており、Foursquare プロバイダは 2021 年に "Manually tested ✅" です。
- Laravel SocialiteProviders/Foursquare と omniauth-foursquare も、既定で state 検証が有効なまま使われています。
- 未ログイン時の /oauth2/authenticate は、state を含む全パラメータを /login?continue= に保持して302します(実測)。

なお Auth.js v5(@auth/core)の既定は checks=["pkce"] のみで state を送りません。Foursquare が PKCE を無視する場合、その既定構成では CSRF 防御が効きません(推測)。このため、ライブラリに頼らず自前実装で state を必須にすることを推奨します。
  - sources: https://github.com/nextauthjs/next-auth/issues/2524 , https://github.com/nextauthjs/next-auth/blob/v4/packages/next-auth/src/core/lib/providers.ts , https://github.com/nextauthjs/next-auth/blob/main/packages/core/src/lib/utils/providers.ts , https://github.com/SocialiteProviders/Providers/blob/master/src/Foursquare/Provider.php , https://github.com/arunagw/omniauth-foursquare , https://foursquare.com/oauth2/authenticate

- **[fsq-oauth-15] (high)** users/self(GET /v2/users/self, v必須)の主要項目: id(文字列)、firstName、lastName、handle、gender、homeCity、birthday、createdAt、photo{prefix, suffix, default}、contact{email, verifiedEmail, verifiedPhone, facebook} など。email は空文字の場合がある。
  - detail: 文書例の値は id "123456"、photo.prefix "https://fastly.4sqi.net/img/user/"、suffix "/blank_boy.png"、contact.email ""(空)です。画像URLは prefix + サイズ(例 100x100 / original)+ suffix で組み立てます。主要OSS(Auth.js、social-core、Socialite)は id、氏名、contact.email、photo を使っています。

アプリ側の識別キーは fsq_user_id = response.user.id(文字列で保存)とし、email には依存しないことを推奨します。next/image を使う場合は fastly.4sqi.net の許可が必要です。
  - sources: https://docs.foursquare.com/developer/reference/get-user-details , https://github.com/nextauthjs/next-auth/blob/main/packages/core/src/providers/foursquare.ts , https://github.com/python-social-auth/social-core/blob/master/social_core/backends/foursquare.py

- **[fsq-oauth-16] (medium)** ユーザーが Foursquare 側で連携を解除する画面として app.foursquare.com/settings/connections が実在する(ログイン要求の302)。画面の中身は未確認。
  - detail: 実測結果:
- foursquare.com/settings/* は 308 で app.foursquare.com へ転送されます。
- app.foursquare.com の /settings/connections と /settings/privacy は /login?continue=... へ302します(ルートが存在)。
- /settings/apps と存在しないパスは 404 でした。

旧v2文書の和訳にも「ユーザは Foursquare の設定画面からいつでも切断することができます」とあります。F-03 の案内先候補ですが、連携アプリ一覧と解除操作があるかは実アカウントでの確認が必要です。
  - sources: https://app.foursquare.com/settings/connections , https://docs-foursquare-api-ja.readthedocs.io/ja/latest/overview/auth.html

- **[fsq-oauth-17] (high)** 認可フロー中に表示される Foursquare の Web ログイン(app.foursquare.com/login)は、パスワードではなくメールまたは電話番号に送られるワンタイムコードで認証する方式。
  - detail: Swarm Web のバンドルにある文言は "Log in to Foursquare" / "Enter your email or phone to receive a login code" / "Enter your code" などで、Apple/Google/Facebook のログインボタンの文言は見当たりませんでした。foursquare.com/login は app.foursquare.com/login へ308します。SNS のみで登録しメール/電話を持たないユーザーが OAuth を完了できない可能性があります(推測)。
  - sources: https://app.foursquare.com/login , https://ss1.4sqi.net/swarm/main.9ca5bc43b468cd94fdbd.js

- **[fsq-oauth-18] (medium)** F-05 の「ログアウト後の再ログインで Foursquare OAuth の再実行は不要」は字義どおりには実現できない。
  - detail: ログアウト後に本人確認できる手段が Foursquare OAuth しかないためです。/oauth2/authenticate なら認可済みユーザーは同意画面なしで即座にコールバックへ戻るので、「再同意不要のワンクリック再ログイン」と読み替えるのが現実的です。この点は旧文書の記述に基づく推論で、実挙動は未確認です。

保存済みトークンは削除せずに保持し、再認可で得たトークンで上書きします。同じ値が返るかは未確認です。
  - sources: https://docs-foursquare-api-ja.readthedocs.io/ja/latest/overview/auth.html , https://foursquare.com/oauth2/authorize

- **[fsq-oauth-19] (high)** Next.js(App Router)では cookies() は async で、.set / .delete は Route Handler か Server Function でのみ実行できる。最新の next は 16.4.2(engines: node >=20.9.0)。
  - detail: Next.js docs(cookies, lastUpdated 2026-06-09)によると、v15 で async 化されています。対応オプションは httpOnly/secure/sameSite/maxAge/path/partitioned/priority で、既定値は path=/ だけです。npm view の結果は next@16.4.2、engines node>=20.9.0 で、開発機の Node v20.11.1 は条件を満たします。

OAuth 開始とコールバックは Route Handler(または Server Action)で実装し、state 用 Cookie を設定・削除します。
  - sources: https://nextjs.org/docs/app/api-reference/functions/cookies , https://nextjs.org/docs/app/api-reference/cli/next , https://www.npmjs.com/package/next

### recommendations
- 最初のスパイクで go/no-go を判定する: 新規 Developer 登録 → 審査状態の確認 → プロジェクト作成 → 実 Swarm アカウントで OAuth → users/self、users/self/checkins?limit=250、checkins/{id} が 402/403 なしで通るかを確認する。通らなければ他の設計を進める前に方針を見直す。
- 要件を改訂する。N-09 は「不可(レガシーOAuthに revoke API なし)。代わりに Foursquare 側での解除手順を案内」とする。F-03 は「自DBの暗号化トークンを即削除し disconnected_at を設定、Foursquare 設定画面(app.foursquare.com/settings/connections を実地確認のうえ)へ誘導」とする。F-05 は「再同意不要(/oauth2/authenticate による自動リダイレクト)のワンクリック再ログイン」と再定義する。
- OAuth は Auth.js 等に頼らず Route Handler で自前実装し、state を必須にする。手順は次のとおり。(1) 開始は POST フォームか Server Action で行い、Web Crypto で 32 バイトの state を作る。HMAC 署名付きの一時 Cookie に {state, intent, returnTo(相対パスのみ), iat} を入れて /oauth2/authenticate へ302する。(2) コールバックでは Cookie を即削除し、error パラメータ・code/state の欠落・不一致・期限切れを先に弾く。(3) トークン交換はフォーム POST で、redirect_uri を認可時と完全一致させ、タイムアウトは10秒とする。(4) users/self の id を fsq_user_id として Supabase 側処理へ渡し、303 で code を含まない URL へ遷移する。
- state 用 Cookie の属性: 本番は __Host-fsq_oauth; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600 とする。開発の http://localhost では Secure を外し、名前も __Host- なしにする。SameSite=Strict にするとコールバックで Cookie が届かず、必ず state 不一致になるため使わない。
- Foursquare API 呼び出しはサーバー専用のラッパに集約する。Authorization: Bearer ヘッダを使い(URL にトークンを載せない)、v は FSQ_API_VERSION=YYYYMMDD の固定値、m は省略する。分岐は meta.errorType 優先で行う: invalid_auth は要再連携、rate_limit_exceeded は X-RateLimit-Reset まで待機、quota_exceeded/429 は翌日まで停止、402 は運営アラート、5xx は指数バックオフ、deprecated は警告ログ。X-RateLimit-Remaining を記録してバックフィルのペースを調整する。
- code、access_token、コールバック URL 全体、トークン交換の送信内容をログに残さない。コールバック応答には Cache-Control: no-store と Referrer-Policy: no-referrer を付ける。fsq_user_id には一意制約を付け、ログイン中に別の Foursquare アカウントで戻ってきた場合の扱い(切替か拒否か)を仕様化する。
- 課金対象を避ける: /v2/venues/{id}(Premium)や /v2/users/self/historysearch(Pro)を呼ばない設計にする。Billing ページで Free/Paid Credits とカードの要否を確認し、402 を監視対象にする。
- ローカル用と本番用で Foursquare プロジェクト(Client ID/Secret)を分ける(L-03/L-04/L-06)。Redirect URL は環境ごとに完全な URL で登録する(例 http://localhost:3000/auth/foursquare/callback)。http://localhost が拒否されたら next dev --experimental-https で https://localhost:3000 を使う。Netlify のデプロイプレビューのようなランダムなホスト名では OAuth を通さず、固定のステージングドメインを用意する。
- 規約対応を UI 設計に織り込む。検索結果と詳細画面に Powered by Foursquare ロゴ(PoweredByFSQ21.zip を自前ホスト)と venue へのリンク(?ref=PROJECT_ID、nofollow 禁止)を置く。アプリ名・ドメインに Swarm/Foursquare/4SQ を含めない。商標の免責文を掲載する。認証後ページには noindex を付け robots.txt で Disallow とする。広告やトラッキングのタグはデータ表示ページに入れない。プライバシーポリシーのページを作り Console に登録する。
- raw JSON の永続保存(F-13/N-06)と連携解除後2週間の保持(F-40)を Foursquare Developer Support に書面で確認する。回答次第で保持方針を変えられるよう、ユーザー単位の完全削除、venue 属性の再取得、保存項目の縮小に対応できるスキーマにしておく。
- OAuth クライアントは差し替え可能な抽象にしておく(Legacy OAuth2 と将来の OAuth 2.1 の両方を想定)。Foursquare に OAuth 2.1 の trusted domain 追加(PKCE/refresh/revoke を使える)を打診する余地がある。
- ログイン画面とヘルプに「Foursquare のログインはメール/電話に届くコードで行う」旨を記載する。SNS のみで登録したユーザー向けに、Swarm アプリでメールを登録する手順を案内する。

### open_questions
- 新規アカウントで v2 が使えるか(最優先): 2026-10時点で新規 Developer アカウント(審査あり)・新規プロジェクトの Client ID/Secret で、レガシー OAuth と /v2/users/self/checkins が 402 等なしに使えるか。【手順】(1) Developer 登録をして審査状態(pending/screened)を記録する。(2) Create New Project で Project URL・Privacy Policy URL・Redirect URL を設定する。(3) 実 Swarm アカウントで認可から交換まで行う。(4) users/self、users/self/checkins?limit=250&offset=0、checkins/{id} を呼び、HTTP ステータス・meta・X-RateLimit-* ヘッダ・Billing ページの残高を記録する。
- redirect_uri の照合規則(検証5): 完全一致か前方一致か、末尾スラッシュの差、追加クエリ、ポート違い、http と https の違いをどう扱うか。http://localhost は登録できるか。【手順】Redirect URL に http://localhost:3000/auth/foursquare/callback を登録し、パスやクエリを変えた redirect_uri で認可して、エラー画面または成功を記録する。拒否されたら next dev --experimental-https で https://localhost:3000 を登録して再試行する。
- state と拒否時の挙動(N-08): state はコールバックにそのまま返るか。同意画面で拒否したときのクエリは何か(error=access_denied 等)。【手順】ランダムな state を付けて認可し、コールバック URL を記録する。同意画面で「拒否」を押した場合の URL も記録する。2回目以降に /authenticate で同意画面が出ずに自動で戻るか、/authorize では毎回出るかも確認する。
- トークン応答と寿命: 交換レスポンスに access_token 以外(token_type、expires_in 等)が含まれるか。同じユーザーが再認可したとき同じトークンが返るか、旧トークンは無効化されるか。【手順】交換レスポンスの生 JSON を保存し(トークン値はマスク)、2回認可して値を比較する。旧トークンで users/self を呼び 200 か 401 かを確認する。
- PKCE: レガシー OAuth は PKCE を検証するか。【手順】code_challenge(S256)を付けて認可し、交換時にわざと誤った code_verifier を送る。トークンが発行されれば非対応(無視されている)と判定する。
- ユーザー側の連携解除(検証4): app.foursquare.com/settings/connections に本アプリが表示され解除できるか。解除後、保存トークンはすぐ invalid_auth(401, "OAuth token invalid or revoked.")になるか。【手順】実アカウントで設定画面を確認して解除し、保存トークンで users/self を呼ぶ。可能ならパスワード変更やアカウント削除時の挙動も確認する。
- users/self の実データ: contact.email の有無、photo、lastName 欠落の有無。m=swarm の有無で checkins レスポンスに差があるか。【手順】実アカウントで m なし/m=swarm の両方を取得し、JSON の差分を取る(個人情報はマスクして保存)。
- 規約の解釈(書面確認): 認可済みユーザー本人のチェックイン(venue 属性を含む)を raw JSON で無期限に保存・検索してよいか。連携解除後2週間の保持はよいか。Powered by Foursquare の表示位置。アプリ名の可否。【手順】Developer Console の問い合わせ窓口(support.foursquare.com のチケット)と Brand@foursquare.com に、本アプリの構成を添えて照会し、回答を保存する。
- 402 Payment Required の発生条件: 無料扱いの users/checkins 系でも、Billing 未設定やクレジット枯渇で 402 になるか。【手順】スパイク中に Billing ページの状態(カード有無、Free/Paid Credits)と API 結果を突き合わせて記録し、402 が出たらサポートに問い合わせる。
- SNS のみで登録した Swarm アカウント(メール/電話なし)が、Web のコード式ログインで OAuth を完了できるか。【手順】該当する種類のテストアカウントで認可フローを試す。用意できなければ Foursquare サポートに確認する。
- OAuth 2.1(PKCE/refresh/revoke)の trusted domains に一般のサードパーティ Web アプリを追加してもらえるか、また OAuth 2.1 のトークンで /v2/users/self/checkins を呼べるか。【手順】Foursquare に問い合わせる。

### artifacts
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\research\fsq-oauth.md
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-oauth-work\scripts\probe.ps1
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-oauth-work\downloads\wellknown\oauth-authorization-server.json
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-oauth-work\downloads\wellknown\oauth-protected-resource.json
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-oauth-work\downloads\logo\extracted\PoweredByFSQ_guidelines.pdf
