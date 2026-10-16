# Swarm/Foursquare 公式データエクスポート(Download your data)調査

- 調査日: 2026-10-16
- 目的: 利用者が公式エクスポートを取得してアップロードし、アプリで索引化する案の実現性を確かめる
- 凡例: 確度は high / medium / low。出典で直接確認できず推論したものには「推測」と付記
- 前提: Foursquare はエクスポートのスキーマを公式に文書化していない(2024-12 のブログに "there's no documentation from Foursquare" とある)。フィールドの情報は、OSS パーサやブログに載った実データの断片から組み立てた

## 1. 申請方法・配送・所要時間

**申請手順**

- Swarm アプリ(high): プロフィール → 歯車 → Settings > Privacy Settings → "Initiate Data Download Request"。出典: https://foursquare.com/city-guide-sunset/
- Web(high): foursquare.com にログイン → Settings → Privacy Settings → "Initiate Data Download Request"。出典: https://foursquare.com/legal/privacy-center/
- `foursquare.com/settings/privacy` は `https://app.foursquare.com/settings/privacy` に転送され、未ログインならログイン画面に飛ぶ(high、HTTP ヘッダで確認)

**条件・配送・所要時間**

- セルフサービスのボタンで申請でき、サポートへの依頼は不要。ログインできることが条件(high)
- noreply@legal.foursquare.com から受付メールが届き、準備ができると2通目のメールでダウンロードリンクが届く。中身は ZIP(high)
- 公式の記載は "within 7 days"(high)。Privacy Center の 2025 年実績はアクセス請求の平均3日・中央値2日(medium)。体験談は48時間以内、約30時間、数日後など
- 再申請: 公式は "remains available, with no plans to discontinue it" とし、回数制限の記載は無い(medium)。リンクの有効期限・サイズ上限は公開情報なし

## 2. 構造

| 時期 | 観測されたファイル | 確度 |
|---|---|---|
| 2019 | `checkins.json`(1ファイル)、`photos.json`、`checkins.csv` | medium |
| 2023-09 | `checkins1.json`〜`checkins7.json` と同名の .csv、comments、expertise、paymentProfiles、photos、tastes、tips、unconfirmed_visits、uniqueDevices、users、venueRatings、visits(.csv と .json)、`readme.html`、`pix/`(写真の実ファイル) | high |
| 2024-11〜12 | checkins 群、visits、unconfirmed_visits、comments、tips、venueRatings、photos、pix/ | high |
| 2026-10 | His-Story のパーサが読むファイル: `checkins*.json`、`photos1.json`、visits、unconfirmed_visits、tips、lists、venueRatings、users、comments、shares、pix/ | medium(実データではなくパーサの実装から推定) |

- チェックインは1000件ずつ別ファイルに分かれる(medium-high)。各ファイルは `{"count":N,"items":[...]}`(high)
- 写真: `photos.json` はメタデータ(id, createdAt, prefix, suffix, width, height, visibility, fullUrl, relatedItemUrl)。`relatedItemUrl` の末尾がチェックイン ID。`pix/` に実ファイル(high)
- `comments.json` は {userId, time, comment} のみで、どのチェックインへのコメントか分からない(high)
- `visits.json` には city/state/countryCode があるが、チェックインとは結合できない(high)

## 3. チェックインのフィールド

実サンプル(2024-11、ID はマスク):

```json
{"id":"673583d9xxxxxxxxxxxx5c32","createdAt":"2024-11-14 05:00:09.000000","type":"checkin",
 "visibility":"closeFriends","entities":[],"shout":"Kareoke time!","timeZoneOffset":-300,
 "venue":{"id":"52854129xxxxxxxxxxxxff56","name":"The Brew Inn",
          "url":"https:\/\/foursquare.com\/v\/the-brew-inn\/52854129..."},
 "comments":{"count":0}}
```

| フィールド | 内容 | 確度 |
|---|---|---|
| id | 24桁の16進数。先頭8桁が作成時刻の UNIX 秒 | high |
| createdAt | 2023年以降は UTC の文字列 `"YYYY-MM-DD HH:MM:SS.ffffff"`。2019年は UNIX 秒の整数 | high / medium |
| timeZoneOffset | 分単位の整数 | high |
| type | checkin / venueless(venue の代わりに location{name, lat, lng})/ shout | high / medium |
| shout | 任意。API の shout にある同行者表記がエクスポートに無いことがある | high / medium |
| visibility, private | private、closeFriends など。古いレコードには無い | medium-high |
| venue | **{id, name, url} のみ。住所・city・state・country・lat/lng・カテゴリは含まれない** | high |
| トップレベルの lat/lng | 情報が矛盾(2024-12 のブログは無いと明言、2026-10 の His-Story は読んでいる) | low |
| event | イベントのチェックインだけカテゴリを持つ | medium |
| comments | 件数のみ | high |
| 写真 | 埋め込まれていない。photos.json と relatedItemUrl で結合 | high |
| likes, with | どのサンプルにも無い | medium |

His-Story の「エクスポートには city・country・category が無い」は支持される(high)。

## 4. エクスポートを使う OSS と欠けた項目の補い方

- His-Story(2026-10): エクスポートに加え、本人の OAuth で v2 の users/self/checkins を呼んでカテゴリ・住所を補っている
- samgrover(2019): v2 venues API で座標を補完(無料枠の制限で数千件に約2週間)
- fightwithtools(2024-12): v3 Place Details で座標を補完
- artlung(2023)、ymkz(2019): 補完なし
- Places API で補った値は、セルフサーブ契約ではキャッシュ禁止のため、永続保存すると違反になる可能性が高い(推測)

## 5. 規約とデータポータビリティ(法的助言ではない)

- Consumer Services Privacy Policy(2026-02-20 更新): "You may request access to or copies of the personal data we have about you (including for transfer purposes)"(high)
- Consumer Services Terms of Use(2026-02-26 更新): 利用者の投稿(位置情報、shout など)の所有権は利用者に残る(§3.3)。Foursquare 側の Content は個人的・非商用の利用許諾(§3.2)。エクスポートについての条項は無い(high)
- Personalization APIs EULA のキャッシュ制限は「API が返したデータ」を対象にしている。利用者が公式エクスポートで受け取って自分でアップロードしたファイルに、この制限がそのまま及ぶ可能性は低い(推測)
- ただしベニュー名・ID・URL は Foursquare の Content で、消費者規約上は「個人的・非商用」の許諾にとどまる。商用利用や、利用者をまたいだベニュー DB の構築(Developer Master Terms §7.5.8 の趣旨)はリスクを上げる(推測)
- エクスポートには第三者のデータ(友人、メンション)や支払い・端末情報が含まれるため、アップロード前に除外するのが望ましい(推測)
- 確実を期すなら弁護士か Foursquare(privacy@foursquare.com)に書面で確認する

## 6. 網羅性

- 非公開チェックイン、City Guide 時代を含む全履歴が含まれる(high)
- 後から追加したチェックインは通常のチェックインとして入っている可能性が高い(推測)
- API にあってエクスポートに無いもの: 住所、city、country、lat/lng、カテゴリ、写真の埋め込み、with、likes(medium-high)

## 総合評価: エクスポートだけで索引化できるもの

| 項目 | 可否 | 補足 |
|---|---|---|
| ベニュー名 | 可 | high |
| shout | 可 | high。欠けることがある |
| 日時(現地時刻も算出可) | 可 | high |
| 公開範囲 | 可 | medium-high |
| 写真枚数 | 可 | photos.json から集計 |
| コメント数 | 可 | high |
| イベントのカテゴリ | 一部 | medium |
| 住所・city・state・country | 不可 | high |
| ベニューのカテゴリ | 不可 | high |
| lat/lng | 基本は不可 | low |

UX 上の示唆: 自動更新はできない(再申請 → 2〜3日、最大7日待ち → ZIP をダウンロード → 再アップロード)。ZIP は写真を含み大きくなりうるため、ブラウザ側で展開してチェックインの JSON だけを送る(Netlify の関数のリクエスト上限は 6MB)。形式は予告なく変わりうるため元の JSON も保存する。最優先は、実際に2026年版のエクスポートを取得して座標の有無などを確かめること。

## 主な出典

- https://foursquare.com/city-guide-sunset/
- https://foursquare.com/legal/privacy-center/
- https://foursquare.com/legal/privacy-center/foursquare-privacy-policy-consumer-services/
- https://foursquare.com/legal/terms/foursquare-consumer-services-terms-of-use/
- https://foursquare.com/legal/terms/personalization-apis-self-service-eula/
- https://foursquare.com/legal/terms/developermasterterms/
- https://github.com/mjanssen19/His-Story
- https://fightwithtools.dev/posts/projects/foursquare-location-data-site/day-1-getting-a-handle-on-the-data/
- https://github.com/artlung/foursquare-export-to-html
- https://samgrover.com/2019/04/16/importing-foursquareswarm-history.html
- https://gdpr-info.eu/art-20-gdpr/
