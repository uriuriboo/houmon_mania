/**
 * チェックインレコード・写真の情報の検証と組み立て直し(9.2.3、F-13、P-5・P-6)。
 *
 * 2026-10 に取得した実物のエクスポート(S-1)で確認した形式:
 * - checkins*.json: {"count": N, "items": [...]}。1000件ずつ分割
 *   id(24桁の16進数)、createdAt("YYYY-MM-DD HH:MM:SS.ffffff"、UTC)、type、visibility(無いこともある)、
 *   timeZoneOffset、shout(任意)、venue{id, name, canonicalName(任意), url}、lat/lng(トップレベル)、hacc、
 *   comments{count}、event{id, name, categories, canonicalUrl}(任意)、canonicalUrl、editableUntil、entities
 * - photos*.json: id、createdAt、prefix(https://fastly.4sqi.net/img/general/)、suffix(/数字_英数字.jpg)、
 *   width、height、visibility、fullUrl、relatedItemUrl(https://swarmapp.com/checkin/{チェックインID})、canonicalUrl
 */
import { LIMITS } from '@/lib/constants';
import { parseCreatedAt } from '@/lib/datetime';
import { contentHash } from '@/lib/hash';
import type { CheckinRecord, PhotoRecord, RawCheckin, SearchIndexRecord } from '@/lib/model';
import { codePointLength, normalizeForSearch, utf8ByteLength } from '@/lib/text';
import { z } from '@/lib/zod';

const HEX24 = /^[0-9a-f]{24}$/u;
const hex24 = z.string().regex(HEX24);

/** 写真の prefix と suffix の許可パターン(9.4)。表示時にも再確認する */
export const PHOTO_PREFIX_RE = /^https:\/\/[a-z0-9-]{1,32}\.4sqi\.net\/img\/general\/$/u;
export const PHOTO_SUFFIX_RE = /^\/[A-Za-z0-9_-]{1,200}\.(?:jpg|jpeg|png|gif|webp)$/u;
const VENUE_URL_RE = /^https:\/\/(?:app\.|www\.)?foursquare\.com\/v\/[^\s"'<>]{1,1500}$/u;

/** 型・範囲が不正な任意項目は null 扱いにする(.catch)。id・createdAt が不正なレコードは取り込まない */
const optionalString = z.string().optional().catch(undefined);
const lat = z.number().min(-90).max(90).optional().catch(undefined);
const lng = z.number().min(-180).max(180).optional().catch(undefined);

const checkinSchema = z.object({
  comments: z.object({ count: z.number().int().min(0).max(1_000_000) }).optional().catch(undefined),
  createdAt: z.union([z.string().max(40), z.number().int()]),
  event: z.object({ id: hex24.optional().catch(undefined), name: optionalString }).optional().catch(undefined),
  id: hex24,
  lat,
  lng,
  location: z.object({ lat, lng, name: optionalString }).optional().catch(undefined),
  private: z.boolean().optional().catch(undefined),
  shout: optionalString,
  timeZoneOffset: z.number().int().min(-720).max(840).optional().catch(undefined),
  type: z.string().max(32).optional().catch(undefined),
  venue: z
    .object({ canonicalName: optionalString, id: hex24, name: z.string(), url: optionalString })
    .optional()
    .catch(undefined),
  visibility: z.string().max(32).optional().catch(undefined),
});

/** 保存も警告もしない、既知の項目(実物と旧形式で確認したもの) */
const KNOWN_CHECKIN_KEYS = new Set([
  'canonicalUrl',
  'comments',
  'createdAt',
  'editableUntil',
  'entities',
  'event',
  'hacc',
  'id',
  'lat',
  'lng',
  'location',
  'private',
  'shout',
  'timeZoneOffset',
  'type',
  'venue',
  'visibility',
  // API 由来の旧形式に含まれうる項目(読み込まない)
  'createdBy',
  'isMayor',
  'likes',
  'overlaps',
  'photos',
  'posts',
  'score',
  'source',
  'sticker',
  'with',
]);

const SAFE_KEY_RE = /^[A-Za-z0-9_]{1,40}$/u;

export type CheckinValidation =
  | { ok: true; raw: RawCheckin; createdAt: number }
  | { ok: false; id: string | null; reason: 'NOT_OBJECT' | 'SCHEMA' | 'CREATED_AT' | 'TOO_LONG' | 'TOO_LARGE' };

/** 未知の項目名を集める(形式の変更の検知のため。項目名だけで、値は持たない) */
export const collectUnknownKeys = (item: unknown, into: Set<string>): void => {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return;
  for (const key of Object.keys(item)) {
    if (into.size >= LIMITS.maxUnknownKeys) return;
    if (!KNOWN_CHECKIN_KEYS.has(key) && SAFE_KEY_RE.test(key)) into.add(key);
  }
};

const idOf = (item: unknown): string | null => {
  if (typeof item !== 'object' || item === null) return null;
  const id = (item as { id?: unknown }).id;
  return typeof id === 'string' && HEX24.test(id) ? id : null;
};

const tooLong = (s: string | undefined, max: number): boolean => s !== undefined && codePointLength(s) > max;

/**
 * チェックインレコードを検証し、許可した項目だけで raw を組み立て直す。
 * 読み込んだオブジェクトをそのままコピーしない(__proto__ などのキーを持ち込まない)。
 * 文字列が長すぎるレコードは、切り詰めずに不正として扱う(6.2)。
 */
export const validateCheckin = (item: unknown, now: number = Date.now()): CheckinValidation => {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return { id: null, ok: false, reason: 'NOT_OBJECT' };
  const parsed = checkinSchema.safeParse(item);
  if (!parsed.success) return { id: idOf(item), ok: false, reason: 'SCHEMA' };
  const r = parsed.data;
  const createdAt = parseCreatedAt(r.createdAt, now);
  if (createdAt === null) return { id: r.id, ok: false, reason: 'CREATED_AT' };

  const names = [r.venue?.name, r.venue?.canonicalName, r.location?.name, r.event?.name];
  if (names.some((s) => tooLong(s, LIMITS.nameMaxChars)) || tooLong(r.shout, LIMITS.shoutMaxChars)) {
    return { id: r.id, ok: false, reason: 'TOO_LONG' };
  }

  const raw: RawCheckin = { createdAt: r.createdAt, id: r.id };
  if (r.type !== undefined) raw.type = r.type;
  if (r.visibility !== undefined) raw.visibility = r.visibility;
  if (r.private !== undefined) raw.private = r.private;
  if (r.shout !== undefined) raw.shout = r.shout;
  if (r.timeZoneOffset !== undefined) raw.timeZoneOffset = r.timeZoneOffset;
  if (r.venue) {
    raw.venue = { id: r.venue.id, name: r.venue.name };
    if (r.venue.canonicalName !== undefined) raw.venue.canonicalName = r.venue.canonicalName;
    if (r.venue.url !== undefined && VENUE_URL_RE.test(r.venue.url)) raw.venue.url = r.venue.url;
  }
  if (r.location && (r.location.name !== undefined || r.location.lat !== undefined || r.location.lng !== undefined)) {
    raw.location = {};
    if (r.location.name !== undefined) raw.location.name = r.location.name;
    if (r.location.lat !== undefined && r.location.lng !== undefined) {
      raw.location.lat = r.location.lat;
      raw.location.lng = r.location.lng;
    }
  }
  if (r.lat !== undefined && r.lng !== undefined) {
    raw.lat = r.lat;
    raw.lng = r.lng;
  }
  if (r.event && (r.event.id !== undefined || r.event.name !== undefined)) {
    raw.event = {};
    if (r.event.id !== undefined) raw.event.id = r.event.id;
    if (r.event.name !== undefined) raw.event.name = r.event.name;
  }
  if (r.comments) raw.comments = { count: r.comments.count };

  if (utf8ByteLength(JSON.stringify(raw)) > LIMITS.rawMaxBytes) return { id: r.id, ok: false, reason: 'TOO_LARGE' };
  return { createdAt, ok: true, raw };
};

// ───────────────────────── 写真の情報 ─────────────────────────
const photoSchema = z.object({
  createdAt: z.union([z.string().max(40), z.number().int()]).optional().catch(undefined),
  height: z.number().int().min(1).max(100_000).optional().catch(undefined),
  id: hex24,
  prefix: z.string().regex(PHOTO_PREFIX_RE),
  relatedItemUrl: z.string().max(500),
  suffix: z.string().regex(PHOTO_SUFFIX_RE),
  visibility: z.string().max(32).optional().catch(undefined),
  width: z.number().int().min(1).max(100_000).optional().catch(undefined),
});

const RELATED_HOSTS = new Set(['swarmapp.com', 'www.swarmapp.com', 'foursquare.com', 'www.foursquare.com', 'app.foursquare.com']);

/** relatedItemUrl の末尾からチェックインID を取り出す(例: https://swarmapp.com/checkin/{id}) */
export const checkinIdFromRelatedUrl = (url: string): string | null => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || !RELATED_HOSTS.has(u.hostname)) return null;
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length < 2 || !/^checkins?$/u.test(segments[segments.length - 2]!)) return null;
  const last = segments[segments.length - 1]!;
  return HEX24.test(last) ? last : null;
};

export type PhotoValidation = { ok: true; photo: PhotoRecord } | { ok: false };

export const validatePhoto = (item: unknown, now: number = Date.now()): PhotoValidation => {
  const parsed = photoSchema.safeParse(item);
  if (!parsed.success) return { ok: false };
  const p = parsed.data;
  const checkinId = checkinIdFromRelatedUrl(p.relatedItemUrl);
  if (checkinId === null) return { ok: false };
  return {
    ok: true,
    photo: {
      checkin_id: checkinId,
      created_at: p.createdAt === undefined ? null : parseCreatedAt(p.createdAt, now),
      height: p.height ?? null,
      photo_id: p.id,
      prefix: p.prefix,
      suffix: p.suffix,
      visibility: p.visibility ?? null,
      width: p.width ?? null,
    },
  };
};

/** 写真の表示順(投稿日時の昇順、同時刻は ID 順) */
export const comparePhotos = (a: PhotoRecord, b: PhotoRecord): number =>
  (a.created_at ?? 0) - (b.created_at ?? 0) || (a.photo_id < b.photo_id ? -1 : a.photo_id > b.photo_id ? 1 : 0);

// ───────────────────────── 検索・表示用の値 ─────────────────────────

/** 検索用テキスト(9.3.3)。店名(英字表記と現地語)・コメント・場所名・イベント名を改行で連結して正規化する */
export const buildSearchText = (raw: RawCheckin): string =>
  normalizeForSearch(
    [raw.venue?.canonicalName, raw.venue?.name, raw.location?.name, raw.event?.name, raw.shout]
      .filter((s): s is string => typeof s === 'string' && s.length > 0)
      .join('\n'),
  );

/** raw と写真の情報の集合から内容のハッシュを作る(9.2.4) */
export const buildContentHash = (raw: RawCheckin, photos: readonly PhotoRecord[]): string => {
  const photoPart = [...photos]
    .sort((a, b) => (a.photo_id < b.photo_id ? -1 : a.photo_id > b.photo_id ? 1 : 0))
    .map((p) => [p.photo_id, p.prefix, p.suffix, p.width, p.height, p.visibility, p.created_at]);
  return contentHash(`${JSON.stringify(raw)}\u0000${JSON.stringify(photoPart)}`);
};

const visibilityOf = (raw: RawCheckin): string | null => {
  if (raw.visibility) return raw.visibility;
  if (raw.private === true) return 'private';
  return null;
};

/** raw(と写真の情報)から、保存する値を作る。保存形式の移行でも使う(9.1.3) */
export const deriveRecords = (
  raw: RawCheckin,
  createdAt: number,
  photos: readonly PhotoRecord[],
): { checkin: CheckinRecord; searchIndex: SearchIndexRecord } => {
  const lat = raw.lat ?? raw.location?.lat ?? null;
  const lng = raw.lng ?? raw.location?.lng ?? null;
  const checkin: CheckinRecord = {
    comment_count: raw.comments?.count ?? 0,
    created_at: createdAt,
    event_name: raw.event?.name ?? null,
    id: raw.id,
    lat: lat !== null && lng !== null ? lat : null,
    lng: lat !== null && lng !== null ? lng : null,
    location_name: raw.location?.name ?? null,
    photo_count: photos.length,
    raw,
    shout: raw.shout ?? null,
    type: raw.type ?? 'checkin',
    tz_offset: raw.timeZoneOffset ?? null,
    venue_canonical_name: raw.venue?.canonicalName ?? null,
    venue_id: raw.venue?.id ?? null,
    venue_name: raw.venue?.name ?? null,
    visibility: visibilityOf(raw),
  };
  const searchIndex: SearchIndexRecord = {
    content_hash: buildContentHash(raw, photos),
    created_at: createdAt,
    id: raw.id,
    search_text: buildSearchText(raw),
  };
  return { checkin, searchIndex };
};
