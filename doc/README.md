# ドキュメント一覧

Swarm(Foursquare)のチェックイン履歴を検索する Web アプリの設計資料。

利用者が Foursquare 公式のデータエクスポート(ZIP)をブラウザで読み込み、店名とコメントで AND/OR 検索する。**データは利用者のブラウザの中だけに保存し、ログインもサーバー側の DB も持たない**。Foursquare API は使わない(理由は[要件定義書](1_requirements/1_requirements%20definition.md)の0.1節)。

## 現在の状態(2026-10-16)

| フェーズ | 状態 |
|---|---|
| 要件定義 | **v2.0 に改訂済み**(方式変更を[要件定義書](1_requirements/1_requirements%20definition.md)に反映。D-1)。ログインとサーバー保存をやめた差分は、基本設計のレビューであわせて確認 |
| 技術調査 | 机上調査とローカル実験は完了。実物での確認(S-1、S-4〜S-7)は未実施。S-1 のエクスポートは 2026-10-16 に申請済み(届くまで2〜7日) |
| 基本設計 | **v2.0 レビュー待ち**(内部レビューの指摘を反映済み)。決定済み: D-1〜D-7・D-9・D-10・データの置き場所。残りの判断事項は [17章](2_basic%20design/17_%E5%88%A4%E6%96%AD%E4%BA%8B%E9%A0%85.md) の D-8(アプリ名・ドメイン。公開前に決めればよい) |
| 詳細設計 | 未着手(基本設計の承認後) |
| 実装 | 未着手 |

**エクスポートが届いたら**: メールのリンクから ZIP を早めにダウンロードし(リンクに有効期限がある場合があるため)、**このリポジトリの外**のフォルダに置いてください。実物の ZIP・JSON はリポジトリに入れません(12.2 L-05)。2026年版の実際の形式が設計上の最大の不確定要素で、届いたら S-1 の確認を行い、詳細設計の取り込み仕様を確定します。

## レビューの読む順

1. [要件定義書](1_requirements/1_requirements%20definition.md) の 0章 — 方式変更の理由と影響(10分)
2. [基本設計書 17. 判断事項](2_basic%20design/17_%E5%88%A4%E6%96%AD%E4%BA%8B%E9%A0%85.md) — 決定済みの事項と残りの判断事項(5分)
3. [基本設計書](2_basic%20design/README.md) の目次にある「読む順」に沿って本体(20〜30分)

## ファイル構成

工程ごとに1つのフォルダにまとめている。

```text
doc/
├─ README.md                          この一覧
├─ 1_requirements/                    要件定義
│  └─ 1_requirements definition.md    要件定義書 v2.0
├─ 2_basic design/                    基本設計
│  ├─ README.md                       基本設計書の目次(改訂履歴・読む順)
│  └─ 00_〜17_*.md                    各章
├─ 2-1_technical investigation/       技術調査
│  ├─ 2-1_technical investigation.md  報告書 本編(15・16章)
│  ├─ 2-1_technical investigation_API方式の記録.md  報告書 別冊(1〜14章)
│  └─ evidence/                       根拠資料(所見・調査メモ・試作コード・検証スクリプト)
├─ 3_detailed design/                 詳細設計(基本設計の承認後に作成)
└─ archive/                           旧版
   ├─ v1.0_API-sync/                  要件定義書 v1.0(API 同期方式の原本)
   ├─ v0.9_API-sync/                  基本設計書 v0.9(API 同期方式)
   └─ v1.0_server-storage/            基本設計書 v1.0・要件変更一覧 v1.0(サーバー保存方式)
```

| フォルダ・ファイル | 内容 |
|---|---|
| [1_requirements definition.md](1_requirements/1_requirements%20definition.md) | **要件定義書 v2.0**。ブラウザ内で完結する方式。変更の経緯は0章、削除した要件IDは3章の冒頭 |
| [2_basic design/](2_basic%20design/README.md) | **基本設計書 v2.0**。目次は `README.md`、本文は章ごとの18ファイル |
| [2-1_technical investigation.md](2-1_technical%20investigation/2-1_technical%20investigation.md) | 技術調査報告書 本編。エクスポートの前提(15章)、ブラウザ内で完結する方式の前提と実地検証計画(**16章**) |
| [2-1_technical investigation_API方式の記録.md](2-1_technical%20investigation/2-1_technical%20investigation_API%E6%96%B9%E5%BC%8F%E3%81%AE%E8%A8%98%E9%8C%B2.md) | 同 別冊(1〜14章)。API 方式の調査記録。9章(liqe)と12章(フロントエンド)は現行方式でも有効 |
| [evidence/](2-1_technical%20investigation/evidence/README.md) | 調査の根拠資料。所見・調査メモ・試作コード・検証スクリプト |
| [archive/](archive/) | 旧版。版ごとのフォルダに分けている |

## 章番号の読み方

基本設計書の本文にある参照は、次のとおり読む。

| 表記 | 意味 |
|---|---|
| 「9.2.4」のような番号 | 章.節。9章 = [09_方式設計.md](2_basic%20design/09_%E6%96%B9%E5%BC%8F%E8%A8%AD%E8%A8%88.md) |
| 「P-2」 | 基本方針([02_システム概要.md](2_basic%20design/02_%E3%82%B7%E3%82%B9%E3%83%86%E3%83%A0%E6%A6%82%E8%A6%81.md) の 2.3) |
| 「D-4」 | 判断事項([17_判断事項.md](2_basic%20design/17_%E5%88%A4%E6%96%AD%E4%BA%8B%E9%A0%85.md)) |
| 「S-1」〜「S-7」 | 実地検証([技術調査報告書 16.3](2-1_technical%20investigation/2-1_technical%20investigation.md))。S-2・S-3 は欠番 |
| 「報告書 11章」など | 技術調査報告書の章。1〜14章は別冊、15・16章は本編(章番号は通し) |
| 「F-10」「N-11」「L-01」 | 要件ID。内容は[要件定義書](1_requirements/1_requirements%20definition.md) |
