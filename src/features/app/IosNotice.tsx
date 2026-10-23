'use client';

import { Smartphone } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Notice } from '@/components/ui/notice';

const noop = () => () => undefined;

/** iPhone・iPad の Safari で開いているか(ホーム画面のアプリとして開いている場合は false) */
const detectIosBrowser = (): boolean => {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/u.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
};

/**
 * iPhone・iPad では、取り込みの前にホーム画面に追加し、ホーム画面のアイコンから開いて取り込むよう案内する(9.1.2、R-6a)。
 * Safari とホーム画面のアプリは保存領域が別のため。
 */
export function IosNotice({ always = false }: { always?: boolean }) {
  const isIosBrowser = useSyncExternalStore(noop, detectIosBrowser, () => false);
  if (!always && !isIosBrowser) return null;
  return (
    <Notice tone={isIosBrowser ? 'warning' : 'info'} title="iPhone・iPad をお使いの場合">
      <p className="flex items-start gap-2">
        <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          先にこのページを<strong>ホーム画面に追加</strong>し、ホーム画面のアイコンから開いて読み込んでください(共有ボタン →「ホーム画面に追加」)。
          Safari で読み込んだデータは、ホーム画面から開いたアプリでは見えません。ホーム画面から使うと、データが消えにくくなります。
        </span>
      </p>
    </Notice>
  );
}
