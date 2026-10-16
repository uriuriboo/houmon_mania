# 調査メモ: チェックイン取得API・データ構造・差分同期 (key: fsq-checkins)

- 調査日: 2026-10-16
- 対象要件: F-10〜F-15, F-30, F-33, N-06 / 着手事項 検証2・検証3
- 実アカウント/トークンは使用していない。Foursquare API へはトークン無し/ダミートークンでのエラー応答確認のみ実施。
- 実験ファイル: `scratchpad/fsq-checkins-exp/` (map.mjs, map-check.mjs, keydiff.mjs, probe.mjs, sync-sim.mjs, exp.mjs, jsonb-size.mjs と各 *-output.txt)
- ダウンロード資料 (未信頼データとして隔離): `scratchpad/fsq-checkins-dl/`

---

## 0. 結論サマリ (設計判断に効く順)

1. **v2 Personalization API は公式ドキュメント上「Deprecated」表示 (2025-07頃〜)。ただし 2026-06 の価格改定告知で checkins/users 系は「無料のまま」と明記、2026-08〜10 も複数の実利用報告あり。** 廃止日は未告知。→ N-06 (raw 保持) は必須、API 停止時に「同期のみ停止・検索は継続」できる設計にする。
2. **`sort` / `afterTimestamp` / `beforeTimestamp` は現行ドキュメントに無い (旧版 2016〜2021 には記載)。** 2026-08 の実測報告では、after/before は機能、`sort=oldestfirst` は「ページ内の並べ替えのみ」で古い順の取得には使えない、`count` は窓を指定しても総数のまま、`beforeTimestamp` は包含 (<=)。
3. **`offset` 深追いの挙動は報告が割れている** (2026-08 実測: 約7,400件まで正常 / 2026-09 別報告: 数百件超で先頭ページ繰り返し / 2026-03 別リポジトリ: ~2,500件上限説 (AI生成PR由来で根拠薄))。→ バックフィルは `beforeTimestamp` カーソル主体 + 「進捗なし」検知で `offset` へフォールバックする二系統実装を推奨。
4. **方式A(既知ID打ち切り)も方式B(afterTimestamp=最大createdAt)も、遡及チェックイン・編集・削除を取りこぼす。** 推奨は「直近 N 日の窓を毎回読み直す + count 照合で不一致なら全走査 + 定期フル走査」のハイブリッド。シミュレーションで有効性を確認 (§9)。
5. 詳細API (`/v2/checkins/{id}`) で増えるのは `user`, `checkinShortUrl`(署名付き共有URL), `canonicalUrl/Path`, `comments.items[]`(本文), `score`(コイン), `overlaps` 等。**一覧で取れない検索対象は特に無い** → F-15 方針(一覧で完結)は妥当。ただし詳細 raw で一覧 raw を上書きすると抽出列が壊れる恐れがあるので raw_detail を別列にする案を推奨。
6. **レスポンス形状は `v`/`m` で揺れる** (例: `formattedAddress` が string[] の場合と `{text, entities}` の場合が公式例に混在)。抽出は防御的に書き、`v` は固定値にする。
7. **地名・カテゴリ名はロケール依存** (locale 未指定だと地名は現地語、カテゴリ名は英語既定)。検索語の言語に直結するので `Accept-Language` を固定する必要あり (要実測)。
8. 写真・アイコン URL は `prefix + サイズ + suffix`。2026-10-16 に認証無しで取得できることを確認 (Fastly CDN, max-age 10年, ACAO:*)。
9. ストレージ見積: raw JSONB は 1件あたり約1.7KB(一般的)〜2.7KB(写真/いいね多数)。行全体で 2.3〜4KB 程度 → **3万件のユーザーで約70〜120MB (推測)**。Supabase Free(500MB)では重量ユーザー数名で上限に達しうる。
10. エラー: トークン失効/取消は `401 invalid_auth "OAuth token invalid or revoked."`(実測)。`403` は `rate_limit_exceeded` と `not_authorized` の二義 → `meta.errorType` で分岐必須。F-14 の「レート制限時に再連携を促す」は誤誘導になるので文言を分ける。

---

## 1. 公式ドキュメントの記載状況 (年表)

| 時期 | URL | パラメータ記載 | 備考 |
|---|---|---|---|
| 2016-03 (Wayback) | developer.foursquare.com/docs/users/checkins | USER_ID(self のみ), limit(最大250), offset, **sort(newestfirst/oldestfirst), afterTimestamp, beforeTimestamp** | 「We highly discourage developers from polling this endpoint to learn of new check-ins or to keep their users' check-in history synced. Using the real-time API is a much better solution.」 Modes supported: swarm |
| 2018-06 (Wayback) | developer.foursquare.com/docs/api/users/checkins | 同上 | Response fields: id, type(checkin/shout/venueless), timeZoneOffset, createdAt, private, shout, user, venue, location, source, event, photos, comments, likes, overlaps, score |
| 2021-03 (Wayback) | developer.foursquare.com/docs/api-reference/users/checkins | 同上 | 2022-10 に 404 |
| 2023-12 (Wayback) | location.foursquare.com/developer/reference/get-user-checkins | **`v` のみ** | 「Private Beta Feature」表示。OpenAPI 定義に limit/offset すら無し |
| 2026-10-16 (live) | docs.foursquare.com/developer/reference/get-user-checkins | v(必須), limit(最大250, 既定20), offset(既定0, 上限なしと記載) | 「Public Beta Feature」、サイドバーのカテゴリ名は **「Personalization APIs (depr)」**、updated_at 2026-02-12 |

旧版 afterTimestamp の説明 (原文): "Retrieve the first results to follow these seconds since epoch. This should be useful for paging forward in time, or when polling for changes. To avoid missing results when polling, we recommend subtracting several seconds from the last poll time and then de-duplicating."
旧版 beforeTimestamp: "Retrieve the first results prior to these seconds since epoch. Useful for paging backward in time."
旧版 sort: "How to sort the returned checkins. Can be newestfirst or oldestfirst."

### Deprecated 表示の経緯 (Wayback で確認)
- docs.foursquare.com/developer の製品一覧: 2025-05-29 時点「Personalization API」(ラベル無し) → **2025-07-10 以降「Personalization API - Deprecated」**、同時に「Users API New!」が出現。
- 「Users API」は managed user / Placemaker 用で、チェックイン履歴を返すエンドポイントは無い (docs.foursquare.com/fsq-developers-users/reference/*)。
- Release Notes (Personalization API) は 2024-03 (Public Beta 開始), 2024-04 の2件のみ。廃止日の告知は見つからず。
- upcoming-changes (2026): 「Beginning June 1, 2026 ... Any checkins, lists, tastes, tips, and users endpoints not mentioned in the above lists will remain free.」 Pro 課金対象に `/v2/users/X/historysearch` を明記 (Swarm Web が使う historysearch は有料なので使わない)。
- Versioning ページ: 廃止時は meta に `errorType: deprecated` を返し、「at least several months」の移行期間を設けるとの記載 (2017 版より)。

---

## 2. パラメータ挙動 (文書 / 実測報告 / 未確認)

| パラメータ | 現行文書 | 実測・実装報告 (日付) | 本調査の判断 |
|---|---|---|---|
| `v` | 必須 (YYYYMMDD) | 各OSSで 20170319〜20260223 が稼働 | 固定値で送る (例 20260801)。形状が v/m で変わる |
| `limit` | 最大250, 既定20 | 公式例: count 23 に対し items 20 (既定20を確認) | 250 固定。251/500 の挙動は未確認 |
| `offset` | 既定0, 上限記載なし | tk0miya/travelmap (2026-08-30, 8,700件の実アカウント): offset で 10年窓 7,373件を走査し成功 / SlashNephy/mitsubachi (2026-08-31): users/{id}/checkins の offset「正しく動作する」 / spokenlikeageek (2025-12): 13,714件を offset で取得 / **airalcorn2/swarm-explorer (2026-09): 「数百件を超えると先頭ページを繰り返す」** / toouur (2026-03, Codex生成PR): 「~2,500で黙って打ち切り」 | **報告が割れている → 要実測 (検証2)**。単独依存は避ける |
| `sort` | 記載なし | travelmap 実測: `sort=oldestfirst` + `limit=5` は最新5件をページ内で逆順にしただけ (古い順の「選択」はしない) | 送らない。古い順取得は不可と考える |
| `afterTimestamp` | 記載なし | tdrayson (2026-08 本番稼働「3 new check-in(s)」), mitsubachi (/checkins/recent で「その時刻より新しいものに絞り込まれる」), toouur CI (毎時) | 機能するが未文書化。包含/排他は未確認 → マージン+ID重複排除 |
| `beforeTimestamp` | 記載なし | travelmap 実測: **包含 (createdAt == T を返す)** / toouur: 約69,000件の履歴を before カーソルで全件再取得する運用 (2026-04-21 に途中打ち切りの run もあり、count 到達で完了判定) / airalcorn2 (2026-09) | 機能する (遡りページング可)。同秒対策に「最古createdAtをそのまま次カーソル+ID重複排除」 |
| `count` (応答) | 総数 | travelmap 実測: 窓 (after/before) を付けても総数 8,700 のまま | 進捗表示 (F-11) と整合チェックに使える。窓内件数には使えない |
| `m=swarm` | 記載なし | travelmap 実測: 付けると `displayGeo`, `exactContextLine` が増えるだけ。無しで 200 | 送らない (raw に余計な揺れを入れない) |
| 認証 | `oauth_token` クエリ (ManagedUserTokenAuth) / v2-authentication では `Authorization: Bearer` | travelmap 実測: Bearer も oauth_token も可。本調査でもダミートークンで Bearer が認識されることを確認 | **Bearer ヘッダで送る** (トークンをURL/ログに残さない) |
| `locale` / `Accept-Language` | Localization ページ: ヘッダ推奨、en(既定)/es/fr/de/it/ja/th/tr/ko/ru/pt/id。未指定時、地名は「その国で最も一般的な言語」にフォールバック | toouur: 国名が現地語 (Беларусь, Republica Moldova, المغرب) で返る / travelmap: push で国名・カテゴリ名が日本語 (アプリ言語の影響か未確定) | **要実測**。検索語の言語を左右するため固定する |

### 2.1 本調査で実施した無認証プローブ (2026-10-16, 東京から)
```
GET /v2/users/self/checkins?v=20261016&limit=250&sort=oldestfirst&afterTimestamp=0 (認証なし)
=> 400 {"meta":{"code":400,"errorType":"invalid_auth","errorDetail":"Missing access credentials. See https://developer.foursquare.com/docs/api/configuration/authentication for details.","requestId":"..."},"response":{}}  elapsed 297ms
GET ...&oauth_token=INVALIDTOKEN123
=> 401 {"meta":{"code":401,"errorType":"invalid_auth","errorDetail":"OAuth token invalid or revoked.","requestId":"..."},"response":{}}  elapsed 202ms
GET (v 無し) ...&oauth_token=INVALIDTOKEN123 => 401 同上 (認証が先に評価され v 必須の確認は不可)
GET /v2/checkins/592b2cfe09e28339ac543fde?v=...&oauth_token=INVALID => 401 同上
Authorization: Bearer INVALIDTOKEN123 => 401 "OAuth token invalid or revoked." (= Bearer ヘッダは認識される)
レスポンスヘッダ: Via: 1.1 varnish, X-Served-By: cache-nrt-... (Fastly 東京エッジ経由), X-Cache: MISS。エラー応答には X-RateLimit-* 無し
```

---

## 3. レスポンス構造 (一覧 `GET /v2/users/self/checkins`)

```
{ meta:{code, requestId, [errorType, errorDetail]}, notifications:[...],
  response:{ checkins:{ count:<総数>, items:[ <checkin>... ] } } }
```

### 3.1 checkin 主要フィールド
| フィールド | 型 | 有無 | 備考 (根拠) |
|---|---|---|---|
| id | string(24hex) | 常に | |
| createdAt | int (UNIX秒) | 常に | |
| type | "checkin" / "shout" / "venueless" | 常に | 旧docs。venue 無しは shout/venueless (古いFoursquare時代) |
| timeZoneOffset | int (分) | ほぼ常に | 例: JST=540, EDT=-240 |
| shout | string | **コメントが無い時はキー自体が無い** | 公式例・zakiメモ・travelmap で一致。友達タグ時に「— with Natalie」等が本文に含まれる例あり (swarm-to-sqlite fixture) |
| entities | array | shout がある時 | user メンションの indices |
| private | true | 非公開時のみ | 「It is only being returned because the owner of the checkin is viewing this data.」 |
| visibility | "public"/"private"/"closeFriends" | 新しめのデータ | 公式例は private のみ、shkspr(2026) で closeFriends、travelmap で public |
| venue | object | venue 無しチェックイン以外 | 下表 |
| location | {name, lat, lng} | type=shout/venueless のとき有り得る | 旧docs |
| photos | {count, items[], layout} | 常に | items[]: id, createdAt, prefix, suffix, width, height, user, visibility, source。「All items may not be present」 |
| likes | {count, groups[{type,count,items[user]}], summary} | 常に | いいねしたユーザーは一覧でも取れる |
| like / isMayor | bool | 常に | |
| comments | {count} | 常に | **一覧では本文なし (count のみ)** |
| posts | {count, textCount, [items]} | 常に | |
| source | {name, url} | **古い(2010頃)チェックインでは欠落** | swarm-to-sqlite issue #6 |
| with | [user] | 同行者タグ時 | |
| createdBy | user | 友達が代理チェックインした時 | |
| sticker | {id, name, image{prefix, sizes[], name}, ...} | 使用時 | |
| event | {id, name, categories} | イベントチェックイン時 | |
| overlaps | {count, items} | **一覧ではほぼ返らない** (toouur: "bulk endpoint never/rarely returns overlaps") | 詳細APIで取得 |
| editableUntil | int (ミリ秒) | 新しめのデータ/push | travelmap push fixture では createdAt+1h |
| canonicalUrl | string | push/詳細 | 一覧での有無は未確認 |

### 3.2 venue / location / categories
- venue: id, name, contact{...}, location, categories[], verified, stats{tipCount, usersCount, checkinsCount}, url, venueRatingBlacklisted, beenHere, createdAt, **private (自宅等の非公開venue)**, **closed (閉店)**, locked, storeId, venuePage, hasMenu, menu, ... (2023公式例)
- location: address, crossStreet, lat, lng, labeledLatLngs[], postalCode, cc, neighborhood, city, state, country, contextLine, contextGeoId, **formattedAddress (string[] または {text:"…\n…", entities:[]})**, **isFuzzed (非公開venueで座標がぼかされる)**
  - formattedAddress の形: swarm-to-sqlite(v=20190101)/zakiメモ(v=20231010)/travelmap は string[]、2023 公式例 20件はすべて object(text)。→ 両対応必須
  - 非公開venue (category "Home (private)") は address/city が欠け state/country のみ等
- categories[]: id, name, pluralName, shortName, icon{prefix, suffix}, primary(bool)。2026 push では `categoryCode`, `mapIcon` も (travelmap fixture)
- venue.timeZone ("Asia/Tokyo") が push payload に存在 (一覧での有無は未確認)

### 3.3 公式例 (2023 docs, get-user-checkins の 200 例) item[0] 全文 (抜粋保存: fsq-checkins-dl/doc2023_get-user-checkins_example.json)
```json
{
  "id": "59b97e6cf79faa0d5e23abeb", "createdAt": 1505328748, "type": "checkin",
  "private": true, "visibility": "private", "entities": [], "shout": "Monday monday!", "timeZoneOffset": -240,
  "venue": {
    "id": "4f0de7267bebfc146005dcc0", "name": "Mattlantis 🐳", "contact": {"facebook": "122222194529429"},
    "location": {
      "address": "Lake Sakakawea", "lat": 47.4992621650669, "lng": -101.9282341003418,
      "labeledLatLngs": [{"label": "display", "lat": 47.4992621650669, "lng": -101.9282341003418}],
      "postalCode": "58540", "cc": "US", "city": "Garrison", "state": "ND", "country": "United States",
      "contextLine": "Garrison, ND", "contextGeoId": 72057594043617170,
      "formattedAddress": {"text": "Lake Sakakawea\nGarrison, ND 58540", "entities": []}
    },
    "categories": [{"id": "4bf58dd8d48988d161941735", "name": "Lake", "pluralName": "Lakes", "shortName": "Lake",
      "icon": {"prefix": "https://ss3.4sqi.net/img/categories_v2/parks_outdoors/lake_", "suffix": ".png"}, "primary": true}],
    "verified": true, "stats": {"tipCount": 16, "usersCount": 1, "checkinsCount": 4}, "private": true,
    "url": "http://foursquare.com/johnsmith", "venueRatingBlacklisted": true, "beenHere": {"lastCheckinExpiredAt": 0}, "createdAt": 1326311206
  },
  "likes": {"count": 0, "groups": []}, "like": false, "isMayor": false,
  "photos": {"count": 1, "items": [{"id": "59b97e6d270ee77dbf2b8aa0", "createdAt": 1505328749,
      "source": {"name": "Swarm for iOS", "url": "https://www.swarmapp.com"},
      "prefix": "https://fastly.4sqi.net/img/general/", "suffix": "/7294631_KK8FbnS6sqgrlXgZeCwkYbSn2efiAQBoT7x4p_hteis.jpg",
      "width": 1440, "height": 1920,
      "user": {"id": "123456", "firstName": "John", "lastName": "Smith", "handle": "johnsmith", "privateProfile": false, "gender": "male",
               "countryCode": "US", "relationship": "self", "photo": {"prefix": "https://fastly.4sqi.net/img/user/", "suffix": "/blank_boy.png", "default": true},
               "birthday": 19700101, "isAnonymous": false},
      "visibility": "private"}], "layout": {"name": "single"}},
  "posts": {"count": 0, "textCount": 0}, "comments": {"count": 0},
  "source": {"name": "Swarm for iOS", "url": "https://www.swarmapp.com"}
}
```
公式例 20件の集計 (map-check.mjs 出力より): shout 20%, private/visibility 15%, venue.closed 35%, venue.private 20%, isFuzzed 10%, neighborhood 70%, address 75%, city 90%, formattedAddress=object 100%, photos 4件(各1枚)。

### 3.4 実データ由来 fixture (dogsheep/swarm-to-sqlite tests/checkin.json, 2017 のチェックイン, 一部匿名化)
特徴: `shout: "7th wedding anniversary — with Natalie"` + entities(user), `with[]`, `likes.groups[].items[]`(3名), `sticker{image{prefix,sizes:[60,94,150,300],name}}`, `photos.items[3]`(各 source/user/visibility:"public"), `posts.items[]`(text), `comments:{count:1}`(本文なし), `event{categories}`。`private`/`visibility` キーは無い。formattedAddress は string[]。
(全文は fsq-checkins-dl/swarm-to-sqlite/tests__checkin.json)

### 3.5 2026 の push payload (tk0miya/travelmap testdata/push_body.txt, 実push を伏字化したもの)
```
checkin={"id":"5f2a1b3c4d5e6f708192a3b4","createdAt":1767225906,"type":"checkin","visibility":"public","timeZoneOffset":540,
 "canonicalUrl":"https://foursquare.com/user/1709193/checkin/5f2a...","editableUntil":1767229506000,"user":{"id":"1709193"},
 "venue":{"id":"4b4429abf964a520a80f25e3","name":"東京タワー","location":{"address":"4 Chome-2-8 Shibakoen","lat":35.6586,"lng":139.7454,
 "postalCode":"105-0011","cc":"JP","city":"港区","state":"東京都","country":"日本","formattedAddress":["4 Chome-2-8 Shibakoen","港区, 東京都","日本"]},
 "categories":[{"id":"4bf58dd8d48988d12d941735","name":"モニュメント / ランドマーク",...,"icon":{"prefix":"https://ss3.4sqi.net/img/categories_v2/building/monument_","suffix":".png"},
 "categoryCode":"10027","mapIcon":"https://ss3.4sqi.net/img/categories_v2/building/monument_88.png","primary":true}],"timeZone":"Asia/Tokyo"}}
&user={"id":"1709193",...,"email":"[REDACTED]"}&secret=...
```
→ 住所の番地はローマ字、市区町村・国・カテゴリは日本語という混在。user.id は数値風だが文字列。

---

## 4. 詳細API `GET /v2/checkins/{checkin_id}` との差分 (検証3)

### 4.1 公式例同士の key diff (keydiff.mjs, 同一ID 59b97e2a0d173f01fd48252e)
```
only in DETAILS: canonicalUrl, canonicalPath, user{id,firstName,lastName,gender,countryCode,relationship,canonicalUrl,canonicalPath,photo,isAnonymous},
                 photos.items[].user.canonicalUrl/canonicalPath,
                 checkinShortUrl = "https://www.swarmapp.com/user/123456/checkin/59b97e2a...?s=NGWtGIBccpKeOKH_SB9EEnGqrI4",
                 comments.items = [], score.total = 0
only in LIST:    venue.contact/location/categories/verified/stats/url/..., photos.items[].source, photos.items[].visibility, ...
```
注意: 公式の詳細例は venue が `{id, name}` のみに手で削られている体裁 (整形が崩れている)。OwnYourSwarm は詳細レスポンスの venue.location / url / contact を使っているため、**実レスポンスでは venue 詳細も入ると推測**。

### 4.2 実装コードから読み取れる詳細専用/詳細化項目
| 項目 | 一覧 | 詳細 | 根拠 |
|---|---|---|---|
| コメント本文 | count のみ | comments.items[]{id, createdAt, text, user{id, firstName, lastName, photo}, sticker?} | aaronpk/OwnYourSwarm lib/Backfeed.php (詳細を取り直して items を読む) |
| いいねユーザー | likes.groups[].items[] | 同左 | OwnYourSwarm は一覧の likes.groups を使用 |
| 共有URL | 無し | checkinShortUrl (`?s=` 署名付き: 友達限定を回避できる共有リンク) | shkspr 2026-06、旧docs(signature の説明) |
| overlaps (同時刻に同じ場所の友達) | ほぼ無し | count/items | toouur 2026-03/04 |
| score (コイン) | 無し | total, scores[]{points, message, icon} | OwnYourSwarm ProcessCheckin::sendCoins |
| user | 無し (自分なので省略) | あり | 旧docs「If the user is not clear from context」 |
| shares | 無し | {twitter:true} 等 (連携時) | zaki-lknr メモ |
| 削除済みID | (一覧から消える) | **400 errorDetail "Invalid checkin id"** (または404) | OwnYourSwarm, toouur fetch_checkins.py confirm_deleted() |

→ 検索対象 (店名・shout・住所・カテゴリ) はすべて一覧に含まれる。**詳細取得は表示の充実 (コメント本文・コイン・共有URL・最新の写真) と削除検知のため**と位置付けるのが妥当。

---

## 5. OSS の差分同期実装と「現在も機能する」証拠

| 実装 | 期間 | 方式 | 2025-2026 の稼働証拠 |
|---|---|---|---|
| dogsheep/swarm-to-sqlite | 2019〜(最終2023-04) | sort=newestfirst, limit=250, **beforeTimestamp=前ページ最後の createdAt** で遡る (offset 無し)、`--since` は afterTimestamp | 2024-06 Issue コメント「It worked for me with swarm-to-sqlite」 |
| tk0miya/travelmap (Go) | 2026-08〜10 | 文書化済みのみ: v固定, limit=250, **offset**, Bearer。毎回「直近14日の窓」を再読込 (再開カーソルを使わない)、下限はクライアント側で適用、push と併用 | PR #49 (2026-08-30) に実アカウント(8,700件)での挙動表。§2参照 |
| toouur/foursquare-dashboard / darya-shvvv/swarm-journal | 2026-03〜10 | 増分: afterTimestamp=CSV最大createdAt + beforeTimestamp で遡り。全件: CI は beforeTimestamp、ローカルは offset。count 到達で完了判定。削除は詳細APIの "Invalid checkin id" で確認後に反映 (最大50件) | 2026-10-14 コミット、約69,000件、Cloudflare Worker で毎分 `limit=1&sort=newestfirst` をポーリング |
| airalcorn2/swarm-explorer | 2026-09 | beforeTimestamp=最古+1 (包含対策で重複排除) | README「offset は数百件で先頭ページを繰り返す」 |
| tdrayson/taylordrayson | 2026-08 | afterTimestamp + 「直近 --days を再確認」+ ギャップ時は最新保存分まで延長 (上限90日) | PR #154 「foursquare:sync 3 new check-in(s), 0 already stored」(本番実行) |
| aaronpk/OwnYourSwarm | 2017〜2025-11 | **User Push API** 受信 → 詳細APIをバックオフでポーリング (写真追加待ち)、一覧 limit=30〜100 で likes/comments の変化検知 | 継続運用中 (最終push 2025-11) |
| alexpriest/swarm-mcp | 2025-12〜 | offset+sort、after/before による期間検索 | — (oldestfirst で最古取得を試みているが travelmap 実測に照らすと誤り) |
| SlashNephy/mitsubachi (Android) | 2026-08 | users/{id}/checkins は offset ページング | PR #436 実機検証 |

User Push API (Real Time View, docs 2026-02 更新): アプリ設定「Push API notifications」に HTTPS(443) URL と push secret を登録すると、認可済みユーザーのチェックイン毎に `checkin`, `user`, `secret` を URL エンコード JSON で POST。public/friends/private 全てが届く。リトライ仕様は未記載。travelmap は 2026 年に実 push を受信 (観測された送信元は公開IP帯 199.38.176.0/22 ではなく AWS us-east-1 だったが、webhook レコーダ経由のため判断保留と記載)。旧docs: 「cache indefinitely しないこと」。

---

## 6. 大量履歴取得時の注意

- **レート制限** (Personalization API Rate Limits): OAuth トークンごと・1時間あたり・リソースグループ単位。Users 500 / Checkins 500 / Photos 500 / Venues 500 / Lists 1000。超過時 403 (`errorType: rate_limit_exceeded`, 応答は空)。ヘッダ `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`。別に `429 quota_exceeded` (Daily call quota) がエラー表に存在。
  - 一覧は 250件/req なので 500 req/h = 12.5万件/h。3万件ユーザーでも約120リクエスト → 制限には当たらない。
  - 詳細APIはユーザーあたり 500/h。toouur は 0.35秒間隔の一括詳細取得で quota 403 → 8秒間隔に変更 (2026-03-30)。→ N-07 の連打防止は必須、詳細結果は短時間キャッシュ。
- **402 Payment Required のリスク**: spokenlikeageek (2025-12記事) は users/self/checkins で 402 を受け、Foursquare サポートが対応するまで約2か月。toouur は venueokays/venuedislikes が常時402、venuelikes は月約220回のプレミアム枠超過で402と報告。→ **本番アプリの client_id で早期に一覧APIを叩いて確認**すること。
- **1リクエストのレイテンシ**: 公開された計測値は見つからず。無認証エラー応答の往復は東京から 200〜300ms (Fastly NRT 経由, origin MISS)。250件ページは本文 0.4〜1.2MB (公式例の平均 1.5KB/件, 写真等の多い例 4.7KB/件で試算) なので **1〜3秒/ページ程度と推測**。3万件で数分。→ サーバレスの1呼び出しで完走させず、ページ単位のジョブ化 (カーソル永続化) が必要。
- **取得中の新規チェックイン**: offset 方式は先頭に1件増えると境界の1件が次ページで重複 (upsert で吸収)。途中で削除があると1件飛ばす可能性。beforeTimestamp カーソルは新規追加の影響を受けない (古い方へ進むため)。同秒 (createdAt 同値) が境界を跨ぐと、包含カーソル+ID重複排除で吸収。
- **toouur の報告**: beforeTimestamp ページングで HTTP 500 が出ることがあり 1秒ずつ戻して回避 (Codex 生成コード由来で一次観測かは不明, low)。
- **編集・削除の反映**: shout は後から編集可 (Update Checkin: shout ≤200字)、写真は後から追加される (OwnYourSwarm は写真出現までポーリング)、venue の改名・統合で venue_id が変わる (swarm-journal)。削除されたチェックインは一覧から消え、詳細は 400 "Invalid checkin id"。**高水位カーソル型の差分同期ではどれも拾えない** → 窓の再読込・定期フル走査・詳細表示時の再取得で反映する。遡及チェックイン (過去日時で後から登録) の createdAt が「訪問時刻」か「登録時刻」かは未確定 (travelmap の未解決事項)。
- **ストレージ** (PGlite = PostgreSQL 18.6 で計測, jsonb-size.mjs): 公式例タイプ 1件 1,666B(JSON) → jsonb 列 1,674B (2KB未満なので TOAST 圧縮されない)。写真/いいね多数タイプ 5,085B → 2,724B (圧縮)。raw+id のみで 2,290B/行。抽出列・生成列・インデックス込みで 3〜4KB/行と見込む → 3万件 ≈ 90〜120MB (推測)。Supabase Free は 500MB/プロジェクト、Pro は 8GB 込み。

---

## 7. 写真・アイコン URL

| 種別 | 組み立て | 検証 (2026-10-16, 認証なし GET) |
|---|---|---|
| チェックイン写真 | `prefix + size + suffix`。size = `original` / `WxH` (任意値, 中央トリミング) / `capN` / `widthN` / `heightN` (旧docs: 36,100,300,500 が代表値) | public 写真 (fastly.4sqi.net/img/general/...): original 1920x1440, 300x300→300x300, 36x36, 100x100, 500x500, cap300→300x225, width960→960x720, width300→300x225, height300→400x300, 123x77→123x77 すべて 200。Cache-Control max-age=315360000 (10年), Access-Control-Allow-Origin:* 。公式例の「private」写真 URL は 404 (削除済みと推測) |
| カテゴリアイコン | `icon.prefix + size + icon.suffix`。size 32/44/64/88 (旧docs)、灰背景は `bg_` + size | ss3.4sqi.net/.../french_64.png, french_bg_64.png, french_88.png, french_120.png = 200 (max-age 30日)、サイズ無し `french_.png` = 403 |
| ユーザー写真 | `photo.prefix + 300x300 + photo.suffix` | 200 |
| ステッカー | `image.prefix + sizes[i] + image.name` | igx.4sqi.net/img/sticker/300/foodie_a56e26.png = 200 |

利用上の注意: CDN はリファラ・認証チェック無しで配信 (ホットリンク可能)。非公開写真も URL を知っていれば見える可能性が高い (推測) → URL を他者に出さない。EULA §3.2「Powered by Foursquare」表記、§3.3 クローラ対策 (Personalization Data を表示するページ)。キャッシュ/保存期間の具体値は Usage Guidelines 参照とされるが、Personalization 向けの数値は確認できず (Places 向けは「fsq_id 以外30日」「未認可ユーザーのデータは3時間」との二次情報)。

---

## 8. 試作コードの要点

### 8.1 マッピング (map.mjs) の方針
- `id`/`createdAt` 欠損は例外 (取込スキップ+ログ)。それ以外は欠損で NULL / 0 / '{}' にし、例外を投げない。
- categories は primary を先頭に並べ替えた name の配列。
- formattedAddress は string[] と {text} の両対応。
- venue 無し (type=shout/venueless) は top-level location の name/lat/lng を使う。
- 実行結果 (exp-output.txt): 6種の fixture (実データ由来/公式例/2026 push 由来/合成) で全件エラーなく変換。DB 生成列と JS 側 NFKC+lower の結果が一致。

### 8.2 生成列の制約 (PGlite PG18.6 で確認)
```
FAIL A: array_to_string in generated column: generation expression is not immutable
FAIL B: concat_ws in generated column: generation expression is not immutable
OK   C: normalize(lower(coalesce(a,'') || ' ' || coalesce(b,'')), NFKC)
OK   D: immutable wrapper for text[] join  (create function fsq_join_text(text[]) ... language sql immutable)
```
→ `search_text` に categories(text[]) を入れるには IMMUTABLE ラッパー関数か、別途 categories_text 列が必要。`concat_ws` も不可なので `||` + coalesce で連結する。

### 8.3 差分同期シミュレーション (sync-sim.mjs, 偽API: 6,063件, createdAt 降順, before 包含/after 排他)
```
## API正常 / M1(新規5+窓内遡及1+窓内削除1)
  diff_A_offset_stop_at_known: missing=1 stale=1 calls=1
  diff_B_afterTs_noMargin:     missing=1 stale=1 calls=1
  diff_H_window14d_plus_count: missing=0 stale=0 calls=1 {"added":6,"deleted":1,"reconciled":false}
## API正常 / M2(+400日前の遡及)
  diff_A: missing=2 stale=1 / diff_B: missing=2 stale=1
  diff_H: missing=0 stale=0 calls=26 {"reconciled":true}   ← count 不一致で全走査
## API正常 / M3(+窓外削除で件数が相殺)
  diff_H: missing=1 stale=1 calls=1 {"reconciled":false}   ← count 照合だけでは検知不能 → 定期フル走査が必要
## offset が 300 超で先頭ページを返す
  backfill_offset: missing=5563 (no-progress 検知で停止) / backfill_before: missing=0 / backfill_hybrid: missing=0
## beforeTimestamp が黙って無視される
  backfill_before: missing=5813 / backfill_hybrid: missing=0 (before->offset に自動切替, calls=27)
## afterTimestamp が黙って無視される
  diff_H: missing=0 (下限をクライアント側で強制しているため影響なし)
```

### 8.4 実地プローブ (probe.mjs, 未実行・要トークン)
T1 limit 既定/250/251/500 と X-RateLimit ヘッダ・レイテンシ・バイト数、T2 offset 250〜10000 で先頭ページ繰り返しの有無、T3 sort の選択/並べ替え、T4/T5 after/before の包含・count 変化、T6 before カーソル3ページの単調性と重複、T7 Accept-Language ja/en/なし の表記差、T8 m=swarm のキー差、T9 詳細3件 (写真/コメント多い順) の保存、T10 存在しないIDの詳細エラー形。出力を map-check.mjs / keydiff.mjs に通すと検証3の欠損率表・差分表がそのまま作れる。

---

## 9. 方式A / 方式B 比較と推奨

| 観点 | 方式A: offset + 既知ID到達で打ち切り | 方式B: afterTimestamp 等で絞り込み | 推奨: 窓再読込ハイブリッド |
|---|---|---|---|
| 依存パラメータ | v/limit/offset (文書化済み) | afterTimestamp/beforeTimestamp (現行未文書化、旧版で文書化、2026実測で機能) | 下限はクライアント側で強制し、afterTimestamp は「送れば転送量が減る最適化」扱い。ページングは before 主体・offset フォールバック |
| 新規取得 | ○ (通常1リクエスト) | ○ (通常1リクエスト) | ○ (通常1リクエスト) |
| 遡及チェックイン | × (既知IDで止まる) | × (最大createdAtより前は対象外) | ○ 窓内 / 窓外は count 不一致→全走査で回収 |
| 編集 (shout・写真追加・venue変更) | × | × | 窓内は○、窓外は定期フル走査・詳細表示時に反映 |
| 削除 | × | × | 窓内は検知→詳細APIで "Invalid checkin id" 確認後に論理削除。窓外は定期フル走査 |
| 仕様変更耐性 | offset 上限問題の報告あり | パラメータが黙って無視されると全件取得になり得る | 「進捗なし」「下限より古い行が返る」を検知して切替 |
| 実装コスト | 低 | 低 | 中 (ジョブ化・照合ロジック) |

推奨値 (初期案): 窓 = DB上の最大 createdAt − 14日 (travelmap と同値。写真の後付けや遡及登録を考慮し 30日も可)。count 照合でずれたら全走査ジョブ。定期フル走査は月1回 or ユーザー操作「完全再同期」。全走査・初回バックフィルは beforeTimestamp カーソル (`cursor = 前ページ最古 createdAt`, 包含なので ID で重複排除) を主に、ページが進まなければ offset に切替。

---

## 10. 一覧API → checkins テーブル マッピング案

| DB列 (要件5章) | 取得元 | 欠損時 | 備考 |
|---|---|---|---|
| id | item.id | 取込不可 | PK は (user_id, id) の複合を推奨 (他ユーザー行の誤上書き防止) |
| user_id | (セッション) | — | |
| created_at | to_timestamp(item.createdAt) | 取込不可 | timestamptz (UTC) |
| tz_offset | item.timeZoneOffset (分) | NULL | 表示時刻 = created_at + tz_offset。NULL 時はユーザーTZ |
| shout | item.shout | NULL | キー自体が無いのが通常。「— with 友人名」等が含まれ得る |
| venue_id | item.venue.id | NULL | venue 統合で後日変わり得る |
| venue_name | item.venue.name | item.location.name → NULL | ロケール依存 |
| categories | venue.categories[].name (primary 先頭) | '{}' | ロケール依存。検索生成列には IMMUTABLE ラッパー経由 |
| address | venue.location.address | NULL | 非公開venueでは欠落が普通 |
| city / state / country | venue.location.* | NULL | ロケール依存 (未指定時は現地語) |
| lat / lng | venue.location.lat/lng | item.location.lat/lng → NULL | isFuzzed=true はぼかし座標 |
| photo_count | photos.count | 0 | F-30 |
| raw | item 全体 | NOT NULL | 一覧由来の raw |
| search_text | 生成列: lower(normalize(venue_name‖shout‖address‖formatted_address‖city‖state‖country‖fsq_join_text(categories), NFKC)) | — | concat_ws/array_to_string は使用不可 |
| deleted_at | — | NULL | 連携解除 (F-40) と Swarm 側削除を区別するなら別列 (例 source_deleted_at) |

追加推奨列: cc (国コード: 唯一ロケール非依存), formatted_address (string[]/{text} を正規化), type, is_private (private==true), visibility, primary_category_id, category_icon (prefix/suffix), comment_count, like_count, venue_closed, venue_private/is_fuzzed, source_name, event_name, list_synced_at, **raw_detail (jsonb NULL) + detail_fetched_at** (F-33 の詳細 raw は別列に保存し、一覧由来の抽出列を詳細 raw から再抽出しない)。

---

## 11. 未解決事項と実地検証手順

1. offset の深さ上限 (検証2): probe.mjs T2。count が 3,000件以上の実アカウントで offset=2,500/2,750/5,000 の先頭IDが page0 と一致しないこと、createdAt が単調減少することを確認。
2. afterTimestamp の包含/排他、count の扱い (T4/T5)。
3. sort=oldestfirst が並べ替えのみか (T3)。
4. limit>250 の挙動 (T1)。
5. ロケール (T7): Accept-Language: ja / en / 未指定で venue.name, city, country, categories[0].name を比較。日本語UIなら ja 固定が第一候補。既存データとの混在を避けるため、途中で変える場合は全件再取得。
6. 詳細APIの追加項目 (T9 → keydiff.mjs): 実レスポンスで venue の詳細が入るか、comments.items の本文、score.scores、overlaps の有無。
7. 本番 client_id で 402 が出ないか (登録直後に一覧API を1回)。
8. 遡及チェックインの createdAt の意味: Swarm アプリで過去日時のチェックインを1件作り、一覧での位置と createdAt を確認。
9. User Push API を使うか: 新Developer Console で「Push API notifications」設定が可能か、HTTPS 443 で受けられるか (Netlify/Workers で可)、push secret 検証。
10. 写真の可視性: private 写真の URL が無認証で取得できるか (自分の非公開チェックインで確認)。
11. Personalization API の廃止予定: Foursquare サポートに問い合わせ (廃止日・代替の有無)。

---

## 12. 参照URL
- https://docs.foursquare.com/developer/reference/get-user-checkins (現行、Public Beta、(depr) カテゴリ)
- https://docs.foursquare.com/developer/reference/get-checkin-details
- https://docs.foursquare.com/developer/reference/personalization-apis-rate-limits
- https://docs.foursquare.com/developer/reference/personalization-apis-errors
- https://docs.foursquare.com/developer/reference/personalization-apis-localization
- https://docs.foursquare.com/developer/reference/versioning
- https://docs.foursquare.com/developer/reference/v2-authentication
- https://docs.foursquare.com/developer/reference/real-time-view
- https://docs.foursquare.com/developer/reference/update-a-checkin / delete-a-check-in
- https://docs.foursquare.com/developer/reference/upcoming-changes
- https://docs.foursquare.com/developer (Personalization API - Deprecated / Users API New!)
- https://docs.foursquare.com/developer/reference/personalization-api-release-notes
- https://foursquare.com/legal/terms/personalization-apis-self-service-eula/
- https://web.archive.org/web/20160326145626/https://developer.foursquare.com/docs/users/checkins
- https://web.archive.org/web/20180624134731/https://developer.foursquare.com/docs/api/users/checkins
- https://web.archive.org/web/20210308224356/https://developer.foursquare.com/docs/api-reference/users/checkins
- https://web.archive.org/web/20210506134639/https://developer.foursquare.com/docs/api-reference/checkins/details
- https://web.archive.org/web/20231202154744/https://location.foursquare.com/developer/reference/get-user-checkins
- https://web.archive.org/web/20170719121943/https://developer.foursquare.com/docs/responses/photo
- https://web.archive.org/web/20150925223209/https://developer.foursquare.com/docs/responses/category
- https://web.archive.org/web/20170301142214/https://developer.foursquare.com/overview/realtime
- https://web.archive.org/web/20170301142208/https://developer.foursquare.com/overview/versioning
- https://web.archive.org/web/20250529184801/https://docs.foursquare.com/developer , https://web.archive.org/web/20250710012901/https://docs.foursquare.com/developer
- https://github.com/tk0miya/travelmap/pull/49 , https://github.com/tk0miya/travelmap/pull/40 , docs/architecture.md, docs/database.md, TODO.md
- https://github.com/SlashNephy/mitsubachi/pull/436
- https://github.com/toouur/foursquare-dashboard (scripts/fetch_checkins.py, solution.html, PR #2) / https://github.com/darya-shvvv/swarm-journal
- https://github.com/airalcorn2/swarm-explorer
- https://github.com/tdrayson/taylordrayson/pull/154
- https://github.com/dogsheep/swarm-to-sqlite (utils.py, tests/checkin.json, issues #3 #6 #8 #16)
- https://github.com/aaronpk/OwnYourSwarm (lib/ProcessCheckin.php, lib/Backfeed.php, controllers/Foursquare.php)
- https://github.com/alexpriest/swarm-mcp
- https://github.com/josemoliver/SwarmScripts , https://github.com/ericblue/swarm-downloader (historysearch 使用例)
- https://shkspr.mobi/blog/2026/06/using-foursquares-api-to-post-location-checkins-to-social-media/
- https://www.spokenlikeageek.com/2025/12/01/exporting-foursquare-check-ins-to-day-one/
- https://zaki-lknr.github.io/Misc/4sq/
- https://supabase.com/pricing
