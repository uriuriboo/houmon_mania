# 20_result.json (agent a000fee20b9539199)

## TOPIC: frontend: フロントエンド技術スタックの最新状況(2026年10月時点)— Next.js 16.4 / React 19.3 / Tailwind v4 / shadcn/ui / テスト / 日本語フォント / URL状態とページネーション / 周辺ライブラリ

### summary
2026-10-16 時点の最新安定版は Next.js 16.4.2(16.x が Active LTS)、React 19.3.1、Tailwind CSS 4.3.3、shadcn CLI 4.21.5、Vitest 5.0.5、Playwright 1.64.1、zod 4.6.7、liqe 3.8.7、lucide-react 1.57.0。2026-10-14 のセキュリティ更新で Critical 2 件と High 1 件(Server Actions への DoS を含む)が修正されたため、Next は 16.4.1 以上が必須。

Node 20 は 2026-04-30 に EOL。開発機の Node 20.11.1 でも next build と next dev(proxy.ts を含む)は動くことを実測で確かめた。一方で Vitest 5 と ESLint 10 は util.styleText が無いために落ちる(styleText は v20.12.0 で追加)。jsdom 30 と jest-dom 7 は Node 22 以上が必要。同梱の npm 10.2.4 では vitest@4 のインストールにも失敗した。このため Node 24 LTS(24.22.0)への更新を推奨する。

Next 16 のポイントは次のとおり。
- proxy.ts は Node.js ランタイム専用。runtime を指定するとエラーになる。Edge が必要なら非推奨の middleware.ts を使う。
- cookies/headers/params/searchParams は同期アクセスが廃止され、すべて await が必要。
- Turbopack がデフォルト。
- next lint は廃止され、ESLint CLI(flat config)か Biome を直接使う。
- typedRoutes は安定版。
- Cache Components は 16.0 では opt-in だったが、16.4 で公式推奨になり create-next-app のデフォルトになった。Next 17 でデフォルト化の予定。有効にするとランタイム API を読む部分は Suspense 内に置く必要があり、Node ランタイムも必須になる。
- TypeScript 7.0.2 は JS API を持たず typescript-eslint の対象外。当面は TS 6.0.3 に固定するのが無難(build が通ることを実測)。

UI まわり。
- shadcn は 2026-07 から Base UI がデフォルト(Radix も継続サポート)。必要なコンポーネントは registry 上にすべてあることを実測で確認した。
- next-themes は 2025-03 以降リリースが無く、React 19 で出る script 警告が未解決。ダークモードは MVP では OS 設定に追従させる CSS だけの方式を推奨する。
- 日本語フォントは、Windows でも 2025-04 から Noto Sans JP が OS 標準になったため、システムフォントスタックを推奨する。next/font の Noto Sans JP は 124 スライスで、可変フォント全体は約 5.3MB(実測)。

検索・表示まわり。
- 検索状態は /search?q=&page=&size= の URL で持つ。送信は next/form(GET)、サーバー側は await searchParams を zod で正規化する。
- 総件数の表示が必須なので、ページ番号方式(並び順は created_at DESC, id DESC)を推奨する。
- 現地時刻は「epoch に offset 分を足してから timeZone:'UTC' で整形する」方式をサーバー側で使う。全環境で同じ結果になる。Intl に '+09:00' を直接渡す方式は Node 20 では RangeError になった。
- liqe は小文字の and/or を演算子として扱わず、全角スペースや全角括弧も区切りとして認識しない(実測)。パース前の NFKC 正規化と、演算子は大文字で入力するよう UI で案内することが必要。

### findings

- **[F1] CRITICAL (high)** Next.js の最新安定版は 16.4.2(2026-10-15)。16.x が Active LTS、15.x は Maintenance LTS。2026-10-14 のセキュリティ更新は 16.4.1 / 15.5.28 で修正されたため、16.4.1 未満は使えない
  - detail: npm view next: latest=16.4.2、backport=15.5.28、canary=16.5.0-canary.15、engines node>=20.9.0。リリース履歴は 16.0(2025-10-21)→16.1(2025-12-18)→16.2(2026-03-18)→16.3(2026-08-03)→16.4(2026-10-06)。

10-14 の更新で直った脆弱性:
- Cache Components 下の use cache が typed array を複数返すと未認証 RCE(Critical)
- 画像最適化 API で SVG 経由の RCE(Critical。sharp 0.35.5 以上で回避)
- Server Action を 1 つでも持つ App Router への DoS(High)

本アプリは Server Action を使うので必須対応。@opennextjs/cloudflare 1.20.12 も peer で next>=16.4.1 を要求している。15.x の Maintenance は「初回リリースから 2 年」の規定なので 2026-10-21 頃に終了する見込み(推測)。Next.js 17 はまだ発表されていない。
  - sources: https://www.npmjs.com/package/next , https://nextjs.org/blog , https://nextjs.org/blog/nextjs-security-update-october-14-2026 , https://nextjs.org/support-policy , https://nextjs.org/blog/next-16-4

- **[F2] CRITICAL (high)** Node 20 は 2026-04-30 で EOL。開発機の Node 20.11.1 でも Next 16.4.2 の build/dev は動いたが、2026 年版のツール群(Vitest 5、ESLint 10、jsdom 27 以降、jest-dom 7、shadcn CLI)は 20.11.1 では動かないか対象外。Node 24 LTS(24.22.0)を推奨
  - detail: Node の状況(nodejs/Release):
- 20.x: EOL 2026-04-30
- 22.x: Maintenance(〜2027-04-30)
- 24.x: Active LTS。2026-10-20 から Maintenance、EOL 2028-04-30
- 26.x: 2026-10-28 から Active LTS

実測(Node 20.11.1):
- next build: Turbopack + cacheComponents + TS 6.0.3 で exit 0(39 秒)
- next dev: Ready 2.0s、初回 GET が 200
- vitest@5.0.5: rolldown の import で「node:util does not provide an export named styleText」となり起動失敗
- eslint@10.12.0: 結果出力時に「util.styleText is not a function」でクラッシュ
- util.styleText は Node 公式ドキュメント上 v21.7.0 / v20.12.0 で追加。20.11.1 では typeof が undefined だった
- 同梱の npm 10.2.4 では vitest@4.1.12 のインストールが「Cannot read properties of null (reading 'edgesOut')」で 2 回失敗し、npm 10.9.9 では成功した

engines の上限:
- jsdom 30: ^22.22.2 または ^24.15.0
- jest-dom 7: >=22
- shadcn CLI 4.21.5: >=20.18.1
- Playwright 公式: Node 22/24/26 のみ

AWS Lambda(Netlify Functions の基盤)は nodejs24.x が GA。nodejs26.x は preview で、GA 予定は 2026-11。
  - sources: https://github.com/nodejs/Release , https://nodejs.org/en/about/previous-releases , https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/util.md , https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html , https://vitest.dev/blog/vitest-5 , https://playwright.dev/docs/intro , https://nextjs.org/docs/app/guides/upgrading/version-16

- **[F3] CRITICAL (high)** Next 16 で middleware.ts は proxy.ts に改名(deprecated)された。proxy は Node.js ランタイム固定で、runtime 設定を書くとエラーになる。Edge を使い続けるなら非推奨の middleware.ts に残すしかない
  - detail: 公式の記述:
- 「The edge runtime is NOT supported in proxy. The proxy runtime is nodejs, and it cannot be configured.」
- 「Setting the runtime config option in Proxy will throw an error.」
- skipMiddlewareUrlNormalize は skipProxyUrlNormalize に改名された。codemod は middleware-to-proxy。
- Server Functions は matcher の対象外になると Proxy を通らないため、「各 Server Function 内で認証・認可を検証せよ」と明記している。

実測: proxy.ts でレスポンスヘッダに process.version を入れたところ、next start と next dev の両方で v20.11.1 が返り、Node ランタイムで動いていることを確認した。

ホスティング側の状況:
- OpenNext Cloudflare: proxy.ts(Node middleware)対応は PR #1309(2026-08-25 merge)による experimental。nodejs_compat が必要で、ワーカーサイズが増える。
- Netlify: middleware は Edge Functions で実装される。Node middleware には C++ アドオン不可・ファイルシステム不可の制限がある。

proxy は Supabase のセッション Cookie 更新と大まかなリダイレクトに限定し、認可は RLS と各 Server Component / Action で行う設計が妥当。
  - sources: https://nextjs.org/docs/app/api-reference/file-conventions/proxy , https://nextjs.org/docs/app/guides/upgrading/version-16 , https://nextjs.org/blog/next-16 , https://github.com/opennextjs/opennextjs-cloudflare/pull/1309 , https://opennext.js.org/cloudflare , https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/

- **[F4] (high)** Next 16 で cookies()/headers()/draftMode()/params/searchParams への同期アクセスは完全に削除され、await が必須。型は next typegen が生成する PageProps<'/route'> 等で付けられる
  - detail: アップグレードガイドの記述: 「Starting with Next.js 16, synchronous access is fully removed.」

searchParams は Promise<Record<string, string | string[] | undefined>>。layout は searchParams を受け取らない。codemod は next-async-request-api。

実測: PageProps<'/'> を使い、Pick<PageProps<'/'>,'searchParams'> を子に渡して Suspense 内で await する構成で、型チェックと build が通った。
  - sources: https://nextjs.org/docs/app/guides/upgrading/version-16 , https://nextjs.org/docs/app/api-reference/functions/use-search-params

- **[F5] CRITICAL (high)** Cache Components は 16.0 では opt-in(cacheComponents: true)だったが、16.4 で全アプリ向けの推奨になり、create-next-app の推奨デフォルトで有効化されるようになった。Next 17 でデフォルト化の予定
  - detail: 16.4 ブログ: 「Cache Components … will become the default in Next.js 17」「all new apps created with create-next-app will have Cache Components enabled by default」。推奨設定は cacheComponents:true と partialPrefetching:true(後者は明示しないと警告)。

有効時の制約:
- cookies/headers/searchParams を読むコンポーネントは Suspense 内に置く
- use cache 内では runtime API を読めない(引数で渡すか use cache: private を使う)
- Node.js ランタイム必須で、runtime の segment config は不可。公式は「Other server-side JavaScript runtimes are not guaranteed to work」としている
- ナビゲーション時、前のルートを Activity で hidden のまま保持する

実測: 有効化した build で、Suspense 内で searchParams を読むページが「◐ Partial Prerender」になった。

ユーザー別の検索結果(RLS・Cookie 依存)は use cache せずストリーミングするのが妥当。最終的な採否はホスティング PoC で決める。
  - sources: https://nextjs.org/blog/next-16-4 , https://nextjs.org/blog/next-16 , https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents , https://nextjs.org/docs/app/getting-started/caching , https://nextjs.org/docs/app/api-reference/cli/create-next-app

- **[F6] (high)** Next 16 から Turbopack が dev/build ともデフォルト(--webpack で opt-out)。16.3 から dev と build のファイルシステムキャッシュもデフォルトで有効
  - detail: - custom webpack 設定があると next build は誤設定防止のため失敗する。
- experimental.turbopack は top-level の turbopack に移動した。
- 16.3 ブログでは dev のメモリを最大 90% 削減したとしている。
- 実測の build ログでも「Next.js 16.4.2 (Turbopack)」と表示された。
  - sources: https://nextjs.org/docs/app/guides/upgrading/version-16 , https://nextjs.org/blog/next-16-3

- **[F7] (high)** next lint は Next 16 で削除され、next build も lint しなくなった。ESLint CLI と flat config(eslint-config-next/core-web-vitals と /typescript)か Biome を直接使う
  - detail: - eslint-config-next 16.4.0 以降は ESLint 10 にも対応するが、ESLint 10 自体が Node ^20.19.0 / ^22.13.0 / >=24 を要求する。
- eslint 9.39.5(maintenance)は ^20.9.0 対応。
- 実測: Node 20.11.1 で eslint 10.12.0 + eslint-config-next 16.4.2 はクラッシュした(F2)。
- next.config の eslint オプションも削除された。
- create-next-app は ESLint / Biome / None から選べる。
- 移行 codemod は next-lint-to-eslint-cli。
  - sources: https://nextjs.org/docs/app/api-reference/config/eslint , https://nextjs.org/docs/app/guides/upgrading/version-16 , https://www.npmjs.com/package/eslint-config-next

- **[F8] (high)** npm の typescript latest は 7.0.2(Go ネイティブ版、JS API 無し)。typescript-eslint 8.71.2 の peer は typescript <6.1.0 なので、ESLint を使うなら TypeScript 6.0.3 に固定するのが無難
  - detail: - TS 7.0 は 2026-07-08 GA。公式は「does not ship with an API」とし、API は 7.1 で予定している。
- 公式は @typescript/typescript6 を npm alias で併用する方法を案内している。
- typescript-eslint の TS 7 対応 issue #12518 は「TS 7 API が無いため非対応」として close された。
- Next 16.3 以降の next build は、プロジェクトローカルの tsc CLI で型チェックする(experimental.useTypeScriptCli、TS 6/7 両対応)。
- 実測: TS 6.0.3 で next build が通った。
- Next が自動生成した tsconfig は strict:false だったので、手動で true にする。
- TS 6.0 はデフォルトが変わっている(strict が true、types が [] など)ため、tsconfig は明示的に書く。
  - sources: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ , https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html , https://github.com/typescript-eslint/typescript-eslint/issues/12518 , https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli , https://nextjs.org/docs/app/api-reference/config/typescript

- **[F9] (high)** typedRoutes は安定版(top-level の typedRoutes: true)で、Turbopack ビルドでもクエリ文字列付きの href を型検査できる
  - detail: 公式: 「This option has been marked as stable, so you should use typedRoutes instead of experimental.typedRoutes」。非リテラルの href は as Route でキャストする。

実測: typedRoutes:true の状態で、テンプレートリテラル `/?q=${encodeURIComponent(q)}&page=${page + 1}` と UrlObject {pathname:'/', query:{q,page}} の両方が型チェックを通過した。
  - sources: https://nextjs.org/docs/app/api-reference/config/next-config-js/typedRoutes , https://nextjs.org/docs/app/api-reference/config/typescript

- **[F10] (high)** React は 19.3.1 が latest(Next 16.4 が同梱)。React Compiler は 1.0 安定版で、Next では reactCompiler: true で有効化するがデフォルトは無効。Rust 版は experimental
  - detail: React 19.3 の主な変更: ViewTransition と Fragment Refs の安定化、react-dom の browser() API、Trusted Types 対応。

React Compiler:
- babel-plugin-react-compiler 1.0.0(2025-10-07)。React 公式は「New apps should use React Compiler」と推奨している。
- lint ルールは eslint-plugin-react-hooks の recommended に統合済み(eslint-config-next 16.4.2 は react-hooks ^7.1 を同梱)。
- Next の reactCompiler は 16.0 で stable になったが、「It is not enabled by default」で、Babel 経由のためビルドが遅くなる。compilationMode: 'annotation'(use memo で opt-in)も選べる。
- experimental.turbopackRustReactCompiler は 16.3 で導入。Babel プラグイン不要だが experimental。
  - sources: https://react.dev/blog/2026/09/09/react-19-3 , https://react.dev/blog/2025/10/07/react-compiler-1 , https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler , https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackRustReactCompiler , https://nextjs.org/blog/next-16-4

- **[F11] (high)** Tailwind CSS は 4.3.3 が latest(@tailwindcss/postcss 経由で導入)。v4 の既定 --font-sans は -apple-system / 'Segoe UI' 始まりで、日本語向けには上書きが必要
  - detail: - 導入: npm i tailwindcss @tailwindcss/postcss postcss。postcss.config.mjs に "@tailwindcss/postcss": {} を書き、CSS に @import "tailwindcss" を置く。
- v4 のブラウザ要件: Chrome 111 / Safari 16.4 / Firefox 128。
- 4.2: 新パレット、@tailwindcss/webpack。4.3(2026-05-08): scrollbar・zoom・tab・@container-size。
- 2026-09-09 に Tailwind Labs が Shopify に合流したが、OSS は MIT のまま保守継続。
- 実測: theme.css(4.3.3)の --font-sans は「-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif, 絵文字フォント」。
- ブレークポイントは mobile-first で sm 640 / md 768 / lg 1024 / xl 1280 / 2xl 1536px。@container でコンテナクエリも使える。
- dark: はデフォルトで prefers-color-scheme。
  - sources: https://www.npmjs.com/package/tailwindcss , https://tailwindcss.com/blog/tailwindcss-v4-3 , https://tailwindcss.com/docs/installation/framework-guides/nextjs , https://tailwindcss.com/docs/compatibility , https://unpkg.com/tailwindcss@4.3.3/theme.css , https://tailwindcss.com/docs/responsive-design , https://tailwindcss.com/blog/tailwind-is-joining-shopify

- **[F12] CRITICAL (high)** shadcn/ui(CLI 4.21.5)は 2026-07 から Base UI がデフォルト(Radix は非推奨化されず -b radix で選べる)。必要なコンポーネントは registry 上にすべてある。ただしトーストは Base UI 版が toast、Radix 版が sonner で、sonner 実装は next-themes に依存する
  - detail: init --help(実測)の主なオプション:
- -t next
- -b base|radix|aria
- -p preset
- -d(既定は template=next、preset=base-nova)

registry の実測:
- base-nova: ui 65 件。pagination, badge, card, sheet, dialog, skeleton, progress, sonner, toast, alert, alert-dialog, dropdown-menu, select, native-select, tooltip, separator, spinner, empty, input-group, field, table がすべてある。
- radix-nova: 64 件で、toast だけ無い。

init で入る依存: class-variance-authority, cn(clsx + tailwind-merge の置換。2026-09 から), lucide-react, @base-ui/react。devDependencies は tw-animate-css と shadcn。

sonner コンポーネントは deps が sonner と next-themes で、useTheme() を使う。Base UI 版 toast の deps は cn と @base-ui/react のみ。

@base-ui/react は 1.9.0(1.0.0 は 2025-12-11)。shadcn CLI の engines は >=20.18.1。
  - sources: https://ui.shadcn.com/docs/changelog , https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default , https://ui.shadcn.com/docs/changelog/2026-07-toast , https://ui.shadcn.com/docs/installation/next , https://ui.shadcn.com/docs/components , https://ui.shadcn.com/r/styles/base-nova/registry.json , https://ui.shadcn.com/r/styles/radix-nova/registry.json

- **[F13] (high)** next-themes の最新は 0.4.6 で 2025-03-11 から更新が無い。React 19 環境の「Encountered a script tag while rendering React component」警告は未解決のまま
  - detail: - next-themes #387(2026-03-24 open、Next 16.2.1)と shadcn #10104(2026-03-19 open)。どちらもメンテナの応答なし。
- 回避策は scriptProps={{type:'application/json'}} などのハック、またはフォーク(@teispace/next-themes, @wrksz/themes)。
- shadcn 公式のダークモード手順は今も next-themes(attribute=class, defaultTheme=system, html に suppressHydrationWarning)。
- Tailwind v4 の dark: は既定で prefers-color-scheme なので、OS 追従だけなら JS は不要。
  - sources: https://www.npmjs.com/package/next-themes , https://github.com/pacocoursey/next-themes/issues/387 , https://github.com/shadcn-ui/ui/issues/10104 , https://ui.shadcn.com/docs/dark-mode/next , https://tailwindcss.com/docs/dark-mode

- **[F14] (high)** Vitest 5.0.5 は Node >=22.12 と Vite >=6.4 が必須。Node 20.11.1 で動く最新は Vitest 4.1.12(vite 6.4.4 と組み合わせ。npm 10.9 系でインストール)で、React Testing Library を含めて実測で動いた
  - detail: 実測(Node 20.11.1):
- vitest 5.0.5: 起動失敗
- vitest 4.1.12 + vite 6.4.4 + @vitejs/plugin-react 4.7.0 + @testing-library/react 16.3.3 + @testing-library/dom 10.4.2 + react 19.3.1: happy-dom 21.0.3 と jsdom 26.1.0 の両方で 2 テストとも成功
- vitest 3.2.7: 成功

Node 24 環境で組む場合:
- vitest 5 + vite 8 + plugin-react 6(peer は vite ^8)+ jsdom 30 + jest-dom 7(/vitest エントリあり)
- vite 8 は resolve.tsconfigPaths で vite-tsconfig-paths が不要

その他:
- Vitest 5 の主な変更: clearMocks の既定が true、await していない resolves/rejects は失敗扱い、locator は既定で exact。
- Next 公式は「Vitest は async Server Components 非対応、E2E 推奨」としている。
- Playwright は 1.64.1(2026-10-14)で、公式要件は Node 22/24/26・Windows 11+。
- @next/playwright の instant() ヘルパーもある。
  - sources: https://vitest.dev/blog/vitest-5 , https://www.npmjs.com/package/vitest , https://nextjs.org/docs/app/guides/testing/vitest , https://playwright.dev/docs/intro , https://nextjs.org/blog/next-16-3 , https://github.com/vitest-dev/vitest/issues/10054

- **[F15] (medium)** Windows では 2025-04 の Windows Update で Noto Sans JP が標準搭載された(Win10/11、7 ウェイト)。Win11 の Chrome/Edge は既定の sans-serif が Noto Sans JP になる。Apple はヒラギノ、Android は Noto Sans CJK JP
  - detail: ICS MEDIA(2025-07-18)によると:
- Windows 11 には Noto Sans JP と Noto Serif JP、Windows 10 には Noto Sans JP のみが入った。
- Apple 系には日本語 Noto が無く、Safari は local() を遮断する。
- Android の Noto Sans CJK JP は Android 15 から可変フォント。
- 日本語サイトでは system-ui を避けるよう推奨している(Windows で游ゴシック UI が当たるため)。

Web フォントを使わない構成が最軽量。具体的なフォントスタックは推奨(R6)参照。搭載時期の一次情報(Microsoft の KB)は未確認。
  - sources: https://ics.media/entry/250718/ , https://tawara-memo.hatenablog.com/entry/2025/06/10/184844

- **[F16] (high)** next/font/google の Noto Sans JP は日本語用の名前付き subset を持たない(cyrillic/latin/latin-ext/vietnamese のみ)。実測では 124 個の woff2 スライスになり、可変フォント全体で約 5.3MB、静的 400 の 1 ウェイトで約 2.8MB
  - detail: next の font-data.json の subsets は [cyrillic, latin, latin-ext, vietnamese]。

Google Fonts CSS2 の実測:
- wght@400: 124 ファイル、合計約 2,867KB(最大 47.9KB、latin スライス 12.8KB)

Noto_Sans_JP({preload:false, display:'swap'}) を next build した実測:
- .next/static/media に woff2 が 124 個、合計約 5,342KB(最大 90.5KB / 最小 8.0KB)
- CSS は @font-face 125 個(Fallback を含む)で約 93KB
- preload link は 0 件で、警告も出なかった
- 生成 CSS の src は url() のみ(local() は Fallback 用の local(Arial) だけ)なので、OS に Noto Sans JP があってもダウンロードされる

ブラウザは unicode-range で必要なスライスだけ取得するが、店名の漢字によっては多数のスライスにまたがる可能性がある(推測)。
  - sources: https://nextjs.org/docs/app/api-reference/components/font , https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400&display=swap

- **[F17] (high)** URL の検索状態は、送信に next/form(string action = GET・クライアント遷移・progressive enhancement)、サーバーで await searchParams、ページ送りに Link を使うのが公式パターン。nuqs 2.10.2 は型付き URL state の選択肢
  - detail: next/form:
- action が文字列のとき、フォームデータを URL の search params にしてナビゲートし、loading UI を prefetch する。
- replace / scroll / prefetch の props があり、useFormStatus で送信中を表示できる。

useSearchParams:
- prerender 対象のルートでは Suspense が必須(無いと Missing Suspense boundary でビルド失敗)。

Next Learn のパターン:
- 入力は defaultValue、useDebouncedCallback(300ms)で replace
- クエリ変更時に page=1 にリセット
- Suspense の key に query + page を指定
- 総ページ数は別クエリで取得

nuqs 2.10.2:
- サーバー側は createLoader / createSearchParamsCache、クライアント側は useQueryState。既定は shallow なので RSC を再取得するには shallow:false が必要。
- throttleMs は deprecated で、limitUrlUpdates に置き換え。clearOnDefault の既定は true。

関連する不具合: cacheComponents 有効時に history.replaceState のたびに client page が suspend して入力フォーカスを失う問題(Next issue #99512。nuqs も該当)は、2026-10-03 に PR #99611 で修正済み。
  - sources: https://nextjs.org/docs/app/api-reference/components/form , https://nextjs.org/docs/app/api-reference/functions/use-search-params , https://nextjs.org/learn/dashboard-app/adding-search-and-pagination , https://nuqs.dev/docs/server-side , https://nuqs.dev/docs/options , https://github.com/vercel/next.js/issues/99512

- **[F18] CRITICAL (medium)** 総件数の表示(F-31)と任意ページへの移動が必要なら、キーセット方式は不向きで、ページ番号方式(LIMIT/OFFSET + 総件数)が適する。ただし ORDER BY を一意にする(created_at DESC, id DESC)ことが必須
  - detail: 根拠:
- PostgreSQL 公式: 「The rows skipped by an OFFSET clause still have to be computed inside the server」「important to use an ORDER BY clause that constrains the result rows into a unique order」
- Use The Index, Luke: キーセット方式は速くズレないが「you cannot directly navigate to arbitrary pages」
- supabase-js の count: exact は COUNT(*)、planned は統計による概算、estimated は件数が小さいとき exact・大きいとき planned

ILIKE(前方 %)で総件数を出すには該当行を結局すべて評価するので、OFFSET の追加コストは相対的に小さい(推測。N-05 の規模で要計測)。
  - sources: https://www.postgresql.org/docs/current/queries-limit.html , https://use-the-index-luke.com/no-offset , https://supabase.github.io/postgrest-js/v1/classes/_lib_postgrestquerybuilder_.postgrestquerybuilder.html

- **[F19] (high)** Intl.DateTimeFormat の timeZone に '+09:00' のようなオフセット文字列を渡せるのは Chrome 120 / Firefox 121 / Safari 17.4 / Node 22.0 以降のみ。Node 20.11.1 では RangeError になる。「epoch に offset 分を足して timeZone:'UTC' で整形」する方式なら全環境で正しい
  - detail: MDN browser-compat-data の utc_offset: chrome 120、edge mirror、firefox 121、safari 17.4、safari_ios mirror、nodejs 22.0.0。Next 16 の対象ブラウザ(Chrome 111 / Safari 16.4)を全ては満たさない。

実測(Node 20.11.1):
- timeZone:'+09:00' は「RangeError: Invalid time zone specified」
- shift+UTC 方式: 540 → 2026/10/15(木) 21:34、-240 → 2026/06/30(火) 23:00、330 → 05:30、345 → 05:45
- Etc/GMT-9 は符号が逆で、分単位(+05:30 など)を扱えない
- date-fns 4.4.0 + @date-fns/tz 1.5.0 の TZDate(ms, '+09:00') も Node 20 で同じ結果になった
- Intl.RelativeTimeFormat('ja') は「昨日 / 3 時間前 / 2 か月前」
  - sources: https://raw.githubusercontent.com/mdn/browser-compat-data/main/javascript/builtins/Intl/DateTimeFormat.json , https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat , https://github.com/date-fns/tz , https://blog.date-fns.org/v40-with-time-zone-support/

- **[F20] CRITICAL (high)** liqe 3.8.7 は小文字の and/or を演算子として扱わず、検索語として暗黙 AND に含める。全角スペースや全角括弧も区切り・グルーピングとして認識しない。NFKC 正規化してからパースすれば期待どおりの AST になる
  - detail: 実測の AST:
- 'A OR (B AND C)' → LogicalExpression OR(右辺は ParenthesizedExpression)
- 'ラーメン and 渋谷' → AND(AND(ラーメン, 'and'), 渋谷)
- 'ラーメン　渋谷'(全角スペース)→ Tag 1 語
- '（ラーメン OR 蕎麦） AND 渋谷' → '（ラーメン' と '蕎麦）' が語になる
- 上 2 つを NFKC 正規化した後は、期待どおりの AND / 括弧として解釈された

弾く対象(F-26)になりうるノード:
- 'venue:スタバ' → field=venue
- 'count:>10' → op ':>'、value は数値 10
- 'NOT x' / '-x' → UnaryOperator
- '/re/' → RegexExpression
- 'ラー*' → '*' を含む Literal

エラー時の挙動:
- 'A OR' → Error 'Found no parsings.'
- 'A || B' → SyntaxError(column 付き)
- '' → EmptyExpression

README 上は趣味プロジェクト扱いで、最終リリースは 2026-06-11。
  - sources: https://github.com/gajus/liqe , https://www.npmjs.com/package/liqe

- **[F21] (high)** zod 4.6.7 は import * as z from 'zod' で v4 API を使う。z.literal([20,50,100]) などで、URL の q/page/size を安全に正規化できる(実測)
  - detail: Zod 4 の主な変更:
- エラー指定は error パラメータに統一(message は deprecated)
- z.email() などがトップレベル関数に
- z.literal に配列を渡せる
- 軽量版の zod/mini
- parse が 6〜14 倍高速(公式ベンチ)

実測: preprocess(配列なら先頭を採用)+ coerce + catch のスキーマで、{q:['a','b'], page:['2','9'], size:'30'} が {q:'a', page:2, size:20} に、page:'abc' / '0' / '1.5' が page 1 に正規化された。200 文字を超える q は catch で空文字になるため、実装では safeParse してエラーを表示する方がよい。
  - sources: https://zod.dev/v4 , https://www.npmjs.com/package/zod

- **[F22] (high)** lucide-react は v1 系(現行 1.57.0)。ブランドアイコンの削除、aria-hidden の既定 true、UMD 廃止がある。1.0.1 の RSC 非互換(#4200)は 1.7.0 で解決済み
  - detail: - Lucide v1 ガイド: 「remove all brand icons」「setting aria-hidden to true by default」(意味を持つアイコンには aria-label / title を付ける)、UMD 廃止(ESM/CJS)、LucideProvider で既定値を設定可能。
- issue #4200(モジュールレベルの createContext による RSC 非互換)は 2026-03-27 に close され、1.7.0 で解消を報告者が確認している。
  - sources: https://lucide.dev/guide/version-1 , https://github.com/lucide-icons/lucide/issues/4200 , https://www.npmjs.com/package/lucide-react

- **[F23] (high)** Next 16.4 の next dev は、プロジェクト直下に AGENTS.md(agent 向けルールブロック)を自動で書き込む。agentRules: false で無効化できる。create-next-app の推奨デフォルトは Agent feedback(telemetry 必須の実験機能)も有効にする
  - detail: 実測の dev ログ: 「Generated AGENTS.md for AI agents. Set `agentRules: false` in next.config to disable.」

AGENTS.md の内容は、node_modules/next/dist/docs/ にあるバージョン一致のドキュメントを読むよう指示するもので、「This block is written and re-added by next dev」と書かれている。

create-next-app の推奨デフォルト: TypeScript, ESLint, No React Compiler, Tailwind, App Router, Cache Components, AGENTS.md, Agent feedback。
  - sources: https://nextjs.org/blog/next-16-3 , https://nextjs.org/docs/app/api-reference/cli/create-next-app , https://nextjs.org/blog/next-16-4

### recommendations
- R1. Node 24 LTS(24.22.0)を開発と本番の共通ベースラインにする。nvm-windows で開発機を更新し、リポジトリに .nvmrc(24)と package.json の engines を置いて Netlify の NODE_VERSION と揃える。npm は 10.9 以上(Node 24 同梱版)を使う。Node 26 は Lambda の GA(2026-11 予定)後に再評価する。
- R2. 基本スタックを次の版で固定する: next 16.4.2(16.4.1 未満は禁止)、react / react-dom 19.3.1、typescript 6.0.3、@types/react 19.3、tailwindcss / @tailwindcss/postcss 4.3.3。Lint は ESLint 10 + eslint-config-next 16.4.2(flat config、core-web-vitals + typescript)。Biome を採るならそれでもよい。TS 7 は typescript-eslint が対応するまで見送る。
- R3. proxy.ts の役割は Supabase セッション Cookie の更新と、未ログイン時の大まかなリダイレクトだけにする。matcher で _next/static などを除外する。データ認可は RLS と各 Server Component / Server Action / Route Handler の中で必ず検証する(公式が明記)。Cloudflare を選ぶ場合は、OpenNext の experimental な proxy 対応を PoC で確認し、だめなら middleware.ts(Edge)に退避する。
- R4. cacheComponents: true と partialPrefetching: true を基本案とする(Next 17 のデフォルトに合わせる)。ユーザー別データは use cache せず Suspense でストリーミングし、searchParams や cookies を読む部分は Suspense 内に置く。runtime の segment config は書かない。ホスティング PoC で PPR や proxy との併用に問題が出たら無効化する。
- R5. UI は shadcn CLI(npx shadcn@latest init -t next)のデフォルト Base UI に乗る。主に使うコンポーネント: pagination, card, badge, skeleton, progress, alert, dialog / sheet(詳細表示とモバイルナビ), dropdown-menu, select, tooltip, separator, empty, spinner。通知は Base UI 版の toast を使い、next-themes への依存を避ける。React Compiler は任意とし、有効化する場合は babel-plugin-react-compiler 1.0.0 に固定する。
- R6. ダークモードは MVP では OS 設定に追従する CSS のみ(prefers-color-scheme)にする。フォントは Web フォントを使わず、Tailwind の --font-sans を「Hiragino Sans, Hiragino Kaku Gothic ProN, Noto Sans JP, Noto Sans CJK JP, Meiryo, sans-serif, 絵文字フォント」で上書きする(system-ui は先頭にしない)。どうしても next/font を使う場合は Noto_Sans_JP を preload:false、display:'swap'、ウェイト 2 種程度に絞る。
- R7. URL は /search?q=&page=&size=(size は 20/50/100 のいずれか)とする。検索は next/form の action='/search' で明示送信する(インクリメンタル検索はしない。N-03 のレート制限とも相性がよい)。サーバーでは await searchParams を zod v4 の safeParse で正規化し、q 変更時は page=1 に戻す。結果部分は <Suspense key={q+page+size}> とスケルトンで表示し、ページ送りはサーバー生成の <Link> で行う。件数表示(F-31)と「該当なし」は shadcn の empty を使い、aria-live で読み上げる。nuqs は複数フィルタやインクリメンタル検索を導入する段階で採用する。
- R8. ページネーションはページ番号方式(LIMIT/OFFSET + 総件数)にする。ORDER BY created_at DESC, id DESC で順序を一意にし、総件数は count(*) OVER() か別の count クエリで取る。page は ceil(total/size) でクランプする。キーセット方式は将来「もっと見る」UI にする際の拡張とする。
- R9. 現地時刻は Server Component で「new Date((createdAt + tzOffsetMin*60)*1000) を Intl.DateTimeFormat('ja-JP', {timeZone:'UTC', ...}) で整形し、UTC±hh:mm の表記を添える」方式で文字列化して渡す(依存ゼロで、ハイドレーション差異も出ない)。クライアント側で Intl に offset タイムゾーンを渡す方式には頼らない。相対表記が必要なら Intl.RelativeTimeFormat を使う。date-fns / @date-fns/tz は必要になってから追加する。
- R10. liqe に渡す前に、クエリを NFKC 正規化してトリムし、長さを制限する。演算子は大文字の AND / OR だけと UI のプレースホルダとヘルプで明示する(小文字を大文字化する前処理を入れるかは検索設計で決める)。field / range / regex / NOT / ワイルドカードの各ノードは F-26 に従って日本語メッセージで弾く。liqe のエラー(Found no parsings / SyntaxError column)も日本語に変換して表示する。
- R11. テストは Node 24 で Vitest 5 + Vite 8(resolve.tsconfigPaths)+ @vitejs/plugin-react 6 + RTL 16.3.3 + @testing-library/dom 10 + jest-dom 7 + jsdom 30(または happy-dom 21)を使い、E2E は Playwright 1.64.1。純関数(AST→SQL、searchParams 正規化、日時整形)は node 環境のユニットテスト、async RSC と認証フローは Playwright で担保する。Node 20 のまま一時的に進めるなら Vitest 4.1.12 + vite 6.4.4 + plugin-react 4.7.0 + happy-dom 21 / jsdom 26 + jest-dom 6.10 にする(npm 10.9 で install すること)。
- R12. F-11 の同期プログレスは、クライアントから Server Action を繰り返し呼ぶバッチループにする。1 回の呼び出しで数ページ分だけ取得・upsert し、{fetched, total, done} を返す。表示は shadcn の progress + aria-live の件数テキストとし、失敗時は alert に再連携ボタンを出す(F-14)。関数のタイムアウトに強い構成にしておく。
- R13. next dev による AGENTS.md の自動生成をどう扱うか(コミットする / agentRules:false で止める)と、create-next-app の Agent feedback を有効にするか(telemetry 前提)を、リポジトリ方針として基本設計書に明記する。

### open_questions
- Q1. 本番ホスティング(Netlify / Cloudflare + OpenNext)で、proxy.ts(Node middleware)+ @supabase/ssr の Cookie リフレッシュ + Cache Components / PPR が期待どおりに動くか。検証手順: scratchpad の next16 試作に Supabase の updateSession を組み込み、両候補へデプロイする。ログイン後のリクエストで Set-Cookie が更新されること、PPR ルートで静的シェル+ストリーミングになること、proxy のヘッダで実行ランタイムを確認する。
- Q2. shadcn init(Base UI)で生成される globals.css のダークモード定義(.dark クラス前提か)と、OS 追従だけにした場合の書き換え量。検証手順: Node 24 環境で create-next-app → npx shadcn@latest init -t next → 必要なコンポーネントを add → next build → Playwright で light / dark(emulateMedia colorScheme)のスモークテストを行う。
- Q3. ページ番号方式 + count(*) OVER() + ILIKE が、数万件規模で数百 ms(N-05)に収まるか。検証手順: ローカル Supabase に fixture 3〜5 万件を投入し、page=1 と最終ページ、ヒットが多い / 少ないクエリについて EXPLAIN (ANALYZE, BUFFERS) で計測する。pg_trgm GIN の有無でも比較する。
- Q4. Foursquare の timeZoneOffset の単位と符号(分で、東経が正。JST=540 を想定)と、一覧 API に総件数フィールドがあるか(F-11 で進捗を determinate 表示できるか)。検証手順: 実アカウントで GET /v2/users/self/checkins?limit=1&v=YYYYMMDD を取得し、JST のチェックインの timeZoneOffset と、レスポンス内の count 相当フィールドを確認する。
- Q5. next/font で Noto Sans JP を採用する場合、実データの一覧 1 ページで何スライス・何 KB を取得するか(採用判断の材料)。検証手順: fixture のチェックイン 50〜100 件を表示するページを next build && next start で起動し、DevTools の Network で woff2 の本数と転送量を計測する(キャッシュ無効、Slow 4G 相当)。
- Q6. 開発機の Node 24 への移行(nvm-windows の nvm install 24.22.0 / nvm use 24.22.0。管理者権限が必要な場合がある=推測)と、既存のグローバル npm ツールへの影響。検証手順: ユーザーのターミナルで実行し、node -v、npm -v(10.9 以上)、npx next --version を確認する。非対話シェルでは nvm list がハングしたため、エージェント側では実施していない。
- Q7. Netlify Functions の実行時間制限と、F-11 のバッチ 1 回あたりの適切な処理量(何ページ × 250 件まで安全か)。hosting テーマの結果と突き合わせ、実アカウントで 1 ページ(250 件)の取得と upsert の所要時間を計測して決める。

### artifacts
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\research\frontend.md
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\frontend-exp\next16\next.config.ts
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\frontend-exp\next16\proxy.ts
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\frontend-exp\next16\app\page.tsx
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\frontend-exp\next16\app\layout.tsx
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\frontend-exp\next16\eslint.config.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\frontend-exp\vitest4-vite6\vitest.config.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\frontend-exp\liqe\probe.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\frontend-exp\intl\probe.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\frontend-exp\intl\probe-datefns.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\frontend-exp\zod\probe.mjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\frontend-exp\scripts\measure-font-slices.ps1
