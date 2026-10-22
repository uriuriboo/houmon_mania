/**
 * チェックインの表示用の値(5.4)。読み込んだ文字列は、表示の前に制御文字と双方向制御文字を取り除く。
 */
import type { CheckinView } from '@/lib/model';
import { cleanDisplayText } from '@/lib/text';

/**
 * 主に表示する名前。現地語の店名(canonicalName)があればそれを、無ければ店名、場所名、イベント名の順。
 * 2026年版のエクスポートでは、name が英字表記で canonicalName に日本語の店名が入っていることがある。
 */
export const primaryName = (c: Pick<CheckinView, 'venue_canonical_name' | 'venue_name' | 'location_name' | 'event_name'>): string =>
  cleanDisplayText(c.venue_canonical_name ?? c.venue_name ?? c.location_name ?? c.event_name ?? '') || '(場所なし)';

/** 補助の名前(英字表記)。主な名前と違う場合だけ */
export const secondaryName = (c: Pick<CheckinView, 'venue_canonical_name' | 'venue_name'>): string | null =>
  c.venue_canonical_name && c.venue_name && c.venue_name !== c.venue_canonical_name ? cleanDisplayText(c.venue_name) : null;

/** 一覧では「非公開」「親しい友達」のときだけ表示する */
export const listVisibilityLabel = (v: string | null): string | null => (v === 'private' ? '非公開' : v === 'closeFriends' ? '親しい友達' : null);

export const visibilityLabel = (v: string | null): string => {
  switch (v) {
    case 'private':
      return '非公開';
    case 'closeFriends':
      return '親しい友達';
    case 'public':
      return '公開';
    case 'friends':
      return '友達';
    case null:
      return '記録なし';
    default:
      return cleanDisplayText(v);
  }
};
