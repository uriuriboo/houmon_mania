/**
 * エクスポートの中から、読み込むファイル(checkins*.json と photos*.json)だけを選ぶ(7.1、P-4)。
 * それ以外のファイル(友人一覧・コメント・支払い・端末情報・写真の実ファイルなど)は、名前で除外して開かない。
 */
import { LIMITS } from '@/lib/constants';

export type ExportFileKind = 'checkins' | 'photos';

export type ExportFileRef = {
  readonly path: string;
  readonly kind: ExportFileKind;
  /** checkins3.json → 3、checkins.json → null */
  readonly index: number | null;
};

export type FileClassification =
  | {
      readonly ok: true;
      readonly checkins: ExportFileRef[];
      readonly photos: ExportFileRef[];
      /** 連番に欠けが無く、分割形式と単一ファイル形式が混ざっていない */
      readonly complete: boolean;
      /** 見つからない連番のファイル名 */
      readonly missing: string[];
      readonly hasPhotosFile: boolean;
    }
  | { readonly ok: false; readonly code: 'NO_CHECKINS' | 'MULTIPLE_EXPORTS' | 'TOO_MANY_FILES' };

const EXPORT_FILE_RE = /^(checkins|photos)(\d*)\.json$/iu;

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const dirname = (path: string): string => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

/** 読み込む対象のファイル名か(ZIP の目次・フォルダの一覧の絞り込みに使う) */
export const isExportDataPath = (rawPath: string): boolean => {
  const path = rawPath.replace(/\\/gu, '/');
  if (path.split('/').some((seg) => seg === '__MACOSX')) return false;
  return EXPORT_FILE_RE.test(basename(path));
};

const parseRef = (rawPath: string): ExportFileRef | null => {
  const path = rawPath.replace(/\\/gu, '/');
  const m = EXPORT_FILE_RE.exec(basename(path));
  if (!m) return null;
  const kind = m[1]!.toLowerCase() as ExportFileKind;
  const index = m[2] ? Number(m[2]) : null;
  return { index, kind, path };
};

const checkSequence = (refs: ExportFileRef[], kind: ExportFileKind): { complete: boolean; missing: string[] } => {
  if (refs.length === 0) return { complete: true, missing: [] };
  const numbered = refs.filter((r) => r.index !== null).map((r) => r.index!);
  const single = refs.length - numbered.length;
  if (single > 0 && numbered.length > 0) return { complete: false, missing: [] };
  if (single > 1) return { complete: false, missing: [] };
  if (single === 1) return { complete: true, missing: [] };
  const set = new Set(numbered);
  if (set.size !== numbered.length) return { complete: false, missing: [] };
  const max = Math.max(...numbered);
  const missing: string[] = [];
  for (let i = 1; i <= max; i++) if (!set.has(i)) missing.push(`${kind}${i}.json`);
  return { complete: missing.length === 0, missing };
};

const byIndex = (a: ExportFileRef, b: ExportFileRef) => (a.index ?? 0) - (b.index ?? 0);

/**
 * ファイルの一覧を分類し、欠けと混在を確かめる(9.2.2)。
 * 同じ名前のファイルが複数のフォルダにある場合は、複数のエクスポートが混ざっているとみなす(7.1)。
 */
export const classifyExportFiles = (paths: readonly string[]): FileClassification => {
  const refs = paths.filter(isExportDataPath).map(parseRef).filter((r): r is ExportFileRef => r !== null);
  const checkins = refs.filter((r) => r.kind === 'checkins').sort(byIndex);
  const photos = refs.filter((r) => r.kind === 'photos').sort(byIndex);
  if (checkins.length === 0) return { code: 'NO_CHECKINS', ok: false };
  if (checkins.length > LIMITS.maxFilesPerKind || photos.length > LIMITS.maxFilesPerKind) return { code: 'TOO_MANY_FILES', ok: false };

  const dirs = new Set(refs.map((r) => dirname(r.path)));
  if (dirs.size > 1) return { code: 'MULTIPLE_EXPORTS', ok: false };

  const c = checkSequence(checkins, 'checkins');
  const p = checkSequence(photos, 'photos');
  return {
    checkins,
    complete: c.complete && p.complete,
    hasPhotosFile: photos.length > 0,
    missing: [...c.missing, ...p.missing],
    ok: true,
    photos,
  };
};
