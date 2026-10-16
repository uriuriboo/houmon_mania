# 調査メモ: フロントエンド技術スタックの最新状況(2026-10-16 時点)

- テーマ key: `frontend`
- 対応要件: 7章 技術スタック / F-11(同期プログレス) / F-24(日時降順・ページネーション) / F-30(一覧表示項目) / F-31(件数・該当なし表示) / F-33(詳細表示) / レスポンシブ対応
- 調査日: 2026-10-16(npm レジストリ・公式ドキュメント・公式ブログ・公式リポジトリを優先)
- 実験環境: Windows 11 / PowerShell 5.1 / **Node v20.11.1**(npm 10.2.4, V8 11.3, ICU 73.2)。実験は scratchpad 配下 `frontend-exp/` のみで実施(プロジェクトディレクトリは未変更)

---

## 0. 結論サマリ

| 項目 | 結論(推奨) |
|---|---|
| Node.js | **Node 24 LTS(現行 24.22.0)へ更新を推奨**。Node 20 は 2026-04-30 で EOL。Next.js 16.4.2 自体は 20.11.1 でも build/dev 可(実測)だが、Vitest 5・ESLint 10・jsdom 27+・jest-dom 7・shadcn CLI 等が 20.11.1 では動かない/対象外(実測・engines)。Netlify Functions の実行基盤 AWS Lambda も nodejs24.x が GA(nodejs26.x は preview、GA 予定 2026-11) |
| Next.js | **16.4.x(16.4.1 以上必須、現行 latest 16.4.2)**。2026-10-14 のセキュリティ更新(Critical×2, High×1)は 16.4.1 / 15.5.28 で修正。16.x が Active LTS |
| React | 19.3.1(Next 16.4 は React 19.3 同梱を明言) |
| React Compiler | 安定版 1.0(babel-plugin-react-compiler 1.0.0)。Next は `reactCompiler: true` で有効化(デフォルト無効)。Rust 版は experimental。MVP では「任意(後から有効化可)」 |
| TypeScript | **6.0.3 を推奨**(typescript-eslint 8.71.2 の peer が `<6.1.0`、TS 7.0 は JS API 無し)。Next 16.3+ の build は tsc CLI で型チェックするので TS7 も可だが ESLint 連携と衝突 |
| Lint | `next lint` は 16 で削除。ESLint CLI + flat config(`eslint-config-next/core-web-vitals` + `/typescript`)または Biome |
| CSS | Tailwind CSS 4.3.3(`@tailwindcss/postcss`) |
| UI | shadcn CLI 4.21.5。**2026-07 から Base UI がデフォルト**(Radix も継続サポート、`-b radix`)。必要コンポーネント(pagination, badge, card, sheet, dialog, skeleton, progress, sonner/toast, alert, dropdown-menu, select, tooltip, separator 等)は registry 上すべて存在(実測) |
| ダークモード | MVP は **OS 設定追従(CSS の prefers-color-scheme)で JS 不要**を推奨。トグルが必要なら next-themes 0.4.6(2025-03 以降リリース無し、React 19 の script 警告が未解決)を回避策付きで |
| テスト | Node 24 前提: Vitest 5.0.5 + Vite 8 + @vitejs/plugin-react 6 + RTL 16.3.3 + jsdom 30 or happy-dom 21 + jest-dom 7。Node 20.11.1 のままなら Vitest 4.1.12 + vite 6.4.4 + plugin-react 4.7.0 + happy-dom 21 / jsdom 26 + jest-dom 6.10(実測で動作)。E2E は Playwright 1.64.1 |
| 日本語フォント | **システムフォントスタック推奨**(Windows は 2025-04 の Update で Noto Sans JP が標準搭載、Apple はヒラギノ、Android は Noto Sans CJK JP)。Tailwind 既定 `--font-sans` は `-apple-system, BlinkMacSystemFont, 'Segoe UI', ...` なので日本語向けに上書き。next/font の Noto Sans JP は 124 スライス・variable 全体 約5.3MB(実測)で、使うなら `preload:false` |
| URL 状態 | `/search?q=&page=&size=`。送信は `next/form`(GET・クライアント遷移)、サーバーは `await searchParams` → zod で正規化、ページ送りは `<Link>`。nuqs 2.10.2 は「入力中の URL 同期」等が必要になった場合に採用 |
| ページネーション | 総件数表示が必須なので **ページ番号方式(LIMIT/OFFSET + 総件数)** を推奨。ORDER BY `created_at DESC, id DESC` で一意な順序を保証 |
| 日時表示 | チェックイン地の現地時刻は **サーバー側で「epoch + offset(分)を足して timeZone:'UTC' で整形」** が全環境で確実(実測)。Intl の `timeZone:'+09:00'` は Chrome 120 / Firefox 121 / Safari 17.4 / Node 22 以降のみ(Node 20.11.1 では RangeError を実測) |
| liqe | 3.8.7。**小文字 and/or は演算子にならず検索語扱い、全角スペース・全角括弧は区切り/グルーピングにならない**(実測)→ パース前に NFKC 正規化必須、演算子は大文字のみと UI で明示 |

---

## 1. バージョン一覧(`npm view` 実行結果, 2026-10-16)

| パッケージ | latest | 主な dist-tags / 備考 | engines |
|---|---|---|---|
| next | **16.4.2**(2026-10-15) | canary 16.5.0-canary.15, backport 15.5.28, next-15-3 15.3.9 | node `>=20.9.0` |
| react / react-dom | **19.3.1** | canary 19.3.0-canary-…-20261015 | - |
| babel-plugin-react-compiler | **1.0.0**(2025-10-07) | experimental 0.0.0-experimental-… | - |
| typescript | **7.0.2**(2026-07-08) | 6.x 最新 6.0.3(2026-04-16), 5.9.3, next 7.1.0-dev | `>=16.20.0` |
| @types/react / @types/react-dom | 19.3.0 / 19.3.0 | | |
| @types/node | 26.6.5 | 24 系最新 24.19.2 | |
| eslint | **10.12.0** | maintenance 9.39.5 | 10: `^20.19.0 \|\| ^22.13.0 \|\| >=24` / 9.39.5: `^18.18.0 \|\| ^20.9.0 \|\| >=21.1.0` |
| eslint-config-next | 16.4.2 | peer eslint `>=9.0.0`。deps: typescript-eslint ^8.56, eslint-plugin-react-hooks ^7.1 | |
| typescript-eslint | 8.71.2 | **peer typescript `>=4.8.4 <6.1.0`** | |
| eslint-plugin-react-hooks | 7.1.1 | | |
| @biomejs/biome | 2.5.15 | | `>=14.21.3` |
| tailwindcss / @tailwindcss/postcss | **4.3.3** | v3-lts 3.4.19 | |
| shadcn(CLI) | **4.21.5** | | `>=20.18.1` |
| @base-ui/react | 1.9.0(2026-10-09) | 1.0.0 は 2025-12-11 | peer react ^17\|\|^18\|\|^19 |
| radix-ui | 1.8.1 | | |
| cn | 0.4.0(2026-09-22) | clsx + tailwind-merge 置換(shadcn 2026-09 から採用) | |
| tw-animate-css | 1.4.0 | | |
| next-themes | **0.4.6**(最終更新 2025-03-11) | | |
| sonner | 2.0.8 | peer react ^18\|\|^19 | |
| vitest | **5.0.5**(2026-10-15) | V4 4.1.12, V3 3.2.7 | 5: `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` / 4.1.12: `^20.0.0 \|\| ^22.0.0 \|\| >=24.0.0` / 3.2.7: `^18 \|\| ^20 \|\| >=22` |
| vite | **8.3.4** | 7.3.7, 6.4.4 | 8/7: `^20.19.0 \|\| >=22.12.0` / 6.4.4: `^18 \|\| ^20 \|\| >=22` |
| @vitejs/plugin-react | 6.1.2(peer vite ^8) | 5.2.0(node ^20.19), 4.7.0(node >=14.18) | |
| @testing-library/react | 16.3.3 | peer @testing-library/dom ^10(別途インストール必須) | `>=18` |
| @testing-library/dom | 10.4.2 | | `>=18` |
| @testing-library/jest-dom | 7.0.1(2026-07) | 6 系最新 6.10.0 | 7: `>=22` / 6: `>=14` |
| @testing-library/user-event | 14.6.8 | | |
| jsdom | 30.1.3 | 26.1.0(>=18), 27/28(^20.19…), 29(^20.19 \|\| ^22.13 \|\| >=24) | 30: `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` |
| happy-dom | 21.0.3 | | `>=20.0.0` |
| @playwright/test / playwright | **1.64.1**(2026-10-14) | | `>=20`(ただし公式 System requirements は Node 22/24/26) |
| @next/playwright | 16.4.2 | `instant()` ヘルパー | |
| nuqs | **2.10.2** | peer next `>=14.2.0` | |
| liqe | **3.8.7**(最終更新 2026-06-11) | | `>=12.0` |
| zod | **4.6.7** | canary 4.5.0-canary… | |
| lucide-react | **1.57.0** | peer react ^16.5.1 \|\| … \|\| ^19 | |
| date-fns / @date-fns/tz | 4.4.0 / 1.5.0 | | |
| dayjs | 1.11.23(2026-08-17) | | |
| @opennextjs/cloudflare | 1.20.12(2026-10-15) | **peer next `>=15.5.28 <16 \|\| >=16.4.1`** | |
| @netlify/plugin-nextjs | 5.16.2(2026-10-05) | | |
| prettier | 3.9.10 | | |

---

## 2. Next.js 16.x

### 2.1 最新版・LTS・セキュリティ
- 16.0(2025-10-21)→ 16.1(2025-12-18)→ 16.2(2026-03-18)→ 16.3(2026-08-03)→ **16.4(2026-10-06)**、パッチ 16.4.1(10-14)/16.4.2(10-15)。Next.js 17 の発表は無し。
- サポートポリシー: **16.x = Active LTS、15.x = Maintenance LTS**。Maintenance は初回リリースから 2 年(15.x は 2024-10-21 リリースなので 2026-10-21 頃終了と推測)。
- 2026-10-14 セキュリティ更新(16.4.1 / 15.5.28 で修正):
  - `use cache` 関数が typed array を複数返すと未認証 RCE(Critical, GHSA-673q-mjm6-r5xr。Cache Components 利用アプリ)
  - Image Optimization API + SVG で RCE(Critical, CVE-2026-96889。sharp 0.35.5 以上で回避)
  - Server Actions を 1 つでも持つ App Router への DoS(High, GHSA-p3m5-59mp-jv5r)
  → **本アプリは Server Action を使う(F-12 等)ので 16.4.1 未満は不可**。OpenNext Cloudflare 1.20.12 も peer で `>=16.4.1` を要求。

### 2.2 Node 要件と開発機(Node 20.11.1)での実測
- Next 16 の要件: Node **20.9+**、TypeScript **5.1+**、ブラウザ Chrome/Edge/Firefox 111+, Safari 16.4+。
- Node リリース状況(nodejs/Release, nodejs.org):
  - 20.x: **EOL 2026-04-30**(最終 20.20.2)
  - 22.x: Maintenance LTS(〜2027-04-30)、最新 22.23.3
  - 24.x: Active LTS(2026-10-20 から Maintenance、EOL 2028-04-30)、最新 **24.22.0**
  - 26.x: Current(2026-10-28 に Active LTS 入り、EOL 2029-04-30)、最新 26.12.0
  - Node 27 からは年 1 回リリース・全メジャーが LTS 化
- AWS Lambda(Netlify Functions の基盤): nodejs24.x GA(廃止予定 2028-04-30)、nodejs26.x は public preview(GA 目標 2026-11)、nodejs20.x は 2026-04-30 廃止済み。
- **実測(scratchpad/frontend-exp/next16)**:
  ```
  === next build (Node v20.11.1)
  ▲ Next.js 16.4.2 (Turbopack)
  - Cache Components enabled
  - Partial Prefetching enabled
  ✓ Compiled successfully in 16.9s
    We detected TypeScript in your project and created a tsconfig.json file for you.
    Finished TypeScript in 12.6s ...
  Route (app)
  ┌ ◐ /
  └ ○ /_not-found
  ƒ Proxy (Middleware)
  ◐  (Partial Prerender)  prerendered as static HTML with dynamic server-streamed content
  exit: 0  elapsed: 39.2s
  ```
  - `next start` → `GET /?q=ラーメン&page=2` = 200、レスポンスヘッダ `x-proxy-node-version: v20.11.1`(proxy.ts 内で `process.version` を返した値 = Node ランタイムで実行されている)
  - `next dev` → `Ready in 2.0s`、初回 `GET /?q=test&page=1 200 in 7.5s (next.js: 6.4s, proxy.ts: 670ms, application-code: 378ms)`
  - **`next dev` 起動時にプロジェクト直下へ `AGENTS.md` を自動生成**(ログ: `Generated AGENTS.md for AI agents. Set agentRules: false in next.config to disable.`)。内容は「node_modules/next/dist/docs/ の同梱ドキュメントを読め」という agent 向けルールブロック。
- **Node 20.11.1 で動かないもの(実測)**:
  - Vitest 5.0.5: `SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'`(rolldown が `util.styleText` を import)
  - ESLint 10.12.0: lint 結果出力時に `TypeError: util.styleText is not a function` でクラッシュ
  - `util.styleText` は **Node v21.7.0 / v20.12.0 で追加**(Node docs の YAML メタ)。20.11.1 では `typeof util.styleText === 'undefined'` を確認
  - npm 10.2.4(Node 20.11.1 同梱)で `npm install -D vitest@4.1.12` が `npm ERR! Cannot read properties of null (reading 'edgesOut')` で失敗(2 回再現)。`npx npm@10.9.9 install` では成功 → **npm も更新推奨**(推測: vitest 4.1.12 が vite を dependencies と peerDependencies の両方に持つ構成で古い arborist が落ちる)
  - shadcn CLI 4.21.5 は engines `>=20.18.1`(`--version`/`--help` は警告付きで動作、init は未検証)
  - `nvm list` は非対話シェルでハング(nvm-windows の操作はユーザーのターミナルで行うこと)
- **推奨**: 開発機を **Node 24.22.0(LTS)** に更新し、リポジトリに `.nvmrc`(`24`)/ `package.json#engines`(`"node": ">=24 <25"` 等)を置いて Netlify の `NODE_VERSION` と一致させる。Node 26 は Lambda GA 後(2026-11 予定)に再評価。

### 2.3 proxy.ts(middleware.ts からの改名)
- v16.0.0 で `middleware` は deprecated・`proxy` に改名。関数名も `proxy`(default export 可)。codemod: `npx @next/codemod@canary middleware-to-proxy .`
- **ランタイム制約**: 「Proxy defaults to using the Node.js runtime. The `runtime` config option is not available in Proxy files. Setting the `runtime` config option in Proxy will throw an error.」/ 「The `edge` runtime is NOT supported in `proxy`… If you want to continue using the `edge` runtime, keep using `middleware`.」(middleware.ts は Edge 用に残るが deprecated)
- 設定名も改名: `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`
- **認可を proxy だけに頼らない**: 公式は「Server Functions は別ルートではなく、matcher から外れると Proxy を通らない。各 Server Function 内で認証・認可を検証せよ」と明記。→ 本アプリでは proxy は Supabase セッション Cookie のリフレッシュ+粗いリダイレクトに限定し、データアクセスの認可は RLS + 各 Server Component/Action で行う。
- matcher 無しだと `_next/static` 等にも走る。negative lookahead の matcher 推奨。`unstable_doesProxyMatch` で単体テスト可能(experimental)。
- ホスティング影響(詳細は hosting テーマ):
  - OpenNext Cloudflare: Node.js middleware(= proxy.ts)対応は PR #1309(2026-08-25 merge)で **experimental**、`nodejs_compat` 必須・ワーカーサイズ増。Next 16.3 の Node middleware が instrumentation を動的 require する問題は #1359 で修正、`@opentelemetry/api` 同梱時のビルド失敗 #1400 の報告あり。
  - Netlify: Middleware は Edge Functions で実装、Node.js Middleware の制限として「C++ Addons / Filesystem 非対応」。

### 2.4 非同期 Request API
- 16 で同期アクセスは完全削除: `cookies()` / `headers()` / `draftMode()` / `params` / `searchParams` はすべて `await` 必須。
- `npx next typegen`(15.5+)で `PageProps<'/route'>` / `LayoutProps` / `RouteContext` のグローバル型を生成。実測の page.tsx:
  ```tsx
  export default function Page(props: PageProps<'/'>) {
    return (
      <main>
        <Form action="/"><input name="q" /><button type="submit">検索</button></Form>
        <Suspense fallback={<p>読み込み中...</p>}>
          <Results searchParams={props.searchParams} />
        </Suspense>
      </main>
    )
  }
  async function Results({ searchParams }: Pick<PageProps<'/'>, 'searchParams'>) {
    const sp = await searchParams            // Promise<Record<string, string | string[] | undefined>>
    const q = typeof sp.q === 'string' ? sp.q : ''
    ...
  }
  ```
- Layout は searchParams を受け取らない(ナビゲーションで再レンダーされず stale になるため)。

### 2.5 キャッシュ(Cache Components / "use cache")
- 16.0: `cacheComponents: true` で opt-in(`experimental.dynamicIO`/`useCache`/`ppr` は削除・統合)。「caching with Cache Components is entirely opt-in. All dynamic code … is executed at request time by default」。
- **16.4(2026-10-06)で方針転換**: 「Starting with Next.js 16.4, we're excited to recommend Cache Components as the best choice for every Next.js app.」「all new apps created with create-next-app will have Cache Components enabled by default」「it will become the default in Next.js 17」。推奨設定は `cacheComponents: true` + **`partialPrefetching: true`(明示しないと警告)**。
- 有効時のルール:
  - runtime API(cookies/headers/searchParams/params)を読むコンポーネントは `<Suspense>` 内へ(外だと dev overlay に blocking-route insight、ビルドで検証)
  - `use cache` 内で cookies 等は読めない → 値を引数で渡す or `"use cache: private"`
  - **Node.js ランタイム必須、`runtime` segment config は不可**(`runtime='nodejs'` すら削除が必要)。「Other server-side JavaScript runtimes are not guaranteed to work.」
  - ナビゲーション時に React `<Activity>` で前ルートを hidden 保持(ダイアログ/ドロップダウンの状態が残る点に注意)
  - `Math.random()` / `Date.now()` 等は `connection()` + Suspense か `use cache` が必要
- **本アプリへの示唆**: 検索結果・マイページはユーザー別(RLS/Cookie 依存)なので `use cache` は使わず Suspense でストリーミング。静的シェル(ヘッダ・検索フォーム・スケルトン)だけが prerender される。実測ビルドで `/` が `◐ Partial Prerender` になることを確認。採用可否はホスティング PoC(OpenNext/Netlify での PPR・proxy 併用)の結果で最終決定。

### 2.6 Turbopack
- 16 から dev/build ともデフォルト。`--webpack` で opt-out。custom webpack 設定があると build は失敗(誤設定防止)。
- 16.1 で dev の FS キャッシュ、16.3 で build の FS キャッシュもデフォルト有効、dev メモリ最大 90% 削減。設定は top-level `turbopack`。

### 2.7 ESLint / next lint
- **`next lint` は 16 で削除、`next build` は lint しない**、next.config の `eslint` オプションも削除。codemod: `npx @next/codemod@canary next-lint-to-eslint-cli .`
- 公式推奨の flat config(実測で使用):
  ```js
  // eslint.config.mjs
  import { defineConfig, globalIgnores } from 'eslint/config'
  import nextVitals from 'eslint-config-next/core-web-vitals'
  import nextTs from 'eslint-config-next/typescript'
  export default defineConfig([...nextVitals, ...nextTs,
    globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts'])])
  ```
- eslint-config-next 16.4.0+ で ESLint 10 対応(ESLint 10 は Node `^20.19.0 / ^22.13.0 / >=24`)。一部同梱プラグインの peer が ESLint 10 未記載で警告あり。
- create-next-app は ESLint / Biome / None を選択可能。

### 2.8 typedRoutes
- 安定版(`typedRoutes: true`、`experimental.typedRoutes` ではない)。`next/link` の href と `next/navigation` の push/replace/prefetch を型検査。非リテラルは `as Route`。
- 実測: `typedRoutes: true` + Turbopack ビルドで、`` href={`/?q=${encodeURIComponent(q)}&page=${page + 1}`} `` と `href={{ pathname: '/', query: { q, page: page + 1 } }}` の両方が型チェックを通過。

### 2.9 TypeScript 6 / 7
- TS 7.0(2026-07-08 GA)は Go ネイティブ版で 8〜12 倍速だが **API 非搭載**(7.1 で新 API 予定)。公式は `@typescript/typescript6` との併用(npm alias)を案内。
- Next 16.3+: `next build` はデフォルトで **プロジェクトローカルの `tsc` CLI** で型チェック(`experimental.useTypeScriptCli`、TS 6/7 両対応)。
- typescript-eslint 8.71.2 の peer は `typescript >=4.8.4 <6.1.0`、TS7 対応要望 issue #12518 は「TS 7 API が無いので非対応」で close。
- → **TypeScript 6.0.3 に固定**が無難(実測で next build 成功)。TS 6.0 はデフォルト変更あり(`strict` true、`types` []、`module` esnext 等)なので tsconfig は明示。Next が自動生成した tsconfig は `"strict": false` だった(手動で true にする)。

### 2.10 その他の破壊的変更(MVP に関係しそうなもの)
- next/image: `minimumCacheTTL` 既定 60s→4h、`qualities` 既定 [75]、ローカル IP 最適化はデフォルト禁止、リダイレクト最大 3。
- `revalidateTag(tag)` 単引数は deprecated(`revalidateTag(tag, 'max')` か Server Action 内 `updateTag`)。`refresh()` 新設。
- 並列ルートは `default.js` 必須。`next dev` と `next build` の出力ディレクトリ分離(`.next/dev`)。
- create-next-app の推奨デフォルト: TypeScript, ESLint, React Compiler なし, Tailwind, App Router, Cache Components, AGENTS.md, **Agent feedback(telemetry 必須の実験機能、不要なら無効化)**。

---

## 3. React 19.3 / React Compiler

- React 19.3(2026-09-09 ブログ): `<ViewTransition>` と Fragment Refs が安定化、`react-dom` の `browser()`(SSR から外す)、Trusted Types 対応、Server Component から Context を直接レンダー可。明示的な breaking change の記載なし(StrictMode での hydration 時 Effect 二重実行などの挙動変更あり)。
- React Compiler: 1.0 安定版(2025-10-07)。「New apps should use React Compiler」。React 17+ 対応。lint は `eslint-plugin-react-hooks` の `recommended` に統合(eslint-config-next 16.4.2 は react-hooks ^7.1 を同梱)。
- Next.js: `reactCompiler: true`(16.0 で stable、**デフォルト無効**、Babel 経由のためビルドが遅くなる。Next は SWC で対象ファイルを絞る最適化あり)。`reactCompiler: { compilationMode: 'annotation' }` で `'use memo'` opt-in も可。`babel-plugin-react-compiler` を devDependency に(公式は exact pin 推奨)。
- Rust 版: `experimental.turbopackRustReactCompiler: true`(16.3 で導入、16.4 で高速化)。Babel プラグイン不要だが experimental。
- **推奨**: MVP は「有効化しても良いが必須ではない」。有効化する場合は `reactCompiler: true` + `babel-plugin-react-compiler@1.0.0` 固定。Rust 版は GA 待ち。

---

## 4. Tailwind CSS v4 / shadcn/ui / ダークモード

### 4.1 Tailwind CSS
- 4.3.3 が latest。4.2(新パレット mauve/olive/mist/taupe、`@tailwindcss/webpack`、論理プロパティ)、4.3(2026-05-08: scrollbar ユーティリティ、`@container-size`、`zoom-*`、`tab-*` 等)。`start-*`/`end-*` は deprecated → `inset-s-*`/`inset-e-*`。
- 2026-09-09「Tailwind Labs is joining Shopify」: OSS は MIT のまま、既存チームが保守継続。
- Next.js への導入: `npm i tailwindcss @tailwindcss/postcss postcss`、`postcss.config.mjs` に `"@tailwindcss/postcss": {}`、`globals.css` に `@import "tailwindcss";`(create-next-app のデフォルトで構成済み)。
- ブラウザ要件: Chrome 111 / Safari 16.4 / Firefox 128(Next 16 の要件とほぼ同じ)。Sass 等プリプロセッサ併用は非推奨。
- ブレークポイント(mobile-first): sm 40rem(640px), md 48rem, lg 64rem, xl 80rem, 2xl 96rem。`@container` + `@sm:`/`@md:` でコンテナクエリ。
- **既定フォントスタック(4.3.3 の theme.css を実測)**:
  ```css
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial,
    sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
  ```
  → 日本語 UI では欧文が Segoe UI/Roboto、和文がフォールバックになる。5 章の通り上書きを推奨。

### 4.2 shadcn/ui(CLI 4.21.5)
- 主な変遷: 2025-02 Tailwind v4 対応(OKLCH、`tw-animate-css`、forwardRef 除去、data-slot)/ 2025-08 CLI 3.0 + MCP / 2025-12 `npx shadcn create` / 2026-03 CLI v4 / **2026-07 Base UI がデフォルト**(Radix は非推奨化されず継続サポート、`-b radix` で選択)/ 2026-07 React Aria 対応・Base UI 版 Toast / 2026-09 `cn` パッケージ(clsx+tailwind-merge 置換、`migrate cn` あり)/ 2026-10 Trace・Code Block・AI Elements。
- `init --help`(実測):
  ```
  Usage: shadcn init|create [options] [components...]
    -t, --template <template>  (next, start, vite, react-router, laravel, astro)
    -b, --base <base>          the component library to use. (base, radix, aria)
    -p, --preset [name]        use a preset configuration
    -d, --defaults             use default configuration: --template=next --preset=base-nova
    --rtl / --pointer / --css-variables ...
  ```
  - 新規: `npx shadcn@latest init -t next`(既定 Base UI)、Radix 希望なら `-b radix`。既存 Next プロジェクトなら `npx shadcn@latest init` → `npx shadcn@latest add pagination badge card ...`
- registry 実測(`https://ui.shadcn.com/r/styles/<style>/registry.json`):
  - base-nova: ui 65 件。pagination, badge, card, sheet, dialog, skeleton, progress, **sonner, toast**, alert, alert-dialog, dropdown-menu, select, native-select, tooltip, separator, spinner, empty, input-group, field, table, button, input すべて存在
  - radix-nova: ui 64 件。上記のうち **toast のみ無し**(sonner はあり)
  - init(base-nova)の依存: `class-variance-authority, cn, lucide-react, @base-ui/react`、dev: `tw-animate-css, shadcn`。CSS は `@import "tw-animate-css"; @import "shadcn/tailwind.css";`
  - 各コンポーネントの依存: ほぼ `cn` のみ(+ registryDeps `button`)。**sonner コンポーネントは `sonner` と `next-themes` に依存**(`useTheme()` で theme を渡す実装)。Base UI の `toast` は `cn, @base-ui/react` のみ。
- React 19 / Next 16 / Tailwind v4 対応は現行 CLI の前提(Tailwind v4 ページ、Next インストールページ)。
- **推奨**: 新規なので Base UI デフォルトに乗る。トースト通知は Base UI の `toast` を使えば next-themes 依存を避けられる。Radix を選ぶ場合は sonner。

### 4.3 ダークモード
- shadcn 公式の Next 手順: `next-themes` の ThemeProvider(`attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange`)+ `<html suppressHydrationWarning>`。
- **next-themes の状況**: 最新 0.4.6 は 2025-03-11 から更新無し。React 19 で「Encountered a script tag while rendering React component」警告(next-themes #387、2026-03-24 open、メンテナ応答無し / shadcn #10104、2026-03-19 open)。回避策は `scriptProps={{ type: 'application/json' }}` 等のハック、またはフォーク(@teispace/next-themes, @wrksz/themes)。
- Tailwind v4 の `dark:` は**既定で `prefers-color-scheme` メディアクエリ**。手動トグルは `@custom-variant dark (&:where(.dark, .dark *));` で class 方式に切替。
- **推奨**: 要件にトグルは無いので MVP は OS 設定追従のみ(JS・next-themes 不要、FOUC 無し)。shadcn の生成 CSS が `.dark` クラス前提の場合は、`.dark { … }` の変数ブロックを `@media (prefers-color-scheme: dark) { :root { … } }` に移す/dark variant を media に戻す(init 実地確認が必要)。トグルを入れる段階で next-themes(回避策付き)か代替を選定。

---

## 5. 日本語フォント

### 5.1 OS 標準フォントの現状
- **Windows**: 2025-04 の Windows Update で Noto Sans JP(Win10/11)と Noto Serif JP(Win11)が標準搭載(7 ウェイト、`NotoSansJP-VF.ttf`)。Win11 の Chrome/Edge は既定の `sans-serif` が Noto Sans JP に(ICS MEDIA 2025-07-18)。
- **Apple**: Noto 日本語は未搭載、ヒラギノ(Hiragino Sans / Hiragino Kaku Gothic ProN)。Safari は `local()` 参照を遮断。
- **Android**: Noto Sans CJK JP(Android 15 から可変)。`"Noto Sans JP"` 名指定は効かないので `sans-serif` フォールバックに任せる。
- ICS MEDIA は日本語サイトで `system-ui` を避けるよう推奨(Windows で游ゴシック UI が当たるため)。

### 5.2 next/font/google + Noto Sans JP の実測
- next/font の font-data.json: `Noto Sans JP` は weights 100〜900 + variable、**subsets は `cyrillic, latin, latin-ext, vietnamese` のみ**(日本語用の名前付き subset は無い)。
- Google Fonts CSS2 API の実測(Chrome UA): Noto Sans JP は **124 個の @font-face(番号付きスライス 120 + 名前付き 4)**、unicode-range で必要なスライスだけ取得される。
  - `wght@400`(静的 1 ウェイト): 124 ファイル、合計 **約 2,867KB**、最大 47.9KB、latin スライス 12.8KB
  - `wght@100..900`(可変): next build 後の `.next/static/media` に woff2 **124 個・合計 約 5,342KB**(最大 90.5KB / 最小 8.0KB)、CSS 1 本(@font-face 125 = 124 + `Noto Sans JP Fallback`)約 93KB
- 実測の生成 CSS: `@font-face{font-family:Noto Sans JP;…;font-display:swap;src:url(../media/…woff2)format("woff2");unicode-range:…}`。`local()` は Fallback 用の `local(Arial)` の 1 件のみ → **OS に Noto Sans JP があっても Web フォントがダウンロードされる**。
- `preload:false` + subsets 無指定でビルド警告なし、HTML に font preload link は 0 件(実測)。`preload:true`(既定)で subsets 未指定だと警告。
- チェックインの店名は固有名詞の漢字が多く、1 ページで多数のスライスを跨ぐ可能性(推測、実データで要計測)。

### 5.3 推奨
- **システムフォントスタック**(Web フォント無し)を推奨。例:
  ```css
  @theme {
    --font-sans: "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Noto Sans CJK JP",
      Meiryo, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  }
  ```
  (`system-ui` / `-apple-system` を先頭にしない。Meiryo は Noto 未導入の古い Windows 向け保険。数字の桁揃えが必要な箇所は `tabular-nums`)
- 見た目を全 OS で揃えたい場合のみ next/font: `Noto_Sans_JP({ preload: false, display: 'swap', weight: ['400','700'], variable: '--font-noto-sans-jp' })`(可変全域は避ける)。

---

## 6. テスト

### 6.1 実測結果(Node v20.11.1)
| 構成 | 結果 |
|---|---|
| vitest@5.0.5(peer で vite 8.3.4 / rolldown 1.2.14) | **起動失敗**: `does not provide an export named 'styleText'` |
| vitest@4.1.12 を npm 10.2.4 で install | **install 失敗**: `npm ERR! Cannot read properties of null (reading 'edgesOut')`(2 回) |
| vitest@4.1.12 を `npx npm@10.9.9 install`(vite 6.4.4 が解決された) | **成功** `Test Files 1 passed` |
| vitest@4.1.12 + vite@6.4.4 + @vitejs/plugin-react@4.7.0 + RTL 16.3.3 + @testing-library/dom 10.4.2 + react 19.3.1 + happy-dom 21.0.3 / jsdom 26.1.0 | **成功** `Test Files 2 passed (2)`(happy-dom と `// @vitest-environment jsdom` の両方) |
| vitest@3.2.7(vite 6.4.4) | **成功** |

### 6.2 推奨構成
- **Node 24 前提(推奨)**: `vitest@5` + `vite@8`(`resolve.tsconfigPaths: true` で vite-tsconfig-paths 不要。Vitest で効かなかった問題は Vite 8.0.x 系で修正済みとの報告)+ `@vitejs/plugin-react@6` + `@testing-library/react@16.3.3` + `@testing-library/dom@10` + `@testing-library/jest-dom@7`(`/vitest` エントリあり)+ `jsdom@30`(Node ^24.15 以上)or `happy-dom@21`。
  - Vitest 5 の主な変更: Node ≥22.12 & Vite ≥6.4 必須、`clearMocks` 既定 true、未 await の `resolves/rejects` は失敗扱い、locator は exact 既定、`bench` API 変更、レポーター出力は `.vitest/` へ。
- **Node 20.11.1 のまま進める場合(暫定)**: `vitest@4.1.12` + `vite@6.4.4` + `@vitejs/plugin-react@4.7.0` + `happy-dom@21` or `jsdom@26.1.0` + `@testing-library/jest-dom@6.10.0`、npm は 10.9 系で install。
- Next 公式: Vitest は **async Server Components 非対応** → それらは E2E で。公式手順のパッケージ: `vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom vite-tsconfig-paths`。
- **Playwright 1.64.1**: 公式 System requirements は「Node.js latest 22.x, 24.x or 26.x」「Windows 11+」。`npm init playwright@latest`。Next 16.3+ は `@next/playwright` の `instant()` ヘルパー(Instant Navigation の回帰テスト)を提供。
- テスト対象の切り分け案: 純関数(liqe AST→SQL 変換、searchParams 正規化、日時整形)= Vitest(node 環境)/ クライアント UI(ページネーション、検索フォーム)= Vitest + RTL / RSC を含む画面・認証フロー = Playwright。

---

## 7. URL 検索パラメータとページネーション

### 7.1 URL 設計
- `/search?q=<クエリ>&page=<1..>&size=<20|50|100>`(ブックマーク・共有・SSR・解析に有利 = Next 公式 Learn の理由付け)。
- 送信: **`next/form`(`<Form action="/search">`)**: string action は GET でクエリを URL に積み、表示時に loading UI を prefetch、クライアント遷移、JS 無しでも動作(progressive enhancement)。`replace`/`scroll`/`prefetch` props。`useFormStatus` で送信中表示。
- サーバー: page の `searchParams`(Promise)を `await` → zod で正規化 → 検索 RPC。Cache Components 有効時は結果部分を `<Suspense key={q+page+size}>` で包む(Learn の `key` パターンで遷移時にスケルトン再表示)。
- ページ送り: サーバーで href を生成し `<Link>`(`URLSearchParams` で q/size を保持して page のみ変更)。q 変更時は page=1 にリセット。
- **nuqs 2.10.2**: 型付き URL state。サーバーは `createLoader`(2.3+)/`createSearchParamsCache`、クライアントは `useQueryState(s)`。既定は shallow(サーバー再レンダー無し)なので RSC で検索する場合は `shallow: false`(+`startTransition` でローディング表示)。`throttleMs` は 2.5 で deprecated → `limitUrlUpdates`(debounce/throttle)。`clearOnDefault` 既定 true。**MVP は明示送信型の検索なので必須ではない**(インクリメンタル検索や複数フィルタを入れる時に採用)。
- 参考: Next issue #99512(cacheComponents 有効時、client page の `use(searchParams)` が `history.replaceState` のたびに suspend し入力フォーカスを失う。nuqs も該当)は **2026-10-03 に PR #99611 で修正**(16.4 系で取り込み済みと推測)。

### 7.2 zod v4 による正規化(実測)
```js
import * as z from 'zod'
const first = (v) => (Array.isArray(v) ? v[0] : v)
export const searchParamsSchema = z.object({
  q: z.preprocess(first, z.string().trim().max(200)).catch(''),
  page: z.preprocess(first, z.coerce.number().int().min(1).max(10000)).catch(1),
  size: z.preprocess(first, z.coerce.number().pipe(z.literal([20, 50, 100]))).catch(20),
})
```
実行結果(zod 4.6.7):
```
{} => {"q":"","page":1,"size":20}
{"q":" ラーメン OR 蕎麦 ","page":"3","size":"50"} => {"q":"ラーメン OR 蕎麦","page":3,"size":50}
{"q":["a","b"],"page":["2","9"],"size":"30"} => {"q":"a","page":2,"size":20}
{"page":"abc","size":"1000"} => {"q":"","page":1,"size":20}
{"page":"0"} / {"page":"1.5"} => page 1
{"q":"x"*300} => q ""   ← 長すぎる q は catch で空になる。実装では safeParse してエラー表示にする方が親切
clampPage(99, 123, 20) = 7
```

### 7.3 ページ番号方式 vs キーセット方式(総件数表示が前提)
| 観点 | ページ番号(LIMIT/OFFSET + 総件数) | キーセット(seek) |
|---|---|---|
| 任意ページへのジャンプ / 「全 N 件中 x–y 件」表示 | ◎ | ✕(前後移動のみ。総件数は別クエリが必要) |
| 深いページの性能 | OFFSET 分の行も計算される(PostgreSQL 公式: 「The rows skipped by an OFFSET clause still have to be computed inside the server」) | ◎ |
| 同期でデータが増えた時のズレ | 先頭に新着が入ると 1 件ずれる | ◎ ずれない |
| 実装・URL | `?page=3` で単純 | カーソル(created_at,id)を URL に持つ |
- 本アプリでは ILIKE(先頭 % )の性質上、総件数のためにユーザーの該当行は結局すべて評価するので、OFFSET の追加コストは相対的に小さい(推測。N-05 の数万件規模で要計測)。
- **推奨**: ページ番号方式。`ORDER BY created_at DESC, id DESC`(PostgreSQL 公式: LIMIT 使用時は一意な順序の ORDER BY が必須)、総件数は `count(*) OVER()` か別 count クエリ(supabase-js の count は `exact`=COUNT(*)、`planned`=統計による概算、`estimated`=小さい時 exact/大きい時 planned)。page 上限は `ceil(total/size)` で丸める。将来「もっと見る」UI にする場合はキーセットを追加。

---

## 8. 周辺ライブラリ

### 8.1 liqe 3.8.7(実測: frontend-exp/liqe/probe.mjs)
README 上は趣味プロジェクト扱い(「a hobby/intellectual exercise」)、最終リリース 2026-06。AST は公開 API。
```
"A OR (B AND C)"          => {op:OR, left:Tag A, right:{paren:{op:AND, B, C}}}
"ラーメン 渋谷"            => {op:AND, ラーメン, 渋谷}            ← 暗黙 AND
"ラーメン and 渋谷"        => {op:AND,{op:AND, ラーメン, "and"}, 渋谷}  ← 小文字 and は検索語扱い
"ラーメン or 渋谷"         => {op:AND,{op:AND, ラーメン, "or"}, 渋谷}   ← 小文字 or も検索語扱い
"ラーメン　渋谷"(全角SP)  => Tag "ラーメン　渋谷"(1語)         ← 全角スペースは区切りにならない
"（ラーメン OR 蕎麦） AND 渋谷" => 括弧として認識されず "（ラーメン" "蕎麦）" が語になる
"\"東京 駅\""              => Tag "東京 駅" quoted:true
"venue:スタバ"             => Tag field=venue op=":"             ← F-26 で弾く対象
"count:>10"                => Tag field=count op=":>" value=10(number)
"NOT ラーメン" / "-ラーメン" => UnaryOperator(NOT / -)          ← 要件は AND/OR/括弧のみ。扱いを決める
"ラー*"                    => Literal "ラー*"(ワイルドカード文字を含む)
"/ラー.+/"                 => RegexExpression                   ← 弾く対象
"A OR"                     => Error "Found no parsings."
""                         => EmptyExpression
"A || B" / "A && B"        => SyntaxError "Syntax error at line 1 column 3"
--- NFKC 正規化後
"ラーメン 渋谷" => AND / "(ラーメン OR 蕎麦) AND 渋谷" => 正しく括弧 / "RAMEN OR ラーメン" => OR
```
- 示唆: **パース前に `q.normalize('NFKC')`**(全角スペース→半角、全角括弧/英数→半角)。演算子は大文字 AND/OR のみと UI(プレースホルダ・ヘルプ)で明示するか、サーバー側で「単独トークンの and/or」を大文字化する前処理を設計で決める。liqe のエラーメッセージは英語・不親切なので日本語メッセージに変換して表示。

### 8.2 zod 4.6.7
- `import * as z from "zod"`(v4 が標準)、軽量版 `zod/mini`。エラー指定は `error` パラメータに統一(`message` は deprecated)、`z.email()` 等トップレベル化、`z.literal([...])` で複数値、`z.prettifyError()`、`z.toJSONSchema()`。v3 比で parse 6〜14 倍高速(公式ベンチ)。

### 8.3 lucide-react 1.57.0
- Lucide v1(2026 前半): **ブランドアイコン削除**(Simple Icons 推奨)、**`aria-hidden` 既定 true**(意味を持つアイコンには `aria-label`/`title`)、UMD 廃止(ESM/CJS)、`LucideProvider` で既定 size/color/strokeWidth。
- 1.0.1 で RSC 非互換(モジュールレベル `createContext()`)の不具合 #4200 → **1.7.0 で解決**(2026-03-27 close)。現行 1.57.0 は問題なし(推測: 以降の回帰報告は未確認)。

### 8.4 日時表示(timeZoneOffset[分] を考慮した現地時刻)
実測(frontend-exp/intl/probe.mjs, Node 20.11.1):
```
{"createdAt":1792067696,"timeZoneOffset":540}
 method1(shift+UTC): 2026/10/15(木) 21:34 (UTC+09:00)
 method2(offset tz): ERROR RangeError: Invalid time zone specified: +09:00
 method3(Etc/GMT):  2026/10/15(木) 21:34 [Etc/GMT-9]
{"createdAt":1782874800,"timeZoneOffset":-240}
 method1(shift+UTC): 2026/06/30(火) 23:00 (UTC-04:00)
{"createdAt":1767225600,"timeZoneOffset":330}
 method1(shift+UTC): 2026/01/01(木) 05:30 (UTC+05:30)
 method3(Etc/GMT):  N/A (Etc/GMT は時間単位のみ)
RelativeTimeFormat: 昨日 / 3 時間前 / 2 か月前
```
date-fns v4 + @date-fns/tz(frontend-exp/intl/probe-datefns.mjs, Node 20.11.1):
```
{"createdAt":1792067696,"timeZoneOffset":540} => 2026/10/15(木) 21:34 +09:00
{"createdAt":1782874800,"timeZoneOffset":-240} => 2026/06/30(火) 23:00 -04:00
{"createdAt":1767225600,"timeZoneOffset":330} => 2026/01/01(木) 05:30 +05:30
{"createdAt":1767225600,"timeZoneOffset":345} => 2026/01/01(木) 05:45 +05:45
```
- Intl の `timeZone` にオフセット文字列(`"+01:00"` 等)を渡す機能の対応(MDN browser-compat-data `utc_offset`): **Chrome 120 / Edge(mirror) / Firefox 121 / Safari 17.4 / iOS Safari(mirror) / Node 22.0.0 / Deno 1.38**。Next 16 の対象ブラウザ(Chrome 111 / Safari 16.4)を全ては満たさない。
- `Etc/GMT±N` は符号が逆・分単位不可。
- **推奨実装(依存ゼロ・全環境で同一結果)**:
  ```ts
  // lib/format-checkin-time.ts(サーバー側=RSC で文字列化して渡す)
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  export function formatCheckinLocalTime(createdAtSec: number, tzOffsetMin: number) {
    const local = new Date((createdAtSec + tzOffsetMin * 60) * 1000) // 「現地の壁時計」を UTC として表現
    const sign = tzOffsetMin >= 0 ? '+' : '-'
    const a = Math.abs(tzOffsetMin)
    const off = `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
    return { text: fmt.format(local), offset: `UTC${off}` }
  }
  ```
  `<time dateTime={ISO8601 with offset}>` で機械可読値も付与。RSC で整形すればハイドレーション差異も起きない。date-fns 4.4 + @date-fns/tz の `TZDate(ms, "+09:00")` も可(TZDateMini は約 1KB)。dayjs は不要。

---

## 9. F-11 同期プログレス表示の実装方針(案)
- UI: shadcn `progress`(determinate)+ 件数テキスト(`aria-live="polite"`)、失敗時は `alert` + 再連携ボタン(F-14)、完了時に toast。
- 方式案(推測を含む。サーバーレスの実行時間制限は hosting テーマで確認):
  1. **クライアント駆動のバッチループ**: Client Component が Server Action `syncNextBatch()` を繰り返し呼び、各呼び出しは数ページ(例: 250 件 × n)だけ取得・upsert して `{fetched, total?, done}` を返す。1 リクエストが短く関数タイムアウトに強い。進捗は戻り値でそのまま描画。
  2. 同期ジョブ行(sync_status テーブル)を更新し、クライアントはポーリング or Supabase Realtime で購読。
- total が分かれば determinate(Foursquare 一覧レスポンスの総件数フィールドの有無は API テーマで確認)、無ければ indeterminate + 取得件数表示。

---

## 10. 推奨構成(叩き台)

```jsonc
// package.json(抜粋・叩き台)
{
  "engines": { "node": ">=24 <25" },
  "dependencies": {
    "next": "16.4.2", "react": "19.3.1", "react-dom": "19.3.1",
    "zod": "^4.6.7", "liqe": "3.8.7", "lucide-react": "^1.57.0",
    "@base-ui/react": "^1.9.0", "class-variance-authority": "^0.7.1", "cn": "^0.4.0"   // shadcn init が追加
  },
  "devDependencies": {
    "typescript": "6.0.3", "@types/react": "19.3.0", "@types/react-dom": "19.3.0", "@types/node": "^24",
    "tailwindcss": "^4.3.3", "@tailwindcss/postcss": "^4.3.3", "tw-animate-css": "^1.4.0",
    "eslint": "^10.12.0", "eslint-config-next": "16.4.2",
    "vitest": "^5.0.5", "@vitejs/plugin-react": "^6.1.2", "jsdom": "^30.1.3",
    "@testing-library/react": "^16.3.3", "@testing-library/dom": "^10.4.2", "@testing-library/jest-dom": "^7.0.1",
    "@playwright/test": "^1.64.1"
    // React Compiler を使う場合: "babel-plugin-react-compiler": "1.0.0"
  }
}
```
```ts
// next.config.ts(叩き台)
import type { NextConfig } from 'next'
const nextConfig: NextConfig = {
  cacheComponents: true,     // ホスティング PoC で問題があれば false
  partialPrefetching: true,  // cacheComponents 有効時は明示必須(未設定は警告)
  typedRoutes: true,
  // reactCompiler: true,
  // agentRules: false,      // next dev による AGENTS.md 自動生成を止めたい場合
}
export default nextConfig
```

---

## 11. 未確定事項(実地検証が必要)
1. ホスティング上での proxy.ts(Node middleware)+ Supabase SSR Cookie リフレッシュ + Cache Components/PPR の動作(Netlify は Edge Functions 実装・FS 不可、OpenNext Cloudflare は experimental)。
   - 手順: 本メモの next16 試作に `@supabase/ssr` の updateSession を入れた最小アプリを両候補にデプロイ → ログイン後に proxy で Set-Cookie が返るか、PPR ルートの静的シェル+ストリーミング、`x-proxy-…` ヘッダで実行ランタイムを確認。
2. shadcn init 後の `globals.css`(dark variant 定義、Base UI/Radix 差)と React Compiler 有効時の全コンポーネント動作。
   - 手順: Node 24 環境で `npx create-next-app@latest` → `npx shadcn@latest init -t next` → 必要コンポーネントを add → `next build` と Playwright でスモーク。
3. 実データでの Noto Sans JP スライス取得数(next/font を採用する場合のみ)。
   - 手順: fixture のチェックイン 100 件を表示するページで DevTools Network の woff2 本数/転送量を計測。
4. ページ番号方式 + `count(*) OVER()` の応答時間(N-05)。
   - 手順: ローカル Supabase に 3〜5 万件の fixture を投入し、`EXPLAIN ANALYZE` で page=1 / page=末尾、ヒット多/少のクエリを計測。
5. Foursquare `timeZoneOffset` の符号・単位(分、東経が正と想定)と一覧 API の総件数フィールドの有無。
   - 手順: 実アカウントで `/v2/users/self/checkins?limit=1` を取得し JST のチェックインで `timeZoneOffset` が 540 であること、総件数フィールドを確認。
6. 開発機の Node 24 移行(nvm-windows の `nvm install 24.22.0` / `nvm use 24.22.0` はユーザーのターミナルで実行。管理者権限が必要になる場合あり=推測)。

---

## 12. 出典
- npm レジストリ(`npm view <pkg> version / dist-tags / engines / peerDependencies / time`)2026-10-16 実行
- Next.js Blog 一覧 https://nextjs.org/blog
- Next.js 16 https://nextjs.org/blog/next-16
- Next.js 16.3 https://nextjs.org/blog/next-16-3
- Next.js 16.4 https://nextjs.org/blog/next-16-4
- Security update 2026-10-14 https://nextjs.org/blog/nextjs-security-update-october-14-2026
- Support policy https://nextjs.org/support-policy
- Upgrade to v16 https://nextjs.org/docs/app/guides/upgrading/version-16
- proxy.js https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- cacheComponents https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents
- Caching https://nextjs.org/docs/app/getting-started/caching
- ESLint https://nextjs.org/docs/app/api-reference/config/eslint
- TypeScript https://nextjs.org/docs/app/api-reference/config/typescript
- useTypeScriptCli https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli
- typedRoutes https://nextjs.org/docs/app/api-reference/config/next-config-js/typedRoutes
- reactCompiler https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler
- turbopackRustReactCompiler https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackRustReactCompiler
- create-next-app https://nextjs.org/docs/app/api-reference/cli/create-next-app
- Font https://nextjs.org/docs/app/api-reference/components/font
- Form https://nextjs.org/docs/app/api-reference/components/form
- useSearchParams https://nextjs.org/docs/app/api-reference/functions/use-search-params
- Vitest guide https://nextjs.org/docs/app/guides/testing/vitest
- Learn: search & pagination https://nextjs.org/learn/dashboard-app/adding-search-and-pagination
- Next issue #99512 https://github.com/vercel/next.js/issues/99512
- Node release schedule https://github.com/nodejs/Release / https://nodejs.org/en/about/previous-releases
- Node util.styleText メタ https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/util.md
- AWS Lambda runtimes https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
- React 19.3 https://react.dev/blog/2026/09/09/react-19-3
- React Compiler 1.0 https://react.dev/blog/2025/10/07/react-compiler-1
- React Compiler install https://react.dev/learn/react-compiler/installation
- TypeScript 7.0 https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- TypeScript 6.0 https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- typescript-eslint #12518 https://github.com/typescript-eslint/typescript-eslint/issues/12518
- Tailwind blog https://tailwindcss.com/blog / v4.3 https://tailwindcss.com/blog/tailwindcss-v4-3 / Shopify https://tailwindcss.com/blog/tailwind-is-joining-shopify
- Tailwind Next.js install https://tailwindcss.com/docs/installation/framework-guides/nextjs
- Tailwind compatibility https://tailwindcss.com/docs/compatibility / dark mode https://tailwindcss.com/docs/dark-mode / responsive https://tailwindcss.com/docs/responsive-design / font-family https://tailwindcss.com/docs/font-family
- Tailwind theme.css 4.3.3 https://unpkg.com/tailwindcss@4.3.3/theme.css
- shadcn changelog https://ui.shadcn.com/docs/changelog / Base UI default https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default / Toast https://ui.shadcn.com/docs/changelog/2026-07-toast
- shadcn Next install https://ui.shadcn.com/docs/installation/next / components https://ui.shadcn.com/docs/components / dark mode https://ui.shadcn.com/docs/dark-mode/next / Tailwind v4 https://ui.shadcn.com/docs/tailwind-v4
- shadcn registry https://ui.shadcn.com/r/styles/base-nova/registry.json , https://ui.shadcn.com/r/styles/radix-nova/registry.json
- next-themes https://github.com/pacocoursey/next-themes / #387 https://github.com/pacocoursey/next-themes/issues/387 / shadcn #10104 https://github.com/shadcn-ui/ui/issues/10104
- Vitest blog https://vitest.dev/blog/ / Vitest 5 https://vitest.dev/blog/vitest-5
- Vite 8 tsconfigPaths(Vitest issue)https://github.com/vitest-dev/vitest/issues/10054
- Playwright intro https://playwright.dev/docs/intro
- ICS MEDIA Noto Sans JP 実装ガイド https://ics.media/entry/250718/
- nuqs https://nuqs.dev/docs/server-side , https://nuqs.dev/docs/options , https://nuqs.dev/docs/adapters
- PostgreSQL LIMIT/OFFSET https://www.postgresql.org/docs/current/queries-limit.html
- Use The Index, Luke (no-offset) https://use-the-index-luke.com/no-offset
- supabase-js count オプション(postgrest-js doc コメント)https://supabase.github.io/postgrest-js/v1/classes/_lib_postgrestquerybuilder_.postgrestquerybuilder.html
- liqe https://github.com/gajus/liqe
- zod v4 https://zod.dev/v4
- Lucide v1 https://lucide.dev/guide/version-1 / #4200 https://github.com/lucide-icons/lucide/issues/4200
- date-fns v4 https://blog.date-fns.org/v40-with-time-zone-support/ / @date-fns/tz https://github.com/date-fns/tz
- MDN DateTimeFormat https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat / BCD https://raw.githubusercontent.com/mdn/browser-compat-data/main/javascript/builtins/Intl/DateTimeFormat.json
- OpenNext Cloudflare https://opennext.js.org/cloudflare / PR #1309 https://github.com/opennextjs/opennextjs-cloudflare/pull/1309
- Netlify Next.js https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/ / Node version https://docs.netlify.com/build/configure-builds/manage-dependencies/

## 13. 実験ファイル(scratchpad/frontend-exp)
- `next16/`(next.config.ts, proxy.ts, app/layout.tsx[Noto_Sans_JP preload:false], app/page.tsx[searchParams+Suspense+next/form+typedRoutes], eslint.config.mjs)
- `vitest5/`, `vitest4/`, `vitest3/`, `vitest4-vite6/`(RTL + happy-dom/jsdom)
- `liqe/probe.mjs`, `intl/probe.mjs`, `intl/probe-datefns.mjs`, `zod/probe.mjs`
- `fonts-dl/`(Google Fonts CSS 取得物), `scripts/measure-font-slices.ps1`
