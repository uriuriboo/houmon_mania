/**
 * リンク・画像の URL の組み立て(9.4、P-6)。読み込んだ URL はそのまま使わず、検証した ID や許可したパターンから組み立てる。
 */
import { PHOTO_PREFIX_RE, PHOTO_SUFFIX_RE } from '@/lib/export/records';
import type { PhotoRecord } from '@/lib/model';

const HEX24 = /^[0-9a-f]{24}$/u;

/** Foursquare 上の店ページ */
export const buildVenueUrl = (venueId: string | null): string | null =>
  venueId !== null && HEX24.test(venueId) ? `https://foursquare.com/v/${venueId}` : null;

/**
 * 写真のサイズ指定(Foursquare の画像 CDN の書式: prefix + サイズ + suffix)。
 * 一覧のサムネイルは中央で切り抜いた正方形、詳細は幅を指定する。
 */
export type PhotoSize = '100x100' | '300x300' | 'width960';

/** 写真の URL。表示時にもパターンを再確認し、一致しなければ null */
export const buildPhotoUrl = (photo: Pick<PhotoRecord, 'prefix' | 'suffix'>, size: PhotoSize): string | null => {
  if (!PHOTO_PREFIX_RE.test(photo.prefix) || !PHOTO_SUFFIX_RE.test(photo.suffix)) return null;
  return `${photo.prefix}${size}${photo.suffix}`;
};
