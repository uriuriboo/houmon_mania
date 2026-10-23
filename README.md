# Visit_Mania(足あと検索)

Swarm(Foursquare)のチェックイン履歴を、店名・コメントなどのキーワードで AND/OR 検索する Web アプリ。

- 利用者が Foursquare 公式のデータエクスポート(ZIP)をブラウザで読み込む。
- データは**利用者のブラウザの中だけ**(IndexedDB)に保存し、検索もブラウザの中で行う。サーバーには送らない。
- ログインは無い。Foursquare API も使わない。

## 状態

MVP を実装済み(2026-10-22)。公開後に確認・更新する項目は [doc/4_maintenance/メンテナンス項目.md](doc/4_maintenance/%E3%83%A1%E3%83%B3%E3%83%86%E3%83%8A%E3%83%B3%E3%82%B9%E9%A0%85%E7%9B%AE.md)。設計資料は [doc/README.md](doc/README.md)、実装で決めたこと・基本設計からの変更点は [doc/3_detailed design/00_実装メモ.md](doc/3_detailed%20design/00_%E5%AE%9F%E8%A3%85%E3%83%A1%E3%83%A2.md)。

## Foursquare の規約との関係

| 規約 | 本アプリの対応 |
|---|---|
| API 利用ガイドライン(API で得たデータのサーバー保存の禁止など) | API を一切使わない。利用者本人が公式機能で受け取ったエクスポートを、本人の端末で読み込む |
| 消費者向け利用規約(店名などは個人的・非商用の利用許諾) | 非商用。本人のデータを本人が検索する用途に限る。運営者はデータを預からない。広告を入れない。解析は Vercel Web Analytics と Google アナリティクス 4(どちらも Cookie は保存しない設定)を、位置履歴を扱わない3ページ(トップ・このアプリについて・プライバシーポリシー)だけに入れる |
| 商標・ブランドの規定 | アプリ名・ドメインに Foursquare / Swarm / 4SQ / Check-in を含めない。ロゴ・ブランドカラーを使わない。非公式である旨と商標の免責文を全ページのフッターと「このアプリについて」に表示する。API 利用者向けの "Powered by Foursquare" ロゴは使わない(API を使わないため) |
| 第三者のデータ | 友人一覧・他人のコメント・支払い・端末情報などのファイルは展開も読み込みもしない(`checkins*.json` と `photos*.json` だけを読む) |

商用化する場合は、事前に法務確認(弁護士か Foursquare)を行うこと。

## 開発

Node.js 24(`.nvmrc`)。22.13 以上でも動く(ESLint 10 の要件)。

```bash
npm ci
npm run dev          # http://localhost:3000
npm test             # 単体テスト(Vitest)
npm run lint
npm run typecheck
npm run build        # 静的書き出し(out/)+ CSP の埋め込み
npm run preview      # out/ を本番と同じヘッダで配信(http://localhost:4173)
npm run test:e2e     # E2E(Playwright。先に build。初回は npx playwright install chromium)
npm run fixture -- --count 5000            # 架空データの疑似エクスポート(local-data/)
npm run fixture -- --count 5000 --folder   # 展開済みのフォルダとして
```

実物のエクスポート(ZIP・展開したフォルダ)には位置履歴が含まれる。リポジトリには入れない(`.gitignore` で `*.zip`・`local-data/`・`data-export-*/`・ルート直下の `data*` を除外している)。テストには架空データだけを使う。

## デプロイ(Vercel)

静的ファイルの配信だけで動く(サーバー側の処理・環境変数・秘密情報は無い)。設定は [vercel.json](vercel.json) にある。

1. Vercel でこのリポジトリをインポートする。Framework Preset は `vercel.json` の `"framework": null`(Other)が使われ、`npm run build` の出力 `out/` をそのまま配信する。
2. 次の機能は**有効にしない**(第三者のスクリプトを読み込まない方針のため。基本設計 P-7):
   - Vercel Toolbar(プレビューのデプロイに差し込まれるスクリプト。Project Settings で無効にする。有効なままだと CSP でブロックされ、コンソールにエラーが出る)
   - Speed Insights
   - Web Analytics は、アプリ側の対応(トップ・このアプリについて・プライバシーポリシーの3ページだけに入れる、[TODO](doc/TODO.md) の # 16・17)を入れた。Vercel のダッシュボードで有効にする(有効にするまで、計測のスクリプトは 404 になるだけで、害はない)
3. GitHub と Vercel のアカウントは2段階認証を必須にし、main ブランチを保護する(10.1)。PR を必須にし、CI(`.github/workflows/ci.yml`。PR のときだけ動く)が通ることをマージの条件にする。依存の更新は Dependabot(`.github/dependabot.yml`)が PR を作る。
4. Vercel のビルドの Node は、`package.json` の `engines`(22.13 以上)から選ばれる。CI は `.nvmrc`(24)を使う。
5. ドメインは公開前に決める(保存データはドメインごとに別。後から変えると利用者は読み込み直しになる。17章 D-8)。

Hobby プランは非商用の個人利用が条件で、本アプリの前提(非商用)と合う。

セキュリティヘッダ:

| 対象 | 付け方 |
|---|---|
| 画面の CSP(インラインスクリプトのハッシュ入り) | ビルド後に `scripts/inject-csp.mjs` が各 HTML に `<meta http-equiv="Content-Security-Policy">` として埋め込む(ハッシュはビルドごとに変わり、`vercel.json` はビルドの前に読まれるため) |
| `frame-ancestors`、Referrer-Policy、HSTS など | `vercel.json` |
| ワーカーのスクリプトの CSP(`/_next/static/*`) | `vercel.json`(`default-src 'none'; script-src 'self'; connect-src 'self'`) |

## 注意

- 本ソフトウェアは Foursquare・Swarm の非公式のツールで、Foursquare Labs, Inc. とは関係がない。Foursquare® および Swarm™ は Foursquare Labs, Inc. の商標。

## ライセンス

[MIT License](LICENSE)。ソフトウェアは現状のまま提供し、使用によって生じたいかなる損害についても、作者は責任を負わない。
