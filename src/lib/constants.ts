/**
 * アプリ全体の定数。秘密の環境変数は持たず、ビルド時の設定はコードの定数として持つ(基本設計 12.3)。
 */

/** 仮称(17章 D-8)。商標規定により Foursquare / Swarm / 4SQ / Check-in を含めない */
export const APP_NAME = 'Visit_Mania';
export const APP_NAME_JA = '足あと検索';

/**
 * 公開 URL(オリジン)。sitemap.xml と robots.txt に使う。独自ドメインにするときは、ここだけ書き換える(17章 D-8)。
 * 公開後にドメインを変えると、利用者の保存データは引き継げない。
 */
export const SITE_URL = 'https://visit-mania.vercel.app';

/** 検索エンジンに載せるページ(位置履歴を扱わないもの)。検索・取り込み・データ管理は載せない */
export const PUBLIC_PATHS = ['/', '/about', '/privacy'] as const;

/** Google アナリティクス 4 の測定 ID(公開されてよい値)。PUBLIC_PATHS の 3 ページだけで使う(TODO # 18) */
export const GA_MEASUREMENT_ID = 'G-PCEDMF6SC8';

/** IndexedDB のデータベース名。オリジンごと・ブラウザごとに別 */
export const DB_NAME = 'ashiato';

/** 取り込み・削除・保存形式の移行で共通に使う排他ロックの名前(9.6) */
export const DATA_LOCK_NAME = 'ashiato-data';

/** タブ間の連絡に使う BroadcastChannel の名前(8.4) */
export const BROADCAST_CHANNEL_NAME = 'ashiato';

/** 大きさ・件数の上限(N-12。詳細設計の初期値) */
export const LIMITS = {
  /** ZIP の目次のファイル数(写真の実ファイルを含む) */
  zipMaxEntries: 500_000,
  /** ZIP の目次(central directory)の大きさ */
  zipMaxDirectoryBytes: 128 * 1024 * 1024,
  /** 分割された checkinsN.json・photosN.json の1ファイルの大きさ(展開後) */
  splitJsonMaxBytes: 32 * 1024 * 1024,
  /** 分割されていない古い形式の checkins.json・photos.json の大きさ(展開後) */
  singleJsonMaxBytes: 400 * 1024 * 1024,
  /** 展開するファイルの合計の大きさ */
  totalExtractMaxBytes: 800 * 1024 * 1024,
  /** checkins*.json・photos*.json のそれぞれのファイル数 */
  maxFilesPerKind: 1_000,
  /** チェックインの総件数(1ブラウザあたり) */
  maxCheckins: 200_000,
  /** 写真の情報の総件数 */
  maxPhotos: 400_000,
  /** raw の1件の大きさ(UTF-8 のバイト数) */
  rawMaxBytes: 16 * 1024,
  /** 店名・場所名・イベント名の文字数 */
  nameMaxChars: 500,
  /** コメント(shout)の文字数 */
  shoutMaxChars: 2_000,
  /** 1つのトランザクションで保存する件数 */
  saveBatchSize: 2_000,
  /** 分析結果の警告に含める未知の項目名の数 */
  maxUnknownKeys: 30,
} as const;

/** 検索式の上限(9.3.1) */
export const QUERY_LIMITS = {
  maxLength: 200,
  maxTermLength: 50,
  maxTerms: 10,
  maxDepth: 5,
} as const;

/** 表示件数の選択肢(5.6) */
export const PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

/** 最終取り込みからこの日数がたったら、再申請を促す(9.2.7) */
export const STALE_DAYS = 30;

/** 削除候補の安全条件: 保存件数のこの割合と、この件数の大きい方まで(9.2.4) */
export const DELETION_MAX_RATIO = 0.05;
export const DELETION_MIN_ALLOWED = 20;
