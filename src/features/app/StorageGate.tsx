'use client';

import type { ReactNode } from 'react';
import { Notice } from '@/components/ui/notice';
import { PageContainer, Skeleton } from '@/components/ui/misc';
import { useAppState } from './AppStateProvider';

/**
 * 保存領域を使う画面の入口。対応していないブラウザ・保存領域が使えない場合はエラー画面(SCR-E)を出す。
 */
export function StorageGate({ children, contained = false }: { children: ReactNode; contained?: boolean }) {
  const { status } = useAppState();
  if (status === 'ready') return <>{children}</>;
  if (status === 'closed-deleted' || status === 'closed-upgraded') return null;
  const fallback = <Fallback status={status} />;
  return contained ? <PageContainer>{fallback}</PageContainer> : fallback;
}

function Fallback({ status }: { status: ReturnType<typeof useAppState>['status'] }) {
  if (status === 'checking' || status === 'blocked') {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">読み込み中</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  if (status === 'unsupported') {
    return (
      <Notice tone="error" title="このブラウザには対応していません" role="alert">
        <p>このアプリは、ブラウザの保存領域(IndexedDB)と Web Worker などの機能を使います。</p>
        <p>Chrome・Edge・Safari・Firefox の最新版でお試しください。</p>
        <p className="text-xs opacity-80">エラーの種類: E-APP-UNSUPPORTED</p>
      </Notice>
    );
  }
  if (status === 'unavailable') {
    return (
      <Notice tone="error" title="ブラウザの保存領域を使えません" role="alert">
        <p>このブラウザでは、サイトのデータを保存できない状態になっています。</p>
        <ul className="list-disc pl-5">
          <li>プライベートブラウズ(シークレットモード)を使っている場合は、通常のウィンドウで開いてください。</li>
          <li>ブラウザの設定で、このサイトのデータ(Cookie とサイトデータ)の保存を許可してください。</li>
          <li>端末の空き容量が少ない場合は、空きを増やしてください。</li>
        </ul>
        <p className="text-xs opacity-80">エラーの種類: E-APP-STORAGE</p>
      </Notice>
    );
  }
  return null;
}
