# 調査メモ: ホスティング比較 Netlify vs Cloudflare Workers(Next.js App Router + Supabase)

- テーマ key: `hosting`
- 調査日: 2026-10-16(情報は 2026年10月時点で再確認済み。公式ドキュメント/公式リポジトリ/changelog/npm レジストリを優先)
- 対応要件: 7章 技術スタック、N-03, N-05, N-07, F-10/F-11, F-42
- 実験ディレクトリ(スクラッチパッド配下、プロジェクトは無変更):
  - `scratchpad\hosting-bench\`(チャンク処理 CPU ベンチ: `bench.mjs`, `bench-result.txt`)
  - `scratchpad\hosting-dbtest\`(PGlite による DB 側レート制限・猶予期間削除の試作: `dbtest.mjs`, `dbtest-result.txt`)

---

## 0. 結論サマリ

| 観点 | Netlify | Cloudflare Workers (OpenNext) |
|---|---|---|
| Next.js 16.4 対応 | OpenNext ベースの公式アダプタ(`@netlify/plugin-nextjs` 5.16.2, 自動更新)。公式表で App Router/Server Actions/Route Handlers/Middleware/ISR すべて "Full Support"。Node.js Middleware(=proxy.ts)は 5.13.0 で対応済み | `@opennextjs/cloudflare` 1.20.12(2026-10-15)で "Add support for Next.js 16.4"。proxy.ts(Node middleware)は 1.20.3(2026-08-26)から **experimental**。Cloudflare 公式は新規アプリに **vinext** を推奨 |
| 実行時間 | 同期関数 60秒(公式・変更不可)※10秒/26秒の利用者報告あり / Scheduled 30秒 / Background 15分 | CPU 時間課金。Free 10ms/リクエスト(厳格)/ Paid 既定30秒・最大5分。壁時計時間は無制限 |
| 無料枠 | 300 credits/月の**ハードリミット**、超過で全プロジェクト停止。本番デプロイ1回=15 credits | 100,000 req/日。ただし CPU 10ms のため Next.js SSR は実質不可 → **Paid $5/月が前提** |
| リージョン | Functions 既定 Ohio (cmh)。変更は **Pro 以上のみ** | ユーザー最寄り PoP で実行。Smart Placement / リージョン指定は全プラン |
| レート制限 | コード定義ルール(関数 config か netlify.toml の redirects)。非Enterprise は IP 単位のみ、Free 2ルール、窓 ≤180秒。Next.js 生成関数に config を付けられない | WAF レート制限ルール(Free 1ルール・IP・10秒)/ Rate Limiting binding(キー任意=ユーザーID可、GA) |
| Cron | Scheduled Functions(全プラン、30秒上限) | Cron Triggers(OpenNext ではカスタム worker で scheduled を追加) |
| Windows | ビルドは Netlify CI(Linux)。ローカルは `next dev` で十分 | OpenNext は「Windows の完全サポートは保証しない」→ WSL/Linux VM/CI 推奨。wrangler は Node 22+ 必須 |
| 月額目安 | Free(制約大)/ Personal $9(1,000cr)/ Pro $20(3,000cr, リージョン選択可) | Workers Paid $5(10M req + 30M CPU-ms 込み) |

**推奨(条件付き)**: Cloudflare Workers(Workers Paid)+ `@opennextjs/cloudflare` + Supabase(東京)を第一候補とし、基本設計前に「検証8: ホスティング実地スパイク」(9章)で合格した場合に確定。不合格時は Netlify(Pro で `nrt` リージョン、または Personal + Supabase を us-east-2 に配置)へ切替。どちらでも動くよう、レート制限・日次削除は DB 側、同期は Route Handler によるクライアント主導チャンク、セッション更新は proxy.ts に依存しない設計を推奨。

---

## 1. バージョン・スナップショット(npm レジストリ実測, 2026-10-16)

```
next => 16.4.2 (16.4.0: 2026-10-06, 16.4.1: 2026-10-14 セキュリティ修正, 16.4.2: 2026-10-15)
@netlify/plugin-nextjs => 5.16.2 (2026-10-05)  engines.node >=18
@opennextjs/cloudflare => 1.20.12 (2026-10-15)  peer: next ">=15.5.28 <16 || >=16.4.1", wrangler "^4.148.0"
@opennextjs/aws => 4.1.11
wrangler => 4.151.0  engines.node >=22.0.0(bin/wrangler.js に MIN_NODE_VERSION = "22.0.0" の実行時チェックあり)
netlify-cli => 27.12.1  engines.node >=22.13.0(26.x までは >=20.12.2)
@supabase/supabase-js => 2.118.0  engines.node >=22.0.0(2.109.0 まで >=20.0.0、2.110.0 = 2026-06-30 から >=22)
@supabase/ssr => 0.12.7  peer @supabase/supabase-js ^2.114.0
liqe => 3.8.7
vinext => 1.2.1 (1.0.0: 2026-09-28)  engines.node >=22, peer react ^19.3.1, vite ^8.0.0
next@16.4.2 engines.node >=20.9.0
Node.js 最新 LTS: v24.22.0 (Krypton, 2026-10-14)。Node 20 は 2026-04-30 EOL
開発機: Node v20.11.1(nvm 管理、他バージョン未インストール), npm 10.2.4, WSL コマンドあり, RAM 8GB
```

示唆:
- 開発機の Node 20.11.1 では wrangler(実行時に拒否)、netlify-cli 27、supabase-js ≥2.110 の要件を満たさない。**どちらのホスティングを選んでも Node 24 LTS(最低 22)へ更新が必要**。supabase-js は 2.109.0 が Node 20 最終対応版。第三者報告では realtime-js が Node 20 でネイティブ WebSocket 不在のため createClient() 時に例外("Node.js detected but native WebSocket not found")。
- OpenNext Cloudflare は Next 16.4.0 公開(10-06)から対応版(10-15)まで約9日のラグ。peer 下限をセキュリティ理由で頻繁に引き上げる(1.20.7: 16.3.6, 1.20.8: 16.3.8, 1.20.12: 16.4.1)→ 強制アップグレードが定期的に発生。
- Netlify アダプタ 5.16.2 は 16.4.0 より前のリリースだが、Netlify は「全ての安定版で互換性を検証」「アダプタを pin しないこと推奨(自動更新)」。2026-10-14 のセキュリティ告知で 16.4.1 へのアップグレードを推奨。

---

## 2. Netlify 詳細

### 2.1 Next.js 対応
- アダプタ: OpenNext 製 `opennextjs-netlify`(パッケージ名 `@netlify/plugin-nextjs`)。Next.js 13.5 以降をサポート、ビルド毎に最新アダプタを自動使用(pin 非推奨)。
- 公式機能表(docs: Next.js on Netlify): App Router / SSR / ISR / SSG / RSC / Server Actions / Streaming / `next/after` / Middleware / Route Handlers / Image Optimization / i18n / Skew Protection / Draft Mode / Turbopack / Cache Components = すべて "Full Support"。
- アダプタが作るもの: SSR・ISR・PPR・Route Handlers・Server Actions を処理する **サーバーレス関数 1 つ** + Middleware 用 **Edge Function**。
- 制限: Edge runtime 指定の SSR も Functions リージョンで Node 実行 / Middleware の後に headers・redirects が評価される / **Node.js Middleware は C++ アドオン不可・ファイルシステム不可**。
- Node.js Middleware(proxy.ts)対応: 5.13.0(2025-09-02)"Node.js Middleware support"。5.15.8/5.15.9 で bundling 修正。
- 未解決 issue(2026-10 時点、メンテナ返信なし):
  - #3562(2026-08-24): proxy.ts が Edge Functions bundling で MODULE_NOT_FOUND。エラーパスがバックスラッシュ → **Windows ローカルビルド+netlify deploy** の事例。
  - #3575(2026-09-28): Next 16.3.x + Turbopack で同様。Windows ユーザーの追報あり。Netlify CI(Linux)での再現有無は不明。
  - #3560(2026-08-21): Node middleware で ESM-only の serverExternalPackages を使うと 500。
- Next.js 公式(deploying ドキュメント 2026-08-06 更新): Verified Adapters は Vercel と Bun のみ。「Cloudflare and Netlify are working on verified adapters built on the Adapter API」。Netlify は Adapter API ベースの新アダプタを "later this year" に予定、現行 OpenNext アダプタのサポートは継続と表明。

### 2.2 Functions の制限(docs: Configuration for functions)
| 項目 | 値 |
|---|---|
| Region | 既定 `cmh`(US East, Ohio)。変更は **Pro/Enterprise のみ**。Next.js 等アダプタ生成関数はコードで region 指定不可、プロジェクト単位 UI 設定 |
| Memory | 1024 MB(Credit-based Pro/Enterprise で 1024〜4096MB に変更可) |
| 同期実行上限 | **60 秒(Configurable: No)** |
| Scheduled 実行上限 | 30 秒 |
| Background 実行上限 | 15 分(Credit-based Free/Personal/Pro で利用可) |
| バッファ型 req/res ペイロード | 6 MB(バイナリは base64 で実質 4.5MB) |
| ストリーム応答 | 20 MB |
| Background ペイロード | 256 KB |

タイムアウトの食い違い: 公式は 60 秒だが、第三者ブログ(bex.co, 2026-09-23)は「Free 10秒/有料26秒」、Netlify フォーラム(2026-08-25, Pro ユーザー)で "the default 10-second limit" に当たったとの報告。レガシープランや Lambda 互換モード由来の可能性(**推測**)。→ 設計上は 1 リクエスト ≤10 秒に収める。

### 2.3 料金(Credit-based, 2025-09-04 以降の新規アカウント)
- 月間クレジット: Free 300(**ハードリミット**)/ Personal $9 で 1,000 / Pro $20 で 3,000〜(5,000以上は繰越可)。
- 消費: 本番デプロイ 15/回(プレビュー・ブランチデプロイは 0)、Compute 10/GB-h(関数の**実行時間×メモリ**、外部 API 待ちも課金対象)、帯域 20/GB、Web リクエスト 2/1万件、Forms 無料。Edge Functions は compute ではなく web requests で計上。
- 使い切ると: 「all of your web projects (sites/apps) are paused」→ `Site not available`、新規本番デプロイ不可。Free は次サイクルまで待つかアップグレード。1プロジェクトの超過でチーム内全プロジェクト停止。通知は 50/75/90/100%。
- 自動リチャージ: Personal 500cr/$5、Pro 1,500cr/$10(既定 OFF)。Free は追加購入不可。
- Rate limiting: Free から "Firewall Traffic Rules & basic rate limiting"。

### 2.4 Rate Limiting(docs: Rate limiting)
- コードベースのルールは全プラン。UI ルールは Enterprise(HP Edge)のみ。
- ルール数: Free/Starter/Personal = 2/プロジェクト、Pro/Enterprise = 5、HP Edge = 100。
- 集計: 非 Enterprise は「Per domain and IP」のみ(ユーザー単位不可)。windowSize 最大 180 秒。アクション: 429 or rewrite。
- 反映遅延: 閾値超過から最大 10 秒間はリクエストが通る(カウントはリクエスト経路外で非同期)。
- 定義場所: (a) 関数/Edge 関数の `export const config = { path, rateLimit: {...} }`(**path 必須**、netlify.toml では関数の rate limit は定義不可)、(b) netlify.toml の `[[redirects]]` + `[redirects.rate_limit]`(`_redirects` ファイルでは不可)。
- Next.js との関係: アダプタ生成関数には config を書けない(docs: "you can't add export const config to them")。リクエストチェーン上 Rate Limiting は Firewall/WAF の直後(Edge Functions・関数・リダイレクトより前)に評価されるため、netlify.toml の redirects ルールで Next.js のパスにも効く可能性はあるが**公式記述なし・未検証**(GitHub 上の個人プロジェクトでも「未検証、失敗時は本番で 404」との注記)。

### 2.5 Scheduled / Background Functions
- Scheduled: 全プラン、cron 式(UTC)、30秒上限、本番(published)デプロイでのみ実行、URL から直接呼べない、ペイロード不可。
- Background: 15分、即 202 を返す、失敗時 1分後・2分後にリトライ。

### 2.6 Node ランタイム指定
- ビルド: UI の Dependency management、`NODE_VERSION` 環境変数、`.node-version`/`.nvmrc`(UI 設定より優先)。
- 関数ランタイム: ビルドの Node バージョンに追従(有効な AWS Lambda ランタイムで2か月以内に非推奨化されないもの。満たさない場合のフォールバックは Node.js 24)。`AWS_LAMBDA_JS_RUNTIME`(例 `nodejs24.x`)で上書き可、ただし UI/CLI/API でのみ設定可(netlify.toml 不可)。

### 2.7 環境変数
- UI/CLI/API で設定した変数のみ Functions/Edge Functions から参照可。**netlify.toml の environment は関数から見えない**。
- 値はデプロイ時点で固定(変更は再デプロイが必要)。デプロイコンテキスト別の値可。
- スコープ(Builds/Functions/Runtime/Post processing)の限定は **Pro 以上**。Free/Personal では全変数がビルドにも関数にも渡る。
- `NEXT_PUBLIC_` はビルド時インライン。SSR で使う値は UI/CLI/API で設定(スコープが使えるなら Builds+Functions)。
- Secrets Controller(`Contains secret values`): 値は write-only、ビルド成果物のシークレットスキャン。Smart detection は Personal 以上。
- Lambda 互換モードのみ 4KB 制限(モダン関数は対象外)。Lambda 互換モードは 2027-07-01 で受付終了予定。

---

## 3. Cloudflare Workers 詳細

### 3.1 @opennextjs/cloudflare
- 最新 1.20.12(2026-10-15): "Add support for Next.js 16.4"。peer: next `>=15.5.28 <16 || >=16.4.1`、wrangler `^4.148.0`。
- 1.15.0(2026-01-21): "Next 16 is now supported"。1.16.0 以降、脆弱性のある Next バージョンではビルドをエラーにする。
- **proxy.ts(Node.js middleware)**: 1.20.3(2026-08-26)で "feature: support Node.js middleware (proxy.ts)"。「The support is experimental and requires the `nodejs_compat` compatibility flag.」PR #1309(2026-07-13 作成, 08-25 マージ)では、workerd がファイルシステムや実行時モジュールロードができないため middleware を静的バンドル化。レビューでメンテナが「I don't really like the solution TBH ... this is just to unblock this」「looks fishy」とコメント。
  - 未解決: #1373 proxy.ts は no-op でも約4.6MB を同梱(2026-08-31〜open)/ #1400 @opentelemetry/api 解決失敗(open)/ #1401 instrumentation の register() が残る(open)/ #617 Node middleware 機能要望(open)。
  - 公式ドキュメント(opennext.js.org と Cloudflare の OpenNext ガイド)は依然「Node Middleware (15.2) are not yet supported」と記載(ドキュメント未更新)。実例: 2026-10-09 の第三者 PR は OpenNext 1.20.6 で proxy.ts → middleware.ts に戻して運用("since OpenNext runs no Node proxy")。
- サポート機能(docs): App Router, Route Handlers, SSG/SSR, Middleware(Edge), Image optimization(Cloudflare Images 要設定), PPR, Pages Router, ISR, `after`, `'use cache'`, Turbopack。Server Actions も App Router の一部として動作。
- 必須設定: `nodejs_compat` フラグ、compatibility_date 2024-09-23 以降(FinalizationRegistry 系エラー回避には 2025-05-05 以降)。
- 既知 issue: #1381(2026-09-04〜open, メンテナ返信なし)「SSR renders retain per-isolate state until the Worker dies of exceededCpu (1102) — clean for ~120 renders, then degrades; **route handlers unaffected**」。Next 16.2/16.3、adapter 1.19.11/1.20.6 で再現、Paid でも発生報告。回避策は Cache API で前段キャッシュ(キャッシュ可能ページのみ)。
- トラブルシュート(docs): グローバルな DB クライアントの再利用は "Cannot perform I/O on behalf of a different request" → リクエスト毎に生成。

### 3.2 vinext(Cloudflare の新方針)
- Cloudflare docs(OpenNext ガイド): 「Cloudflare recommends vinext instead of OpenNext for new Next.js applications on Cloudflare Workers.」「Use this guide to maintain an existing OpenNext application.」
- Cloudflare docs(Next.js フレームワークガイド): 「vinext is in beta」。一方 Cloudflare 公式 X(Birthday Week, 2026-09)は「Vinext 1.0 graduates ... to a production-ready framework」。
- GitHub README: "Under active development"、"not yet a drop-in replacement for every application or production workload"、本番利用は "You can, with caution."。App Router/Server Actions/Route Handlers/middleware.ts・proxy.ts 対応、`"use cache"` は部分実装。Next 16.x 対象。Node ≥22、React ^19.3.1、Vite ^8。
- 示唆: Next.js 本体のビルド(`next build`)を使わない別実装であり、MVP では採用しない。ただし標準 Next.js API のみで書けば将来の移行余地は残る。

### 3.3 制限(docs: Workers limits)
| 項目 | Free | Paid |
|---|---|---|
| リクエスト数 | 100,000/日(UTC 0時リセット、超過で Error 1027) | 無制限 |
| CPU 時間/HTTP リクエスト | **10 ms(リクエスト単位、平均ではない)** | 5分(既定 30秒、`limits.cpu_ms` で変更) |
| 壁時計時間(HTTP) | 無制限 | 無制限 |
| Cron Trigger の実行時間 | 15分 | 15分 |
| メモリ/isolate | 128 MB | 128 MB |
| Worker サイズ | **64 MiB(非圧縮)** | **64 MiB(非圧縮)** |
| 起動時間 | 1秒 | 1秒 |
| サブリクエスト/呼び出し | 50 | 10,000(最大1,000万) |
| 同時接続 | 6 | 6 |
| 環境変数数/サイズ | 64 / 5KB | 128 / 5KB |
| Cron Triggers/アカウント | 5 | 250 |

- **2026-09-04 changelog**: 「The compressed Worker size limits (3 MB free / 10 MB paid) have been removed. Cloudflare now only checks the uncompressed bundle size, which is 64 MiB across all plans.」→ OpenNext ドキュメントの「Free 3MiB / Paid 10MiB」は古い。実例: 実アプリで 7.5〜12 MiB(非圧縮)/ 2.1〜2.4 MiB(gzip)。
- CPU 時間はネットワーク待ちを含まない。

### 3.4 料金(docs: Workers pricing)
- Paid: 最低 $5/月/アカウント。10M リクエスト/月込み(超過 $0.30/100万)、30M CPU-ms/月込み(超過 $0.02/100万 CPU-ms)。
- 静的アセットへのリクエストは無料・無制限。
- Workers Builds(Git 連携 CI): Free 3,000分/月・同時1、Paid 6,000分/月・同時6(超過 $0.005/分)、タイムアウト20分、Ubuntu 24.04、既定 Node 24.18.0(22.23.2 もプリインストール、`NODE_VERSION`/`.nvmrc`/`.node-version` で指定)。

### 3.5 Rate Limiting
- Rate Limiting binding(2025-09-19 GA): wrangler に `ratelimits`(namespace_id, simple.limit, simple.period は 10 か 60 秒)。`await env.RL.limit({ key })`。キーは任意(ユーザーID/APIキー推奨、IP は非推奨と明記)。「permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system」、ロケーション単位。料金は公式ページに記載なし(第三者は追加料金なしと記述)。第三者 issue で limit が効かない報告あり(未確認)。
- WAF Rate limiting rules(ゾーン単位、コード不要): Free = 1ルール・IP 単位・計数期間 10秒・緩和 10秒・条件は Path と Verified Bot。Pro = 2ルール・最大1分。カスタムドメイン(ゾーン)前提(workers.dev への適用は記載なし)。

### 3.6 Cron Triggers
- wrangler の `triggers.crons`、UTC、`scheduled(controller, env, ctx)`、変更反映に最大15分、ローカルは `/cdn-cgi/local/scheduled`。
- OpenNext の生成 worker は fetch のみ export → `scheduled` を足すには **custom worker**(`.open-next/worker.js` の fetch を再 export し、wrangler の `main` を差し替え)。

### 3.7 Windows でのビルド
- OpenNext 共有ドキュメント: 「can be used on Windows ... Windows full support is not guaranteed」→ WSL、Linux VM、または Windows では通常の Next.js ツールで開発し Linux/macOS の CI でデプロイ、を推奨。
- 修正履歴: 1.11.1 Windows のシェルクォート修正、1.20.2 Windows パス正規化。
- 外部実測(GitHub issue, 2026-10-11, OpenNext 1.20.10): Windows で `next build --webpack` によるビルドは約35秒で成功、ただし「完全には互換でない」警告と WSL 推奨表示。本番ビルドは Linux CI 推奨と結論。
- 本調査では、開発機の空きメモリ(コミット可能 約1.4GB、他プロセス稼働中)を考慮し、Next.js フルビルドの実地試験は見送った。

### 3.8 supabase-js / @supabase/ssr の動作実績
- supabase-js README: 「We support Cloudflare Workers runtime environments.」(Node は Active/Maintenance LTS のみ)。
- @supabase/ssr on Workers: `nodejs_compat` 未設定で "Dynamic require of stream" 系エラー(supabase#37592、2025-07、非活動でクローズ。メンテナは nodejs_compat の有無を確認)。
- OpenNext + Supabase の採用例は GitHub 上に多数(個人/小規模)。proxy.ts + getClaims() の Workers 上での公式動作確認は見つからず(未検証)。
- Supabase SSR ドキュメント: Next.js 16 では proxy.ts でトークン更新(getClaims())、Server Components は Cookie を書けないため。トークン更新時の Set-Cookie を CDN がキャッシュすると別ユーザーに配布される危険 → `Cache-Control: private, no-store` を推奨。

### 3.9 環境変数・シークレット
- `env` バインディング、`import { env } from "cloudflare:workers"`、`nodejs_compat` + 互換日付 2025-04-01 以降で `process.env` に自動投入(nodejs_compat_populate_process_env)。
- OpenNext: ローカルは Next の `.env` ファイル推奨(`.dev.vars` は next dev で見えない)、Workers Builds では「Build variables and secrets」に設定(NEXT_PUBLIC_ のインライン化と SSG 用)、実行時の値はダッシュボードで設定し `deploy -- --keep-vars`。
- Secrets: `wrangler secret put`(即デプロイ)/ ダッシュボード。値は読み戻し不可。

### 3.10 配置
- Smart Placement は全 Workers プランで利用可(fetch ハンドラのみ対象、静的アセットは常に最寄り)。`placement.region = "aws:ap-northeast-1"` 形式のリージョン指定も可。

---

## 4. Next.js 16 proxy.ts と Supabase(両プラットフォーム共通の論点)
- Next.js 16: `middleware` は非推奨で `proxy` に改名。**proxy の runtime は nodejs 固定・設定不可**(runtime を書くとエラー)。Edge を使い続けたい場合は middleware.ts を使い続ける(非推奨)。
- Next.js docs: Server Functions は Proxy の matcher から外れると保護が外れるため、「Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone」。
- 現状: Cloudflare(OpenNext)= proxy.ts は experimental、Netlify = 対応済みだが bundling 不具合の未解決 issue(主に Windows ローカルビルドの報告)。
- **設計提案**: Supabase へのアクセス(=トークン更新が起こりうる処理)を Route Handler / Server Action に集約すれば、そこで Cookie を書けるため proxy.ts への依存を外せる(Server Components は Supabase を叩かない「薄い SSR」にする)。必要なら proxy.ts は「セッション更新のみ」の最小構成にし、ダメなら middleware.ts(Edge)へ退避。→ 認証テーマ側で要確認(推測を含む)。

---

## 5. 本アプリ特性への適合性

### 5.1 クライアント主導チャンク同期の成立性
方式: ブラウザがループで `POST /api/sync/chunk`(Route Handler)を呼ぶ。1リクエスト = Foursquare `GET /v2/users/self/checkins?limit=250&offset=N` を1回 + `upsert ... on conflict (id)` 1回 + 進捗を DB に記録。レスポンスで次カーソルと進捗(F-11)を返す。途中失敗は DB の進捗から再開(冪等)。

- **Server Action ではなく Route Handler を推奨**: Next.js docs「Server Functions are designed for server-side mutations. The client dispatches and awaits them one at a time.」(並列化不可)。また Server Action 内で Cookie を set すると現在のページを再レンダリングする(CPU 増)。Route Handler なら JSON のみで軽く、必要なら並列化も可能、両プラットフォームで同一。
- Foursquare 制限: 認証済みリクエストは OAuth トークン毎に 500/時、トップレベルのエンドポイントグループ単位(users/* と checkins/* は別枠)。超過時 403 + `X-RateLimit-Reset`。5万件 = 200 リクエストで枠内。

#### CPU ベンチ(試作コード: `scratchpad\hosting-bench\bench.mjs`)
- 内容: Foursquare 一覧レスポンス(250件)を JSON.parse → 行へマッピング(id, user_id, created_at, tz_offset, shout, venue_id, venue_name, categories[], address, city, state, country, lat, lng, photo_count, raw)→ PostgREST へ送る JSON.stringify、を 200 回計測(ウォームアップ 20 回)。
- リッチ版テンプレート: swarm-to-sqlite のテストフィクスチャ(写真3枚・likes・posts・sticker・event 付き)を引数で読み込み。ライト版(写真なし・日本語店名)を自作。

チェックイン構造(リッチ版の抜粋):
```json
{ "id": "592b2cfe09e28339ac543fde", "createdAt": 1496001790, "type": "checkin",
  "shout": "7th wedding anniversary — with Natalie", "timeZoneOffset": -420,
  "venue": { "id": "453774dcf964a520bd3b1fe3", "name": "Restaurant Name",
    "location": { "address": "Address", "lat": 38.456, "lng": -122.345, "cc": "US", "city": "City", "state": "State", "country": "Country", "formattedAddress": ["..."] },
    "categories": [ { "id": "4bf58dd8d48988d10c941735", "name": "Category Name", "primary": true, "icon": {"prefix":"...","suffix":".png"} } ] },
  "likes": { "count": 3, "groups": [ ... ] }, "photos": { "count": 3, "items": [ ... ] },
  "posts": { "count": 1, "items": [ ... ] }, "comments": { "count": 1 }, "source": { "name": "Swarm for iOS" }, "event": { ... } }
```

実行結果(i5-8250U / Windows 11 / Node v20.11.1 / V8 11.3、他エージェント稼働中で負荷あり):
```
{"label":"mix30 (first call, cold JIT)","wall_ms":20.73}
{"label":"light (0% rich)","responseKB":241.6,"upsertBodyKB":314.5,"wall_ms":{"p50":14.06,"p95":23.27,"max":42.13},"cpu_ms_processCpuUsage":{"p50":16,"p95":31}}
{"label":"mix (30% rich)","responseKB":516.9,"upsertBodyKB":597.1,"wall_ms":{"p50":23.73,"p95":33.17,"max":72.76},"cpu_ms_processCpuUsage":{"p50":31,"p95":32}}
{"label":"rich (100% rich, photos x3 etc.)","responseKB":1159,"upsertBodyKB":1256.4,"wall_ms":{"p50":34.06,"p95":68.73,"max":88.7},"cpu_ms_processCpuUsage":{"p50":32,"p95":78}}
```
(process.cpuUsage は Windows のタイマ分解能 ~15.6ms のため粗い。I/O を含まない単一スレッド処理なので wall ≒ CPU とみなす)

解釈:
- 1チャンクの純粋な JSON 処理だけで **約14〜34ms(p50)、最悪 70〜90ms**。ここに Next.js の Route Handler 処理・supabase-js・認証検証が上乗せ。→ **Workers Free(10ms)は不可、Workers Paid(既定30秒)は余裕**。
- 外部実測(OpenNext 1.20.10, wrangler tail cpuTime): API ルート ping 中央値 9ms(コールド 158〜286ms)、SSR ページ中央値 99ms(ウォーム 13〜18ms)→「Workers Free の CPU 10ms では動かせない」と結論(GitHub issue #639, 2026-10-11)。

#### 1チャンクの所要時間見積り(推測を含む)
| 要素 | 見積り | 根拠 |
|---|---|---|
| Foursquare 一覧 API(limit=250) | 0.5〜3.0 s | **推測**(実測は検証3で) |
| サーバー処理(parse/map/stringify) | 0.015〜0.09 s | 本ベンチ |
| Supabase upsert 250行(0.3〜1.3MB, raw jsonb + 生成列 + 索引) | 0.1〜0.6 s | **推測** |
| リージョン間 RTT 加算 | Netlify(Ohio)→Supabase 東京: +約136ms/往復、Workers(東京 PoP)→Foursquare(米国と推定): +約150ms/往復 | cloudping、本実測 |
| 合計(壁時計) | **約0.8〜4 s/チャンク** | |

- Netlify: 60秒(公式)はもちろん、報告のある 10秒でも収まる。Foursquare fetch に AbortController で 8 秒程度のタイムアウトを設けて ≤10 秒を保証すべき。
- Cloudflare: 壁時計無制限、CPU 20〜100ms 程度(Paid で問題なし)。
- バックフィル全体: 1万件 = 40 チャンク ≈ 0.5〜2.7分、5万件 = 200 チャンク ≈ 3〜13分(逐次)。

### 5.2 コスト試算(推測を含む)
- Netlify(1GB 既定): 5万件ユーザーのバックフィル = 200 × 約2秒 = 400 GB-s = 0.111 GB-h → **約1.1 credits** + リクエスト 0.04 credits。Free(300cr)なら本番デプロイ20回で枯渇する点の方が支配的。
- 検索トラフィック例(100 MAU × 200 検索/月 = 2万回、SSR/関数 0.3 秒): 1.67 GB-h → 約17 credits + Web リクエスト・帯域で数十〜100 credits 規模 + 本番デプロイ(15/回)。→ 公開運用は Personal($9)以上が現実的。リージョンを東京にするなら Pro($20)。
- Cloudflare Paid: 上記全体で数万リクエスト + 数百万 CPU-ms 程度 → $5 の込み枠内(**推測**)。静的アセット無料、デプロイ無料。

### 5.3 レイテンシ(N-05)
開発機(日本と推定)からの実測(curl, 5回, connect / TLS / TTFB 秒):
```
ap-northeast-1(Tokyo) : 0.050/0.199/0.205 | 0.038/0.067/0.074 | 0.035/0.061/0.068 | 0.048/0.073/0.080 | 0.029/0.054/0.061
us-east-2(Ohio=Netlify既定cmh) : 0.196/0.837/1.000 | 0.176/0.350/0.513 | 0.209/0.409/0.579 | 0.794/0.989/1.151 | 0.332/0.542/0.747
us-east-1(N.Virginia) : 0.495/0.831/1.004 | 0.219/0.429/0.605 | 0.234/0.436/0.611 | 0.208/0.420/0.593 | 0.215/0.445/0.621
```
AWS リージョン間(cloudping.co): Ohio↔Tokyo 約136ms、N.Virginia↔Tokyo 約148ms。

検索1回の応答見積り(**推測**、サーバー処理 50〜150ms と仮定):
| 構成 | 見積り |
|---|---|
| Workers(東京 PoP)+ Supabase 東京 | 約100〜250 ms |
| Netlify Pro(nrt)+ Supabase 東京 | 約100〜250 ms |
| Netlify Free/Personal(Ohio)+ Supabase us-east-2 | 約250〜450 ms(日本↔Ohio 1往復が支配) |
| Netlify Free/Personal(Ohio)+ Supabase 東京 | 約450〜800 ms(DB 往復ごとに +136ms) |

### 5.4 レート制限(N-03 / N-07)
- 主: **DB 側でユーザー単位**(auth.uid())。検索 RPC・詳細取得の入口で `private.consume_rate_limit()` を呼ぶ。プラットフォーム非依存・正確(トランザクション内 UPSERT)・ローカル(Supabase CLI)で検証可能。
- 補: プラットフォームの IP 単位制限を「設定のみ」で追加(Cloudflare WAF ルール / Netlify netlify.toml ルール ※Next.js ルートへの効き目は要検証)。未認証の大量リクエストによる課金・停止リスク対策。
- PGlite 試作(`scratchpad\hosting-dbtest\dbtest.mjs`、PostgreSQL 18.6 on PGlite 0.5.10)結果:
```
[rate-limit] userA 35 calls -> allowed/denied:  {"allowed":30,"denied":5,"firstDeniedAt":{"call":31,"code":"P0429","message":"rate limit exceeded"}}
[rate-limit] userB first call (independent bucket): {"ok":true,"rows":0}
[auth] unauthenticated call ->  {"code":"28000","message":"not authenticated"}
[read-only] RPC inside READ ONLY tx -> {"code":"25006","message":"cannot execute INSERT in a read-only transaction"}
[rate-limit] counters: [{"bucket":"search","subject":"1111...","hits":30},{"bucket":"search","subject":"2222...","hits":1}]
```
  - 学び1: PostgREST の GET RPC は read-only トランザクション(Supabase docs: "GET and HEAD requests run in read-only mode")→ カウンタ更新不可。**RPC は POST で呼ぶ**(supabase-js の rpc() 既定は POST)。
  - 学び2: 拒否時に例外を投げるとカウンタ増分もロールバックされる(35回呼んでも hits=30)。窓内は拒否され続けるので制限としては正しいが、「拒否回数も記録したい(悪質判定)」場合はカウント用 RPC を別トランザクションで先に呼ぶか、例外ではなく結果コードで返す。
  - Supabase/PostgREST では `raise sqlstate 'PGRST' using message = json..., detail = json_build_object('status', 429, ...)` で HTTP ステータスを指定可能(Supabase docs の pre-request 例)。
- 試作関数の要点:
```sql
create function private.consume_rate_limit(p_bucket text, p_subject uuid, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into private.rate_limit_counters as c (bucket, subject, window_start, hits)
  values (p_bucket, p_subject, v_window, 1)
  on conflict (bucket, subject, window_start) do update set hits = c.hits + 1
  returning c.hits into v_hits;
  return v_hits <= p_limit;
end $$;
```

### 5.5 連携解除データの日次物理削除(F-42)
- 主: **pg_cron(Supabase Cron)**。ホスティング側に service_role キーや外部呼び出しが不要、DB 内でゼロレイテンシ。Supabase 推奨: 同時実行 ≤8 ジョブ、1ジョブ ≤10分、`cron.job_run_details` は自動削除されないので掃除ジョブも登録。
- 条件ベース(`deleted_at < now() - interval '14 days'`)にして**冪等**にする → 取りこぼし(Supabase Free の 1週間非アクティブ停止など)があっても次回で自己回復。
- PGlite 試作結果(3,000件の期限切れ・1,000件の猶予中・50件の有効):
```
[purge] before:  {"expired":3000,"in_grace":1000,"active":50}
[purge] purged rows (batch=1000): {"purged":3000,"ms":368.2}
[purge] after:   {"expired":0,"in_grace":1000,"active":50}
[purge] second run (idempotent): {"purged":0}
```
- 登録例(**未検証**、検証6で Supabase CLI ローカルにて確認):
```sql
select cron.schedule('purge-expired-checkins', '0 18 * * *', $$ select private.purge_expired_checkins(1000) $$); -- 03:00 JST
select cron.schedule('cleanup-rate-limit-counters', '*/30 * * * *', $$ delete from private.rate_limit_counters where window_start < now() - interval '1 hour' $$);
select cron.schedule('cleanup-cron-history', '0 19 * * *', $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$);
```
- 代替(非推奨): Netlify Scheduled Functions(30秒上限)/ Cloudflare Cron Triggers(custom worker 必須)。いずれもプラットフォーム依存コードと service_role キーの配置が必要。

### 5.6 サーバー側 OAuth・シークレット
- どちらも Route Handler で認可コード交換・Supabase Admin API 呼び出しが可能(HTTP のみ)。Foursquare Client Secret / service_role キーは実行時シークレット(Netlify: UI/CLI/API の変数、Cloudflare: Secrets)。`NEXT_PUBLIC_` に入れない。
- プレビュー環境は URL が毎回変わるため Foursquare の redirect_uri 登録と相性が悪い → 固定 URL のステージング(Netlify のブランチデプロイ固定サブドメイン / Cloudflare の別 Worker)を用意。

---

## 6. 比較表(本アプリ観点)

| 観点 | Netlify | Cloudflare Workers + OpenNext | 優位 |
|---|---|---|---|
| Next.js 機能の成熟度 | 公式 "Full Support"、Node(Lambda)実行 | 概ね対応、proxy.ts は experimental、#1381 未解決 | Netlify |
| proxy.ts | 対応済み(bundling 不具合の未解決 issue あり) | experimental(未解決 issue 複数) | Netlify(やや) |
| 同期チャンク(≤10秒) | 可(60秒/報告上10秒) | 可(Paid) | 同等 |
| 費用(公開運用) | Personal $9〜Pro $20 | Paid $5 | Cloudflare |
| 無料枠の安全性 | 超過で全停止(DoS で止められうる) | Free は CPU 制約で実質不可 | — |
| 日本ユーザーのレイテンシ | Pro で nrt 指定時のみ良好 | 最寄り PoP 実行で良好 | Cloudflare |
| レート制限機能 | IP 単位・2ルール・Next ルート適用は未検証 | WAF(IP)+ binding(ユーザーキー可) | Cloudflare |
| Cron | Scheduled Functions 30秒 | Cron Triggers(custom worker) | 同等(DB 側推奨) |
| Windows 開発 | ローカルビルド不要 | WSL/CI 推奨、Node 22+ | Netlify |
| ベンダーの方向性 | Adapter API ベースの新アダプタを準備中 | 新規は vinext 推奨(OpenNext は既存向け) | 不確実性は Cloudflare がやや大 |

---

## 7. 推奨と理由
**第一候補: Cloudflare Workers(Workers Paid, $5/月)+ `@opennextjs/cloudflare` ≥1.20.12 + Next ≥16.4.1 + Supabase(ap-northeast-1)**
1. 日本の利用者に対し、最寄り PoP 実行 + 東京 DB で N-05(数百ms)を最も満たしやすい。Netlify で同等にするには Pro($20)が必要。
2. CPU 時間課金(I/O 待ち非課金)で、Foursquare API 待ちが長いバックフィルと相性が良い。$5 の込み枠で十分(推測)。デプロイ無料。
3. 2026-09-04 の上限変更で Worker サイズ(64 MiB 非圧縮)は障害ではなくなった。
4. N-03/N-07 に使えるプリミティブ(WAF ルール、ユーザーキーの binding)がある。
5. Netlify Free は公開アプリには不向き(300cr ハードリミット超過で全停止、本番デプロイ 15cr)。

**条件(検証8で確認、どれか不合格なら Netlify に切替)**: (a) 認証・Supabase アクセスを Route Handler/Server Action に寄せ proxy.ts なし(または middleware.ts)で Cookie セッションが回る、(b) 検索ページ・同期 API の連続 1,000 リクエストで 1102(#1381)が出ない、(c) Workers Builds(Linux)でビルド・デプロイが通る、(d) 同期チャンクの cpuTime が 30秒既定に対して十分小さい。
**代替: Netlify** — Pro($20、Functions を nrt に)+ Supabase 東京、または Personal($9)+ Supabase us-east-2(日本からの往復 +150〜200ms を許容)。Next.js 機能の成熟度と Windows 開発の手軽さを重視するならこちら。

---

## 8. 「どちらでも移植しやすくする」注意点の妥当性評価
| 方針 | 評価 | 補足 |
|---|---|---|
| レート制限を DB 側(Postgres)で | **妥当(主)** | ユーザー単位で正確・両対応・ローカル検証可。ただし未認証の大量アクセスによる関数起動コストは防げない → プラットフォームの IP 制限を「設定のみ」で併用 |
| 日次バッチを pg_cron で | **妥当** | 条件ベース・バッチ削除で冪等に。job_run_details の掃除。Supabase Free の非アクティブ停止に注意 |
| プラットフォーム固有 API を避ける | **妥当** | `getCloudflareContext()`、`@netlify/functions` の Context、Netlify Blobs、KV/D1/R2/Images binding をアプリコードで使わない。どうしても使う場合は 1 モジュールに閉じ込める |
| 環境変数は `process.env` で読む | 妥当 | Workers も nodejs_compat + 互換日付 ≥2025-04-01 で process.env 可。`NEXT_PUBLIC_` はビルド時インライン |
| DB アクセスは supabase-js(HTTP)のみ | 妥当 | TCP ドライバ(pg/postgres.js)は Workers で Hyperdrive/connect() 等の考慮、Lambda でプール考慮が必要 |
| クライアントはリクエスト毎に生成・グローバル状態を持たない | 妥当 | Workers の "Cannot perform I/O on behalf of a different request" 回避、インメモリのレート制限/キャッシュは無効 |
| 1リクエスト ≤10秒・低 CPU | 妥当 | Netlify のタイムアウト食い違いにも耐える。Foursquare fetch に 8 秒タイムアウト |
| 同期は Route Handler(Server Action ではなく) | 妥当(追加提案) | Server Action はクライアントで直列ディスパッチ、Cookie 設定時に再レンダリング |
| proxy.ts に依存しない認証設計 | 妥当(追加提案、要検証) | 両プラットフォームで proxy.ts に未解決 issue。Server Functions 内で認可を必ず検証(Next.js docs) |
| `next/image` 最適化を使わない | 妥当 | Cloudflare は Images binding、Netlify は Image CDN と挙動・課金が異なる。写真は Foursquare CDN の URL を直接(または unoptimized) |
| ユーザー毎データに ISR/`use cache` を使わない、`Cache-Control: private, no-store` | 妥当 | トークン更新 Set-Cookie のキャッシュ事故防止(Supabase docs) |
| ビルドは Linux CI | 妥当 | Netlify CI / Workers Builds / GitHub Actions。Windows では `next dev` のみ |
| Node 24 LTS へ更新 | **必須** | wrangler・netlify-cli・supabase-js の要件 |

---

## 9. 未確定事項と実地検証手順(検証8 案: ホスティング・スパイク)
前提: 最小 Next 16.4.x アプリ(Route Handler: `/api/ping`, `/api/sync/chunk`(Foursquare は fixture で代替可), `/api/search`、Supabase 接続、@supabase/ssr の Cookie セッション)を Cloudflare(Workers Paid)と Netlify(無料で可)にデプロイ。
1. **Netlify の同期関数タイムアウト実値**: `/api/sleep?s=5|15|30|65` を作り、504/タイムアウトとなる秒数を記録(新規 Credit-based アカウント)。
2. **Netlify の netlify.toml レート制限が Next.js ルートに効くか**: `[[redirects]] from="/api/search" to="/api/search" status=200 force=true` + `[redirects.rate_limit] window_limit=20 window_size=60 aggregate_by=["ip","domain"]` を Deploy Preview に入れ、1分間に 60 回叩いて 429 が返るか・通常時に 404 等の副作用がないか、デプロイログの post-processing にルールが出るかを確認。
3. **proxy.ts の可否**: 両環境で `proxy.ts`(@supabase/ssr + getClaims)をデプロイし、アクセストークン期限切れ(JWT 有効期限を短く設定)後にリロードして Cookie が更新されるか。Netlify は CI(Linux)ビルドで #3562/#3575 が再現するか。Cloudflare は `wrangler deploy --dry-run --outdir` の Total Upload(#1373 の 4.6MB 増)を確認。
4. **proxy なし設計の成立性**: Server Components から Supabase を叩かず、Route Handler 内で createServerClient → getClaims → setAll(Cookie 書き込み)でセッションが維持されるか。
5. **#1381 ソークテスト(Cloudflare)**: 検索ページ(SSR)と `/api/search` を各 1,000 回逐次リクエストし、`wrangler tail` の outcome(exceededCpu)と cpuTime を集計。
6. **チャンク同期の実測**: 実アカウントで limit=250 の Foursquare 応答時間・サイズ(検証3と統合)、upsert 時間、Workers の cpuTime、Netlify の関数 duration を p50/p95 で記録。≤10 秒/チャンクを確認。
7. **レイテンシ**: 日本から `/api/search` の TTFB を 100 回計測(Workers+東京 DB / Netlify Ohio+DB 東京 / Netlify Ohio+DB Ohio)。Workers の `request.cf.colo` で東京/大阪 PoP 実行か確認。
8. **Cloudflare Rate Limiting binding の実効性**(使う場合): limit=3/60 で 10 回叩き success=false が返るか(第三者 issue で効かない報告あり)。
9. **WAF レート制限ルール**(Cloudflare Free ゾーン): /api/search に 10 秒間 N 回超で Block を設定し動作確認(カスタムドメイン要)。
10. **pg_cron**: Supabase CLI ローカル(検証6)で `cron.schedule` が使えるか、ジョブ実行履歴と削除件数を確認。
11. Netlify Free での Secrets Controller(`Contains secret values`)の可否(スコープは Pro 以上のため)。

---

## 10. 出典
- Netlify: Next.js on Netlify — https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
- Netlify: Configuration for functions(既定値表・リージョン・Node ランタイム)— https://docs.netlify.com/build/functions/configuration/
- Netlify: Functions usage and billing — https://docs.netlify.com/build/functions/usage-and-billing/
- Netlify: How credits work — https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
- Netlify: Billing FAQ for credit-based plans — https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/
- Netlify: Pricing — https://www.netlify.com/pricing/
- Netlify: Rate limiting — https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
- Netlify: Request chain — https://docs.netlify.com/start/core-concepts/request-chain/
- Netlify: Scheduled Functions — https://docs.netlify.com/build/functions/scheduled-functions/
- Netlify: Background Functions — https://docs.netlify.com/build/functions/background-functions/
- Netlify: Edge Functions limits — https://docs.netlify.com/build/edge-functions/limits/
- Netlify: Environment variables overview — https://docs.netlify.com/build/environment-variables/overview/
- Netlify: Environment variables and serverless functions — https://docs.netlify.com/build/functions/environment-variables/
- Netlify: Use environment variables with frameworks — https://docs.netlify.com/build/frameworks/use-environment-variables-with-frameworks/
- Netlify: Secrets Controller — https://docs.netlify.com/build/environment-variables/secrets-controller/
- Netlify: Manage build dependencies — https://docs.netlify.com/build/configure-builds/manage-dependencies/
- Netlify: Lambda compatibility — https://docs.netlify.com/build/functions/lambda-compatibility/
- Netlify changelog: 2026-10-14 Next.js & React security — https://www.netlify.com/changelog/2026-10-14-nextjs-react-security-vulnerabilities/
- Netlify blog: Next.js adapter API — https://www.netlify.com/blog/the-next-js-adapter-api-just-shipped-here-s-what-comes-next/
- opennextjs-netlify CHANGELOG — https://raw.githubusercontent.com/opennextjs/opennextjs-netlify/main/CHANGELOG.md
- opennextjs-netlify issues #3562 / #3575 / #3560 / #2669 — https://github.com/opennextjs/opennextjs-netlify/issues/3562 , https://github.com/opennextjs/opennextjs-netlify/issues/3575 , https://github.com/opennextjs/opennextjs-netlify/issues/3560 , https://github.com/opennextjs/opennextjs-netlify/issues/2669
- Netlify Support Forums(10秒/26秒報告)— https://answers.netlify.com/t/request-increase-synchronous-function-timeout-to-26-seconds-pro-plan-bis/167503
- bex.co(第三者)— https://bex.co/blog/2026/09/23/netlify-durable-functions-26-second-ceiling
- OpenNext Cloudflare docs — https://opennext.js.org/cloudflare , https://opennext.js.org/cloudflare/get-started , https://opennext.js.org/cloudflare/howtos/env-vars , https://opennext.js.org/cloudflare/howtos/custom-worker , https://opennext.js.org/cloudflare/troubleshooting
- OpenNext docs repo(Windows 節)— https://raw.githubusercontent.com/opennextjs/docs/main/shared/WindowsSupport.mdx
- opennextjs-cloudflare releases / CHANGELOG — https://github.com/opennextjs/opennextjs-cloudflare/releases , https://raw.githubusercontent.com/opennextjs/opennextjs-cloudflare/main/packages/cloudflare/CHANGELOG.md
- opennextjs-cloudflare PR #1309(proxy.ts 対応)— https://github.com/opennextjs/opennextjs-cloudflare/pull/1309
- opennextjs-cloudflare issues #1381 / #598 / proxy 関連一覧 — https://github.com/opennextjs/opennextjs-cloudflare/issues/1381 , https://github.com/opennextjs/opennextjs-cloudflare/issues/598 , https://github.com/opennextjs/opennextjs-cloudflare/issues?q=is%3Aissue+proxy.ts
- 実測事例(OpenNext CPU/サイズ/Windows ビルド)— https://github.com/yamamotonaoki3/MyBookLibrary/issues/639
- 実例(proxy.ts→middleware.ts)— https://github.com/kunwarshivam/mandate/pull/878
- Cloudflare: OpenNext ガイド(vinext 推奨)— https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/
- Cloudflare: Next.js フレームワークガイド — https://developers.cloudflare.com/workers/frameworks/framework-guides/nextjs/
- vinext — https://github.com/cloudflare/vinext
- Cloudflare: Workers limits — https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare changelog 2026-09-04(サイズ上限)— https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/
- Cloudflare: Workers pricing — https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare: Rate Limiting binding — https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ , GA: https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/
- Cloudflare: WAF rate limiting rules — https://developers.cloudflare.com/waf/rate-limiting-rules/
- Cloudflare: Cron Triggers — https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare: Placement — https://developers.cloudflare.com/workers/configuration/placement/
- Cloudflare: Environment variables / Secrets — https://developers.cloudflare.com/workers/configuration/environment-variables/ , https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare: Workers Builds limits / build image — https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ , https://developers.cloudflare.com/workers/ci-cd/builds/build-image/
- Cloudflare: Errors — https://developers.cloudflare.com/workers/observability/errors/
- Next.js: proxy.js — https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- Next.js: Upgrading to v16 — https://nextjs.org/docs/app/guides/upgrading/version-16
- Next.js: Deploying(Adapters)— https://nextjs.org/docs/app/getting-started/deploying
- Next.js: Mutating Data(Server Functions の直列ディスパッチ)— https://nextjs.org/docs/app/getting-started/mutating-data
- Supabase: Next.js SSR — https://supabase.com/docs/guides/auth/server-side/nextjs
- Supabase: Securing your API(pre-request レート制限例)— https://supabase.com/docs/guides/api/securing-your-api
- Supabase: Cron — https://supabase.com/docs/guides/cron , https://supabase.com/docs/guides/cron/quickstart
- Supabase: Regions — https://supabase.com/docs/guides/platform/regions
- Supabase: Node 20 サポート終了 — https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20
- supabase-js README — https://github.com/supabase/supabase-js
- supabase#37592 — https://github.com/supabase/supabase/issues/37592
- Foursquare v2 rate limits — https://docs.foursquare.com/developer/reference/v2-rate-limits
- AWS リージョン間レイテンシ — https://www.cloudping.co/
- wrangler の Node バージョンチェック — https://unpkg.com/wrangler@4.151.0/bin/wrangler.js
- Node.js リリース一覧 — https://nodejs.org/dist/index.json
