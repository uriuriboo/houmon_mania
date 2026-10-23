/**
 * 非公式である旨と商標の免責文(1章、報告書 2.2・15.1)。
 *
 * - 商標規定により、Foursquare® / Swarm™ / 4SQ® / Check-in™ をアプリ名・ドメインに含めない
 * - Foursquare・Swarm のロゴやブランドカラーは使わない。提携・推奨を示唆しない
 * - 本アプリは Foursquare API を使わないため、API 利用者向けの "Powered by Foursquare" 表示・ロゴは使わない
 *   (ロゴの使用許諾は API 利用者向けのものであり、API を使わない本アプリが使うと、提携を示唆するおそれがある)
 * - 消費者向け利用規約上、店名などは「個人的・非商用」の利用許諾にとどまるため、非商用で、本人のデータを本人が検索する用途に限る
 */
export const UNOFFICIAL_NOTICE =
  '本アプリは個人が作成した非公式のツールで、Foursquare Labs, Inc. が提供・承認・推奨するものではなく、同社とは関係がありません。';

export const TRADEMARK_NOTICE = 'Foursquare® および Swarm™ は Foursquare Labs, Inc. の商標です。';

/** ソースコードのリポジトリ(MIT License で公開) */
export const REPO_URL = 'https://github.com/uriuriboo/visit_mania';

/** 作者の技術ブログ(アフィリエイト広告を含む場合がある。リンクに計測用のパラメータは付けない) */
export const BLOG_URL = 'https://mikagesumiyoshitechblog.netlify.app/';

/** 問い合わせ先(不具合・要望)。Issue にはチェックインの内容を書かないよう案内する */
export const ISSUES_URL = `${REPO_URL}/issues`;
