# 技術調査報告書(本編):エクスポート方式の前提と実地検証計画

| 項目 | 内容 |
|---|---|
| 版 | 1.2 |
| 作成日 | 2026-10-16 |
| 対象 | 要件定義書「着手事項(実装前スパイク)」および基本設計に必要な追加調査 |
| 注記 | 調査の結果を受けて、2026-10-16 にデータ取得方式を「公式エクスポートの読み込み」に変更し、同日さらに「データはブラウザの中だけに保存し、ログインもサーバーも持たない」方式に変更した。エクスポートの前提は **15章**、ブラウザ内で完結する方式の前提と実地検証計画は **16章**(いずれも本書) |
| 根拠資料 | `doc/2-1_technical investigation/evidence/`(調査メモ、所見、実験スクリプト、実行結果) |
| 関連文書 | `doc/1_requirements/1_requirements definition.md`、`doc/2_basic design/README.md` |

---

> **本書の構成**: 現行方式(公式エクスポートをブラウザで読み込み、ブラウザの中だけに保存する)の前提と検証計画は本書にある(0章・15章・16章)。当初検討した API 同期方式の調査記録は、章番号をそのままに [別冊](2-1_technical%20investigation_API%E6%96%B9%E5%BC%8F%E3%81%AE%E8%A8%98%E9%8C%B2.md)(1〜14章)へ分けた。**別冊のうち、9章(liqe)、10章の NFKC 正規化の挙動、12章(フロントエンド)は現行方式でも有効**(16.2)。

| 章 | 内容 | 場所 |
|---|---|---|
| 0 | 本書について(調査の方法・実施できなかったこと) | 本書 |
| 1〜14 | API 同期方式の調査記録(うち9章・10章の正規化・12章は現行方式でも有効。16.2) | [別冊](2-1_technical%20investigation_API%E6%96%B9%E5%BC%8F%E3%81%AE%E8%A8%98%E9%8C%B2.md) |
| **15** | **エクスポートの前提・形式**(15.3 の検証計画はサーバー保存版のもの。16.3 に置き換え) | 本書 |
| **16** | **ブラウザ内で完結する方式の前提と実地検証計画(現行)** | 本書 |
| 付録A・B | 出典、成果物 | 本書 |

根拠資料(調査メモ・試作コード・検証スクリプト)は [evidence/](evidence/README.md) を参照。

---

## 0. 本書について

### 0.1 調査の方法

| 方法 | 内容 |
|---|---|
| 机上調査 | 公式ドキュメント、公式リポジトリのソースコード(Supabase Auth など)、changelog、npm レジストリ、Wayback Machine の旧版ドキュメント、2025〜2026年の OSS 実装・利用報告 |
| ローカル実験 | liqe の実機パース、PGlite(WASM 版 PostgreSQL 18.6)での DB 実験、Supabase CLI の導入と起動試験、@supabase/ssr の Cookie 挙動実験(通信はモック)、Foursquare エンドポイントへのダミー値での疎通確認、同期方式のシミュレーション |
| 反証チェック | 設計判断に直結する所見を、別のエージェントが独立に裏取りした。**完了したのはホスティングと Foursquare OAuth・規約の2テーマのみ**(残りは途中で中断)。未チェックのテーマの所見は「単独調査」として扱う |

### 0.2 実施できなかったこと

- **Foursquare の実アカウントを使う検証**(OAuth、チェックイン取得、詳細取得、revoke)。開発者登録とクライアントIDがまだ無いため。
- **Supabase のローカルスタックとホスト環境での検証**。開発機に Docker が無く(WSL2 も仮想化が無効で起動不可)、Supabase プロジェクトもまだ無いため。
- **デプロイ検証**(Netlify)。

このうち現行方式でも必要なもの(デプロイ検証など)は、「16.3 実地検証計画」に手順と合格条件をまとめた(13章は API 方式、15.3 はサーバー保存方式での旧計画)。

### 0.3 状態の表記

| 表記 | 意味 |
|---|---|
| ✅ 確認済み | 公式情報またはローカル実験で確認した |
| ⚠️ 暫定 | 机上では結論が出たが、実地検証で確定する必要がある |
| ❌ 不可・要方針変更 | 要件どおりには実現できない、または前提が崩れる |

---

---

## 15. 方式変更後の調査結果と実地検証計画(エクスポート方式)

2026-10-16、ユーザー判断でデータ取得方式を「利用者が Foursquare 公式のデータエクスポートをアップロードする方式」に変更した(要件定義書 v2.0 の 0.1 節)。本章はその前提となる調査結果をまとめる。1〜14章の API 方式の調査結果は、判断の記録として残す。13章の実地検証計画(S-0〜S-7)は本章 15.3 に置き換え、その後の方式変更で 16.3 にさらに置き換えた。詳細は `doc/2-1_technical investigation/evidence/findings/export.md`。

### 15.1 規約上の位置づけ(法的助言ではない)

| 観点 | 内容 | 確度 |
|---|---|---|
| データポータビリティ | Foursquare の消費者向けプライバシーポリシー(2026-02-20 更新)は、利用者が自分の個人データの写しを(移転目的を含めて)請求できると定めている | high |
| 利用者の権利 | 消費者向け利用規約(2026-02-26 更新)では、利用者の投稿(位置情報、shout など)の所有権は利用者に残る(§3.3) | high |
| API のキャッシュ規定との関係 | キャッシュ規定は「API が返したデータ」を対象にしている。利用者が公式エクスポートで受け取り、自分で読み込んだデータには及ばない可能性が高い | 推測 |
| 店名などの扱い | 店名・ID・URL は Foursquare 側の Content で、消費者規約上は「個人的・非商用」の利用許諾にとどまる(§3.2)。商用利用や、利用者をまたいだ店舗データベースの構築はリスクを上げる | 推測 |
| 第三者のデータ | エクスポートには友人一覧・メンションなど第三者のデータや、支払い・端末情報が含まれる。本アプリはそれらのファイルを展開も読み込みもしない(基本設計 P-4) | 推測 |

結論: 非商用で、各利用者が自分のデータを検索するためだけに使う前提ならリスクは低い。商用化する場合は、弁護士か Foursquare(privacy@foursquare.com)に確認する。

### 15.2 エクスポートの形式

| 項目 | 内容 | 確度 |
|---|---|---|
| 申請 | Swarm アプリ・Web の Settings → Privacy Settings → "Initiate Data Download Request"。セルフサービス | high |
| 配送・所要時間 | ZIP のダウンロードリンクがメールで届く。公式は7日以内、実績は平均3日・中央値2日 | high / medium |
| 再申請 | 回数制限の記載は無い。公式は機能の継続を表明 | medium |
| ファイル | `checkins*.json`(1000件ずつ)、`photos*.json`、visits、unconfirmed_visits、comments、tips、users、venueRatings、paymentProfiles、uniqueDevices、`pix/`(写真の実ファイル)など。CSV が同梱される年もある | high(2023〜2024)/ medium(2026) |
| チェックインの項目 | id、createdAt(UTC の文字列。2019年は UNIX 秒)、type、visibility、timeZoneOffset、shout(任意)、venue、comments(件数) | high |
| venue | **{id, name, url} だけ。住所・市区町村・カテゴリ・座標は含まれない** | high |
| 座標 | venue の無いチェックインの location には座標がある。トップレベルの lat/lng は情報が矛盾 | low |
| 写真 | `photos.json` の relatedItemUrl の末尾がチェックイン ID。画像 URL(prefix・suffix)を持つ | high |
| 網羅性 | 非公開チェックイン、City Guide 時代を含む全履歴が入っている | high |

エクスポートだけで検索・表示に使えるのは、店名、コメント(shout)、日時(現地時刻)、公開範囲、写真枚数、コメント数、場所名(venue の無いチェックイン)、イベント名。住所・市区町村・カテゴリは使えない。

### 15.3 実地検証計画(エクスポート方式・サーバー保存版。16.3 に置き換え済み)

サーバー保存版(基本設計 v1.0)の計画。現行の計画は 16.3。上から順に実施する。S-1 は利用者(開発者)本人の操作が必要で、届くまで数日かかるため、最初に申請しておく。

| ID | 内容 | 合格条件・確認項目 |
|---|---|---|
| S-1 | 実際の2026年版エクスポートを取得して中身を確認する(**最優先**) | ファイル名と分割、チェックインの項目(特に座標の有無)、createdAt の形式、日本語の文字コード、写真の URL が表示できるか(非公開写真を含む)、ZIP のサイズ、リンクの有効期限。個人情報をマスクして fixture にする |
| S-2 | Supabase Auth の Google ログインとメールのリンク・コードを、開発用プロジェクトで確認する | 外部 SMTP での送信、日本語の文面、`/auth/confirm` の確認ボタン方式、CAPTCHA(Turnstile)、同じメールアドレスの自動リンク、レート制限の値と引き上げ方、`Sb-Forwarded-For` を使ったリフレッシュ |
| S-3 | Docker 導入後、ローカルスタックで pg_cron・権限・ロケール・auth.users の SQL からの削除を確認する | 基本設計 6.5・9.5 の想定どおりに動く |
| S-4 | Netlify に最小アプリをデプロイする | アカウント種別(クレジット制/レガシー)、同期関数の実際のタイムアウト、proxy.ts でのセッション更新と CSP、ビルドの成否、`x-nf-client-connection-ip`、Netlify のレート制限ルールが Next.js のルートに効くか |
| S-5 | ブラウザでの ZIP の読み込みを計測する | 写真入りの大きな ZIP(数百MB〜)から必要なファイルだけを取り出せるか、PC とスマホでの処理時間・メモリ、1万件の取り込み時間 |
| S-6 | Supabase に1利用者3〜5万件の fixture を投入して検索を計測する | 総件数を含む検索がサーバー処理で数百ms以内(N-05) |

---

---

## 16. ブラウザ内で完結する方式の前提と実地検証計画(現行)

2026-10-16、ユーザー判断で「取り込んだデータはブラウザの中だけに保存し、検索もブラウザで行う。ログインとサーバー側の DB は持たない」方式に変更した(要件定義書 v2.0)。本章は、その前提となる技術的な事実と、確認の計画をまとめる。

本章の事実は、本書作成者の知識と既存の調査結果に基づく机上の整理であり、独立した裏取りは行っていない。設計判断に関わるものは 16.3 の実地検証で確かめる。

### 16.1 前提となる技術的な事実

| 項目 | 内容 | 確度 |
|---|---|---|
| IndexedDB | 対象ブラウザのすべてで使え、Web Worker の中からも使える | high |
| 保存できる量 | ブラウザが端末の空き容量の一定割合を上限として割り当てる(Chrome・Edge は大きく、Firefox・Safari はそれより小さい)。本アプリの想定(20万件で 120〜240MB)は通常その範囲に収まる | medium(数値はブラウザと版で異なるため S-7 で確認) |
| 自動の削除(容量不足) | 永続化されていないサイトのデータは、端末の容量が逼迫すると、使われていない順にブラウザが削除することがある。永続化されたサイトは対象外 | high |
| Safari の7日ルール | Safari は、サイトを7日間(Safari を使っている日数で数える)操作しないと、そのサイトがスクリプトで保存したデータ(IndexedDB を含む)を削除する。ホーム画面に追加した Web アプリは対象外とされる | medium(実機で S-7) |
| 永続化の要求 | `navigator.storage.persist()` で永続化を求められる。Chrome は利用状況などから自動で判断し(確認画面は出ない。始めは未許可になりやすい)、Firefox は確認画面を出す(利用者の操作から呼ぶ必要がある)。Safari は近年の版で対応 | medium(S-7) |
| ホーム画面のアプリの保存領域 | iOS・iPadOS では、ホーム画面に追加した Web アプリは Safari と別の保存領域を持つ。Safari で保存したデータは、ホーム画面のアプリからは見えない | medium(S-7) |
| プライベートブラウズ | IndexedDB は使えるが、ウィンドウを閉じると消える。サイトからはプライベートブラウズかどうかを確実には判別できない | medium |
| ワーカーと CSP | 自サイトの URL から作った専用ワーカーは、画面の CSP を引き継がず、ワーカーのスクリプトの応答に付いた CSP に従う | medium(S-4) |
| Web Locks・BroadcastChannel | 対象ブラウザの下限(Safari 16.4、Chrome 111、Firefox 128)はいずれも対応している(Safari は 15.4 から) | high |
| URL の `#` 以降 | HTTP のリクエストに含まれず、サーバーに送られない | high |
| Next.js の静的書き出し | Route Handlers(リクエストに依存するもの)、Server Actions、proxy(middleware)、cookies()、設定ファイルでのヘッダ・リダイレクト指定、ISR、既定の画像最適化、`generateStaticParams` の無い動的ルートは使えない | high(Next.js の文書) |
| 静的書き出しとインラインスクリプト | 書き出した HTML には Next.js のインラインスクリプトが含まれるため、厳しい CSP にはそのハッシュを入れる必要がある | medium(S-4 で確認) |
| liqe のブラウザでの利用 | ブラウザ向けにまとめたときの大きさは約 34KB(圧縮前、本調査で計測) | high(`evidence/` の試作) |
| ブラウザでの照合 | 試作の JS の参照評価器は、SQL による検索と29ケースすべてで一致した。数万件の文字列の部分一致は、一般的な端末で数十ミリ秒程度と推測 | high(一致)/ 推測(速さ。S-6) |
| 正規化の一致 | データと検索語の両方に同じ JS の関数(NFKC と小文字化)を使うため、DB と JS の正規化の差(10章の İ の例など)は生じない | high |

### 16.2 既存の調査結果の扱い

| 章 | 現行方式での扱い |
|---|---|
| 1〜7章(Foursquare API・OAuth) | 不要 |
| 2章(規約) | 方式変更の理由として有効。運営者がデータを預からないため、キャッシュ規定の問題は生じない |
| 8章(Supabase CLI)、10章のうち DB の権限・Vault・pg_cron | 不要 |
| 9章(liqe)、10章のうち NFKC 正規化の挙動 | 有効 |
| 11章(ホスティング) | 静的配信だけになるため、関数のタイムアウト・リージョン・レート制限の論点は不要。料金(デプロイのクレジット)は有効 |
| 12章(フロントエンド) | 有効。ただし proxy.ts・Cache Components・Server Actions は使わない |
| 15章(エクスポート) | 有効 |

### 16.3 実地検証計画(現行)

上から順に実施する。S-1 は利用者(開発者)本人の操作が必要で、届くまで数日かかるため、最初に申請しておく。番号はサーバー保存版(15.3)と合わせ、不要になった S-2・S-3 は欠番にする。

| ID | 内容 | 合格条件・確認項目 |
|---|---|---|
| S-1 | 実際の2026年版エクスポートを取得して中身を確認する(**最優先**) | ファイル名と分割、ZIP の中のフォルダ構成、チェックインの項目(特に座標の有無)、createdAt の形式、日本語の文字コード、写真の URL が表示できるか(非公開写真を含む)、ZIP のサイズ。形式の確認に必要な最小限の件数だけを、すべて架空の値に置き換えて fixture にする(実物はリポジトリに入れない) |
| S-4 | Netlify に静的書き出しをデプロイする | ビルドの成否、`netlify.toml` と生成した `out/_headers` のヘッダが付くこと(CSP が重複しないこと)、インラインスクリプトのハッシュによる CSP で画面が動くこと(だめなら代替案)、ワーカーのスクリプトに付けた CSP で**ワーカーの中から外部への `fetch` が拒否されること**、Trusted Types(`require-trusted-types-for 'script'`)を有効にして画面が動くか、zod を `jitless` で使って CSP の違反が出ないこと、アカウント種別とデプロイのクレジット消費 |
| S-5 | ブラウザでの ZIP の読み込みと取り込みを計測する | 写真入りの大きな ZIP(数百MB〜、ZIP64 を含む)から必要なファイルだけを取り出せるか、実際に展開したバイト数で途中で止められるか、分割されていない古い形式の `checkins.json` の大きさ、展開済みのフォルダを選べるか(macOS Safari の自動展開)、PC とスマホでの処理時間・メモリ、1万件・5万件・20万件の取り込み時間、スマホで画面のスリープ防止が効くかと、他のアプリに切り替えたときに中断されるか |
| S-6 | ブラウザ内での検索を計測する | 5万件・20万件で、検索用データ(search_index)の準備時間、検索の応答時間、メモリ使用量(PC・iPhone・Android) |
| S-7 | 保存領域の永続化と、データが消える条件を確認する | `persist()` の結果(各ブラウザ。Chrome で未許可になる条件を含む)、保存できる量の目安、iOS Safari で7日間使わない場合の挙動と、ホーム画面に追加した場合の挙動、**Safari で取り込んだデータがホーム画面のアプリから見えるか**(見えない想定)、プライベートブラウズでの挙動 |

---

## 付録A 主要な出典

| 区分 | 出典 |
|---|---|
| Foursquare 規約 | [Usage Guidelines – Personalization APIs](https://docs.foursquare.com/developer/reference/usage-guidelines-personalization-apis)、[Personalization APIs EULA](https://foursquare.com/legal/terms/personalization-apis-self-service-eula/)、[Trademark Guidelines](https://foursquare.com/legal/terms/trademark-and-brand-feature-guidelines/)、[Upcoming Changes](https://docs.foursquare.com/developer/reference/upcoming-changes) |
| Foursquare API | [v2 Authentication](https://docs.foursquare.com/developer/reference/v2-authentication)、[Get User Checkins](https://docs.foursquare.com/developer/reference/get-user-checkins)、[Errors](https://docs.foursquare.com/developer/reference/personalization-apis-errors)、[Rate Limits](https://docs.foursquare.com/developer/reference/personalization-apis-rate-limits)、[Versioning](https://docs.foursquare.com/developer/reference/versioning) |
| Supabase | [Rate limits](https://supabase.com/docs/guides/auth/rate-limits)、[API keys](https://supabase.com/docs/guides/getting-started/api-keys)、[Vault](https://supabase.com/docs/guides/database/vault)、[Cron](https://supabase.com/docs/guides/cron)、[Data API の既定 GRANT 廃止](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)、[supabase/auth](https://github.com/supabase/auth) |
| Netlify | [Functions configuration](https://docs.netlify.com/build/functions/configuration/)、[How credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)、[Rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/) |
| Next.js | [proxy.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)、[Upgrading to 16](https://nextjs.org/docs/app/guides/upgrading/version-16)、[Security update 2026-10-14](https://nextjs.org/blog/nextjs-security-update-october-14-2026) |
| liqe | [gajus/liqe](https://github.com/gajus/liqe) |

全出典は `doc/2-1_technical investigation/evidence/findings/` と `notes/` にある。

---

## 付録B 成果物

`doc/2-1_technical investigation/evidence/README.md` を参照。
