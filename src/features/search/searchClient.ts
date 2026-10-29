/**
 * 画面から検索ワーカーへの窓口(8.3)。依頼ごとに番号を付け、応答を Promise で返す。
 */
import type { CheckinView } from '@/lib/model';
import type { QueryNode } from '@/lib/query/ast';
import type { SearchFilters } from '@/lib/search/filters';
import type { SearchErrorCode, SearchRequest, SearchResponse, SearchResults } from '@/lib/workers/protocol';

export class SearchWorkerError extends Error {
  public readonly code: SearchErrorCode;
  public constructor(code: SearchErrorCode) {
    super(code);
    this.name = 'SearchWorkerError';
    this.code = code;
  }
}

type Pending = { resolve: (r: SearchResponse) => void; reject: (e: unknown) => void };

// 1つの依頼を表す型(reqId はこのクラスが付ける)
type RequestBody = SearchRequest extends infer R ? (R extends { reqId: number } ? Omit<R, 'reqId'> : never) : never;

export class SearchClient {
  private readonly worker: Worker;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  /** 他のタブでデータが削除された・新しい版で開かれた */
  public onClosed: ((reason: 'deleted' | 'upgraded') => void) | null = null;

  public constructor() {
    this.worker = new Worker(new URL('../../workers/search.worker.ts', import.meta.url), { name: 'search', type: 'module' });
    this.worker.addEventListener('message', (event: MessageEvent<SearchResponse>) => {
      const msg = event.data;
      if (msg.type === 'db-closed') {
        this.onClosed?.(msg.reason);
        return;
      }
      const p = this.pending.get(msg.reqId);
      if (!p) return;
      this.pending.delete(msg.reqId);
      if (msg.type === 'error') p.reject(new SearchWorkerError(msg.code));
      else p.resolve(msg);
    });
    this.worker.addEventListener('error', () => this.failAll());
  }

  private request(body: RequestBody): Promise<SearchResponse> {
    const reqId = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { reject, resolve });
      this.worker.postMessage({ ...body, reqId } as SearchRequest);
    });
  }

  private failAll() {
    for (const p of this.pending.values()) p.reject(new SearchWorkerError('UNKNOWN'));
    this.pending.clear();
  }

  public async prepare(): Promise<{ count: number; ms: number }> {
    const r = await this.request({ type: 'prepare' });
    if (r.type !== 'prepared') throw new SearchWorkerError('UNKNOWN');
    return { count: r.count, ms: r.ms };
  }

  public async search(ast: QueryNode | null, filters: SearchFilters, page: number, size: number): Promise<SearchResults> {
    const r = await this.request({ ast, filters, page, size, type: 'search' });
    if (r.type !== 'results') throw new SearchWorkerError('UNKNOWN');
    return { items: r.items, ms: r.ms, page: r.page, total: r.total };
  }

  public async detail(id: string): Promise<CheckinView | null> {
    const r = await this.request({ id, type: 'detail' });
    if (r.type !== 'detail') throw new SearchWorkerError('UNKNOWN');
    return r.item;
  }

  /** メモリ上の検索用データを捨て、データベースへの接続を閉じる(データの削除の前) */
  public async dispose(): Promise<void> {
    await this.request({ type: 'dispose' });
  }

  public terminate() {
    this.worker.terminate();
    this.failAll();
  }
}
