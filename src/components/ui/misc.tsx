import type { ReactNode } from 'react';

/** 準備中・読み込み中の骨組み(5.5) */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-md bg-stone-200 dark:bg-stone-800 ${className}`} />;
}

/** 進捗バー。value は 0〜1 */
export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-3 w-full overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
    >
      <div className="h-full rounded-full bg-orange-600 transition-[width] dark:bg-orange-400" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** 本文の幅(約 768px)のコンテナ */
export function PageContainer({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-3xl px-4 ${className}`}>{children}</div>;
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="mb-6 text-2xl font-bold tracking-tight">{children}</h1>;
}

/** 件数などの数値の表示 */
export const formatCount = (n: number): string => n.toLocaleString('ja-JP');
