'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { pageSlots, totalPages } from '@/lib/pagination';

const btn =
  'inline-flex h-10 min-w-10 items-center justify-center rounded-lg px-3 text-sm text-stone-800 hover:bg-stone-200/70 disabled:pointer-events-none disabled:opacity-40 dark:text-stone-200 dark:hover:bg-stone-800';

/** ページ番号式のページネーション(5.6)。PC は最大7枠、スマホは「‹ 5 / 25 ›」 */
export function Pagination({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = totalPages(total, size);
  if (pages <= 1) return null;
  return (
    <nav aria-label="ページ" className="mt-8 flex items-center justify-center gap-1">
      <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="size-4" aria-hidden />
        <span className="hidden sm:inline">前へ</span>
        <span className="sr-only sm:hidden">前のページ</span>
      </button>
      <ul className="hidden items-center gap-1 sm:flex">
        {pageSlots(page, pages).map((s) =>
          typeof s === 'number' ? (
            <li key={s}>
              <button
                type="button"
                aria-current={s === page ? 'page' : undefined}
                className={`${btn} aria-[current=page]:bg-stone-800 aria-[current=page]:font-bold aria-[current=page]:text-white dark:aria-[current=page]:bg-stone-200 dark:aria-[current=page]:text-stone-900`}
                onClick={() => onPage(s)}
              >
                <span className="sr-only">ページ </span>
                {s}
              </button>
            </li>
          ) : (
            <li key={s} aria-hidden className="px-1 text-stone-500">
              …
            </li>
          ),
        )}
      </ul>
      <p className="px-3 text-sm sm:hidden">
        {page} / {pages}
      </p>
      <button type="button" className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <span className="hidden sm:inline">次へ</span>
        <span className="sr-only sm:hidden">次のページ</span>
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </nav>
  );
}
