/**
 * 取り込みのエラー種別(9.2.6)。画面には、このコードと日本語の原因・対処を表示する(9.8)。
 * コードにはチェックインの内容を含めない。
 */
export type ImportErrorCode =
  | 'NO_EXPORT_FILES'
  | 'MULTIPLE_EXPORTS'
  | 'FORMAT'
  | 'TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'TOO_MANY_RECORDS'
  | 'NOT_ZIP'
  | 'ZIP_UNSUPPORTED'
  | 'ZIP_ENCRYPTED'
  | 'ZIP_CORRUPT'
  | 'READ_FAILED'
  | 'QUOTA'
  | 'STORAGE_UNAVAILABLE'
  | 'BUSY'
  | 'DB_CLOSED'
  | 'CANCELLED'
  | 'INTERRUPTED'
  | 'NO_ANALYSIS'
  | 'UNKNOWN';

export class ImportError extends Error {
  public readonly code: ImportErrorCode;
  public constructor(code: ImportErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'ImportError';
    this.code = code;
  }
}

/** 保存領域の容量不足のエラーか(QuotaExceededError) */
export const isQuotaError = (error: unknown): boolean =>
  error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22);
