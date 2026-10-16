# 技術調査の成果物

`doc/2-1_technical investigation/2-1_technical investigation.md`(技術調査報告書)の根拠資料です。2026-10-16 に実施した机上調査とローカル実験の記録をそのまま保存しています。本番コードではありません。

| フォルダ | 内容 |
|---|---|
| `findings/` | テーマごとの所見(結論・根拠URL・確度・未確認事項)と、別エージェントによる反証チェックの結果(`verify-*.md`)。反証チェックは hosting と fsq-oauth の2テーマのみ完了 |
| `notes/` | テーマごとの詳細な調査メモ(取得したドキュメントの要点、コマンド実行結果など) |
| `spikes/` | 実アカウントで行う実地検証用のスクリプト(検証2・検証3・検証4) |
| `prototypes/` | 検索式パース(liqe)と SQL 生成の試作コード、実行結果 |
| `experiments/` | PGlite(WASM 版 PostgreSQL 18)での DB 実験、差分同期のシミュレーション、Supabase SSR の Cookie 実験 |

## 注意

- スクリプトは調査用で、依存パッケージ(`liqe`、`@electric-sql/pglite`、`@supabase/ssr` など)を別途 `npm install` しないと動きません。一部は作成時の作業ディレクトリ(一時フォルダ)のパスを前提にしています。
- 調査メモや所見に出てくる `C:\Users\...\scratchpad\...` のパスは、調査時の一時フォルダです。必要なファイルはこのフォルダに複製済みです。
- PGlite での計測値は WASM 上の参考値です。Supabase 本番の性能・ロケール・権限とは差があり得ます。

## spikes/probe.mjs の使い方(検証2・検証3)

GET だけを呼び、書き込み系の API は呼びません。トークンはファイルに保存しません。

```powershell
$env:FSQ_TOKEN = "<実アカウントの access_token>"
$env:FSQ_V = "20260801"   # 設計で固定する v の値
node spikes\probe.mjs .\probe-out
node spikes\keydiff.mjs     # 一覧と詳細のキー差分(検証3)
node spikes\map-check.mjs   # DB 列へのマッピング確認
```

取得した JSON には個人情報が含まれます。共有やシード用 fixture にする前に、必ずマスクしてください。
