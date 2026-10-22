'use client';

import { ExternalLink, ImageOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/misc';
import { Notice } from '@/components/ui/notice';
import { formatDetailDateTime } from '@/lib/datetime';
import type { CheckinView, PhotoRecord } from '@/lib/model';
import { cleanDisplayText } from '@/lib/text';
import { buildPhotoUrl, buildVenueUrl } from '@/lib/urls';
import { primaryName, secondaryName, visibilityLabel } from './display';

function Photo({ photo, index }: { photo: PhotoRecord; index: number }) {
  const [failed, setFailed] = useState(false);
  const src = buildPhotoUrl(photo, 'width960');
  if (!src || failed) {
    return (
      <div className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg bg-stone-100 p-3 text-center text-xs text-stone-500 dark:bg-stone-800 dark:text-stone-400">
        <ImageOff className="size-5" aria-hidden />
        写真を表示できません
        <span className="text-[11px]">(非公開の写真、またはオフライン)</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={`写真 ${index + 1}`}
      width={photo.width ?? undefined}
      height={photo.height ?? undefined}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-auto w-full rounded-lg bg-stone-100 dark:bg-stone-800"
    />
  );
}

/**
 * チェックインの詳細(SCR-04、F-33)。保存データだけで表示する。
 * PC は一覧の右側のシート、スマホは全画面。
 */
export function CheckinDetailSheet({ item, loading, onClose }: { item: CheckinView | null; loading: boolean; onClose: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [item?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const venueUrl = item ? buildVenueUrl(item.venue_id) : null;
  const sub = item ? secondaryName(item) : null;

  return (
    <aside
      aria-labelledby="checkin-detail-title"
      className="fixed inset-0 z-40 overflow-y-auto overscroll-contain bg-white dark:bg-stone-900 lg:inset-auto lg:top-14 lg:right-0 lg:bottom-0 lg:w-[28rem] lg:border-l lg:border-stone-200 lg:shadow-xl dark:lg:border-stone-800"
    >
      <div className="sticky top-0 flex items-center justify-between border-b border-stone-200 bg-white/95 px-4 py-2 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95">
        <span className="text-sm text-stone-600 dark:text-stone-400">チェックインの詳細</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
        >
          <X className="size-5" aria-hidden />
          閉じる
        </button>
      </div>

      <div className="space-y-5 p-5">
        {loading && !item && (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {!loading && !item && (
          <Notice tone="warning" title="このチェックインは見つかりません">
            削除されたか、まだ取り込まれていない可能性があります。
          </Notice>
        )}
        {item && (
          <>
            <div className="space-y-1">
              <h2 id="checkin-detail-title" ref={headingRef} tabIndex={-1} className="text-xl font-bold break-words outline-none">
                {primaryName(item)}
              </h2>
              {sub && <p className="text-sm break-words text-stone-500 dark:text-stone-400">{sub}</p>}
              <p className="text-sm text-stone-600 dark:text-stone-400">
                <time>{formatDetailDateTime(item.created_at, item.tz_offset)}</time>
              </p>
            </div>

            {item.shout && <p className="text-base leading-relaxed break-words whitespace-pre-line">「{cleanDisplayText(item.shout)}」</p>}

            {item.photos.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                {item.photos.map((p, i) => (
                  <Photo key={p.photo_id} photo={p} index={i} />
                ))}
              </div>
            )}
            {item.photo_count > 0 && item.photos.length === 0 && <p className="text-sm text-stone-500">写真の情報がありません。</p>}

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {item.event_name && (
                <>
                  <dt className="text-stone-500 dark:text-stone-400">イベント</dt>
                  <dd className="break-words">{cleanDisplayText(item.event_name)}</dd>
                </>
              )}
              {item.location_name && item.venue_name && (
                <>
                  <dt className="text-stone-500 dark:text-stone-400">場所名</dt>
                  <dd className="break-words">{cleanDisplayText(item.location_name)}</dd>
                </>
              )}
              <dt className="text-stone-500 dark:text-stone-400">公開範囲</dt>
              <dd>{visibilityLabel(item.visibility)}</dd>
              <dt className="text-stone-500 dark:text-stone-400">コメント</dt>
              <dd>{item.comment_count} 件</dd>
            </dl>

            {venueUrl && (
              <p>
                <a href={venueUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-medium">
                  Foursquare で店を見る
                  <ExternalLink className="size-4" aria-hidden />
                  <span className="sr-only">(新しいタブで開きます)</span>
                </a>
                <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">住所やカテゴリは、リンク先で確認できます。</span>
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
