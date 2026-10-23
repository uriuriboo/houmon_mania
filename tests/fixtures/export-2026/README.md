# export-2026(架空データ)

2026-10 に取得した実物のエクスポート(S-1)と**同じ形**で、値をすべて架空にした最小の fixture。
実物の ZIP・JSON はリポジトリに入れない(要件 L-05)。

実物で確認した形式:

| ファイル | 形式 |
|---|---|
| `checkinsN.json` | `{"count": N, "items": [...]}`。1000件ずつ分割。新しい順 |
| `photos1.json` | `{"count": N, "items": [...]}` |
| その他 | `users.json`(本人・友人)、`comments.json`(他人のコメント)、`shares.json`、`uniqueDevices.json`、`venueRatings.json`、`paymentProfiles.json`、各 `.csv`、`readme.html`、`pix/`(写真の実ファイル)。**本アプリは読み込まない** |

チェックインレコードの項目(実物の 1,910 件で確認):

| 項目 | 内容 |
|---|---|
| `id` | 24桁の16進数 |
| `createdAt` | `"YYYY-MM-DD HH:MM:SS.ffffff"`(UTC) |
| `type` | `"checkin"` |
| `visibility` | `"closeFriends"` など。**無いレコードがある** |
| `timeZoneOffset` | 分(例: 540) |
| `shout` | 任意 |
| `venue` | `{id, name, url}`、任意で `canonicalName`。**`name` が英字表記で `canonicalName` に日本語の店名が入っていることがある** |
| `lat`・`lng` | **トップレベルにある**(`location` は無い) |
| `hacc`、`editableUntil`、`canonicalUrl`(署名付き)、`entities` | 保存しない |
| `comments` | `{count}` |
| `event` | 任意。`{id, name, categories, canonicalUrl}` |

写真の情報: `id`、`createdAt`、`prefix`(`https://fastly.4sqi.net/img/general/`)、`suffix`(`/{数字}_{英数字}.jpg`)、`width`、`height`、`visibility`、`fullUrl`、`relatedItemUrl`(`https://swarmapp.com/checkin/{チェックインID}`)、`canonicalUrl`。
