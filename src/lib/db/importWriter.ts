/**
 * 取り込みの保存(IMPT-03、9.2.5)。
 *
 * - 保存の開始時に import_in_progress の印を付け、完了時に外す
 * - 一定件数ずつ、1つのトランザクションで checkins・search_index・photos を保存する(食い違いを生じさせない)
 * - 写真は、書き込んだチェックインの分を今回の集合で置き換える
 * - 削除の反映を選んでいれば、最後に削除候補とその写真の情報を削除する
 * - 途中で止まっても、保存済みの分は残り(冪等なので害は無い)、印が残る
 */
import { LIMITS } from '@/lib/constants';
import { ImportError, isQuotaError } from '@/lib/import/errors';
import type { ImportPlan } from '@/lib/import/analyze';
import type { ImportSummaryMeta } from './meta';
import { META_KEYS, type AppDB } from './schema';

export type WriteProgress = { written: number; total: number };

export type WriteOptions = {
  applyDeletions: boolean;
  now?: number;
  signal?: AbortSignal;
  onProgress?: (p: WriteProgress) => void;
};

export type WriteResult = { written: number; deleted: number; checkinCount: number };

const wrapError = (error: unknown): never => {
  if (error instanceof ImportError) throw error;
  if (isQuotaError(error)) throw new ImportError('QUOTA');
  if (error instanceof DOMException && (error.name === 'InvalidStateError' || error.name === 'AbortError')) {
    // versionchange で接続が閉じられた(他のタブでデータが削除された)など
    throw new ImportError('DB_CLOSED');
  }
  throw new ImportError('UNKNOWN', error instanceof Error ? error.message : undefined);
};

/** 保存件数・期間・最新のチェックインを数え直して meta に書く(取り込み・削除の完了時) */
export const recomputeStats = async (db: AppDB) => {
  const tx = db.transaction(['checkins', 'photos'], 'readonly');
  const index = tx.objectStore('checkins').index('created_at');
  const [checkinCount, photoCount, first, last] = await Promise.all([
    tx.objectStore('checkins').count(),
    tx.objectStore('photos').count(),
    index.openCursor(null, 'next'),
    index.openCursor(null, 'prev'),
  ]);
  const stats = {
    checkinCount,
    latestTz: last?.value.tz_offset ?? null,
    periodMax: last?.value.created_at ?? null,
    periodMin: first?.value.created_at ?? null,
    photoCount,
  };
  await tx.done;
  return stats;
};

export const writeImportPlan = async (db: AppDB, plan: ImportPlan, options: WriteOptions): Promise<WriteResult> => {
  const now = options.now ?? Date.now();
  const { signal, onProgress } = options;
  const deletions = options.applyDeletions && plan.summary.deletionAllowed ? plan.deletionIds : [];
  const total = plan.writes.length + deletions.length;
  let written = 0;

  try {
    await db.put('meta', { startedAt: now }, META_KEYS.importInProgress);
    onProgress?.({ total, written });

    for (let i = 0; i < plan.writes.length; i += LIMITS.saveBatchSize) {
      if (signal?.aborted) throw new ImportError('CANCELLED');
      const batch = plan.writes.slice(i, i + LIMITS.saveBatchSize);
      const tx = db.transaction(['checkins', 'search_index', 'photos'], 'readwrite');
      const checkins = tx.objectStore('checkins');
      const search = tx.objectStore('search_index');
      const photos = tx.objectStore('photos');
      const photoIndex = photos.index('checkin_id');
      const ops: Promise<unknown>[] = [];
      for (const w of batch) {
        ops.push(checkins.put(w.checkin), search.put(w.searchIndex));
        if (!w.isNew) {
          ops.push(
            photoIndex.getAllKeys(w.checkin.id).then((keys) => Promise.all(keys.map((k) => photos.delete(k)))),
          );
        }
        for (const p of w.photos) ops.push(photos.put(p));
      }
      await Promise.all([...ops, tx.done]);
      written += batch.length;
      onProgress?.({ total, written });
    }

    for (let i = 0; i < deletions.length; i += LIMITS.saveBatchSize) {
      if (signal?.aborted) throw new ImportError('CANCELLED');
      const batch = deletions.slice(i, i + LIMITS.saveBatchSize);
      const tx = db.transaction(['checkins', 'search_index', 'photos'], 'readwrite');
      const photos = tx.objectStore('photos');
      const photoIndex = photos.index('checkin_id');
      const ops: Promise<unknown>[] = [];
      for (const id of batch) {
        ops.push(
          tx.objectStore('checkins').delete(id),
          tx.objectStore('search_index').delete(id),
          photoIndex.getAllKeys(id).then((keys) => Promise.all(keys.map((k) => photos.delete(k)))),
        );
      }
      await Promise.all([...ops, tx.done]);
      written += batch.length;
      onProgress?.({ total, written });
    }

    const stats = await recomputeStats(db);
    const summary: ImportSummaryMeta = {
      at: now,
      deletedCount: deletions.length,
      files: plan.summary.fileNames.slice(0, 200),
      invalidCount: plan.summary.invalidCount,
      newCount: plan.summary.newCount,
      unchangedCount: plan.summary.unchangedCount,
      updatedCount: plan.summary.updatedCount,
    };
    const tx = db.transaction('meta', 'readwrite');
    const meta = tx.objectStore('meta');
    await Promise.all([
      meta.put(now, META_KEYS.lastImportedAt),
      meta.put(stats.periodMax, META_KEYS.latestCheckinAt),
      meta.put(stats.latestTz, META_KEYS.latestCheckinTz),
      meta.put(stats.periodMin, META_KEYS.periodMin),
      meta.put(stats.periodMax, META_KEYS.periodMax),
      meta.put(stats.checkinCount, META_KEYS.checkinCount),
      meta.put(stats.photoCount, META_KEYS.photoCount),
      meta.put(summary, META_KEYS.lastImportSummary),
      meta.delete(META_KEYS.importInProgress),
      tx.done,
    ]);
    return { checkinCount: stats.checkinCount, deleted: deletions.length, written: plan.writes.length };
  } catch (error) {
    return wrapError(error);
  }
};
