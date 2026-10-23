'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { GA_MEASUREMENT_ID } from '@/lib/constants';

type GaWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; __gaLoaded?: boolean };

/**
 * Google アナリティクス 4。位置履歴を扱わないページ(トップ・このアプリについて・プライバシーポリシー)だけに置く(TODO # 18)。
 * - layout には置かない。検索・取り込み・データ管理のページでは、スクリプトを読み込まず、何も送らない。
 * - Cookie は使わない設定にする(consent の既定をすべて denied)。広告機能(Google シグナル・広告のパーソナライズ)はオフ。
 * - 自動のページビューは止め(send_page_view: false)、パス(# 以降なし)だけを自分で送る。
 * - インラインの script は使わない(CSP のハッシュと合わないため)。Google のスクリプトを、コードから読み込む。
 * - Google への通信を許す CSP は、この 3 ページの HTML にだけ付く(scripts/inject-csp.mjs)。
 * - Google のスクリプトは、このサイトと同じオリジンで動く。ページを移動する前に、読み直して外す(ga-boundary.tsx)。
 */
export function GoogleAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    const w = window as GaWindow;
    if (!w.__gaLoaded) {
      w.__gaLoaded = true;
      w.dataLayer = w.dataLayer ?? [];
      // gtag.js は、引数の配列ではなく arguments オブジェクトそのものを dataLayer に積む前提で作られている
      w.gtag = function gtag() {
        // eslint-disable-next-line prefer-rest-params
        w.dataLayer?.push(arguments);
      };
      w.gtag('consent', 'default', { ad_personalization: 'denied', ad_storage: 'denied', ad_user_data: 'denied', analytics_storage: 'denied' });
      w.gtag('js', new Date());
      w.gtag('config', GA_MEASUREMENT_ID, { allow_ad_personalization_signals: false, allow_google_signals: false, send_page_view: false });
      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
      document.head.appendChild(script);
    }
    w.gtag?.('event', 'page_view', { page_location: `${window.location.origin}${pathname}`, page_path: pathname, page_title: document.title });
  }, [pathname]);

  return null;
}
