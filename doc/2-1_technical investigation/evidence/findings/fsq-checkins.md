# 16_result.json (agent a9d2a53f30cf4e47e)

## TOPIC: fsq-checkins: チェックイン取得API・データ構造・差分同期 (F-10〜F-15, F-30, F-33, N-06 / 検証2・検証3)

### summary
GET /v2/users/self/checkins は 2026年8〜10月時点でも複数の実利用報告があり、動いています。ただし、これを含む「Personalization API」は 2025年7月頃から公式ドキュメント上で「Deprecated」表示になっています(廃止日は未告知)。そのため N-06(raw保持)と「同期だけ止めても検索は続く」設計が必須です。

現行の公式ドキュメントに載っているのは v / limit(最大250) / offset だけです。sort / afterTimestamp / beforeTimestamp は 2016〜2021年の旧版にのみ記載された未文書化パラメータです。2026-08 の実アカウント検証報告では次の挙動が確認されています。
- afterTimestamp・beforeTimestamp は機能する。beforeTimestamp は包含(<=)。
- sort=oldestfirst はページ内の並べ替えだけで、古い順の取得はできない。
- count は期間を絞っても総数のまま。

offset で深くページングできるかは報告が食い違っています(約7,400件まで正常という報告と、数百〜2,500件付近で打ち切りという報告がある)。このため、バックフィルは beforeTimestamp を主に使い、進まなくなったら offset に切り替える二系統にするのが安全です。

方式A・方式Bはどちらも、過去日時で後から登録したチェックイン・編集・削除を取りこぼします。推奨はハイブリッド方式です。毎回直近14〜30日の範囲を読み直し、範囲の下限はアプリ側で強制します。総件数(count)がDBとずれたら全件を読み直し、定期的なフル同期も併用します。偽APIでのシミュレーションで、この方式の有効性と限界を確認済みです。

詳細APIで増えるのは、コメント本文・コイン(score)・署名付き共有URL・overlaps・user などで、検索対象はすべて一覧APIで揃います。そのため F-15 は妥当です。ただし詳細の raw は別列に保存することを推奨します。

その他の注意点は次のとおりです。
- レスポンスの形が v/m によって揺れる(formattedAddress が配列の場合とオブジェクトの場合がある)。
- 地名・カテゴリ名がロケールによって変わる(検索の言語に直結)。
- 402 Payment Required の事例がある。
- 403 エラーが「レート制限」と「権限なし」の二つの意味を持つ。

写真・アイコンURLの組み立て方は認証なしの取得で検証済みです。DB への対応付け(マッピング)の案と、search_text 生成列の制約(array_to_string と concat_ws は使えない)は PGlite で確認しました。詳細メモと試作コードは artifacts に保存しています。実トークンを使った検証は未実施で、手順は open_questions にまとめています。

### findings

- **[deprecated-status] CRITICAL (high)** users/self/checkins・checkins/{id} を含む v2「Personalization API」は、公式ドキュメント上 2025年7月頃から「Deprecated」表示。廃止日は未告知。2026-06 の価格改定では checkins/users 系は無料のままと明記され、2026-08〜10 も実稼働の報告がある。
  - detail: Wayback で確認: docs.foursquare.com/developer の製品一覧は 2025-05-29 時点では無印、2025-07-10 以降は「Personalization API - Deprecated」と「Users API New!」に変わった(Users API は managed user / Placemaker 用で、チェックイン取得はない)。2026-10-16 の get-user-checkins ページは、本文が「Public Beta Feature」、サイドバーのカテゴリ名が「Personalization APIs (depr)」(updated_at 2026-02-12)。Release Notes は 2024-03(Public Beta 開始)と 2024-04 の2件のみで、廃止告知はない。upcoming-changes には『Any checkins, lists, tastes, tips, and users endpoints not mentioned in the above lists will remain free.』とあり、Pro 課金対象として /v2/users/X/historysearch を明記している(historysearch は使わないこと)。旧 Versioning 文書によれば、廃止時は meta.errorType=deprecated を返し、少なくとも数か月の移行期間を置く。稼働の証拠: shkspr 2026-06(v=20260223)、tk0miya/travelmap 2026-08-30、tdrayson 2026-08、toouur 2026-10-14。
  - sources: https://docs.foursquare.com/developer , https://web.archive.org/web/20250529184801/https://docs.foursquare.com/developer , https://web.archive.org/web/20250710012901/https://docs.foursquare.com/developer , https://docs.foursquare.com/developer/reference/get-user-checkins , https://docs.foursquare.com/developer/reference/personalization-api-release-notes , https://docs.foursquare.com/developer/reference/upcoming-changes , https://docs.foursquare.com/fsq-developers-users/reference/managed-user-endpoints , https://shkspr.mobi/blog/2026/06/using-foursquares-api-to-post-location-checkins-to-social-media/ , https://github.com/tk0miya/travelmap/pull/49

- **[params-documentation] CRITICAL (high)** 現行の公式ドキュメントが記載するのは v(必須)・limit(最大250、既定20)・offset(既定0、上限記載なし)のみ。sort(newestfirst/oldestfirst)・afterTimestamp・beforeTimestamp は 2016〜2021年の旧ドキュメントにだけ記載され、2023年版は v のみ。つまり現状は「未文書化」。
  - detail: 2016-03 / 2018-06 / 2021-03 の developer.foursquare.com 版はいずれも、USER_ID=self のみ・limit 最大250・offset・sort・afterTimestamp・beforeTimestamp を記載している。afterTimestamp の説明は『To avoid missing results when polling, we recommend subtracting several seconds from the last poll time and then de-duplicating.』。2016年版には『We highly discourage developers from polling this endpoint ... to keep their users' check-in history synced. Using the real-time API is a much better solution.』との注記がある。2023-12 の location.foursquare.com 版は「Private Beta Feature」表示で、OpenAPI 定義上のパラメータは v のみ。現行版は v / limit / offset。
  - sources: https://web.archive.org/web/20160326145626/https://developer.foursquare.com/docs/users/checkins , https://web.archive.org/web/20180624134731/https://developer.foursquare.com/docs/api/users/checkins , https://web.archive.org/web/20210308224356/https://developer.foursquare.com/docs/api-reference/users/checkins , https://web.archive.org/web/20231202154744/https://location.foursquare.com/developer/reference/get-user-checkins , https://docs.foursquare.com/developer/reference/get-user-checkins

- **[params-observed-2026] CRITICAL (medium)** 2026年の実利用報告による挙動: afterTimestamp・beforeTimestamp は機能する。beforeTimestamp は包含(createdAt==T を返す)。sort=oldestfirst は古い順の『選択』ではなく、ページ内の逆順化だけ。response.checkins.count は期間を絞っても総数のまま。m=swarm は displayGeo/exactContextLine が増えるだけ。Authorization: Bearer ヘッダも使える。
  - detail: tk0miya/travelmap PR #49(2026-08-30、8,700件の実アカウント): limit=5 で sort=oldestfirst を指定しても、最新5件が逆順で返るだけだった。count は 10年分の期間指定(該当 7,373件)でも 8,700 のまま。beforeTimestamp は包含。Bearer と oauth_token の両方が使える。afterTimestamp の稼働例: tdrayson PR #154(2026-08 本番「3 new check-in(s)」)、toouur の毎時 CI、mitsubachi PR #436(/checkins/recent で『その時刻より新しいもの』に絞り込み)。本調査でも、ダミートークンを Bearer ヘッダで送ると 401『OAuth token invalid or revoked.』になり、ヘッダが認識されていることを確認した(2026-10-16)。afterTimestamp が包含か排他かは未確認。sort/before の意味づけは一次報告が1件だけなので medium とした。
  - sources: https://github.com/tk0miya/travelmap/pull/49 , https://github.com/tdrayson/taylordrayson/pull/154 , https://github.com/SlashNephy/mitsubachi/pull/436 , https://github.com/toouur/foursquare-dashboard , https://docs.foursquare.com/developer/reference/v2-authentication

- **[offset-depth-conflict] CRITICAL (medium)** offset で深くページングできるかは報告が食い違う。約7,400件まで取得できた報告(2026-08)や 13,714件の取得例(2025-12)がある一方、『数百件を超えると先頭ページを繰り返す』(2026-09)、『~2,500件で打ち切り』(2026-03)という記載もある。
  - detail: 肯定側: tk0miya/travelmap は offset 走査で約7,400件を取得(重複29件は upsert で吸収)。mitsubachi は users/{id}/checkins の offset が『正しく動作する』と報告。spokenlikeageek は 13,714件を offset で処理。否定側: airalcorn2/swarm-explorer の README と fetch_checkins.py は『offset は数百件で先頭ページを繰り返し、約250件で止まる』として beforeTimestamp を採用。toouur/swarm-journal のコメント『Foursquare API silently caps offset at ~2,500』は Codex 生成 PR(#2 の『avoid offset ceiling issues』)に由来し、一次観測かどうかは不明。条件(v、limit、アカウント規模など)による差の可能性もある(推測)。
  - sources: https://github.com/tk0miya/travelmap/pull/49 , https://github.com/SlashNephy/mitsubachi/pull/436 , https://www.spokenlikeageek.com/2025/12/01/exporting-foursquare-check-ins-to-day-one/ , https://github.com/airalcorn2/swarm-explorer , https://github.com/toouur/foursquare-dashboard/pull/2 , https://github.com/darya-shvvv/swarm-journal

- **[diff-sync-blindspots] CRITICAL (high)** 方式A(offset+既知IDで打ち切り)も方式B(afterTimestamp=DB上の最大createdAt)も、過去日時で後から登録したチェックイン・既存チェックインの編集(shout修正・写真の後付け・venue統合)・削除を検知できない。2026年の実装は、毎回直近N日分を読み直すことで対処している。
  - detail: travelmap の architecture.md は、最新位置を記録して続きから読む方式の盲点として、①記録位置より古い createdAt で後から登録されたチェックイン、②タイムスタンプが動かない編集、の2つを挙げる。対策として毎回 14日分を読み直し、範囲の下限はアプリ側で適用している。tdrayson も直近 --days を再確認し、空白期間があれば延長する(上限90日)。toouur は月次の全件再取得で削除を検出し、詳細APIの 400『Invalid checkin id』を確認してから反映している(最大50件)。本調査の sync-sim.mjs(偽API、6,063件): A・B とも未取得1〜2件・削除の取り残し1件。推奨ハイブリッドは、範囲内の追加・削除を1リクエストで解消し、範囲外の後付け登録は count 不一致から全件読み直しに移って回収した。ただし範囲外の追加と削除が同数で相殺すると count 照合でも検知できず、定期的なフル同期が要る。後付け登録の createdAt が訪問時刻か登録時刻かは未確定。
  - sources: https://github.com/tk0miya/travelmap/blob/main/docs/architecture.md , https://github.com/tdrayson/taylordrayson/pull/154 , https://github.com/toouur/foursquare-dashboard , https://github.com/dogsheep/swarm-to-sqlite/issues/3 , https://wersm.com/retro-checking-in-on-swarm-its-here/

- **[details-api-diff] CRITICAL (medium)** 詳細API(GET /v2/checkins/{id})で一覧に対して増える・詳しくなるのは、user、canonicalUrl/Path、checkinShortUrl(?s= 署名付きの共有URL)、comments.items[](本文・投稿者・ステッカー)、score(total と scores[] のコイン)、overlaps など。検索対象(店名・shout・住所・カテゴリ)は一覧で揃う。削除済みIDは 400 errorDetail『Invalid checkin id』を返す。
  - detail: 公式例同士を keydiff.mjs で比較(同一ID 59b97e2a…): 詳細のみにあるのは canonicalUrl、canonicalPath、user{…}、checkinShortUrl、comments.items=[]、score.total。公式の詳細例は venue が {id,name} だけに手で削られており、OwnYourSwarm が詳細レスポンスの venue.location / url / contact を使っていることから、実レスポンスには venue の詳細も入ると推測する。コメント本文は一覧には無く(comments は count のみ)、OwnYourSwarm は件数が変わった時だけ詳細を取り直して comments.items[].text/user/createdAt/sticker を読んでいる。overlaps は一覧では『never/rarely』で、詳細でのみ取得(toouur)。checkinShortUrl の s= 署名は友達限定の閲覧制限を回避できるリンクになる(旧 docs)。一覧で無い項目のうち検索に必要なものは無いため、F-15 の方針は妥当。
  - sources: https://docs.foursquare.com/developer/reference/get-checkin-details , https://web.archive.org/web/20260607042005/https://docs.foursquare.com/developer/reference/get-checkin-details , https://web.archive.org/web/20210506134639/https://developer.foursquare.com/docs/api-reference/checkins/details , https://github.com/aaronpk/OwnYourSwarm , https://github.com/toouur/foursquare-dashboard , https://shkspr.mobi/blog/2026/06/using-foursquares-api-to-post-location-checkins-to-social-media/ , https://web.archive.org/web/20160506062901/https://developer.foursquare.com/docs/checkins/checkins

- **[locale-dependency] CRITICAL (medium)** 店名・地名・カテゴリ名はロケールによって変わる。Accept-Language ヘッダ(推奨)または locale= で en(既定)/ja など12言語を指定できる。未指定だと地名は『その国で最も一般的な言語』になる。実データでも、国名が現地語の例や、日本の venue で番地はローマ字・市区町村とカテゴリは日本語という混在が見られる。
  - detail: Localization ページ(現行)と 2017・2019 の旧版は同じ記述。toouur は国名が Беларусь / Republica Moldova / المغرب のように現地語で返ると報告。travelmap の 2026年の実 push fixture は『東京タワー』、address『4 Chome-2-8 Shibakoen』、city『港区』、country『日本』、category『モニュメント / ランドマーク』で、カテゴリが日本語になった理由(アプリ言語など)は未確定。検索(F-22/F-23)への影響: en で取得するとカテゴリが『Ramen Restaurant』などになり、日本語の検索語に当たらない(推測)。途中でロケールを変えると表記が混在するため全件再取得が要る。国コード cc はロケールに依存しない唯一の安定した列。
  - sources: https://docs.foursquare.com/developer/reference/personalization-apis-localization , https://web.archive.org/web/20190819150850/https://developer.foursquare.com/docs/api/configuration/internationalization , https://github.com/tk0miya/travelmap/blob/main/TODO.md , https://github.com/tk0miya/travelmap/blob/main/internal/foursquare/testdata/push_body.txt , https://github.com/toouur/foursquare-dashboard

- **[payment-402-risk] CRITICAL (medium)** users/self/checkins が 402 Payment Required を返した事例がある(2025年、Foursquare サポートの対応で解決までおよそ2か月)。ほかの v2 ユーザー系エンドポイントでも、常に 402 になるものや、月次のプレミアム枠を超えると 402 になるものが報告されている。
  - detail: spokenlikeageek(2025-12-01): users/self/checkins が『HTTP/1.1 402 Payment Required』を返した。サポートは『自分のデータ取得に課金されるべきでない』ことに同意したが、回答まで約2か月かかった。toouur の solution.html: /users/self/venueokays と venuedislikes は常に 402、venuelikes は月約220回のプレミアム枠を超えると月末まで 402。upcoming-changes の『checkins/users は無料』と矛盾するため原因は不明(アカウント設定や課金ゲートの可能性、推測)。本番の client_id で早期に確認しないと、スケジュールが数か月止まるリスクがある。
  - sources: https://www.spokenlikeageek.com/2025/12/01/exporting-foursquare-check-ins-to-day-one/ , https://github.com/toouur/foursquare-dashboard , https://docs.foursquare.com/developer/reference/upcoming-changes

- **[response-structure] (high)** 一覧の各チェックインは id、createdAt(UNIX秒)、type(checkin/shout/venueless)、timeZoneOffset(分)、venue、photos{count, items[]}、likes{count, groups[].items[]}、comments{count のみ}、posts、like、isMayor、source を持つ。shout はコメントが無いとキー自体が無い。非公開チェックインは private:true と visibility:'private' を持つ。
  - detail: 2023年の公式例(20件)の項目出現率: shout 20%、private/visibility 15%、venue.closed 35%(閉店)、venue.private 20%(自宅などの非公開 venue。address/city が欠けやすい)、location.isFuzzed 10%(座標がぼかされる)、neighborhood 70%、address 75%、city 90%、photos.items には visibility(public/private)と user が入る。visibility は public / private / closeFriends を観測。venue が無いチェックイン(type=shout/venueless)では top-level の location{name,lat,lng} が入りうる(旧docs)。2010年頃の古いチェックインには source が無い(swarm-to-sqlite issue #6)。そのほか with[]、createdBy(友達が代わりにチェックイン)、sticker{image{prefix,sizes[],name}}、event、entities、editableUntil(ミリ秒)がある。swarm-to-sqlite の実データ fixture では shout に『— with Natalie』という同行者表記が含まれていた。
  - sources: https://web.archive.org/web/20231202154744/https://location.foursquare.com/developer/reference/get-user-checkins , https://docs.foursquare.com/developer/reference/get-user-checkins , https://github.com/dogsheep/swarm-to-sqlite/blob/main/tests/checkin.json , https://github.com/dogsheep/swarm-to-sqlite/issues/6 , https://web.archive.org/web/20180624134731/https://developer.foursquare.com/docs/api/users/checkins , https://zaki-lknr.github.io/Misc/4sq/

- **[shape-variance] (high)** レスポンスの形は v/m によって揺れる。たとえば venue.location.formattedAddress は、string[] の場合(v=20190101 や 20231010 の実データ、2026年の push)と、{text:'…\n…', entities:[]} の場合(2023年公式例の20件すべて。contextLine/contextGeoId 付き)がある。
  - detail: 抽出処理は両方の形に対応させ、v は固定値にする(Versioning: 『Under no circumstances should you always pass in the current date』)。map.mjs は両対応で実装し、公式例20件・実データ fixture・2026年 push 由来・合成データの計26件を例外なく変換できた。
  - sources: https://web.archive.org/web/20231202154744/https://location.foursquare.com/developer/reference/get-user-checkins , https://github.com/dogsheep/swarm-to-sqlite/blob/main/tests/checkin.json , https://zaki-lknr.github.io/Misc/4sq/ , https://web.archive.org/web/20170301142208/https://developer.foursquare.com/overview/versioning

- **[rate-limits-errors] (high)** レート制限は OAuth トークンごと・1時間ごと・リソース群ごと(Users 500、Checkins 500 など)。超過すると 403 rate_limit_exceeded、日次上限は 429 quota_exceeded。トークンが無効・取消済みなら 401 invalid_auth『OAuth token invalid or revoked.』、認証情報が無ければ 400 invalid_auth(2026-10-16 実測)。
  - detail: 残量は X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset ヘッダで分かる。一覧は250件/リクエストなので、3万件のユーザーでも約120リクエストで制限内に収まる。詳細APIはユーザーあたり 500/h で、toouur は 0.35秒間隔の一括取得で quota の 403 に当たり、8秒間隔に変えた。403 は not_authorized と rate_limit_exceeded の二つの意味を持つので、meta.errorType で分岐する必要がある。F-14 の『レート制限時は再連携を促す』は誤った誘導になる。エラー応答には X-RateLimit ヘッダが無かった。
  - sources: https://docs.foursquare.com/developer/reference/personalization-apis-rate-limits , https://docs.foursquare.com/developer/reference/personalization-apis-errors , https://github.com/darya-shvvv/swarm-journal , https://github.com/tk0miya/travelmap/blob/main/TODO.md

- **[oss-sync-evidence] (high)** 差分同期の OSS 実装: dogsheep は beforeTimestamp=前ページ最後の createdAt で遡る。toouur は増分を afterTimestamp+beforeTimestamp で取り、全件(約69,000件)は beforeTimestamp で取る。airalcorn2 は beforeTimestamp=最古+1 で重複を排除。travelmap は offset+14日分の読み直し。OwnYourSwarm は Push API と詳細のポーリング。いずれも 2024〜2026 年に稼働の証拠がある。
  - detail: dogsheep/swarm-to-sqlite(最終リリース 2023-04): 2024-06 の Issue コメントで『worked for me』。toouur/foursquare-dashboard と swarm-journal(2026-03〜10): count に到達したら完了とみなし、途中で打ち切られた run もあった(2026-04-21)。毎分 limit=1&sort=newestfirst をポーリングする Cloudflare Worker も持つ。airalcorn2(2026-09)。travelmap(2026-08〜10)。tdrayson(2026-08)。aaronpk/OwnYourSwarm(push + 詳細を指数バックオフで再取得、最終 push 2025-11)。
  - sources: https://github.com/dogsheep/swarm-to-sqlite/blob/main/swarm_to_sqlite/utils.py , https://github.com/dogsheep/swarm-to-sqlite/issues/16 , https://github.com/darya-shvvv/swarm-journal/blob/main/scripts/fetch_checkins.py , https://github.com/airalcorn2/swarm-explorer/blob/main/scripts/fetch_checkins.py , https://github.com/tk0miya/travelmap/blob/main/docs/architecture.md , https://github.com/aaronpk/OwnYourSwarm

- **[push-api] (medium)** User Push API(Real Time View)は 2026-02 更新の現行ドキュメントにも残っており、2026年に実際の push を受信した例がある。アプリ設定『Push API notifications』に HTTPS(443) の URL と push secret を登録すると、認可済みユーザーの全チェックイン(public/friends/private)が URL エンコード JSON で POST される。
  - detail: 再送の仕様は記載が無い(タイムアウトは失敗として記録されるだけ)。travelmap は push を即時取得に使い、14日分の読み直しを取りこぼし対策に併用している。後付け登録や編集でも push が来るかは未観測。OwnYourSwarm は secret を検証していないが、travelmap は定数時間比較で検証している。MVP では必須ではない拡張候補(推測)。
  - sources: https://docs.foursquare.com/developer/reference/real-time-view , https://web.archive.org/web/20170301142214/https://developer.foursquare.com/overview/realtime , https://github.com/tk0miya/travelmap/blob/main/docs/api-notes.md , https://github.com/aaronpk/OwnYourSwarm/blob/main/controllers/Foursquare.php

- **[photo-icon-urls] (high)** 写真URLは prefix + サイズ + suffix で、サイズは original / WxH(任意値、切り抜き) / capN / widthN / heightN。カテゴリアイコンは prefix + {32,44,64,88}(120も可) + suffix で、bg_ を付けると灰色背景。2026-10-16 に認証なしで取得できた(Fastly CDN、max-age 10年、ACAO:*)。
  - detail: 公開写真(fastly.4sqi.net/img/general/…)で確認: original は 1920x1440、300x300 / 36x36 / 100x100 / 500x500 / 800x600 / 123x77 は指定どおり、cap300→300x225、width960→960x720、height300→400x300。カテゴリアイコン(ss3.4sqi.net): _64 / _bg_64 / _88 / _120 は 200(max-age 30日)、サイズ無しは 403。ユーザー写真は prefix+300x300+suffix、ステッカーは image.prefix+sizes[i]+image.name で取得できた。公式例の非公開写真URLは 404(削除済みと推測)。非公開写真がURLだけで見えるかは未確認。リファラ制限は無く、直リンク表示は可能。表示面では EULA §3.2『Powered by Foursquare』の表記と §3.3 のクロール防止が必要。
  - sources: https://web.archive.org/web/20170719121943/https://developer.foursquare.com/docs/responses/photo , https://web.archive.org/web/20150925223209/https://developer.foursquare.com/docs/responses/category , https://foursquare.com/legal/terms/personalization-apis-self-service-eula/ , https://github.com/aaronpk/OwnYourSwarm/blob/main/lib/Backfeed.php

- **[generated-column-immutability] (high)** search_text 生成列では、array_to_string と concat_ws が『generation expression is not immutable』で使えない。normalize(lower(...), NFKC) と || 連結は使え、text[] は IMMUTABLE な SQL ラッパー関数を通せば使える(PGlite 0.5.10 = PostgreSQL 18.6 で確認)。
  - detail: exp.mjs で DDL を試行: A(array_to_string)と B(concat_ws)は FAIL、C(normalize(lower(coalesce||…),NFKC))と D(language sql immutable のラッパー)は OK。DB の生成列と JS 側の NFKC+lower の結果は fixture 6件で一致した(全角英字『ＴＥＳＴ』→『test』、半角カナ→全角)。Supabase(PG15/17)でも同じ挙動と推測される。
  - sources: https://www.postgresql.org/docs/current/ddl-generated-columns.html , https://www.postgresql.org/docs/current/functions-string.html

- **[volume-estimate] (low)** raw JSONB は1件あたり約1.7KB(一般的な項目)〜2.7KB(写真・いいねが多い項目)。行全体では3〜4KB程度、3万件のユーザーで約90〜120MBと見込む(推測)。250件のページは0.4〜1.2MBで、1ページ1〜3秒程度と推測(公開された計測値は無い)。
  - detail: PGlite での実測: 公式例タイプは JSON 1,666B → jsonb 列 1,674B(2KB未満なので TOAST 圧縮されない)。写真・いいねの多いタイプは 5,085B → 2,724B。raw+id のみで 2,290B/行。東京からの無認証エラー応答は往復200〜300ms(Fastly NRT 経由、origin MISS)。Supabase Free はプロジェクトあたり DB 500MB、Pro は 8GB 込みで超過分 $0.125/GB。重いユーザーが数名いると Free の上限に届きうる。バックフィルはサーバレスの1回の呼び出しで完走させず、ページ単位のジョブに分ける必要がある。
  - sources: https://supabase.com/pricing , https://web.archive.org/web/20231202154744/https://location.foursquare.com/developer/reference/get-user-checkins , https://github.com/dogsheep/swarm-to-sqlite/blob/main/tests/checkin.json

### recommendations
- F-10(初回バックフィル)の改訂: 2種類のページング方式を持つ。主は beforeTimestamp(前ページの最古 createdAt をそのまま次の基準にする。包含なので同じ秒の重複は ID で除く)。ページが進まない(同じIDが続く、最古 createdAt が下がらない)ことを検知したら offset に切り替える。進捗(F-11)は『取得した一意件数 ÷ count』で出し、件数が count に届いたら完了とする。1回の呼び出しで1〜数ページだけ処理するジョブにし、カーソルを永続化する(sync_jobs テーブル想定)。
- F-12(差分同期)はハイブリッド方式で確定するのを推奨: 毎回『DB上の最大 createdAt − 14〜30日』を下限とする範囲を読み直す。下限はアプリ側で強制し、afterTimestamp は送れば転送量が減る最適化として付けるだけにする。読み直しの後に API の count と DB の有効件数を照合し、ずれていれば全件読み直しジョブを起動する。範囲外での追加と削除が相殺するケースに備え、月1回程度の定期フル同期か、ユーザー操作の『完全再同期』も用意する。範囲内で一覧から消えたチェックインは、詳細APIで 400『Invalid checkin id』を確認してから論理削除する。
- F-13/F-33: 一覧由来の JSON は raw に、詳細API由来の JSON は raw_detail(jsonb NULL)と detail_fetched_at に分けて保存する。抽出列は一覧の raw からだけ作り、詳細の raw から再抽出しない(詳細 venue が簡略形の場合に抽出列が壊れるのを防ぐ)。Swarm 側で削除されたものは、連携解除用の deleted_at(F-40)とは別の列(例: source_deleted_at)で管理する。
- リクエストの共通ルール: v は固定値(例 20260801。変えるのは検証後のみ)、m は送らない、トークンは Authorization: Bearer ヘッダで送り URL に載せない、limit=250 にする。Accept-Language は検証(probe T7)のあと1つに固定する(日本語UIなら ja が第一候補)。ロケールを途中で変えるなら全件を取り直す。抽出処理は formattedAddress の配列とオブジェクト両方への対応や、キーの欠落を前提にした書き方にする。
- F-14 の修正: エラーは HTTP ステータスではなく meta.errorType で分ける。invalid_auth(400/401) → 再連携を促す。rate_limit_exceeded(403) → X-RateLimit-Reset まで待って自動で再開し、再連携は促さない。quota_exceeded(429) → 翌日に再開。not_authorized(403) / param_error → 不具合として記録。402 → 運営側の問題として通知。5xx → 指数バックオフ。HTTP 200 で errorType=deprecated → 監視アラート。
- checkins テーブルの対応付け(要件5章ベース): id←item.id(取込必須。一意性は (user_id, id) の複合を推奨)、created_at←to_timestamp(createdAt)(必須)、tz_offset←timeZoneOffset(分、無ければ NULL)、shout←shout(キーが無ければ NULL)、venue_id/venue_name←venue.id/venue.name(venue が無ければ location.name → NULL)、categories←venue.categories[].name を primary 先頭で(無ければ '{}')、address/city/state/country←venue.location.*(無ければ NULL)、lat/lng←venue.location.lat/lng(無ければ location.lat/lng → NULL)、photo_count←photos.count(無ければ 0)、raw←item 全体。追加を推奨する列: cc、formatted_address、type、is_private、visibility、primary_category_id、カテゴリアイコンの prefix/suffix、comment_count、like_count、venue_closed、is_fuzzed、source_name、event_name、list_synced_at、raw_detail、detail_fetched_at。search_text は lower(normalize(… || fsq_join_text(categories), NFKC)) の生成列とし、array_to_string と concat_ws は使わない。
- 廃止リスクへの対策(N-06): 同期だけを止めて検索・表示は続ける運用モード(機能フラグ)を最初から用意する。errorType=deprecated とエラー率を監視する。Foursquare サポートへ廃止予定を問い合わせる。将来の代替経路として、ユーザーが Foursquare のデータエクスポートを取り込む方式も検討する(エクスポートの形式は未確認)。
- 検証の順番: 検証1で本番 client_id を使い、users/self/checkins が 402 を返さないことを最初に確認する。そのうえで、3,000件以上の実アカウントに対して scratchpad の probe.mjs を実行し(T1〜T10)、出力を map-check.mjs と keydiff.mjs にかけて検証2・検証3の表を作る。取得した JSON はマスキングして L-05 のシード用 fixture にする。
- 詳細API(F-33/N-07)の呼び出し制御: ユーザーあたり 500/h の制限を前提に、1チェックインにつき数分〜十数分は結果をキャッシュし、連続クリックを抑える。写真・コメントの再取得はユーザー操作をきっかけにする場合だけに限る。
- 写真の表示: fastly のURLにサイズを付けて直接表示する(一覧は 300x300 や cap300、詳細は original や width960)。サーバでの複製保存は避ける。『Powered by Foursquare』を表記し、チェックインを表示するページは noindex にする。写真URLを第三者へ渡さない。
- Push API(Real Time View)は MVP の対象外とし、拡張候補にとどめる。採用する場合も、再送の保証が無いため読み直し方式の同期を併用する。HTTPS 443 で受け、push secret を定数時間比較で検証すること。
- ストレージの見積り(3〜4KB/行)をホスティングとプラン選定に反映する。Supabase Free(500MB)では重いユーザー数名で上限に届く可能性があるので、Pro プランや raw の TOAST 圧縮設定などを DB 設計担当と検討する。

### open_questions
- offset で深くページングできるか(検証2): 3,000件以上の実アカウントで probe.mjs の T2 を実行する。offset=250/500/1000/2000/2500/2750/5000 の各ページ先頭IDが page0 と一致しないこと、createdAt が単調に減ることを確認する。上限があれば、その境界の値を記録する。
- afterTimestamp は包含か排他か、窓を付けたときの件数(count)の扱い: probe T4/T5 で、既知のチェックインの createdAt=T に対して afterTimestamp=T と T−1、beforeTimestamp=T と T−1 を送り、そのチェックインが含まれるかを比べる。
- sort=oldestfirst がページ内の並べ替えだけかどうかの再確認と、limit>250(251・500)を送ったときの挙動(上限に切り詰めるのか param_error か): probe T1/T3。
- ロケールで表記がどう変わるか: probe T7 で Accept-Language を ja / en / 未指定にし、同じ20件の venue.name・city・country・categories[0].name を比べる。日本国内と海外の venue を両方含むアカウントで実施する。日本語UIなら ja に固定できるか、カテゴリ名が日本語になるかを確認する。
- 詳細APIの実レスポンス(検証3): probe T9 で、写真やコメントの多いチェックイン3件を取得し、keydiff.mjs で一覧と比べる。venue の詳細(location/url/contact)が入るか、comments.items の本文、score.scores、overlaps、shares の有無を確認する。
- 新規の Developer アカウント・プロジェクトで 402 が出ないか: 本番用 client_id で OAuth を通したらすぐ users/self/checkins?limit=1 を呼び、402/403 の有無と X-RateLimit-* ヘッダを記録する。Billing ページでカード登録が必要かどうかも確認する。
- 後付け登録したチェックインの createdAt の意味: Swarm アプリで過去日時のチェックインを1件作り、一覧上の並び位置と createdAt が訪問時刻か登録時刻かを確認する。同時に push と一覧のどちらに現れるかも見る。
- 編集の反映: Swarm アプリで shout 修正や写真の追加をしたあと、一覧APIの該当項目がどう変わるか(createdAt は不変か、photos.count が更新されるか)を確認する。editableUntil の意味(公開されている fixture では createdAt+1時間)も確かめる。
- 1ページあたりのレイテンシと応答サイズ: probe T1 の ms と bytes を、実アカウント(写真が多い・少ない)で計測し、ジョブの分割単位とサーバレスの時間制限との兼ね合いを決める。
- 一覧の photos.items が写真の多いチェックインで省略されることがあるか(旧docs『All items may not be present』): 写真が5枚以上あるチェックインで、一覧と詳細の items 数を比べる。
- 非公開写真のURLが認証なしで取得できるか: 自分の非公開チェックインに付いた写真URLを、ログアウト状態のブラウザで開いて確認する。
- Personalization API(v2)の廃止予定日と代替手段: Foursquare サポートに書面で問い合わせる。あわせて、raw JSON を無期限に保存する件(F-13/N-06)がキャッシュ規約上問題ないかも確認する。
- Push API の設定が新しい Developer Console でも可能か、また後付け登録や編集でも push が来るか(MVP 外。採用を検討するときに確認)。

### artifacts
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\research\fsq-checkins.md
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-exp\map.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-exp\probe.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-exp\map-check.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-exp\keydiff.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-exp\sync-sim.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-exp\sync-sim-output.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-exp\exp.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-exp\exp-output.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-exp\jsonb-size-output.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-exp\map-check-doc2023.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-exp\keydiff-doc.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-dl\doc2023_get-user-checkins_example.json
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\fsq-checkins-dl\doc2026_get-checkin-details_example.json
