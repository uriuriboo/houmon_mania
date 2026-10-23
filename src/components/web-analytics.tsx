'use client';

import { inject, pageview } from '@vercel/analytics';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Vercel Web Analytics(Cookie なし)。位置履歴を扱わないページ(トップ・このアプリについて・プライバシーポリシー)だけに置く。
 * - layout には置かない。検索・取り込み・データ管理のページでは、スクリプトを読み込まず、何も送らない。
 * - 自動の計測は止め(disableAutoTrack)、このコンポーネントがあるページの表示だけを、パス(# 以降なし)で送る。
 * - mode を production に固定する。既定のままだと、開発時に外部(va.vercel-scripts.com)からスクリプトを読み込む。
 *   本番では自サイトの /_vercel/insights/script.js から読み込み、CSP(script-src・connect-src の 'self')を広げずに済む。
 */
export function WebAnalytics() {
  const pathname = usePathname();
  useEffect(() => {
    inject({ mode: 'production', disableAutoTrack: true });
    pageview({ route: pathname, path: pathname });
  }, [pathname]);
  return null;
}
