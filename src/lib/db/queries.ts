/**
 * 検索ワーカー・取り込みワーカーが使う読み取り。
 */
import { comparePhotos } from '@/lib/export/records';
import type { ExistingState } from '@/lib/import/diff';
import { toCheckinView, type CheckinView, type SearchIndexRecord } from '@/lib/model';
import { readMeta } from './meta';
import type { AppDB } from './schema';

/** 詳細条件(絞り込み)に使う値 */
export type FilterAttrs = Pick<SearchIndexRecord, 'created_at' | 'tz_offset' | 'venue_id' | 'visibility' | 'has_photo' | 'has_shout' | 'has_event'>;

/** 検索用データ。日時の降順(同時刻は ID の降順)に並べたもの(5.6、9.3.4) */
export type SearchEntries = {
  ids: string[];
  texts: string[];
  /** ids と同じ順 */
  attrs: FilterAttrs[];
};

export const compareEntryDesc = (a: { id: string; created_at: number }, b: { id: string; created_at: number }): number =>
  b.created_at - a.created_at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** search_index だけを読む(raw を含む checkins は全件読まない) */
export const loadSearchEntries = async (db: AppDB): Promise<SearchEntries> => {
  const all = await db.getAll('search_index');
  all.sort(compareEntryDesc);
  return {
    attrs: all.map((r) => ({
      created_at: r.created_at,
      has_event: r.has_event,
      has_photo: r.has_photo,
      has_shout: r.has_shout,
      tz_offset: r.tz_offset,
      venue_id: r.venue_id,
      visibility: r.visibility,
    })),
    ids: all.map((r) => r.id),
    texts: all.map((r) => r.search_text),
  };
};

/** 差分の算出に使う、保存済みの ID と内容のハッシュ(search_index と meta だけを読む) */
export const loadExistingState = async (db: AppDB): Promise<ExistingState> => {
  const hashes = new Map<string, string>();
  let cursor = await db.transaction('search_index').store.openCursor();
  while (cursor) {
    hashes.set(cursor.value.id, cursor.value.content_hash);
    cursor = await cursor.continue();
  }
  const meta = await readMeta(db);
  return { hashes, periodMax: meta.periodMax, periodMin: meta.periodMin };
};

/** 表示ページ分のチェックインと写真の情報を、指定した順で読む */
export const getCheckinViews = async (db: AppDB, ids: readonly string[]): Promise<CheckinView[]> => {
  const tx = db.transaction(['checkins', 'photos'], 'readonly');
  const checkins = tx.objectStore('checkins');
  const photoIndex = tx.objectStore('photos').index('checkin_id');
  const rows = await Promise.all(
    ids.map(async (id) => {
      const c = await checkins.get(id);
      if (!c) return null;
      const photos = c.photo_count > 0 ? (await photoIndex.getAll(id)).sort(comparePhotos) : [];
      return toCheckinView(c, photos);
    }),
  );
  await tx.done;
  return rows.filter((r): r is CheckinView => r !== null);
};
