# swarm_search

Swarm(Foursquare)のチェックイン履歴を、店名・コメントなどのキーワードで AND/OR 検索する Web アプリ。

- 利用者が Foursquare 公式のデータエクスポート(ZIP)をブラウザで読み込む。
- データは**利用者のブラウザの中だけ**(IndexedDB)に保存し、検索もブラウザの中で行う。サーバーには送らない。
- ログインは無い。Foursquare API も使わない。

## 状態

設計中(要件定義 v2.0・基本設計 v2.0 のレビュー待ち)。実装はまだ始めていない。設計資料は [doc/README.md](doc/README.md) から読める。

## 注意

- 本ソフトウェアは Foursquare・Swarm の非公式のツールで、両社とは関係がない。
- 実物のエクスポート(ZIP・JSON)には位置履歴が含まれる。リポジトリには入れない(`.gitignore` で `*.zip` と `local-data/` を除外している)。

## ライセンス

[MIT License](LICENSE)。ソフトウェアは現状のまま提供し、使用によって生じたいかなる損害についても、作者は責任を負わない。
