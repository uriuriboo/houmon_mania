# 22_result.json (agent a72c5f9ab85b90efc)

## VERIFY

- **[fsq-oauth-01] partially**
  - correction: 「Personalization API - Deprecated」表示(docs トップ)、Console の「Get Started with the Personalization API (depr)」、Get User Checkins が Public Beta 表記・limit 最大250/既定20・offset であること、サンセット日・移行先が未発表であることは確認できた(新 Users API の Migration Guide にも checkins の移行先は無い)。

ただし「無効トークンで 401 invalid_auth が返る=エンドポイント稼働」という推論は誤り。存在しないパス /v2/thisdoesnotexist/zzz にも同じ 401 invalid_auth が返り、認証層が先に応答しているだけである。元調査自身が 04 でこの点を指摘しており、内部で矛盾している。

また swarm-downloader(2026-02)が呼んでいるのは /v2/users/{id}/historysearch で、users/self/checkins ではない。historysearch は 2026-06-01 以降 Pro 課金。

稼働の傍証として有効なのは次の第三者利用例:
- shkspr.mobi(2026-06-02、users/self/checkins と checkins/{id})
- mjanssen19/His-Story(2026-10-01 作成、v=20261001、users/self/checkins、limit=250)

本プロジェクトの実トークンで 200 応答が得られるかは、スパイクで確認するまで未確認。
  - evidence: 実測(2026-10-16、ダミー値のみ):
- GET /v2/users/self?v=20261016(トークンなし)→ 400 {meta:{errorType:invalid_auth, errorDetail:'Missing access credentials...'}}
- Bearer INVALIDTOKEN で /v2/users/self/checkins → 401 invalid_auth 'OAuth token invalid or revoked.'
- 同じトークンで /v2/thisdoesnotexist/zzz → 401。応答本体は同一

文書・バンドル:
- docs トップ: 'Places API New!' / 'Users API New!' / 'Personalization API - Deprecated'
- get-user-checkins.md(updatedAt 2026-02-12): Public Beta バナー、limit 'up to 250; defaults to 20'、offset。OpenAPI の operation は "deprecated": false
- Console バンドル main.991bed132b6a42d0d1aa.js に 'Get Started with the Personalization API (depr)'
- Versioning 文書: 非推奨化は 'at least several months'、メール通知と 'API brownouts'

第三者コード:
- swarm-downloader download_checkins.py: BASE_URL='https://api.foursquare.com/v2/users/{user_id}/historysearch'、v=20260220
- His-Story fsq_api.py: API_VERSION='20261001'、'/users/self/checkins'、PAGE=250

ログ: scratchpad\factcheck-fsq-oauth\out\probe_log.txt
  - sources: https://docs.foursquare.com/ , https://docs.foursquare.com/developer/reference/get-user-checkins , https://ss0.4sqi.net/developers/main.991bed132b6a42d0d1aa.js , https://api.foursquare.com/v2/thisdoesnotexist/zzz?v=20261016 , https://raw.githubusercontent.com/ericblue/swarm-downloader/main/download_checkins.py , https://raw.githubusercontent.com/mjanssen19/His-Story/HEAD/his_story/fsq_api.py , https://shkspr.mobi/blog/2026/06/using-foursquares-api-to-post-location-checkins-to-social-media/ , https://docs.foursquare.com/fsq-developers-users/reference/migration-guide.md , https://docs.foursquare.com/developer/reference/versioning

- **[fsq-oauth-02] confirmed**
  - correction: 主張は正しい。以下を補足・微修正する。

(1) upcoming-changes の原文は 'the legacy V3 endpoints will be deprecated on May 15, 2026' で、「停止済み」とは書かれていない。/v3/places/search は 2026-10-16 時点でも 401 'Invalid request token.' を返しており、停止は確認できない(本アプリには無関係)。

(2) Premium には無料枠が無く、0〜100,000 calls が $18.75 CPM。/v2/venues/{id} は 1 回目から課金される。Pro の無料分は 500 calls。pricing ページに残る 'Enjoy up to 10,000 free calls on Pro endpoints' は古い表記で、同じページの表(0–500 $0.00)と矛盾する。

(3) spokenlikeageek の 402:
- 記事の公開は 2025-12-01
- 発生は記事中の 'last September' とコード中の v=20250922 から 2025-09 頃
- support が課金対象外であることに同意し、回答まで約 2 か月
- 最終的には 13,714 件を処理できている

(4) swarm-downloader が使う historysearch は現在 Pro 課金なので、参考実装にしてはいけない。
  - evidence: upcoming-changes.md(updatedAt 2026-10-05)原文:
- 'Beginning June 1, 2026 ... 0 - 500 calls – $0.00 CPM / 501 - 100,000 calls – $15.00 CPM ... You will now receive 500 free Pro calls.'
- Premium: /v2/venues/X とサブパス(photos, tips, hours, menu, links, events, attributes)
- Pro: /v2/users/X/historysearch, /v2/venues/search, /v2/search/recommendations, /v2/venues/trending, /v2/venues/X/related
- 'Any checkins, lists, tastes, tips, and users endpoints not mentioned in the above lists will remain free.'

pricing ページ HTML: Pro '0 – 500 Calls $0.00 CPM'、Premium '0 – 100,000 Calls ... $18.75 CPM'、古い表記 'Enjoy up to 10,000 free calls on Pro endpoints'。

spokenlikeageek 本文: 'making authenticated calls to the https://api.foursquare.com/v2/users/self/checkins endpoint ... HTTP/1.1 402 Payment Required ... Foursquare support agreed ... two months before they came back to me'、コード内 '&v=20250922'。

Master Terms §4.2.2: Free Monthly Credits が尽きたら Paid Credits を購入するか翌月まで待機。
  - sources: https://docs.foursquare.com/developer/reference/upcoming-changes , https://foursquare.com/pricing/ , https://www.spokenlikeageek.com/2025/12/01/exporting-foursquare-check-ins-to-day-one/ , https://foursquare.com/legal/terms/enterprise-developermasterterms/ , https://api.foursquare.com/v3/places/search

- **[fsq-oauth-03] confirmed**
  - correction: 主張は正しい。以下を補足する。

(1) refresh 非対応の根拠は強い。grant_type=refresh_token は、実在しない grant_type=foobar_nonexistent と同じ unsupported_grant_type を返す。一方 grant_type=password は unauthorized_client を返すので、サーバは「認識しているが許可しない」grant を区別している。

(2)「GET/POST とも 405 でない=両方対応」は根拠として弱い。PUT も 400 invalid_client を返すので、メソッドを区別しないハンドラであることを示すだけ。正規の資格情報での成否は分からない。His-Story(2026-10)は文書例どおり GET+クエリで交換している。実装は文書例に合わせるか、スパイクで POST を確認すること。

(3) 現行の公式文書(fsq-developers-users の Authentication)は、交換結果を 'permanent access token' と呼んでいる。旧和訳より強い「無期限」の根拠になる。

(4) 現行の公式 v2 OAuth 文書には state パラメータの記載が一切ない。

(5) 公式文書に 'Native authentication is the only flow that supports users logging in to Foursquare using Facebook.' とあり、Web OAuth では Facebook ログインが使えない。
  - evidence: v2-authentication.md(updatedAt 2026-02-12):
- 認可 https://foursquare.com/oauth2/authenticate?client_id&response_type=code&redirect_uri
- 交換 https://foursquare.com/oauth2/access_token?client_id&client_secret&grant_type=authorization_code&redirect_uri&code
- 'The response will be JSON. { "access_token": ACCESS_TOKEN }'、Step4 は 'Authorization header of Bearer'
- scope / PKCE / expires_in / state の記載なし

fsq-developers-users authentication.md: 'redirect_uri ... Must exactly match the redirect_uri used in Step 1'、'This is a server-to-server request'、'exchange ... for a permanent access token'。

実測(ダミー値):
- POST/GET authorization_code → 400 invalid_client
- refresh_token → unsupported_grant_type、foobar_nonexistent → unsupported_grant_type
- password → unauthorized_client
- PUT → invalid_client

旧 v2 和訳: 「アクセストークンは無期限ですが、ユーザが無効にする場合があります」「/authorize はつねに…承諾するよう指示」。
  - sources: https://docs.foursquare.com/developer/reference/v2-authentication , https://docs.foursquare.com/developer/reference/personalization-apis-authentication , https://docs.foursquare.com/fsq-developers-users/reference/authentication.md , https://docs-foursquare-api-ja.readthedocs.io/ja/latest/overview/auth.html , https://foursquare.com/oauth2/access_token , https://raw.githubusercontent.com/mjanssen19/His-Story/HEAD/his_story/fsq_api.py

- **[fsq-oauth-04] partially**
  - correction: 確認できたこと:
- レガシー OAuth の revoke/deauthorize が文書に無い
- /oauth2/revoke(GET/POST)、/oauth2/deauthorize、/oauth2/invalidate、/oauth2/logout は、存在しないパスと同じ WordPress の 404 を返す
- OAuth 2.1 サーバの認可は trusted ドメインの CIMD クライアントに限られる

不正確な点:「revocation_endpoint は trusted クライアント専用」は誤り。/oauth21/revoke は client_id なしの POST(token=FAKE や空ボディ)にも 200 {} を返す。メタデータも revocation_endpoint_auth_methods_supported=['none'] で、RFC 7009 どおりの実装である。client_id を付けた場合だけ検証され、未知なら 401 になる。

このため、レガシー v2 トークンをこの endpoint に送って無効化されるかは未検証で、200 は何も意味しない。実トークンで revoke した後、/v2/users/self が 401 になるかで判定できる。トークン体系(JWT と不透明トークン)が違うので効かない見込み(推測)。

したがって N-09 は「実現不可」と断定しない。「文書化された手段は無い。検証が1件残るが、採用しない前提で F-03 を『自DB即削除+Foursquare 側(/settings/connections)での解除案内』とする」と書くのが正確。
  - evidence: 実測(2026-10-16):
- foursquare.com/oauth2/revoke(POST)、/oauth2/doesnotexist_zz → どちらも 404、同じ WordPress HTML(約181KB)
- app.foursquare.com/oauth2/revoke → 404
- api.foursquare.com/.well-known/oauth-authorization-server: revocation_endpoint=https://api.foursquare.com/oauth21/revoke、revocation_endpoint_auth_methods_supported=['none']、grant_types_supported=['authorization_code','refresh_token']
- /oauth21/appinfo: example.com → 400 'Client domain 'example.com' is not in the trusted domains list'。claude.ai の CIMD → 400 'redirect_uri is missing or not registered'(trusted 判定は通過)
- /oauth21/revoke: token=FAKE&client_id=https://example.com/client.json → 401 'Unknown client_id'。token=FAKE のみ → 200 {}。空ボディ → 200 {}
- app.foursquare.com/settings/connections → 302 /login?continue=%2Fsettings%2Fconnections(ルートは実在)
- 新 Users API の index(llms.txt)にも O&O トークンの revoke 系エンドポイントは無い

ログ: scratchpad\factcheck-fsq-oauth\out\probe_log.txt
  - sources: https://api.foursquare.com/.well-known/oauth-authorization-server , https://api.foursquare.com/oauth21/revoke , https://api.foursquare.com/oauth21/appinfo , https://foursquare.com/oauth2/revoke , https://docs.foursquare.com/developer/reference/v2-authentication , https://docs.foursquare.com/fsq-developers-users/llms.txt , https://datatracker.ietf.org/doc/html/rfc7009

- **[fsq-oauth-06] confirmed**
  - correction: 実測値は再現できた。以下を補足する。

(1) Errors 文書は2つの表が食い違っている。
- errorType 表: invalid_auth=401('OAuth token was not provided or was invalid')
- HTTP ステータス表の 400 行: 'This includes the case where no OAuth token is provided'
実測(欠落=400、無効=401)は後者と一致する。「文書とずれる」より「文書内で不整合」が正確。

(2) 同じ文書の 403 行に 'It could also indicate privileges or access has been revoked.' とある。403 には rate_limit_exceeded と not_authorized があり、さらにアクセス剥奪の可能性もある。errorType と X-RateLimit-* で必ず区別すること。

(3) トークン欠落(400 invalid_auth)はアプリ側のバグであり、ユーザーの再連携では解決しない。F-14 の「要再連携」は 401 invalid_auth に限定するのが妥当。
  - evidence: 実測(2026-10-16):
- トークンなし GET /v2/users/self?v=20261016 → 400 {"meta":{"code":400,"errorType":"invalid_auth","errorDetail":"Missing access credentials..."},"response":{}}
- 無効トークンは Bearer ヘッダでも oauth_token クエリでも → 401 {"meta":{"code":401,"errorType":"invalid_auth","errorDetail":"OAuth token invalid or revoked."},"response":{}}
- 付随ヘッダ: WWW-Authenticate: Bearer realm="https://foursquare.com/login"、Access-Control-Allow-Origin: *。X-RateLimit-* は無し

personalization-apis-errors.md(updatedAt 2026-02-12):
- errorType 一覧: invalid_auth 401 / param_error 400 / endpoint_error 404 / not_authorized 403 / rate_limit_exceeded 403 / quota_exceeded 429 / deprecated 200 / server_error Varies
- errorDetail(開発者向け)、errorMessage(ローカライズ済み、ユーザー向け)
  - sources: https://docs.foursquare.com/developer/reference/personalization-apis-errors , https://api.foursquare.com/v2/users/self?v=20261016 , https://api.foursquare.com/v2/users/self/checkins

- **[fsq-oauth-07] partially**
  - correction: 文書に主張どおりの記述があることは確認できた:
- per hour per OAuth token
- トップレベル資源グループ単位(Checkins 500 / Lists 1000 / Users 500 等)
- 超過時は 403
- 残量は X-RateLimit-Remaining / -Limit、超過時に X-RateLimit-Reset

条件付きの点:
- 資源ごとの表の見出しは 'rate limits per managed user OAuth token' である。Swarm(O&O)ユーザーのトークンに同じ数値が当てはまるとは明記されていない。冒頭の一般原則と「connected user ごとに 500」の例からの推定。
- 'the response object returned by our API will be empty' は、JSON の response フィールドが空という意味にも読める。「応答本体が空」とは断定できない。

実装方針: 500 を固定値にしない。応答ヘッダの残量に追従し、ヘッダ無しや本体空にも耐えるようにする。スパイクで有効トークン時のヘッダを記録すること。
  - evidence: personalization-apis-rate-limits.md(updatedAt 2026-02-12)の原文:
- 'Foursquare rate limits any application making authenticated requests on a per hour per OAuth token basis.'
- 'if your application has 3 connected users, it could make at most 500 requests on behalf of the each connected user'
- 'rate limits are, in general, not per endpoint, but per top-level endpoint resource or group'
- 'The following table includes the rate limits per managed user OAuth token.'(Checkins 500, Lists 1000, Photos 500, Search 500, Tips 500, Users 500, Venues 500)
- 例外: Search Autocomplete 2000、POST Endpoints 500
- 'If you are currently over limits, our API will return a 403 error, and the response object returned by our API will be empty. We will also include a X-RateLimit-Reset header'

実測: 無効トークンへの 401 応答には X-RateLimit-* が付かない。
  - sources: https://docs.foursquare.com/developer/reference/personalization-apis-rate-limits

- **[fsq-oauth-09] confirmed**
  - correction: 主張は正しい。以下を補足する。

(1) EULA §6.2 の禁止対象は 'ad network, ad exchange, data broker, or other advertising or monetization related toolset' で、広告ネットワークより広い。チェックインを表示するページには、第三者の広告タグや計測タグを置かない設計が安全。

(2) 商標条項には 'except as otherwise expressly provided in a written agreement by Foursquare' とあり、書面合意があれば例外になる。

(3) Personalization API 専用の Usage Guidelines は、プライバシーポリシーに source/use/store を明記することに加え、位置情報などの sensitive data を集める場合に 'appropriate notice' と 'appropriate consent' を求めている。

(4) Visual Crediting Policy では、検索結果一覧は視覚クレジットだけでよい。basic data(name/location/category)を出す詳細画面では、?ref=PROJECT_ID 付きの venue リンクが原則で、rel=nofollow は禁止。
  - evidence: EULA(Last Updated 2024-02-29):
- §3.2: 'You must provide Foursquare with branded attribution (i.e., 'Powered by Foursquare') on any page or screen within Your Service where Personalization Data may appear.'
- §3.3: クロール防止の 'commercially reasonable efforts'
- §6.2: '...will not directly or indirectly transfer any data ... to (or use such data in connection with) any ad network, ad exchange, data broker, or other advertising or monetization related toolset, even if a user consents'

Trademark Guidelines:
- 'Foursquare®, Swarm™, 4SQ® and Check-in™'
- 'Do not incorporate our Foursquare Marks ... into your domain names, screen names, website names, or trademarks'
- 免責文の要件と、powered by ロゴのライセンス

Visual Crediting Policy: '?ref=PROEJCT_ID'(原文の綴りのまま)、"Don't set rel=nofollow"、Search Results は視覚クレジットのみで可。

PoweredByFSQ21.zip: HEAD 200、436,918 bytes、Last-Modified 2021-11-18。

using-oauth-authentication: ユーザー認証には Project URL / Privacy Policy URL / Redirect URL が必要。
  - sources: https://foursquare.com/legal/terms/personalization-apis-self-service-eula/ , https://foursquare.com/legal/terms/trademark-and-brand-feature-guidelines/ , https://docs.foursquare.com/fsq-developers-users/reference/visual-crediting-policy.md , https://developer.foursquare.com/assets/PoweredByFSQ21.zip , https://docs.foursquare.com/developer/docs/using-oauth-authentication , https://docs.foursquare.com/developer/reference/usage-guidelines-personalization-apis

- **[fsq-oauth-10] refuted**
  - correction: 誤り:ルールは不明瞭ではなく、明文で定められている。

EULA §3.1 が参照する Personalization API 専用の Usage Guidelines(https://docs.foursquare.com/developer/reference/usage-guidelines-personalization-apis、updatedAt 2026-02-12。Wayback では 2024-05-28 版から同じ文言)の規定:
'you must abide by the following rules around retaining data from the Personalization API: venue_id / photo_id / fsq_addr_id: unlimited caching; All Other Attributes: Enterprise Customers: 24-hour local-device caching only (no server-based caching is permitted); Pay as You Go & Sandbox Customers: no caching permitted.'

セルフサービス利用者の Account-type は、EULA 上 'Self-Service "Pay as You Go"' である。文言どおりに読めば、ID 以外の属性はサーバに保持できない。対象は shout、店名、住所、日時、チェックイン本体など。AUP VI も、docs に定める 'caching restrictions' の遵守を義務付けている。

文言上抵触する要件:
- F-13/N-06(raw の永続保存)
- F-10(全件同期)
- F-25(同期済みデータの検索)
- F-33(raw の上書き保存)
- F-40〜42(解除後2週間の保持)
つまり MVP の中核に当たる。Enterprise の既定条件でもサーバ側キャッシュは不可なので、契約種別を上げるだけでは解決しない。

したがって「書面確認を推奨」では足りない。Foursquare から明示的な書面許諾(個別契約)を得られるかを、技術スパイクより前の Go/No-Go 条件にすべき。

旧ルールも保存に厳しかった:
- 2017 年: 'Checkins must be refreshed every 24 hours'、30日、未認可ユーザーは3時間
- 2019 年: 'Foursquare data may be kept for a maximum of 24 hours without being refreshed'
元調査の「旧ガイドラインは30日」は、その一部だけを引いている。
  - evidence: usage-guidelines-personalization-apis.md(updatedAt 2026-02-12)の Data Retention 節は上記引用のとおり。Personalization の API Usage ページから 'Usage Guidelines' としてリンクされている。

Wayback:
- 20240528200346 版: 同文言('retaining data from the Personalization API ... Pay as You Go & Sandbox Customers: no caching permitted')
- 20231202 版(location.foursquare.com): 'data from the Places API' 表記

EULA §3.1: 'You must comply with the Personalization API caching and query rate limitations applicable to your Account-type (Self-Service "Pay as You Go") set forth in our Usage Guidelines'。

AUP(Last Updated 2024-03-12)VI. API Restrictions/Caching: '...including without limitation with regard to any applicable query limits and caching restrictions'。

旧ルール(Wayback):
- 20170909 developer.foursquare.com/overview/community: 'Checkins must be refreshed every 24 hours / No piece of data can be kept for more than 30 days without being refreshed / The data of users who haven't authed your app may only be stored for up to three hours'
- 20190108 docs/terms-of-use/overview: 'Foursquare data may be kept for a maximum of 24 hours without being refreshed'

リンク状況: 旧 developer/docs/usage-guidelines は 301 → developer/reference/usage-guidelines(現在 404)。

保存ファイル: scratchpad\factcheck-fsq-oauth\out\usage-guidelines-personalization-apis.md、wb_pers_usage_20240528.html、wb_community_2017.html、wb_tou_overview_2019.html
  - sources: https://docs.foursquare.com/developer/reference/usage-guidelines-personalization-apis , https://docs.foursquare.com/developer/reference/personalization-apis-usage , https://web.archive.org/web/20240528200346/https://docs.foursquare.com/developer/reference/usage-guidelines-personalization-apis , https://foursquare.com/legal/terms/personalization-apis-self-service-eula/ , https://foursquare.com/legal/terms/aup/ , http://web.archive.org/web/20170909200005/https://developer.foursquare.com/overview/community , http://web.archive.org/web/20190108044438/https://developer.foursquare.com/docs/terms-of-use/overview , https://docs.foursquare.com/fsq-developers-users/reference/usage-guidelines.md

- **[fsq-oauth-11] confirmed**
  - correction: 主張(未確認であること、審査の仕組みがあること)は正しい。以下を補足する。

(1)「after 11/18/21 は v3」という Legacy 注記は 2021 年の文言。その後、Release Notes(March 2024)に 'Personalization API is now available on the Developer Console in Public Beta for registered users.' とあり、Personalization 系の文書には 'Access is available to anyone interested...' という Public Beta バナーが付いている。新規アカウントで使える見込みは、元調査の評価より高い。

(2)「enterprise customers only」は、新 Users API(app.foursquare.com/oauth2、Placemaker 用)の 3rd Party Authentication についての注記。v2 Personalization の O&O Web 認証(foursquare.com/oauth2)には付いていない。

(3) 稼働の傍証: His-Story(2026-10-01 作成)が、foursquare.com/developers でプロジェクトを作り OAuth 設定に http://localhost:8765/callback を追加する手順で、v2 OAuth と users/self/checkins を使っている。

(4) 反証材料: spokenlikeageek は開発者アカウントを新規登録し、2025-09 頃に 402 を受けた。解決まで約2か月かかっている。スパイクの判定項目には「402 の有無」と「support 対応の要否」を入れること。

(5) 技術面とは別に、規約面(fsq-oauth-10 の訂正)が独立した Go/No-Go 条件になる。
  - evidence: 文書:
- using-oauth-authentication.md(updatedAt 2026-02-12)の Legacy 注記: 'If you added Foursquare after 11/18/21, you automatically have access to the new version (v3)...'
- personalization-api-release-notes.md: 'March 2024 — Personalization API is now available on the Developer Console in Public Beta for registered users.'
- fsq-developers-users authentication.md: '3rd Party Authentication (Enterprise Customers Only)'(app.foursquare.com/oauth2、mode=placemaker)

Console バンドル:
- 'We are currently processing your application.'
- oa={Pending:'pending',NotScreened:'notscreened',Screened:'screened',Failed:'failed'}、V('v2/sanction/self')
- ProjectSettingsPage は useAlternativeContent の真偽どちらでも OAuth タイル(tu)を描画する
- pending または sanctioned の間は Reset Client Secret 等が無効

第三者:
- tsu-nera/dailybuild#92(2026-08-28 作成、2026-10-10 コメント): 「新規アプリ登録が今も通るか(実際に登録していない)」が未確認のまま
- His-Story README: 'Create a project at foursquare.com/developers, and in its OAuth settings add the redirect URI http://localhost:8765/callback'
  - sources: https://docs.foursquare.com/developer/docs/using-oauth-authentication , https://docs.foursquare.com/developer/reference/personalization-api-release-notes , https://docs.foursquare.com/fsq-developers-users/reference/authentication.md , https://ss0.4sqi.net/developers/main.991bed132b6a42d0d1aa.js , https://github.com/tsu-nera/dailybuild/issues/92 , https://github.com/mjanssen19/His-Story , https://www.spokenlikeageek.com/2025/12/01/exporting-foursquare-check-ins-to-day-one/

### missed
- 【最重要・規約】Personalization API Usage Guidelines(updatedAt 2026-02-12)は、Personalization API データの保持を次のように定めている: venue_id / photo_id / fsq_addr_id 以外は「Pay as You Go & Sandbox: no caching permitted」。Enterprise でも 24 時間の端末内キャッシュのみで、サーバキャッシュは不可。EULA §3.1 と AUP VI で拘束力がある。チェックイン全件を同期・保存して検索する本アプリの中核(F-10/F-13/F-25/F-33/F-40〜42/N-06)と文言上衝突する。基本設計の前提に「Foursquare からの書面許諾(個別契約)取得」を Go/No-Go 条件として追加する必要がある。https://docs.foursquare.com/developer/reference/usage-guidelines-personalization-apis
- 保存に関する旧ルール(Wayback):
- 2017-09 developer.foursquare.com/overview/community: 'Checkins must be refreshed every 24 hours' / 'No piece of data can be kept for more than 30 days without being refreshed' / 未認可ユーザーのデータは3時間
- 2019-01 docs/terms-of-use/overview: 'Foursquare data may be kept for a maximum of 24 hours without being refreshed'
Foursquare の公開文書が、チェックインの無期限サーバ保存を許したことは一度も無い。
- 代替データ経路(推測・要法務確認): Swarm/Foursquare 公式のデータエクスポート(Settings → Privacy → Download your data。JSON/CSV がメールで届く)を、ユーザー本人がアップロードする方式。API で取得したデータではないので、API のキャッシュ規定の対象外になる可能性がある。ただし His-Story README によれば、export には city/country/category が無い。API 同期が規約上不可となった場合の設計オプションとして、基本設計に併記する価値がある。
- 位置情報の同意: Personalization Usage Guidelines に 'If your application collects users' location data ..., you must provide appropriate notice and collect appropriate consent from users' とある。チェックインは位置情報なので、OAuth 開始前または同期前に同意画面を置き、プライバシーポリシーに source/use/store を明記する必要がある。
- Facebook ログインの制約: 公式文書に 'Native authentication is the only flow that supports users logging in to Foursquare using Facebook.' とある。Facebook ログインだけを使う Swarm ユーザーは Web OAuth を完了できない可能性が高い。FAQ と、連携失敗時にメール/電話ログインの設定を促す案内が必要。
- state の扱い: 現行の公式 v2 OAuth 文書(v2-authentication / personalization-apis-authentication / fsq-developers-users authentication)は state パラメータに一切触れていない。N-08 は未文書化の挙動に依存する。スパイクで「state がそのまま返るか」「拒否時の error パラメータ」を必ず確認し、返らない場合の代替策を設計で用意すること。
- /oauth21/revoke は client_id なし・空ボディでも 200 {} を返す(RFC 7009 型、revocation_endpoint_auth_methods_supported=['none'])。レガシー v2 トークンに効くかは、実トークンで「revoke → /v2/users/self が 401 になるか」を試せば1回で判定できる。N-09 の最終判断はこの検証の後にする。
- 課金の防御:
- Premium(/v2/venues/X 以下)は無料枠が無く、1 回目から $18.75 CPM
- Pro(historysearch 等)は月 500 calls まで無料、その後 $15 CPM
- Free Monthly Credits が尽きた後は、Paid Credits を購入しないと翌月まで呼べない(Master Terms §4.2.2)
API ラッパで呼べるエンドポイントを users/self、users/self/checkins、checkins/{id} の allowlist に限定し、Billing の残高を監視すべき。
- サービス継続の契約条件: Master Terms §2.3 は 'reserves the right to modify or discontinue ... at any time, for any or no reason, with or without notice' と定め、EULA §5 は Public Beta の AS IS 提供。Versioning 文書の「at least several months」は努力目標にすぎない。Deprecated 表示と合わせて、予告なしの停止もありうる前提で設計する必要がある。ただし raw 保持による備え(N-06)は、上記の保存規定と衝突する。
- User Push API(Real Time View): 認可済みユーザーがチェックインするたびに webhook で POST が届く。Console に Push API 設定と Push Secret がある。ログイン時の差分同期(F-12)の代替になりうるが、'not ... cache indefinitely any information we transmit to you' という制約がある。https://docs.foursquare.com/developer/reference/real-time-view
