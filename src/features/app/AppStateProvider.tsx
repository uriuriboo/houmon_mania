'use client';

/**
 * 画面全体の状態(APP-01 起動時の確認、APP-02 タブ間の調整、DATA-03 データの削除)。
 *
 * - 起動時(と bfcache からの復帰時)に、保存データの有無・保存形式の版・取り込みの途中終了の印を確認する
 * - 保存データがあれば検索ワーカーに準備を依頼する
 * - 他のタブでデータが削除された・新しい版で開かれた場合は、接続を閉じてメモリ上のデータを捨て、自動では開き直さない(9.6)
 * - 取り込みが終わったら BroadcastChannel で他のタブに知らせ、他のタブは検索用データを読み直す
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BROADCAST_CHANNEL_NAME, DATA_LOCK_NAME, STALE_DAYS } from '@/lib/constants';
import { EMPTY_META, readMeta, writeMetaValue, type AppMeta } from '@/lib/db/meta';
import { deleteAppDb, openAppDb } from '@/lib/db/open';
import { META_KEYS, type AppDB } from '@/lib/db/schema';
import { importController } from '@/features/import/importController';
import { SearchClient } from '@/features/search/searchClient';

export type AppStatus =
  | 'checking'
  /** IndexedDB・Web Worker・Web Locks・BroadcastChannel が使えない */
  | 'unsupported'
  /** 保存領域を開けない(プライベートブラウズの制限・サイトデータの禁止など) */
  | 'unavailable'
  /** 古い版で開いている他のタブがあり、保存形式の移行が保留になっている */
  | 'blocked'
  /** 他のタブでデータが削除された */
  | 'closed-deleted'
  /** 他のタブが新しい版で開いた */
  | 'closed-upgraded'
  | 'ready';

export type SearchStatus = 'idle' | 'preparing' | 'ready' | 'error';

export type DeleteResult = 'deleted' | 'busy' | 'aborted' | 'failed';

type AppState = {
  status: AppStatus;
  meta: AppMeta;
  /** 別のタブで取り込み・削除・移行の実行中 */
  otherTabBusy: boolean;
  /** 最終取り込みから一定の日数がたっている(9.2.7) */
  stale: boolean;
  searchStatus: SearchStatus;
  searchClient: SearchClient | null;
  /** データの削除が他のタブにより保留されている */
  deleteBlocked: boolean;
  refresh: () => Promise<void>;
  deleteAllData: (options: { wait: boolean; signal?: AbortSignal }) => Promise<DeleteResult>;
  recordPersistRequest: () => Promise<void>;
};

const AppStateContext = createContext<AppState | null>(null);

const isSupported = (): boolean =>
  typeof indexedDB !== 'undefined' &&
  typeof Worker !== 'undefined' &&
  typeof BroadcastChannel !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  'locks' in navigator;

const isLockHeld = async (): Promise<boolean> => {
  try {
    const q = await navigator.locks.query();
    return (q.held ?? []).some((l) => l.name === DATA_LOCK_NAME);
  } catch {
    return false;
  }
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus>('checking');
  const [meta, setMeta] = useState<AppMeta>(EMPTY_META);
  const [otherTabBusy, setOtherTabBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>('idle');
  const [searchClient, setSearchClient] = useState<SearchClient | null>(null);
  const [deleteBlocked, setDeleteBlocked] = useState(false);

  const dbRef = useRef<AppDB | null>(null);
  const clientRef = useRef<SearchClient | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const closedRef = useRef(false);

  const dropSearch = useCallback(() => {
    clientRef.current?.terminate();
    clientRef.current = null;
    setSearchClient(null);
    setSearchStatus('idle');
  }, []);

  /** 他のタブの削除・移行を受けて、すべての接続を閉じる(自動では開き直さない) */
  const closeAll = useCallback(
    (reason: 'deleted' | 'upgraded') => {
      closedRef.current = true;
      dbRef.current?.close();
      dbRef.current = null;
      dropSearch();
      setStatus(reason === 'deleted' ? 'closed-deleted' : 'closed-upgraded');
    },
    [dropSearch],
  );

  const prepareSearch = useCallback(async () => {
    let client = clientRef.current;
    if (!client) {
      client = new SearchClient();
      client.onClosed = (reason) => closeAll(reason);
      clientRef.current = client;
      setSearchClient(client);
    }
    setSearchStatus('preparing');
    try {
      await client.prepare();
      if (clientRef.current === client) setSearchStatus('ready');
    } catch {
      if (clientRef.current === client) setSearchStatus('error');
    }
  }, [closeAll]);

  const loadMeta = useCallback(async (): Promise<AppMeta | null> => {
    const db = dbRef.current;
    if (!db) return null;
    const [m, busy] = await Promise.all([readMeta(db), isLockHeld()]);
    setMeta(m);
    setOtherTabBusy(busy && !importController.busy);
    setStale(m.lastImportedAt !== null && Date.now() - m.lastImportedAt > STALE_DAYS * 86_400_000);
    return m;
  }, []);

  /** 起動時の確認(APP-01) */
  const start = useCallback(async () => {
    if (closedRef.current) return;
    if (!isSupported()) {
      setStatus('unsupported');
      return;
    }
    if (!dbRef.current) {
      try {
        dbRef.current = await openAppDb({
          onBlocked: () => setStatus('blocked'),
          onTerminated: () => {
            dbRef.current = null;
            setStatus('unavailable');
          },
          onVersionChange: (v) => closeAll(v === null ? 'deleted' : 'upgraded'),
        });
      } catch {
        setStatus('unavailable');
        return;
      }
    }
    try {
      const m = await loadMeta();
      setStatus('ready');
      if (m && m.checkinCount > 0) await prepareSearch();
      else dropSearch();
    } catch {
      setStatus('unavailable');
    }
  }, [closeAll, dropSearch, loadMeta, prepareSearch]);

  /** 取り込みの後に、状態と検索用データを読み直す */
  const refresh = useCallback(async () => {
    if (closedRef.current || !dbRef.current) return;
    const m = await loadMeta();
    if (m && m.checkinCount > 0) await prepareSearch();
    else dropSearch();
  }, [dropSearch, loadMeta, prepareSearch]);

  const recordPersistRequest = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    await writeMetaValue(db, META_KEYS.persistRequestedAt, Date.now()).catch(() => undefined);
  }, []);

  useEffect(() => {
    // 保存領域の確認は非同期の外部処理。結果はコールバックの中で状態に反映する
    void Promise.resolve().then(start);

    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channelRef.current = channel;
    channel.onmessage = (e: MessageEvent<{ type?: string }>) => {
      if (e.data?.type === 'import-complete') void refresh();
    };

    const offCompleted = importController.onCompleted((result) => {
      // 初回は取り込みの完了時に永続化を求める(importController が要求し、ここでは日時を記録する)
      if (result.firstImport) void recordPersistRequest();
      void refresh();
      channel.postMessage({ type: 'import-complete' });
    });

    // 戻る/進むで bfcache から復帰したときは、離れている間の他のタブの操作を反映するため確認をやり直す(9.1.4)
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void start();
    };
    window.addEventListener('pageshow', onPageShow);
    // 別のタブでの取り込みの実行状況を、タブに戻ったときに確かめ直す
    const onVisible = () => {
      if (document.visibilityState === 'visible' && dbRef.current) void loadMeta();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      offCompleted();
      channel.close();
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadMeta, recordPersistRequest, refresh, start]);

  /** このブラウザのデータをすべて即時に削除する(DATA-03、9.5) */
  const deleteAllData = useCallback(
    async ({ wait, signal }: { wait: boolean; signal?: AbortSignal }): Promise<DeleteResult> => {
      const run = async (): Promise<DeleteResult> => {
        try {
          if (clientRef.current) await clientRef.current.dispose().catch(() => undefined);
          dropSearch();
          dbRef.current?.close();
          dbRef.current = null;
          await deleteAppDb(() => setDeleteBlocked(true));
          return 'deleted';
        } catch {
          return 'failed';
        } finally {
          setDeleteBlocked(false);
        }
      };
      let result: DeleteResult;
      try {
        result = wait
          ? await navigator.locks.request(DATA_LOCK_NAME, { signal }, run)
          : await navigator.locks.request(DATA_LOCK_NAME, { ifAvailable: true }, (lock) => (lock ? run() : 'busy'));
      } catch (error) {
        result = error instanceof DOMException && error.name === 'AbortError' ? 'aborted' : 'failed';
      }
      if (result === 'deleted') {
        importController.reset();
        channelRef.current?.postMessage({ type: 'data-deleted' });
        setMeta(EMPTY_META);
      }
      // 自分のタブは開き直して、空の状態から使えるようにする
      if (result === 'deleted' || result === 'failed') await start();
      return result;
    },
    [dropSearch, start],
  );

  const value = useMemo<AppState>(
    () => ({ deleteAllData, deleteBlocked, meta, otherTabBusy, recordPersistRequest, refresh, searchClient, searchStatus, stale, status }),
    [deleteAllData, deleteBlocked, meta, otherTabBusy, recordPersistRequest, refresh, searchClient, searchStatus, stale, status],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export const useAppState = (): AppState => {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('AppStateProvider is missing');
  return ctx;
};
