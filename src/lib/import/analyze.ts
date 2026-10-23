/**
 * ファイルの読み込みと分析(IMPT-02、9.2.2〜9.2.4)。この段階では保存しない。
 *
 * 1. checkins*.json と photos*.json だけを選び、欠けと混在を確かめる
 * 2. 大きさの上限を守りながら読み込み、JSON として解釈する
 * 3. レコードを検証して raw を組み立て直し、ID の重複を除き、写真の情報を対応付ける
 * 4. 保存済みのデータと比べて、新規・更新・変更なし・削除候補を数え、削除の安全条件を判定する
 */
import { LIMITS } from '@/lib/constants';
import { classifyExportFiles, type ExportFileRef } from '@/lib/export/files';
import {
  collectUnknownKeys,
  comparePhotos,
  deriveRecords,
  validateCheckin,
  validatePhoto,
} from '@/lib/export/records';
import type { CheckinRecord, PhotoRecord, RawCheckin, SearchIndexRecord } from '@/lib/model';
import { ZipError } from '@/lib/zip/zipReader';
import { computeDiff, type DeletionBlockReason, type ExistingState, type SourceKind } from './diff';
import { ImportError } from './errors';

export type SourceFile = {
  /** ZIP の中のパス、またはフォルダからの相対パス(区切りは /) */
  readonly path: string;
  /** maxBytes を超えたら ZipError('TOO_LARGE') か ImportError('TOO_LARGE') を投げる */
  read(maxBytes: number): Promise<Uint8Array>;
};

export type ExportSource = {
  readonly kind: SourceKind;
  /** 読み込む対象のファイルだけ(isExportDataPath で絞り込んだもの) */
  readonly files: readonly SourceFile[];
};

export type AnalysisProgress = { filesDone: number; filesTotal: number; records: number };

export type AnalysisWarning =
  | { code: 'INCOMPLETE_FILES'; missing: string[] }
  | { code: 'COUNT_MISMATCH'; files: string[] }
  | { code: 'NO_PHOTOS_FILE' }
  | { code: 'INVALID_RECORDS'; count: number }
  | { code: 'DUPLICATES'; count: number }
  | { code: 'PHOTOS_SKIPPED'; count: number }
  | { code: 'UNKNOWN_KEYS'; keys: string[] };

export type AnalysisSummary = {
  sourceKind: SourceKind;
  /** 読み込んだファイル名(パターンに一致したものだけ。内容は含めない) */
  fileNames: string[];
  /** 正しく読めたチェックインの件数 */
  checkinCount: number;
  /** 不正で保存しないレコードの件数 */
  invalidCount: number;
  /** ID が読み取れなかったレコードの件数(invalidCount に含む) */
  unidentifiedCount: number;
  duplicateCount: number;
  /** チェックインに対応付けた写真の情報の件数 */
  photoCount: number;
  periodMin: number | null;
  periodMax: number | null;
  periodMinTz: number | null;
  periodMaxTz: number | null;
  newCount: number;
  updatedCount: number;
  unchangedCount: number;
  deletionCandidateCount: number;
  deletionAllowed: boolean;
  deletionBlockedReasons: DeletionBlockReason[];
  filesComplete: boolean;
  warnings: AnalysisWarning[];
};

export type ImportWrite = {
  checkin: CheckinRecord;
  searchIndex: SearchIndexRecord;
  photos: PhotoRecord[];
  /** 保存済みに無い(古い写真の情報を消す必要が無い) */
  isNew: boolean;
};

export type ImportPlan = {
  /** 新規と更新のチェックインだけ(変更なしは書き込まない。9.2.5) */
  writes: ImportWrite[];
  /** 削除候補(反映するのは、安全条件を満たし利用者が選んだ場合だけ) */
  deletionIds: string[];
  summary: AnalysisSummary;
};

export type AnalyzeOptions = {
  now?: number;
  signal?: AbortSignal;
  onProgress?: (p: AnalysisProgress) => void;
};

const textDecoder = new TextDecoder('utf-8');

const throwIfAborted = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) throw new ImportError('CANCELLED');
};

export const toImportError = (error: unknown): ImportError => {
  if (error instanceof ImportError) return error;
  if (error instanceof ZipError) {
    switch (error.code) {
      case 'TOO_LARGE':
        return new ImportError('TOO_LARGE');
      case 'TOO_MANY_ENTRIES':
        return new ImportError('TOO_MANY_FILES');
      case 'NOT_ZIP':
        return new ImportError('NOT_ZIP');
      case 'ENCRYPTED':
        return new ImportError('ZIP_ENCRYPTED');
      case 'UNSUPPORTED':
        return new ImportError('ZIP_UNSUPPORTED');
      default:
        return new ImportError('ZIP_CORRUPT');
    }
  }
  return new ImportError('READ_FAILED', error instanceof Error ? error.message : undefined);
};

const extractItems = (json: unknown): { items: unknown[]; count: number | null } | null => {
  if (Array.isArray(json)) return { count: null, items: json };
  if (typeof json === 'object' && json !== null) {
    const o = json as { items?: unknown; count?: unknown };
    if (Array.isArray(o.items)) return { count: typeof o.count === 'number' ? o.count : null, items: o.items };
  }
  return null;
};

const shortName = (path: string): string => path.slice(path.lastIndexOf('/') + 1).slice(0, 40);

export const analyzeExport = async (
  source: ExportSource,
  existing: ExistingState,
  options: AnalyzeOptions = {},
): Promise<ImportPlan> => {
  const now = options.now ?? Date.now();
  const { signal, onProgress } = options;

  const classification = classifyExportFiles(source.files.map((f) => f.path));
  if (!classification.ok) {
    if (classification.code === 'NO_CHECKINS') throw new ImportError('NO_EXPORT_FILES');
    throw new ImportError(classification.code);
  }
  const fileByPath = new Map(source.files.map((f) => [f.path.replace(/\\/gu, '/'), f]));
  const ordered: ExportFileRef[] = [...classification.checkins, ...classification.photos];

  let filesComplete = classification.complete;
  const countMismatch: string[] = [];
  let bytesUsed = 0;
  let filesDone = 0;
  let records = 0;

  const readJsonItems = async (ref: ExportFileRef): Promise<unknown[]> => {
    const file = fileByPath.get(ref.path);
    if (!file) throw new ImportError('READ_FAILED');
    const perFile = ref.index === null ? LIMITS.singleJsonMaxBytes : LIMITS.splitJsonMaxBytes;
    const remaining = LIMITS.totalExtractMaxBytes - bytesUsed;
    if (remaining <= 0) throw new ImportError('TOO_LARGE');
    let bytes: Uint8Array;
    try {
      bytes = await file.read(Math.min(perFile, remaining));
    } catch (error) {
      throw toImportError(error);
    }
    bytesUsed += bytes.length;
    let json: unknown;
    try {
      json = JSON.parse(textDecoder.decode(bytes));
    } catch {
      throw new ImportError('FORMAT');
    }
    const extracted = extractItems(json);
    if (!extracted) throw new ImportError('FORMAT');
    if (extracted.count !== null && extracted.count !== extracted.items.length) {
      filesComplete = false;
      countMismatch.push(shortName(ref.path));
    }
    return extracted.items;
  };

  // ── チェックイン ──
  const valid = new Map<string, { raw: RawCheckin; createdAt: number }>();
  const seenIds = new Set<string>();
  const unknownKeys = new Set<string>();
  let totalItems = 0;
  let invalidCount = 0;
  let unidentifiedCount = 0;
  let duplicateCount = 0;

  for (const ref of classification.checkins) {
    throwIfAborted(signal);
    const items = await readJsonItems(ref);
    for (const item of items) {
      totalItems += 1;
      if (totalItems > LIMITS.maxCheckins) throw new ImportError('TOO_MANY_RECORDS');
      collectUnknownKeys(item, unknownKeys);
      const v = validateCheckin(item, now);
      if (v.ok) {
        if (seenIds.has(v.raw.id)) {
          duplicateCount += 1;
          continue;
        }
        seenIds.add(v.raw.id);
        valid.set(v.raw.id, { createdAt: v.createdAt, raw: v.raw });
      } else {
        invalidCount += 1;
        if (v.id === null) unidentifiedCount += 1;
        else seenIds.add(v.id);
      }
    }
    records += items.length;
    filesDone += 1;
    onProgress?.({ filesDone, filesTotal: ordered.length, records });
  }

  // 想定しない形式(id や createdAt が無いレコードが多い)なら止める(7.1)
  if (totalItems > 0 && valid.size < totalItems * 0.5) throw new ImportError('FORMAT');

  // ── 写真の情報 ──
  const photosByCheckin = new Map<string, PhotoRecord[]>();
  const photoIds = new Set<string>();
  let photoTotal = 0;
  let photosSkipped = 0;
  for (const ref of classification.photos) {
    throwIfAborted(signal);
    const items = await readJsonItems(ref);
    for (const item of items) {
      photoTotal += 1;
      if (photoTotal > LIMITS.maxPhotos) throw new ImportError('TOO_MANY_RECORDS');
      const p = validatePhoto(item, now);
      // チェックインに対応しない写真(ヒントの写真など)は取り込まない
      if (!p.ok || !valid.has(p.photo.checkin_id) || photoIds.has(p.photo.photo_id)) {
        photosSkipped += 1;
        continue;
      }
      photoIds.add(p.photo.photo_id);
      const list = photosByCheckin.get(p.photo.checkin_id);
      if (list) list.push(p.photo);
      else photosByCheckin.set(p.photo.checkin_id, [p.photo]);
    }
    records += items.length;
    filesDone += 1;
    onProgress?.({ filesDone, filesTotal: ordered.length, records });
  }
  throwIfAborted(signal);

  // ── 保存する値と差分 ──
  const derived = new Map<string, { checkin: CheckinRecord; searchIndex: SearchIndexRecord; photos: PhotoRecord[] }>();
  const incoming = new Map<string, string>();
  let periodMin: { at: number; tz: number | null } | null = null;
  let periodMax: { at: number; tz: number | null } | null = null;
  for (const [id, { raw, createdAt }] of valid) {
    const photos = (photosByCheckin.get(id) ?? []).sort(comparePhotos);
    const d = deriveRecords(raw, createdAt, photos);
    incoming.set(id, d.searchIndex.content_hash);
    const old = existing.hashes.get(id);
    if (old !== d.searchIndex.content_hash) derived.set(id, { ...d, photos });
    if (!periodMin || createdAt < periodMin.at) periodMin = { at: createdAt, tz: d.checkin.tz_offset };
    if (!periodMax || createdAt > periodMax.at) periodMax = { at: createdAt, tz: d.checkin.tz_offset };
  }

  const diff = computeDiff({
    existing,
    exportPeriodMax: periodMax?.at ?? null,
    exportPeriodMin: periodMin?.at ?? null,
    filesComplete,
    incoming,
    seenIds,
    sourceKind: source.kind,
    unidentifiedCount,
  });

  const writes: ImportWrite[] = [];
  for (const id of diff.newIds) writes.push({ ...derived.get(id)!, isNew: true });
  for (const id of diff.updatedIds) writes.push({ ...derived.get(id)!, isNew: false });

  const warnings: AnalysisWarning[] = [];
  if (classification.missing.length > 0 || !classification.complete) warnings.push({ code: 'INCOMPLETE_FILES', missing: classification.missing.slice(0, 20) });
  if (countMismatch.length > 0) warnings.push({ code: 'COUNT_MISMATCH', files: countMismatch.slice(0, 20) });
  if (!classification.hasPhotosFile) warnings.push({ code: 'NO_PHOTOS_FILE' });
  if (invalidCount > 0) warnings.push({ code: 'INVALID_RECORDS', count: invalidCount });
  if (duplicateCount > 0) warnings.push({ code: 'DUPLICATES', count: duplicateCount });
  if (photosSkipped > 0) warnings.push({ code: 'PHOTOS_SKIPPED', count: photosSkipped });
  if (unknownKeys.size > 0) warnings.push({ code: 'UNKNOWN_KEYS', keys: [...unknownKeys].sort() });

  return {
    deletionIds: diff.deletionCandidates,
    summary: {
      checkinCount: valid.size,
      deletionAllowed: diff.deletionAllowed,
      deletionBlockedReasons: diff.deletionBlockedReasons,
      deletionCandidateCount: diff.deletionCandidates.length,
      duplicateCount,
      fileNames: ordered.map((r) => shortName(r.path)),
      filesComplete,
      invalidCount,
      newCount: diff.newIds.length,
      periodMax: periodMax?.at ?? null,
      periodMaxTz: periodMax?.tz ?? null,
      periodMin: periodMin?.at ?? null,
      periodMinTz: periodMin?.tz ?? null,
      photoCount: photoIds.size,
      sourceKind: source.kind,
      unchangedCount: diff.unchangedCount,
      unidentifiedCount,
      updatedCount: diff.updatedIds.length,
      warnings,
    },
    writes,
  };
};
