'use client';

import Link from 'next/link';
import { CircleHelp, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, buttonClasses } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { formatCount, PageContainer, Skeleton } from '@/components/ui/misc';
import { Notice } from '@/components/ui/notice';
import { useAppState } from '@/features/app/AppStateProvider';
import { CheckinDetailSheet } from '@/features/checkin/CheckinDetail';
import { PAGE_SIZES, STALE_DAYS } from '@/lib/constants';
import type { CheckinView } from '@/lib/model';
import { pageRange } from '@/lib/pagination';
import { parseSearchQuery, SearchQueryError, type ParsedSearchQuery } from '@/lib/query/parse';
import type { SearchResults } from '@/lib/workers/protocol';
import { navigateSearchHash, useSearchHash } from './hashStore';
import { Pagination } from './Pagination';
import { SearchHelpContent } from './SearchHelp';
import { Timeline } from './Timeline';

type Parsed = ({ ok: true } & ParsedSearchQuery) | { ok: false; message: string };

const safeParse = (q: string): Parsed => {
  try {
    return { ok: true, ...parseSearchQuery(q) };
  } catch (e) {
    return { message: e instanceof SearchQueryError ? e.message : '検索式を解釈できませんでした。', ok: false };
  }
};

// 詳細を「開く」で履歴に積んだかどうか(閉じるときに戻るか、置き換えるかを決める)
let detailPushed = false;

function ResultsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">読み込み中</span>
      <Skeleton className="h-4 w-40" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function SearchView() {
  const hash = useSearchHash();
  const { status, meta, searchStatus, searchClient, otherTabBusy, stale } = useAppState();
  const [helpOpen, setHelpOpen] = useState(false);
  const listTopRef = useRef<HTMLDivElement>(null);

  // 検索ボックスの入力値。URL の検索式が(戻る/進むなどで)変わったら合わせる
  const [input, setInput] = useState('');
  const [syncedQ, setSyncedQ] = useState<string | null>(null);
  if (hash && hash.q !== syncedQ) {
    setSyncedQ(hash.q);
    setInput(hash.q);
  }

  const q = hash?.q ?? null;
  const page = hash?.page ?? 1;
  const size = hash?.size ?? 50;
  const selectedId = hash?.id ?? null;
  const parsed = useMemo(() => (q === null ? null : safeParse(q)), [q]);
  const ready = searchStatus === 'ready' && searchClient !== null;

  // ── 検索 ──
  const searchKey = parsed?.ok ? `${q}\u0000${page}\u0000${size}` : null;
  const [result, setResult] = useState<{ key: string; data: SearchResults } | null>(null);
  const [searchFailed, setSearchFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !searchKey || !parsed?.ok || !hash) return;
    let cancelled = false;
    searchClient
      .search(parsed.ast, page, size)
      .then((data) => {
        if (cancelled) return;
        setResult({ data, key: searchKey });
        setSearchFailed(null);
        // 範囲外のページは補正する(履歴は増やさない)
        if (data.page !== page) navigateSearchHash({ ...hash, page: data.page }, 'replace');
      })
      .catch(() => {
        if (!cancelled) setSearchFailed(searchKey);
      });
    return () => {
      cancelled = true;
    };
    // hash は id の変化でも変わるため、検索の条件(searchKey)だけで実行する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, searchKey, searchClient]);

  const current = result && result.key === searchKey ? result.data : null;
  const loading = parsed?.ok === true && !current && searchFailed !== searchKey;

  // ── 詳細 ──
  const [detail, setDetail] = useState<{ id: string; item: CheckinView | null } | null>(null);
  const fromList = selectedId ? current?.items.find((c) => c.id === selectedId) : undefined;
  const detailItem = fromList ?? (detail && detail.id === selectedId ? detail.item : null);
  const detailLoading = selectedId !== null && !fromList && (!detail || detail.id !== selectedId);

  useEffect(() => {
    if (!ready || !selectedId || fromList) return;
    let cancelled = false;
    searchClient
      .detail(selectedId)
      .then((item) => {
        if (!cancelled) setDetail({ id: selectedId, item });
      })
      .catch(() => {
        if (!cancelled) setDetail({ id: selectedId, item: null });
      });
    return () => {
      cancelled = true;
    };
  }, [ready, selectedId, fromList, searchClient]);

  // 詳細を閉じたら、一覧の同じ項目にフォーカスを戻す
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId) {
      lastSelected.current = selectedId;
    } else if (lastSelected.current) {
      document.querySelector<HTMLElement>(`[data-checkin-id="${lastSelected.current}"]`)?.focus();
      lastSelected.current = null;
      detailPushed = false;
    }
  }, [selectedId]);

  const openDetail = (id: string) => {
    if (!hash) return;
    if (hash.id) {
      navigateSearchHash({ ...hash, id }, 'replace');
    } else {
      navigateSearchHash({ ...hash, id }, 'push');
      detailPushed = true;
    }
  };

  const closeDetail = useCallback(() => {
    if (detailPushed) {
      detailPushed = false;
      window.history.back();
    } else {
      const s = { ...(hash ?? { page: 1, q: '', size: 50 }), id: null };
      navigateSearchHash(s, 'replace');
    }
  }, [hash]);

  // ── 操作 ──
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!hash) return;
    navigateSearchHash({ id: null, page: 1, q: input.trim(), size: hash.size }, 'push');
  };
  const goPage = (p: number) => {
    if (!hash) return;
    navigateSearchHash({ ...hash, id: null, page: p }, 'push');
    listTopRef.current?.scrollIntoView({ block: 'start' });
  };
  const changeSize = (s: number) => {
    if (!hash) return;
    navigateSearchHash({ ...hash, page: 1, size: s }, 'replace');
  };

  const hasData = status === 'ready' && meta.checkinCount > 0;
  const partial = meta.importInProgress !== null && !otherTabBusy;

  if (status === 'ready' && !hasData) {
    return (
      <PageContainer>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold">検索</h1>
          <Notice tone="info" title="このブラウザにはデータがありません">
            <p>
              エクスポートを読み込むと検索できます。以前に読み込んだのに消えている場合は、ブラウザがデータを消した可能性があります(Safari は 7
              日間サイトを開かないと消すことがあります。ホーム画面に追加して使うと避けられます)。エクスポートを読み込み直せば元に戻ります。
            </p>
          </Notice>
          <Link href="/import" className={buttonClasses('primary', 'lg')}>
            データを取り込む
          </Link>
        </div>
      </PageContainer>
    );
  }

  const range = current ? pageRange(current.page, size, current.total) : null;

  return (
    <>
      <div className={selectedId ? 'lg:pr-[28rem]' : ''}>
        <PageContainer>
          <h1 className="sr-only">検索</h1>
          <form role="search" onSubmit={submit} className="flex gap-2">
            <label htmlFor="q" className="sr-only">
              検索式
            </label>
            <input
              id="q"
              type="search"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="店名・コメントで検索"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="search"
              aria-invalid={parsed?.ok === false || undefined}
              aria-describedby={parsed?.ok === false ? 'q-error' : undefined}
              className="h-11 min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-3 text-base placeholder:text-stone-400 dark:border-stone-700 dark:bg-stone-900"
            />
            <Button type="submit" size="lg" className="h-11 px-4">
              <Search className="size-5" aria-hidden />
              <span className="hidden sm:inline">検索</span>
              <span className="sr-only sm:hidden">検索</span>
            </Button>
            <Button variant="ghost" size="lg" className="h-11 px-3" onClick={() => setHelpOpen(true)}>
              <CircleHelp className="size-5" aria-hidden />
              <span className="sr-only">検索の書き方</span>
            </Button>
          </form>

          {parsed?.ok === false && (
            <div id="q-error" role="alert" className="mt-2">
              <Notice tone="error">
                <p>{parsed.message}</p>
                <button type="button" className="mt-1 text-sm underline" onClick={() => setHelpOpen(true)}>
                  検索の書き方を見る
                </button>
              </Notice>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {partial && (
              <Notice tone="warning">
                前回の取り込みが途中で終わっています。保存済みの分は検索できます。<Link href="/import">もう一度読み込んでください</Link>。
              </Notice>
            )}
            {stale && !partial && (
              <Notice tone="info">
                最後の取り込みから {STALE_DAYS} 日以上たっています。新しいチェックインを反映するには、エクスポートを申請して<Link href="/import">読み込み直してください</Link>。
              </Notice>
            )}
            {searchStatus === 'error' && (
              <Notice tone="error" role="alert" title="検索の準備ができませんでした">
                再読み込みしてください。<span className="text-xs opacity-80">エラーの種類: E-SEARCH-PREPARE</span>
              </Notice>
            )}
            {searchFailed === searchKey && searchKey !== null && (
              <Notice tone="error" role="alert" title="検索できませんでした">
                再読み込みしてください。<span className="text-xs opacity-80">エラーの種類: E-SEARCH-QUERY</span>
              </Notice>
            )}
          </div>

          <div ref={listTopRef} className="scroll-mt-20 pt-4">
            {parsed?.ok && parsed.ast && <p className="text-sm text-stone-600 dark:text-stone-400">解釈: {parsed.interpretation}</p>}

            {(loading || !hash) && parsed?.ok !== false ? (
              <div className="mt-4">
                <ResultsSkeleton />
              </div>
            ) : current && range ? (
              <>
                <div className="mt-1 mb-4 flex items-center justify-between gap-3">
                  <p className="text-sm" aria-live="polite">
                    {current.total > 0 ? (
                      <>
                        <strong>{formatCount(current.total)}</strong>件中 {formatCount(range.from)}–{formatCount(range.to)}件
                      </>
                    ) : (
                      '0件'
                    )}
                  </p>
                  <label className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
                    表示件数
                    <select
                      value={size}
                      onChange={(e) => changeSize(Number(e.target.value))}
                      className="h-8 rounded-md border border-stone-300 bg-white px-2 text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                    >
                      {PAGE_SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {current.total === 0 ? (
                  <Notice tone="info" title={`「${q}」に一致するチェックインはありませんでした`}>
                    <ul className="list-disc space-y-1 pl-5">
                      <li>検索の対象は、店名(英語表記・現地語)・コメント・場所名・イベント名です。住所・カテゴリでは検索できません。</li>
                      <li>語を減らすか、OR でつないでみてください(例: ラーメン OR らーめん)。ひらがなとカタカナは区別します。</li>
                    </ul>
                  </Notice>
                ) : (
                  <>
                    <Timeline items={current.items} selectedId={selectedId} onSelect={openDetail} />
                    <Pagination page={current.page} total={current.total} size={size} onPage={goPage} />
                  </>
                )}
              </>
            ) : null}
          </div>
        </PageContainer>
      </div>

      {selectedId && <CheckinDetailSheet item={detailItem} loading={detailLoading} onClose={closeDetail} />}

      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} title="検索の書き方" size="lg">
        <SearchHelpContent />
      </Dialog>
    </>
  );
}
