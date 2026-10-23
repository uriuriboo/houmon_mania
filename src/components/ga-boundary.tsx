'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { PUBLIC_PATHS } from '@/lib/constants';

/**
 * Google のスクリプトを読み込んだページから、位置履歴を扱うページ(検索・取り込み・データ管理)へ画面内で移動したら、
 * ページを読み直す。読み直すと、移動先の HTML の CSP(Google への通信を許さない)に戻り、Google のスクリプトも外れる。
 * 画面内の移動のままだと、最初のページの緩い CSP と Google のスクリプトが、検索ページにも残ってしまう。
 * layout に置く。Google のスクリプトを読み込んでいないときは、何もしない。
 */
export function GaBoundary() {
  const pathname = usePathname();
  useEffect(() => {
    const loaded = (window as Window & { __gaLoaded?: boolean }).__gaLoaded;
    if (loaded && !(PUBLIC_PATHS as readonly string[]).includes(pathname)) window.location.reload();
  }, [pathname]);
  return null;
}
