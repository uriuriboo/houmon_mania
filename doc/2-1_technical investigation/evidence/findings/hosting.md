# 08_result.json (agent acfefe9bfca39e6e1)

## TOPIC: ホスティング比較 Netlify vs Cloudflare Workers(Next.js App Router + Supabase)— 2026年10月時点(key: hosting)

### summary
第一候補は「Cloudflare Workers(有料プラン Workers Paid、月$5)+ @opennextjs/cloudflare 1.20.12以上 + Next.js 16.4.1以上 + Supabase 東京リージョン」です。ただし「検証8: ホスティング実地スパイク」に合格することを確定の条件とし、不合格なら Netlify に切り替えます(Pro で Functions を東京 nrt に置くか、Personal + Supabase us-east-2)。

主な根拠は4つです。
(1) Workers は利用者の最寄り拠点で動くため、東京の Supabase との距離が近く N-05 を満たしやすいです。実測ではこの開発機から東京まで TCP 接続 約28〜50ms、Ohio まで 約176〜330ms、Ohio↔東京は約136ms でした。
(2) Netlify は Free/Personal だと Functions が Ohio 固定で、リージョン変更は Pro 以上です。Free は 300 credits の上限を超えると全サイトが停止し、本番デプロイ1回で15 credits を消費するため、公開アプリには向きません。
(3) Workers は CPU 時間で課金され、外部 API の待ち時間は課金されません。2026-09-04 に圧縮後サイズの上限が撤廃され、全プラン共通で非圧縮 64MiB になりました。
(4) Workers Free の CPU 上限は 10ms/リクエストです。250件チャンクの JSON 処理だけで p50 約14〜34ms かかり、外部実測では SSR の中央値が 99ms なので、Free では動かず有料プランが前提です。

一方で Cloudflare 側には不確実性があります。
- Next.js 16 の proxy.ts(Node ランタイム固定)は OpenNext では 1.20.3 からの実験的対応で、未解決 issue が複数あります。
- SSR を繰り返すと 1102 エラーで落ちる issue #1381 が未解決です(Route Handler には影響しないとの報告)。
- Cloudflare 自身が新規アプリには vinext を推奨しています。
- Windows での完全サポートは保証されておらず、WSL か CI でのビルドが推奨です。
- Netlify 側も proxy.ts のバンドル不具合 issue が未解決で(主に Windows ローカルビルドの報告)、同期関数のタイムアウトは公式60秒に対し10秒/26秒の利用者報告があります。

どちらでも動かすための推奨設計は次のとおりです。
- 同期はクライアント主導のチャンク方式にし、Route Handler で実装します(Server Action はクライアント側で1件ずつ順番に実行されるため)。1チャンクは約0.8〜4秒と見積もり、10秒以内に収めます。
- レート制限は DB 側でユーザー単位に行います(RPC は POST で呼ぶ)。PGlite での試作で、31回目に拒否されること、読み取り専用トランザクションでは記録できないこと、拒否時は増分もロールバックされることを確認しました。
- 日次の物理削除は pg_cron で条件ベースかつ冪等に行います(試作で3,000件の削除と再実行時0件を確認)。
- 認証は proxy.ts に依存しない設計にします。

なお開発機の Node 20.11.1 は wrangler・netlify-cli 27・supabase-js 2.110以降の要件(Node 22以上)を満たしません。どちらを選んでも Node 24 LTS への更新が必須です。

### findings

- **[F1] CRITICAL (high)** Netlify Functions の公式既定値:同期実行60秒(変更不可)、Scheduled 30秒、Background 15分、メモリ1024MB、バッファ型ペイロード6MB、ストリーム応答20MB、リージョンは既定 cmh(Ohio)で変更は Pro/Enterprise のみ
  - detail: 公式の『Configuration for functions』の既定値表による。Next.js のようなアダプタ生成の関数には `export const config` を付けられないため、リージョンはプロジェクト単位の UI 設定(Pro 以上)でしか変えられない。Functions のランタイムはビルド時の Node バージョンに追従し、`AWS_LAMBDA_JS_RUNTIME`(UI/CLI/API でのみ設定可)で上書きできる。条件を満たさない場合のフォールバックは Node 24。タイムアウトの食い違いは F20 を参照。
  - sources: https://docs.netlify.com/build/functions/configuration/ , https://docs.netlify.com/build/configure-builds/manage-dependencies/

- **[F2] CRITICAL (high)** Netlify のクレジット制(2025-09-04以降の新規アカウント):Free は月300 credits のハードリミットで、使い切るとチーム内の全プロジェクトが停止する。本番デプロイ1回=15 credits、Compute=10 credits/GB-h(実行時間×メモリ)
  - detail: Web リクエストは1万件あたり2 credits、帯域は1GBあたり20 credits、プレビュー/ブランチデプロイは0 credits。Personal は月$9で1,000 credits(自動リチャージは500 credits/$5)、Pro は月$20で3,000 credits〜。停止中は新規の本番デプロイもできない。Free はクレジットを追加購入できず、次のサイクルまで待つかアップグレードするしかない。環境変数のスコープ限定は Pro 以上。外部 API の待ち時間も GB-h として課金される。
  - sources: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ , https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/ , https://www.netlify.com/pricing/ , https://docs.netlify.com/build/functions/usage-and-billing/

- **[F3] CRITICAL (high)** Netlify のレート制限:Enterprise 以外で使えるのはコードで定義するルールだけで、集計単位は IP+ドメインのみ(ユーザー単位不可)。ルール数は Free/Personal 2、Pro 5。窓は最大180秒で、超過から適用まで最大10秒の遅延がある
  - detail: 定義できる場所は2つだけ:関数/Edge 関数の `config.rateLimit`(path 必須で、netlify.toml では関数の rate limit は定義不可)、または netlify.toml の `[[redirects]]` + `[redirects.rate_limit]`。Next.js アダプタが生成する関数には config を付けられない。リクエストチェーン上レート制限は Firewall/WAF の直後(関数やリダイレクトより前)に評価されるが、redirects 方式のルールが Next.js の Route Handler に効くかは公式に記述がなく未検証。
  - sources: https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/ , https://docs.netlify.com/start/core-concepts/request-chain/ , https://docs.netlify.com/build/functions/configuration/

- **[F4] CRITICAL (high)** Cloudflare Workers Free の CPU 上限は 10ms/HTTP リクエスト(平均ではなく1件ごと)で、Next.js の SSR や250件チャンク処理はこれを超える。実用には Workers Paid(最低$5/月)が前提になる
  - detail: Paid は CPU 既定30秒(`limits.cpu_ms` で最大5分)、壁時計時間は無制限、月10Mリクエスト+3,000万 CPU-ms 込み(超過は $0.30/100万リクエスト、$0.02/100万 CPU-ms)、静的アセットは無料。Free は1日10万リクエストで超過時は Error 1027。自前ベンチ(scratchpad/hosting-bench、i5-8250U、Node 20):250件の parse→マッピング→stringify が p50 14〜34ms、最悪約70〜90ms。外部実測(OpenNext 1.20.10、wrangler tail):API ルートの中央値 9ms(コールド 158〜286ms)、SSR ページの中央値 99ms で『Free では動かせない』と結論している。
  - sources: https://developers.cloudflare.com/workers/platform/limits/ , https://developers.cloudflare.com/workers/platform/pricing/ , https://github.com/yamamotonaoki3/MyBookLibrary/issues/639

- **[F5] CRITICAL (high)** 2026-09-04 に Workers の圧縮後サイズ上限(Free 3MB / Paid 10MB)が撤廃され、全プラン共通で非圧縮 64MiB だけがチェックされるようになった。OpenNext のドキュメントは旧値(3/10MiB)のまま
  - detail: Cloudflare の changelog とリミット表で確認(gzip 値は参考表示のみ)。メモリ128MB/isolate と起動時間1秒の制限は変わらない。実アプリ例は非圧縮 7.5〜12MiB / gzip 2.1〜2.4MiB で、サイズはもう選定上の障害ではない。
  - sources: https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/ , https://developers.cloudflare.com/workers/platform/limits/ , https://opennext.js.org/cloudflare , https://github.com/kunwarshivam/mandate/pull/878

- **[F6] CRITICAL (high)** Next.js 16 の proxy.ts は Node.js ランタイム固定(runtime 指定不可)で、Supabase は proxy.ts でのセッション更新を推奨している。しかし OpenNext Cloudflare では 1.20.3(2026-08-26)からの実験的対応にとどまり、Netlify でも未解決のバンドル不具合 issue がある
  - detail: Cloudflare 側:PR #1309 は『experimental, requires nodejs_compat』で、メンテナも『just to unblock this』とコメント。未解決 issue は #1373(no-op でも約4.6MB 増)、#1400、#1401、#617。公式ドキュメントは今も『Node Middleware not yet supported』と書いており、実例でも middleware.ts に戻して運用している。Netlify 側:Node.js Middleware は 5.13.0 で対応済み(C++ アドオンと fs は不可、Edge Functions 上で実行)。ただし #3562/#3575(バンドル時の MODULE_NOT_FOUND、Windows ローカルビルドの報告が中心)と #3560(ESM-only の外部パッケージで 500)が未解決。Next.js docs は Server Function 内での認可検証を必須としている。→ proxy.ts に依存しない設計が望ましい。
  - sources: https://nextjs.org/docs/app/api-reference/file-conventions/proxy , https://nextjs.org/docs/app/guides/upgrading/version-16 , https://supabase.com/docs/guides/auth/server-side/nextjs , https://github.com/opennextjs/opennextjs-cloudflare/pull/1309 , https://github.com/opennextjs/opennextjs-cloudflare/issues?q=is%3Aissue+proxy.ts , https://github.com/opennextjs/opennextjs-netlify/issues/3562 , https://github.com/opennextjs/opennextjs-netlify/issues/3575 , https://github.com/opennextjs/opennextjs-netlify/issues/3560 , https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/

- **[F7] CRITICAL (high)** 開発機の Node v20.11.1 は wrangler 4.151(実行時に Node 22未満を拒否)、netlify-cli 27(>=22.13)、supabase-js 2.110以降(>=22、Node 20対応は2.109.0が最後)の要件を満たさない。Node 24 LTS(v24.22.0)への更新が必須
  - detail: npm view と wrangler の bin/wrangler.js(MIN_NODE_VERSION="22.0.0")で確認。supabase-js の engines は 2.110.0(2026-06-30)で >=22 に引き上げられた(Node 20 は 2026-04-30 に EOL)。Next 16.4.2 自体は Node 20.9以上で動く。第三者報告では、realtime-js が Node 20 でネイティブ WebSocket が無いため createClient() 時に例外を出す。Workers Builds の既定は Node 24.18.0、Netlify の関数のフォールバックも Node 24。
  - sources: https://unpkg.com/wrangler@4.151.0/bin/wrangler.js , https://github.com/supabase/supabase-js , https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20 , https://nodejs.org/dist/index.json

- **[F8] CRITICAL (medium)** クライアント主導チャンク同期(1リクエスト=Foursquare 1ページ(limit=250)+upsert)はどちらでも成立する。1チャンクは壁時計で約0.8〜4秒、CPU で約15〜90ms と見積もる。実装は Server Action より Route Handler が適する
  - detail: 内訳:Foursquare API 0.5〜3秒(推測)、JSON 処理 15〜90ms(実測)、upsert 0.1〜0.6秒(推測)、リージョン間 RTT +約136〜150ms。Netlify の60秒(報告上の10秒でも)、Workers Paid の CPU 30秒のどちらにも収まる。Foursquare の上限は OAuth トークンごとに500件/時で、5万件=200リクエストなら枠内(超過時は 403 + X-RateLimit-Reset)。Next.js docs によれば Server Function はクライアントが1件ずつ順番に実行し、Cookie を設定すると再レンダリングが走る → 同期は POST の Route Handler にする。Foursquare への fetch に約8秒のタイムアウトを付けて、1リクエスト10秒以内を保証する。
  - sources: https://nextjs.org/docs/app/getting-started/mutating-data , https://docs.foursquare.com/developer/reference/v2-rate-limits , https://www.cloudping.co/ , https://docs.netlify.com/build/functions/configuration/ , https://developers.cloudflare.com/workers/platform/limits/

- **[F9] CRITICAL (medium)** レイテンシ:Netlify の Free/Personal は Functions が Ohio 固定のため、Supabase を東京に置くと DB 往復ごとに約136ms 加算される。Workers は最寄り拠点で実行され、Smart Placement とリージョン指定も全プランで使える
  - detail: この開発機(日本と推定)から curl で実測した TCP 接続時間:東京 0.028〜0.050秒、Ohio 0.176〜0.330秒、N.Virginia 0.208〜0.495秒。cloudping によると Ohio↔東京 136ms、N.Virginia↔東京 148ms。検索1回の応答見積り(推測):Workers+DB 東京 約100〜250ms、Netlify Pro(nrt)+DB 東京 同程度、Netlify Ohio+DB Ohio 約250〜450ms、Netlify Ohio+DB 東京 約450〜800ms。N-05 と Supabase のリージョン選定に直結する。
  - sources: https://docs.netlify.com/build/functions/configuration/ , https://developers.cloudflare.com/workers/configuration/placement/ , https://www.cloudping.co/ , https://supabase.com/docs/guides/platform/regions

- **[F10] (high)** Cloudflare 公式は新規 Next.js アプリに OpenNext ではなく vinext を推奨し、OpenNext は既存アプリ向けと位置付けている。vinext 自体は beta/『use with caution』の段階
  - detail: OpenNext ガイドの記述:『Cloudflare recommends vinext instead of OpenNext for new Next.js applications on Cloudflare Workers.』。一方 Next.js フレームワークガイドには『vinext is in beta』、README には『not yet a drop-in replacement ... You can, with caution.』とある。vinext は 1.0.0 が 2026-09-28、最新 1.2.1 で、Node>=22、React ^19.3.1、Vite ^8 が必要。Next.js 公式の Verified Adapter は Vercel と Bun のみで、Netlify と Cloudflare は Adapter API ベースのアダプタを準備中。
  - sources: https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/ , https://developers.cloudflare.com/workers/frameworks/framework-guides/nextjs/ , https://github.com/cloudflare/vinext , https://nextjs.org/docs/app/getting-started/deploying , https://www.netlify.com/blog/the-next-js-adapter-api-just-shipped-here-s-what-comes-next/

- **[F11] (medium)** OpenNext Cloudflare の issue #1381(SSR を約120回繰り返すと isolate に状態が残り 1102 エラーで落ちる。Route Handler には影響しない)が 2026-09-04 から未解決で、メンテナの返信もない
  - detail: Next 16.2/16.3、アダプタ 1.19.11/1.20.6 で再現し、Paid プランでも報告がある。回避策は Cache API による前段キャッシュ(キャッシュできるページのみ)。根本原因は不明で報告者も少ないため、影響範囲は推測の域を出ない。対策としては SSR を薄くし、データ取得を Route Handler の JSON API に寄せ、ソークテストで確かめる。
  - sources: https://github.com/opennextjs/opennextjs-cloudflare/issues/1381

- **[F12] (high)** Next.js 16.4 への対応時期:@opennextjs/cloudflare 1.20.12(2026-10-15)が『Add support for Next.js 16.4』(Next 16.4.0 公開から約9日後)。peer は next>=16.4.1 / wrangler ^4.148。Netlify アダプタ 5.16.2(2026-10-05)は自動更新
  - detail: OpenNext Cloudflare はセキュリティ理由で peer の下限を頻繁に引き上げる(1.20.7 で 16.3.6、1.20.8 で 16.3.8、1.20.12 で 16.4.1)ため、定期的に強制アップグレードが発生する。Netlify は『全安定版で互換性を検証』『アダプタを pin しないこと』を推奨しており、2026-10-14 の告知で 16.4.1 へのアップグレードを推奨した(Server Actions の DoS、use cache/画像最適化の RCE の修正)。
  - sources: https://github.com/opennextjs/opennextjs-cloudflare/releases , https://raw.githubusercontent.com/opennextjs/opennextjs-cloudflare/main/packages/cloudflare/CHANGELOG.md , https://raw.githubusercontent.com/opennextjs/opennextjs-netlify/main/CHANGELOG.md , https://www.netlify.com/changelog/2026-10-14-nextjs-react-security-vulnerabilities/

- **[F13] (high)** Cloudflare のレート制限手段は2つ:Workers Rate Limiting binding(2025-09-19 GA、任意キー、期間10秒か60秒、結果整合で緩め)と、WAF のレート制限ルール(Free は1ルール、IP 単位、計数期間10秒、ゾーン前提)
  - detail: binding は『permissive, eventually consistent ... not ... an accurate accounting system』で、ロケーション単位。キーは IP ではなくユーザーIDなどを推奨と明記されている。料金は公式に記載がない。WAF ルールの Free の条件指定は Path と Verified Bot のみで、Pro は2ルール・最大1分。binding を使うとアプリコードがプラットフォーム依存になる。
  - sources: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ , https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/ , https://developers.cloudflare.com/waf/rate-limiting-rules/

- **[F14] (high)** 定期実行の手段:Netlify は Scheduled Functions(全プラン、UTC の cron、30秒上限、本番デプロイのみで実行)。Cloudflare は Cron Triggers(UTC、Free 5件/Paid 250件、15分)だが、OpenNext では custom worker で scheduled ハンドラを追加する必要がある
  - detail: OpenNext が生成する worker は fetch しか export しないため、`.open-next/worker.js` の fetch を再 export するカスタムエントリを作り、wrangler の main を差し替える。どちらもプラットフォーム依存コードと service_role キーの配置が必要になるため、F-42 は pg_cron が適している(F18/F22)。
  - sources: https://docs.netlify.com/build/functions/scheduled-functions/ , https://developers.cloudflare.com/workers/configuration/cron-triggers/ , https://opennext.js.org/cloudflare/howtos/custom-worker , https://developers.cloudflare.com/workers/platform/limits/

- **[F15] (high)** Windows:OpenNext は『Windows full support is not guaranteed』として WSL・Linux VM・Linux CI を推奨している。Workers Builds(Ubuntu 24.04、既定 Node 24.18、Free は月3,000分)で CI ビルドできる。Netlify はクラウド側の CI でビルドするため影響が小さい
  - detail: 外部実測では Windows で `next build --webpack` が約35秒で成功したが、互換性の警告と WSL 推奨が表示された(OpenNext 1.20.10)。Netlify の #3562 は Windows でのローカルビルド+CLI デプロイの事例。本調査では空きメモリ不足(コミット可能 約1.4GB)のため、Next.js フルビルドの実地試験は見送った。
  - sources: https://raw.githubusercontent.com/opennextjs/docs/main/shared/WindowsSupport.mdx , https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ , https://developers.cloudflare.com/workers/ci-cd/builds/build-image/ , https://github.com/yamamotonaoki3/MyBookLibrary/issues/639 , https://github.com/opennextjs/opennextjs-netlify/issues/3562

- **[F16] (high)** 環境変数:Netlify では UI/CLI/API で設定した変数だけが関数から見え(netlify.toml の env は不可)、値はデプロイ時点で固定される。Cloudflare では nodejs_compat と互換日付 2025-04-01 以降の組み合わせで process.env に自動投入される
  - detail: Netlify:スコープ(Builds/Functions 等)の限定は Pro 以上で、Free/Personal では全変数がビルドにも関数にも渡る。NEXT_PUBLIC_ はビルド時にインライン化される。Secrets Controller は値を write-only にし、ビルド成果物をスキャンする。Cloudflare/OpenNext:ローカルは .env 推奨、Workers Builds では『Build variables and secrets』、実行時の値はダッシュボードで設定し `deploy -- --keep-vars`。Secrets は読み戻し不可。変数の上限は Free 64/Paid 128、各5KB。
  - sources: https://docs.netlify.com/build/environment-variables/overview/ , https://docs.netlify.com/build/functions/environment-variables/ , https://docs.netlify.com/build/environment-variables/secrets-controller/ , https://developers.cloudflare.com/workers/configuration/environment-variables/ , https://opennext.js.org/cloudflare/howtos/env-vars , https://developers.cloudflare.com/workers/configuration/secrets/

- **[F17] (high)** supabase-js は公式に Cloudflare Workers をサポートしている。@supabase/ssr を Workers で使うには nodejs_compat が必要。トークン更新時の Set-Cookie がキャッシュされる事故を防ぐため、Supabase は `Cache-Control: private, no-store` を推奨している
  - detail: supabase#37592(nodejs_compat なしで Dynamic require of stream)は非活動のためクローズされており、メンテナは nodejs_compat の有無を確認していた。proxy.ts+getClaims() が Workers 上で動くという公式の確認例は見つからない(未検証)。DB クライアントはリクエストごとに生成する必要がある(OpenNext のトラブルシュート)。
  - sources: https://github.com/supabase/supabase-js , https://github.com/supabase/supabase/issues/37592 , https://supabase.com/docs/guides/auth/server-side/nextjs , https://opennext.js.org/cloudflare/troubleshooting

- **[F18] (high)** DB 側のユーザー単位レート制限と猶予期間データ削除は、プラットフォームに依存せず実装できる(PGlite 0.5.10 / PostgreSQL 18.6 で試作・検証済み)
  - detail: 結果:30回/60秒で31回目以降が P0429 で拒否され、ユーザーごとに独立して数えられた。未認証は 28000。READ ONLY トランザクションでは記録できない(25006、PostgREST の GET RPC が読み取り専用になるため、RPC は POST で呼ぶ)。拒否時の例外で増分もロールバックされる(35回呼んでも hits=30)。猶予切れ3,000行をバッチ1,000件で 368ms で削除し、再実行は0件(冪等)。Supabase docs の pre-request 例も GET/HEAD を対象外にしている。pg_cron 自体は PGlite では検証できない。
  - sources: https://supabase.com/docs/guides/api/securing-your-api , https://supabase.com/docs/guides/cron

- **[F19] (low)** コスト試算(推測):Netlify では5万件ユーザーのバックフィル1回が約1.1 credits。Free は本番デプロイ約20回で枯渇するのが支配的要因。Cloudflare Paid は想定規模なら$5の込み枠内
  - detail: Netlify:200チャンク×約2秒×1GB=0.111GB-h → 約1.1 credits に、リクエスト分 0.04 credits を加える。例として100 MAU×月200検索なら Compute 約17 credits に Web リクエストと帯域で数十〜100 credits 規模となり、これに本番デプロイ(15/回)が加わる → Personal 以上が現実的。Cloudflare:同じ規模で数万リクエスト・数百万 CPU-ms 程度。いずれも Foursquare/DB の応答時間を仮定した推測値。
  - sources: https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ , https://developers.cloudflare.com/workers/platform/pricing/

- **[F20] (medium)** Netlify の同期関数タイムアウトは、公式ドキュメント(60秒・変更不可)と2026年の利用者報告(既定10秒、26秒への引き上げ申請)が食い違っている
  - detail: 2026-08-25 のフォーラムで、Pro ユーザーが『the default 10-second limit』に当たったと報告している。第三者ブログ(bex.co、競合ベンダー、2026-09-23)は『Free 10秒/有料26秒』と記述。レガシープランや Lambda 互換モードの値が混在している可能性がある(推測)。設計上は1リクエスト10秒以内を目標にすべき。
  - sources: https://docs.netlify.com/build/functions/configuration/ , https://answers.netlify.com/t/request-increase-synchronous-function-timeout-to-26-seconds-pro-plan-bis/167503 , https://bex.co/blog/2026/09/23/netlify-durable-functions-26-second-ceiling

- **[F21] (high)** Netlify の Next.js 対応は OpenNext 製アダプタ(@netlify/plugin-nextjs)による。公式の機能表は App Router/Server Actions/Route Handlers/Middleware/ISR/Cache Components などすべて『Full Support』。Middleware は Edge Functions 上で実行される(CPU 50ms/リクエスト、圧縮後20MB)
  - detail: アダプタは、SSR・ISR・PPR・Route Handlers・Server Actions を処理するサーバーレス関数1つと、Middleware 用の Edge Function を作る。制限事項:Middleware の後に headers/redirects が評価される、Node.js Middleware は C++ アドオンと fs が使えない。Netlify は Adapter API ベースの新アダプタを2026年後半に予定しているが、現行アダプタのサポートは継続すると表明。
  - sources: https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/ , https://docs.netlify.com/build/edge-functions/limits/ , https://www.netlify.com/blog/the-next-js-adapter-api-just-shipped-here-s-what-comes-next/

- **[F22] (medium)** Supabase Cron(pg_cron)の推奨は、同時実行8ジョブ以下・1ジョブ10分以下。cron.job_run_details は自動削除されない。Supabase Free のプロジェクトは1週間非アクティブで一時停止するため、cron も止まる
  - detail: F-42 は条件ベース(deleted_at < now()-14日)・バッチ削除で冪等にし、取りこぼしても次回の実行で自己回復するようにする。job_run_details の掃除ジョブも登録する。Free プランでの可用性とローカル CLI での動作は第三者情報に基づくため、検証6で確認が必要。
  - sources: https://supabase.com/docs/guides/cron , https://supabase.com/docs/guides/cron/quickstart , https://supabase.com/pricing

### recommendations
- ホスティングの第一候補は Cloudflare Workers(Workers Paid、月$5)+ @opennextjs/cloudflare 1.20.12以上 + Next.js 16.4.1以上 + Supabase ap-northeast-1 とする。確定は『検証8: ホスティング実地スパイク』の合格後とし、合格条件は次の4つ:proxy.ts なしでセッションが維持できる/1,000回のソークで 1102 エラーが出ない/Workers Builds でビルドできる/同期チャンクの cpuTime が十分小さい。
- 代替は Netlify。採用時は Pro(Functions リージョンを nrt に)+ Supabase 東京、または Personal + Supabase us-east-2(日本からの往復 +150〜200ms を許容)とする。Netlify Free は公開運用には採用せず、開発検証用にとどめる(300 credits 超過で全停止、本番デプロイは15 credits/回)。
- 同期(F-10/F-11)は POST の Route Handler `/api/sync/chunk` で実装し、1リクエスト=Foursquare 1ページ(limit=250)+ upsert(on conflict id)とする。カーソルと進捗は DB に保存し、クライアントのループから再開できるようにする。Foursquare の fetch には約8秒のタイムアウトを付けて1リクエスト10秒以内を保証し、403 と X-RateLimit-Reset を処理する。Server Action は使わない。
- レート制限(N-03/N-07)は DB 側のユーザー単位固定窓(auth.uid() をキーにした UPSERT カウンタ)を主とし、RPC は必ず POST で呼ぶ。プラットフォーム側の IP 単位制限(Cloudflare の WAF ルール/Netlify の netlify.toml ルール)は『設定のみ』で併用する。拒否回数も記録したい場合は、カウント用 RPC を別トランザクションで先に呼ぶ。
- 日次物理削除(F-42)は pg_cron で行い、条件ベース・バッチ削除の冪等な関数にする。レート制限カウンタと cron.job_run_details の掃除ジョブもあわせて登録する。Netlify の Scheduled Functions や Cloudflare の Cron Triggers は使わない。
- 認証は proxy.ts に依存しない設計を基本にする。Supabase へのアクセスとトークン更新は Route Handler/Server Action に集約し、Server Components から Supabase を直接呼ばない『薄い SSR』にする。proxy.ts が必要な場合は最小構成にとどめ、middleware.ts(Edge)へ退避できる案を残す。認証テーマ側と要調整。
- 移植性ルールを基本設計書に明記する:アプリコードでプラットフォーム SDK(getCloudflareContext、@netlify/functions の Context、Blobs/KV/D1/R2)を使わない/process.env で設定を読む/クライアントはリクエストごとに生成しグローバル状態を持たない/DB アクセスは supabase-js(HTTP)のみ/next/image の最適化は使わない/ユーザー固有データに ISR や use cache を使わず、Cache-Control: private, no-store を付ける。
- 開発環境:nvm で Node 24 LTS に更新する(必須)。本番ビルドは Linux CI(Workers Builds/Netlify CI/GitHub Actions)で行い、Windows では next dev を使う。Supabase CLI のために Docker(WSL2)を入れるなら、OpenNext の preview も WSL 上で実行する。
- 依存バージョンは固定し、セキュリティ更新に追従する体制(Renovate など)を用意する。OpenNext Cloudflare は Next.js の peer 下限を頻繁に引き上げ、新しいマイナーへの対応に約1〜2週間の遅れがあるため。
- vinext は MVP では採用しない。標準の Next.js API だけで実装し、将来の移行の選択肢を残す。
- 要件定義書7章のホスティング欄『Netlify』は、基本設計書で比較結果に基づく選定(第一候補と代替)に更新する。本調査ではプロジェクトのファイルは変更していない。

### open_questions
- Netlify の同期関数の実際のタイムアウト(公式60秒か、報告にある10秒/26秒か)。手順:新規のクレジット制アカウントに `/api/sleep?s=5|15|30|65` を作ってデプロイし、504/タイムアウトになる秒数を記録する。
- netlify.toml の `[[redirects]] from="/api/search" to="/api/search" status=200 force=true` + `[redirects.rate_limit]` が Next.js の Route Handler に効くか。手順:Deploy Preview で1分間に60回リクエストし、429 が返るか、通常時に 404 などの副作用がないか、デプロイログの post-processing にルールが表示されるかを確認する。
- proxy.ts(@supabase/ssr + getClaims)が両環境で動くか。手順:JWT の有効期限を短く設定し、期限切れ後のリロードで Cookie が更新されるかを確認する。Netlify は Linux CI のビルドで #3562/#3575 が再現するか、Cloudflare は `wrangler deploy --dry-run --outdir` の Total Upload の増分(#1373)も確認する。
- proxy なしの設計(Route Handler 内で createServerClient → getClaims → setAll)でセッションが維持されるか。手順:Server Components から Supabase を呼ばない最小アプリを作り、トークン期限切れの前後で API を呼んで Set-Cookie と 401 の有無を確認する。
- Cloudflare の #1381(SSR を繰り返すと isolate 劣化で 1102)が本アプリで起きるか。手順:検索ページ(SSR)と /api/search をそれぞれ1,000回逐次リクエストし、`wrangler tail --format json` で outcome と cpuTime を集計する。
- 実アカウントでの1チャンクの実測値。手順:検証3と統合し、limit=250 の Foursquare 応答時間とサイズ、Supabase の upsert 時間、Workers の cpuTime、Netlify の関数 duration を p50/p95 で記録して、10秒以内に収まるか確認する。
- 日本からの検索 TTFB の構成別比較(Workers+DB 東京/Netlify Ohio+DB 東京/Netlify Ohio+DB Ohio)。手順:各構成にデプロイして100回計測する。あわせて Workers の request.cf.colo で東京/大阪の拠点で実行されているか確認する。
- Cloudflare Rate Limiting binding の実効性(第三者 issue に、3/60 の設定が効かないという報告がある)。手順:limit=3/period=60 の設定で10回連続で呼び、success=false が返るかを確認する(binding を使う場合のみ)。
- Cloudflare Free ゾーンの WAF レート制限ルールの動作。手順:カスタムドメインを Cloudflare に載せ、/api/search に10秒あたりの閾値と Block を設定してバースト試験する。
- Supabase CLI のローカルスタックで pg_cron が使えるか(Free プランでの可用性も含む)。手順:検証6で `create extension pg_cron` → cron.schedule を登録し、cron.job_run_details と削除件数を確認する。
- Netlify Free で Secrets Controller(Contains secret values)を使えるか。スコープ限定は Pro 以上のため。手順:Free チームの UI/CLI(`env:set --secret`)で試す。
- Foursquare Developer Console に登録できる redirect_uri の数と、ステージング用の固定 URL(Netlify のブランチデプロイ用サブドメイン/Cloudflare の別 Worker)で運用できるか。手順:検証5と統合して登録を試す。

### artifacts
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\research\hosting.md
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\hosting-bench\bench.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\hosting-bench\bench-result.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\hosting-dbtest\dbtest.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\hosting-dbtest\dbtest-result.txt
