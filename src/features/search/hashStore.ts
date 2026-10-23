'use client';

/**
 * 検索画面の状態(URL の # 以降)の読み取りと更新(8.1)。
 * # 以降は静的に書き出すときには存在しないため、ブラウザの中でだけ読む(useSyncExternalStore。最初の描画では null)。
 * Next.js の useSearchParams は ? 以降を扱うもので、# 以降には使えないため使わない。
 */
import { useMemo, useSyncExternalStore } from 'react';
import { buildSearchHash, parseSearchHash, type SearchHashState } from '@/lib/hashState';

const LOCAL_EVENT = 'ashiato:hashchange';

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  window.addEventListener('popstate', cb);
  window.addEventListener(LOCAL_EVENT, cb);
  return () => {
    window.removeEventListener('hashchange', cb);
    window.removeEventListener('popstate', cb);
    window.removeEventListener(LOCAL_EVENT, cb);
  };
};

const getSnapshot = () => window.location.hash;
const getServerSnapshot = (): string | null => null;

/** null = まだ読み取っていない(静的な HTML の描画中・ハイドレーション中) */
export const useSearchHash = (): SearchHashState | null => {
  const hash = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => (hash === null ? null : parseSearchHash(hash)), [hash]);
};

/**
 * 状態を URL に反映する。検索・ページ移動・詳細を開くは push、表示件数の変更や補正は replace(履歴を増やさない)。
 */
export const navigateSearchHash = (state: SearchHashState, mode: 'push' | 'replace') => {
  const url = `${window.location.pathname}${window.location.search}${buildSearchHash(state)}`;
  if (mode === 'push') window.history.pushState(null, '', url);
  else window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new Event(LOCAL_EVENT));
};
