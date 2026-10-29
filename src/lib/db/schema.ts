/**
 * IndexedDB の保存形式(6.1)。版を上げるときは migrations.ts に移行処理を加える(L-02、9.1.3)。
 */
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type { CheckinRecord, PhotoRecord, SearchIndexRecord } from '@/lib/model';

/** 保存形式の版(IndexedDB のデータベースの版と、meta.schema_version) */
export const DB_VERSION = 2;

export const META_KEYS = {
  schemaVersion: 'schema_version',
  lastImportedAt: 'last_imported_at',
  latestCheckinAt: 'latest_checkin_at',
  latestCheckinTz: 'latest_checkin_tz',
  periodMin: 'period_min',
  periodMax: 'period_max',
  checkinCount: 'checkin_count',
  photoCount: 'photo_count',
  lastImportSummary: 'last_import_summary',
  importInProgress: 'import_in_progress',
  persistRequestedAt: 'persist_requested_at',
} as const;

export type MetaKey = (typeof META_KEYS)[keyof typeof META_KEYS];

export interface AppDBSchema extends DBSchema {
  checkins: { key: string; value: CheckinRecord; indexes: { created_at: number } };
  search_index: { key: string; value: SearchIndexRecord };
  photos: { key: string; value: PhotoRecord; indexes: { checkin_id: string } };
  meta: { key: MetaKey; value: unknown };
}

export type AppDB = IDBPDatabase<AppDBSchema>;
export type AppStoreName = StoreNames<AppDBSchema>;
export type UpgradeTransaction = IDBPTransaction<AppDBSchema, AppStoreName[], 'versionchange'>;
