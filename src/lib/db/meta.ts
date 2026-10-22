/**
 * meta ストア(取り込み状況・保存形式の版など。6.2)の読み書き。
 */
import { META_KEYS, type AppDB, type MetaKey } from './schema';

export type ImportSummaryMeta = {
  at: number;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  deletedCount: number;
  invalidCount: number;
  /** 読み込んだファイル名の一覧(内容は含めない) */
  files: string[];
};

export type AppMeta = {
  schemaVersion: number | null;
  lastImportedAt: number | null;
  latestCheckinAt: number | null;
  latestCheckinTz: number | null;
  periodMin: number | null;
  periodMax: number | null;
  checkinCount: number;
  photoCount: number;
  lastImportSummary: ImportSummaryMeta | null;
  /** 取り込みの保存中の印。起動時に残っていれば、途中で終わったと判断する */
  importInProgress: { startedAt: number } | null;
  persistRequestedAt: number | null;
};

export const EMPTY_META: AppMeta = {
  checkinCount: 0,
  importInProgress: null,
  lastImportSummary: null,
  lastImportedAt: null,
  latestCheckinAt: null,
  latestCheckinTz: null,
  periodMax: null,
  periodMin: null,
  persistRequestedAt: null,
  photoCount: 0,
  schemaVersion: null,
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export const readMeta = async (db: AppDB): Promise<AppMeta> => {
  const tx = db.transaction('meta', 'readonly');
  const store = tx.objectStore('meta');
  const keys = Object.values(META_KEYS) as MetaKey[];
  const values = await Promise.all(keys.map((k) => store.get(k)));
  await tx.done;
  const m = new Map<MetaKey, unknown>(keys.map((k, i) => [k, values[i]]));
  const progress = m.get(META_KEYS.importInProgress);
  const summary = m.get(META_KEYS.lastImportSummary);
  return {
    checkinCount: num(m.get(META_KEYS.checkinCount)) ?? 0,
    importInProgress:
      typeof progress === 'object' && progress !== null && typeof (progress as { startedAt?: unknown }).startedAt === 'number'
        ? { startedAt: (progress as { startedAt: number }).startedAt }
        : null,
    lastImportSummary: typeof summary === 'object' && summary !== null ? (summary as ImportSummaryMeta) : null,
    lastImportedAt: num(m.get(META_KEYS.lastImportedAt)),
    latestCheckinAt: num(m.get(META_KEYS.latestCheckinAt)),
    latestCheckinTz: num(m.get(META_KEYS.latestCheckinTz)),
    periodMax: num(m.get(META_KEYS.periodMax)),
    periodMin: num(m.get(META_KEYS.periodMin)),
    persistRequestedAt: num(m.get(META_KEYS.persistRequestedAt)),
    photoCount: num(m.get(META_KEYS.photoCount)) ?? 0,
    schemaVersion: num(m.get(META_KEYS.schemaVersion)),
  };
};

export const writeMetaValue = async (db: AppDB, key: MetaKey, value: unknown): Promise<void> => {
  await db.put('meta', value, key);
};
