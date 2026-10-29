/**
 * 検索ワーカー(2.2)。IndexedDB から検索用のデータ(search_index)だけを読み込んでメモリに持ち、
 * 中間AST と照合して、該当件数と表示ページ分のチェックインを返す。外部には接続しない(F-25)。
 */
import { openAppDb } from '@/lib/db/open';
import { getCheckinViews, loadSearchEntries } from '@/lib/db/queries';
import type { AppDB } from '@/lib/db/schema';
import { InvalidAstError, validateAst } from '@/lib/query/match';
import { SearchEngine } from '@/lib/search/engine';
import { sanitizeFilters } from '@/lib/search/filters';
import type { SearchErrorCode, SearchRequest, SearchResponse, WorkerScope } from '@/lib/workers/protocol';

const scope = self as unknown as WorkerScope<SearchRequest, SearchResponse>;
const post = (message: SearchResponse) => scope.postMessage(message);

let db: AppDB | null = null;
let engine: SearchEngine | null = null;
/** 他のタブでデータが削除された・新しい版で開かれた。自動では開き直さない(9.6) */
let closed = false;

class ClosedError extends Error {}

const getDb = async (): Promise<AppDB> => {
  if (closed) throw new ClosedError();
  if (db) return db;
  db = await openAppDb({
    onVersionChange: (newVersion) => {
      db = null;
      engine = null;
      closed = true;
      post({ reason: newVersion === null ? 'deleted' : 'upgraded', type: 'db-closed' });
    },
    onTerminated: () => {
      db = null;
      engine = null;
    },
  });
  return db;
};

const errorCode = (error: unknown): SearchErrorCode => {
  if (error instanceof ClosedError || closed) return 'DB_CLOSED';
  if (error instanceof InvalidAstError) return 'INVALID_AST';
  return 'UNKNOWN';
};

const handle = async (msg: SearchRequest): Promise<void> => {
  try {
    switch (msg.type) {
      case 'prepare': {
        const t0 = performance.now();
        let d: AppDB;
        try {
          d = await getDb();
        } catch (error) {
          if (error instanceof ClosedError) throw error;
          post({ code: 'UNAVAILABLE', reqId: msg.reqId, type: 'error' });
          return;
        }
        engine = new SearchEngine(await loadSearchEntries(d));
        post({ count: engine.count, ms: Math.round(performance.now() - t0), reqId: msg.reqId, type: 'prepared' });
        return;
      }
      case 'search': {
        if (!engine || !db) {
          post({ code: closed ? 'DB_CLOSED' : 'NOT_READY', reqId: msg.reqId, type: 'error' });
          return;
        }
        const t0 = performance.now();
        const ast = msg.ast === null ? null : validateAst(msg.ast);
        const size = Number.isInteger(msg.size) && msg.size > 0 && msg.size <= 100 ? msg.size : 50;
        const page = Number.isInteger(msg.page) && msg.page > 0 ? msg.page : 1;
        const r = engine.search(ast, sanitizeFilters(msg.filters), page, size);
        const items = await getCheckinViews(db, r.ids);
        post({ items, ms: Math.round(performance.now() - t0), page: r.page, reqId: msg.reqId, total: r.total, type: 'results' });
        return;
      }
      case 'detail': {
        const d = await getDb();
        const [item] = /^[0-9a-f]{24}$/u.test(msg.id) ? await getCheckinViews(d, [msg.id]) : [];
        post({ item: item ?? null, reqId: msg.reqId, type: 'detail' });
        return;
      }
      case 'dispose': {
        db?.close();
        db = null;
        engine = null;
        post({ reqId: msg.reqId, type: 'disposed' });
        return;
      }
    }
  } catch (error) {
    post({ code: errorCode(error), reqId: msg.reqId, type: 'error' });
  }
};

scope.addEventListener('message', (event) => {
  void handle(event.data);
});
