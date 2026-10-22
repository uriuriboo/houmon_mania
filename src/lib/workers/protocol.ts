/**
 * 画面とワーカーの間のメッセージ(8.2、8.3)。
 */
import type { AnalysisSummary } from '@/lib/import/analyze';
import type { ImportErrorCode } from '@/lib/import/errors';
import type { CheckinView } from '@/lib/model';

// ───────────────────────── 取り込みワーカー ─────────────────────────
export type ImportInput =
  | { kind: 'zip'; file: File }
  /** 展開済みのフォルダ(path は webkitRelativePath)、または JSON ファイルの直接選択 */
  | { kind: 'folder' | 'files'; files: Array<{ file: File; path: string }> };

export type ImportRequest =
  | { type: 'analyze'; input: ImportInput }
  | { type: 'save'; applyDeletions: boolean }
  | { type: 'cancel' };

export type ImportSaveResult = { written: number; deleted: number; checkinCount: number; firstImport: boolean };

export type ImportResponse =
  | { type: 'analyze-progress'; filesDone: number; filesTotal: number; records: number }
  | { type: 'analyzed'; summary: AnalysisSummary }
  | { type: 'save-progress'; written: number; total: number }
  | { type: 'saved'; result: ImportSaveResult }
  | { type: 'cancelled' }
  | { type: 'error'; code: ImportErrorCode };

// ───────────────────────── 検索ワーカー ─────────────────────────
export type SearchRequest =
  | { type: 'prepare'; reqId: number }
  | { type: 'search'; reqId: number; ast: unknown; page: number; size: number }
  | { type: 'detail'; reqId: number; id: string }
  | { type: 'dispose'; reqId: number };

export type SearchErrorCode = 'NOT_READY' | 'INVALID_AST' | 'DB_CLOSED' | 'UNAVAILABLE' | 'UNKNOWN';

export type SearchResults = { total: number; page: number; items: CheckinView[]; ms: number };

export type SearchResponse =
  | { type: 'prepared'; reqId: number; count: number; ms: number }
  | ({ type: 'results'; reqId: number } & SearchResults)
  | { type: 'detail'; reqId: number; item: CheckinView | null }
  | { type: 'disposed'; reqId: number }
  | { type: 'error'; reqId: number; code: SearchErrorCode }
  /** 依頼に対する応答ではない通知。他のタブでデータが削除された・新しい版で開かれた */
  | { type: 'db-closed'; reason: 'deleted' | 'upgraded' };

/** ワーカーの中での self の型(dom の型定義と webworker の型定義は同時に使えないため、使う分だけ定義する) */
export type WorkerScope<Req, Res> = {
  postMessage(message: Res): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<Req>) => void): void;
};
