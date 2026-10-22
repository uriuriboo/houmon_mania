import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<NoticeTone, { box: string; icon: ReactNode; label: string }> = {
  error: {
    box: 'border-red-300 bg-red-50 text-red-950 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100',
    icon: <CircleAlert className="mt-0.5 size-5 shrink-0 text-red-700 dark:text-red-400" aria-hidden />,
    label: 'エラー',
  },
  info: {
    box: 'border-stone-300 bg-white text-stone-800 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200',
    icon: <Info className="mt-0.5 size-5 shrink-0 text-stone-500 dark:text-stone-400" aria-hidden />,
    label: 'お知らせ',
  },
  success: {
    box: 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
    icon: <CircleCheck className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />,
    label: '完了',
  },
  warning: {
    box: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
    icon: <TriangleAlert className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />,
    label: '注意',
  },
};

/** その場に表示するお知らせ・エラー(5.5) */
export function Notice({
  tone = 'info',
  title,
  children,
  role,
  className = '',
}: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div role={role} className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${t.box} ${className}`}>
      {t.icon}
      <div className="min-w-0 flex-1 space-y-1">
        <span className="sr-only">{t.label}: </span>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}
