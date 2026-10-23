'use client';

import { Camera } from 'lucide-react';
import { listVisibilityLabel, primaryName, secondaryName } from '@/features/checkin/display';
import { formatListDateTime, formatMonthHeading, monthKey } from '@/lib/datetime';
import type { CheckinView } from '@/lib/model';
import { cleanDisplayText } from '@/lib/text';

type Group = { key: string; heading: string; items: CheckinView[] };

/** ページ内で連続する同じ年月(現地時刻)ごとにまとめる(5.4) */
const groupByMonth = (items: CheckinView[]): Group[] => {
  const groups: Group[] = [];
  for (const c of items) {
    const key = monthKey(c.created_at, c.tz_offset);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(c);
    else groups.push({ heading: formatMonthHeading(c.created_at, c.tz_offset), items: [c], key });
  }
  return groups;
};

/** タイムライン型の一覧(5.5) */
export function Timeline({ items, selectedId, onSelect }: { items: CheckinView[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-6">
      {groupByMonth(items).map((g, gi) => (
        <section key={`${g.key}-${gi}`} aria-label={g.heading}>
          <h2 className="mb-2 text-sm font-bold text-stone-600 dark:text-stone-400">{g.heading}</h2>
          <ol className="border-l-2 border-stone-200 dark:border-stone-800">
            {g.items.map((c) => {
              const vis = listVisibilityLabel(c.visibility);
              const sub = secondaryName(c);
              const shout = c.shout ? cleanDisplayText(c.shout) : null;
              return (
                <li key={c.id} className="relative">
                  <span
                    aria-hidden
                    className="absolute top-5 -left-[7px] size-3 rounded-full border-2 border-stone-50 bg-orange-600 dark:border-stone-950 dark:bg-orange-400"
                  />
                  <button
                    type="button"
                    data-checkin-id={c.id}
                    aria-current={selectedId === c.id ? 'true' : undefined}
                    onClick={() => onSelect(c.id)}
                    className="ml-3 block w-[calc(100%-0.75rem)] rounded-lg px-3 py-3 text-left hover:bg-stone-100 aria-[current=true]:bg-orange-50 dark:hover:bg-stone-900 dark:aria-[current=true]:bg-orange-950/40"
                  >
                    <span className="flex items-baseline justify-between gap-3 text-xs text-stone-600 dark:text-stone-400">
                      <time>{formatListDateTime(c.created_at, c.tz_offset)}</time>
                      <span className="flex shrink-0 items-center gap-2">
                        {c.photo_count > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Camera className="size-3.5" aria-hidden />
                            写真 {c.photo_count}枚
                          </span>
                        )}
                        {vis && <span className="rounded bg-stone-200 px-1.5 py-0.5 text-[11px] dark:bg-stone-800">{vis}</span>}
                      </span>
                    </span>
                    <span className="mt-0.5 block font-semibold break-words">{primaryName(c)}</span>
                    {sub && <span className="block text-xs break-words text-stone-500 dark:text-stone-400">{sub}</span>}
                    {shout && <span className="mt-1 line-clamp-2 block text-sm break-words whitespace-pre-line text-stone-700 dark:text-stone-300">「{shout}」</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
