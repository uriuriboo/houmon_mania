/**
 * ブラウザ内に保存するデータの型(基本設計 6章)。
 */

/**
 * チェックインレコードから、許可した項目だけで組み立て直した JSON(9.2.3)。
 * 未知の項目は保存しない。検索・表示用の値は、いつでもこれから作り直せる(P-5)。
 */
export type RawCheckin = {
  id: string;
  createdAt: string | number;
  type?: string;
  visibility?: string;
  private?: boolean;
  shout?: string;
  timeZoneOffset?: number;
  venue?: {
    id: string;
    name: string;
    /** 2026年版の実物で確認。name が英字表記で、こちらに現地語(日本語など)の店名が入っていることがある */
    canonicalName?: string;
    url?: string;
  };
  location?: { name?: string; lat?: number; lng?: number };
  /** 2026年版の実物ではトップレベルに座標がある */
  lat?: number;
  lng?: number;
  event?: { id?: string; name?: string };
  comments?: { count: number };
};

/** checkins ストア(一覧・詳細の表示用) */
export type CheckinRecord = {
  id: string;
  /** UTC のミリ秒 */
  created_at: number;
  /** 現地時刻との差(分)。無ければ null(UTC で表示) */
  tz_offset: number | null;
  type: string;
  visibility: string | null;
  shout: string | null;
  venue_id: string | null;
  venue_name: string | null;
  venue_canonical_name: string | null;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  event_name: string | null;
  photo_count: number;
  comment_count: number;
  raw: RawCheckin;
};

/** search_index ストア(検索と差分の算出に使う最小限の値) */
export type SearchIndexRecord = {
  id: string;
  created_at: number;
  /** 店名・コメント・場所名・イベント名を改行で連結し、正規化したもの(9.3.3) */
  search_text: string;
  /** raw と写真の情報の集合から計算したハッシュ(9.2.4) */
  content_hash: string;
};

/** photos ストア(写真の情報) */
export type PhotoRecord = {
  photo_id: string;
  checkin_id: string;
  prefix: string;
  suffix: string;
  width: number | null;
  height: number | null;
  visibility: string | null;
  created_at: number | null;
};

/** 画面に返すチェックイン(raw は含めない) */
export type CheckinView = Omit<CheckinRecord, 'raw'> & { photos: PhotoRecord[] };

export const toCheckinView = (c: CheckinRecord, photos: PhotoRecord[]): CheckinView => {
  const { raw: _raw, ...rest } = c;
  return { ...rest, photos };
};
