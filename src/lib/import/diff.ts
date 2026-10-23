/**
 * 差分と削除の安全条件(9.2.4)。
 */
import { DELETION_MAX_RATIO, DELETION_MIN_ALLOWED } from '@/lib/constants';

export type SourceKind = 'zip' | 'folder' | 'files';

export type DeletionBlockReason =
  /** JSON ファイルを直接選んだ(エクスポート全体がそろっているか確かめられない) */
  | 'NOT_FULL_EXPORT'
  /** ファイルに欠けがある、または件数が合わない */
  | 'INCOMPLETE_FILES'
  /** ID が読み取れないレコードがある */
  | 'UNIDENTIFIED_RECORDS'
  /** エクスポートの期間が、保存済みのデータの期間を覆っていない */
  | 'PERIOD_NOT_COVERED'
  /** 削除候補が多すぎる */
  | 'TOO_MANY_DELETIONS';

export type ExistingState = {
  /** 保存済みの ID と内容のハッシュ */
  readonly hashes: ReadonlyMap<string, string>;
  readonly periodMin: number | null;
  readonly periodMax: number | null;
};

export type DiffInput = {
  /** 今回のエクスポートで正しく読めたチェックインの ID と内容のハッシュ */
  readonly incoming: ReadonlyMap<string, string>;
  /** 今回のエクスポートに含まれていた ID(不正で保存できないものも含む) */
  readonly seenIds: ReadonlySet<string>;
  readonly existing: ExistingState;
  readonly sourceKind: SourceKind;
  /** ファイルに欠けが無く、各ファイルの件数が一致した */
  readonly filesComplete: boolean;
  /** ID が読み取れなかったレコードの件数 */
  readonly unidentifiedCount: number;
  readonly exportPeriodMin: number | null;
  readonly exportPeriodMax: number | null;
};

export type DiffResult = {
  readonly newIds: string[];
  readonly updatedIds: string[];
  readonly unchangedCount: number;
  readonly deletionCandidates: string[];
  /** 削除の反映を選べるか(既定はオフ) */
  readonly deletionAllowed: boolean;
  readonly deletionBlockedReasons: DeletionBlockReason[];
};

export const maxAllowedDeletions = (storedCount: number): number =>
  Math.max(Math.floor(storedCount * DELETION_MAX_RATIO), DELETION_MIN_ALLOWED);

export const computeDiff = (input: DiffInput): DiffResult => {
  const newIds: string[] = [];
  const updatedIds: string[] = [];
  let unchangedCount = 0;
  for (const [id, hash] of input.incoming) {
    const old = input.existing.hashes.get(id);
    if (old === undefined) newIds.push(id);
    else if (old !== hash) updatedIds.push(id);
    else unchangedCount += 1;
  }

  const deletionCandidates: string[] = [];
  for (const id of input.existing.hashes.keys()) {
    if (!input.seenIds.has(id)) deletionCandidates.push(id);
  }

  const reasons: DeletionBlockReason[] = [];
  if (deletionCandidates.length > 0) {
    if (input.sourceKind === 'files') reasons.push('NOT_FULL_EXPORT');
    if (!input.filesComplete) reasons.push('INCOMPLETE_FILES');
    if (input.unidentifiedCount > 0) reasons.push('UNIDENTIFIED_RECORDS');
    const { periodMin, periodMax } = input.existing;
    const covered =
      periodMin !== null &&
      periodMax !== null &&
      input.exportPeriodMin !== null &&
      input.exportPeriodMax !== null &&
      input.exportPeriodMin <= periodMin &&
      input.exportPeriodMax >= periodMax;
    if (!covered) reasons.push('PERIOD_NOT_COVERED');
    if (deletionCandidates.length > maxAllowedDeletions(input.existing.hashes.size)) reasons.push('TOO_MANY_DELETIONS');
  }

  return {
    deletionAllowed: deletionCandidates.length > 0 && reasons.length === 0,
    deletionBlockedReasons: reasons,
    deletionCandidates,
    newIds,
    unchangedCount,
    updatedIds,
  };
};
