'use client';

import Link from 'next/link';
import { Search, Upload } from 'lucide-react';
import { buttonClasses } from '@/components/ui/button';
import { formatCount } from '@/components/ui/misc';
import { useAppState } from './AppStateProvider';

/** トップの「はじめる」/「検索する」(データの有無で切り替える) */
export function HomeActions() {
  const { status, meta } = useAppState();
  const hasData = status === 'ready' && meta.checkinCount > 0;
  if (hasData) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/search" className={buttonClasses('primary', 'lg')}>
          <Search className="size-5" aria-hidden />
          検索する
        </Link>
        <p className="text-sm text-stone-600 dark:text-stone-400">このブラウザに {formatCount(meta.checkinCount)} 件のチェックインがあります</p>
      </div>
    );
  }
  return (
    <Link href="/import" className={buttonClasses('primary', 'lg')}>
      <Upload className="size-5" aria-hidden />
      はじめる
    </Link>
  );
}
