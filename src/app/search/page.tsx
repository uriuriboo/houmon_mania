import type { Metadata } from 'next';
import { StorageGate } from '@/features/app/StorageGate';
import { SearchView } from '@/features/search/SearchView';

export const metadata: Metadata = { robots: { follow: false, index: false }, title: '検索' };

export default function SearchPage() {
  // SearchView は詳細シートの表示に合わせて自分で幅を決めるため、待機・エラーの表示だけを本文の幅で包む
  return (
    <StorageGate contained>
      <SearchView />
    </StorageGate>
  );
}
