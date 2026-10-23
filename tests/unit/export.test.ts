import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyExportFiles, isExportDataPath } from '@/lib/export/files';
import {
  buildSearchText,
  checkinIdFromRelatedUrl,
  collectUnknownKeys,
  deriveRecords,
  validateCheckin,
  validatePhoto,
} from '@/lib/export/records';
import { buildPhotoUrl, buildVenueUrl } from '@/lib/urls';

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../fixtures/export-2026', name), 'utf8')) as { items: unknown[] };
const NOW = Date.UTC(2026, 9, 22);

describe('isExportDataPath / classifyExportFiles', () => {
  it('checkins*.json と photos*.json だけを対象にする', () => {
    expect(isExportDataPath('data-export-1/checkins1.json')).toBe(true);
    expect(isExportDataPath('checkins.json')).toBe(true);
    expect(isExportDataPath('photos12.json')).toBe(true);
    expect(isExportDataPath('data-export-1/users.json')).toBe(false);
    expect(isExportDataPath('data-export-1/comments.json')).toBe(false);
    expect(isExportDataPath('data-export-1/checkins1.csv')).toBe(false);
    expect(isExportDataPath('data-export-1/pix/1_abc.jpg')).toBe(false);
    expect(isExportDataPath('__MACOSX/data-export-1/checkins1.json')).toBe(false);
    expect(isExportDataPath('__MACOSX/data-export-1/._checkins1.json')).toBe(false);
  });

  it('連番の欠けを検知する', () => {
    const r = classifyExportFiles(['d/checkins1.json', 'd/checkins3.json', 'd/photos1.json']);
    expect(r).toMatchObject({ complete: false, missing: ['checkins2.json'], ok: true });
  });

  it('完全なエクスポート', () => {
    const r = classifyExportFiles(['d/checkins2.json', 'd/checkins1.json', 'd/photos1.json', 'd/users.json']);
    expect(r.ok && r.checkins.map((c) => c.index)).toEqual([1, 2]);
    expect(r).toMatchObject({ complete: true, hasPhotosFile: true });
  });

  it('同じ名前のファイルが複数のフォルダにあれば、複数のエクスポートの混在とみなす', () => {
    expect(classifyExportFiles(['a/checkins1.json', 'b/checkins1.json'])).toEqual({ code: 'MULTIPLE_EXPORTS', ok: false });
  });

  it('チェックインのファイルが無い', () => {
    expect(classifyExportFiles(['d/photos1.json', 'd/users.json'])).toEqual({ code: 'NO_CHECKINS', ok: false });
  });

  it('分割されていない古い形式', () => {
    expect(classifyExportFiles(['checkins.json'])).toMatchObject({ complete: true, hasPhotosFile: false, ok: true });
  });
});

describe('validateCheckin(2026年版の形)', () => {
  const items = fixture('checkins1.json').items;

  it('許可した項目だけで raw を組み立て直す', () => {
    const v = validateCheckin(items[0], NOW);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.raw).toEqual({
      comments: { count: 1 },
      createdAt: '2026-10-14 10:32:05.000000',
      id: '6a00000000000000000000a1',
      lat: 35.6595,
      lng: 139.7005,
      shout: '替え玉2回',
      timeZoneOffset: 540,
      type: 'checkin',
      venue: {
        canonicalName: '架空ラーメン 渋谷店',
        id: '5b00000000000000000000b1',
        name: 'Kakuu Ramen Shibuya',
        url: 'https://app.foursquare.com/v/kakuu-ramen-shibuya/5b00000000000000000000b1',
      },
      visibility: 'closeFriends',
    });
    // 署名付きの canonicalUrl・editableUntil・hacc・entities は保存しない
    expect(JSON.stringify(v.raw)).not.toContain('FAKESIGNATURE');
    expect(v.createdAt).toBe(Date.UTC(2026, 9, 14, 10, 32, 5));
  });

  it('visibility が無いレコードを受け付ける', () => {
    const v = validateCheckin(items[1], NOW);
    expect(v.ok && v.raw.visibility).toBeUndefined();
  });

  it('イベントは id と name だけを保存する', () => {
    const v = validateCheckin(items[2], NOW);
    expect(v.ok && v.raw.event).toEqual({ id: '7c00000000000000000000c1', name: '架空フェス 2026' });
  });

  it('id・createdAt が不正なレコードは取り込まない(id は返す)', () => {
    expect(validateCheckin({ createdAt: '2026-01-01 00:00:00.000000', id: 'xyz' }, NOW)).toMatchObject({ id: null, ok: false });
    expect(validateCheckin({ id: '6a00000000000000000000a9' }, NOW)).toMatchObject({ id: '6a00000000000000000000a9', ok: false });
    expect(validateCheckin({ createdAt: 'yesterday', id: '6a00000000000000000000a9' }, NOW)).toMatchObject({ ok: false, reason: 'CREATED_AT' });
    expect(validateCheckin(null, NOW)).toMatchObject({ ok: false });
    expect(validateCheckin([1], NOW)).toMatchObject({ ok: false });
  });

  it('型が不正な任意項目は捨てる', () => {
    const v = validateCheckin({ createdAt: 1_700_000_000, id: '6a00000000000000000000a9', timeZoneOffset: 99999, venue: { id: 'bad', name: 'x' }, visibility: 5 }, NOW);
    expect(v.ok && v.raw).toEqual({ createdAt: 1_700_000_000, id: '6a00000000000000000000a9' });
  });

  it('長すぎる文字列は切り詰めずに不正として扱う', () => {
    expect(validateCheckin({ createdAt: 1_700_000_000, id: '6a00000000000000000000a9', shout: 'あ'.repeat(2001) }, NOW)).toMatchObject({ ok: false, reason: 'TOO_LONG' });
    expect(validateCheckin({ createdAt: 1_700_000_000, id: '6a00000000000000000000a9', shout: 'あ'.repeat(2000) }, NOW).ok).toBe(true);
  });

  it('__proto__ などのキーを持ち込まない', () => {
    const item = JSON.parse('{"id":"6a00000000000000000000a9","createdAt":1700000000,"__proto__":{"polluted":true},"venue":{"id":"5b00000000000000000000b1","name":"x","__proto__":{"p":1}}}');
    const v = validateCheckin(item, NOW);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(Object.keys(v.raw)).toEqual(['createdAt', 'id', 'venue']);
    expect(Object.getPrototypeOf(v.raw)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('許可しない URL の venue.url は保存しない', () => {
    const v = validateCheckin({ createdAt: 1_700_000_000, id: '6a00000000000000000000a9', venue: { id: '5b00000000000000000000b1', name: 'x', url: 'javascript:alert(1)' } }, NOW);
    expect(v.ok && v.raw.venue).toEqual({ id: '5b00000000000000000000b1', name: 'x' });
  });

  it('未知の項目名を集める(既知の項目は除く)', () => {
    const keys = new Set<string>();
    collectUnknownKeys({ ...(items[0] as object), brandNewField: 1, 'bad key!': 2 }, keys);
    expect([...keys]).toEqual(['brandNewField']);
  });
});

describe('検索用テキストと保存する値', () => {
  it('店名の英字表記と現地語(canonicalName)の両方を検索できる', () => {
    const v = validateCheckin(fixture('checkins1.json').items[0], NOW);
    if (!v.ok) throw new Error('invalid');
    const text = buildSearchText(v.raw);
    expect(text).toContain('架空ラーメン 渋谷店');
    expect(text).toContain('kakuu ramen shibuya');
    expect(text).toContain('替え玉2回');
    expect(text.split('\n')).toHaveLength(3);
  });

  it('deriveRecords', () => {
    const items = fixture('checkins1.json').items;
    const v = validateCheckin(items[1], NOW);
    if (!v.ok) throw new Error('invalid');
    const { checkin, searchIndex } = deriveRecords(v.raw, v.createdAt, []);
    expect(checkin).toMatchObject({
      comment_count: 0,
      lat: 35.6441,
      photo_count: 0,
      tz_offset: 540,
      venue_canonical_name: null,
      venue_id: '5b00000000000000000000b2',
      venue_name: 'Mock Coffee Roasters',
      visibility: null,
    });
    expect(searchIndex.content_hash).toMatch(/^[0-9a-f]{16}$/u);
  });

  it('写真の集合が変わると内容のハッシュが変わる', () => {
    const v = validateCheckin(fixture('checkins1.json').items[0], NOW);
    if (!v.ok) throw new Error('invalid');
    const photos = fixture('photos1.json').items.map((p) => validatePhoto(p, NOW)).flatMap((p) => (p.ok ? [p.photo] : []));
    const a = deriveRecords(v.raw, v.createdAt, photos.slice(0, 2)).searchIndex.content_hash;
    const b = deriveRecords(v.raw, v.createdAt, photos.slice(0, 1)).searchIndex.content_hash;
    const c = deriveRecords(v.raw, v.createdAt, [photos[1]!, photos[0]!]).searchIndex.content_hash;
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });
});

describe('写真の情報', () => {
  it('relatedItemUrl からチェックインID を取り出す', () => {
    expect(checkinIdFromRelatedUrl('https://swarmapp.com/checkin/6a00000000000000000000a1')).toBe('6a00000000000000000000a1');
    expect(checkinIdFromRelatedUrl('https://evil.example/checkin/6a00000000000000000000a1')).toBeNull();
    expect(checkinIdFromRelatedUrl('https://swarmapp.com/tip/6a00000000000000000000a1')).toBeNull();
    expect(checkinIdFromRelatedUrl('not a url')).toBeNull();
  });

  it('prefix と suffix のパターンを検証する', () => {
    const base = fixture('photos1.json').items[0] as Record<string, unknown>;
    expect(validatePhoto(base, NOW).ok).toBe(true);
    expect(validatePhoto({ ...base, prefix: 'https://evil.example/img/general/' }, NOW).ok).toBe(false);
    expect(validatePhoto({ ...base, suffix: '/../x.jpg' }, NOW).ok).toBe(false);
    expect(validatePhoto({ ...base, suffix: '/a.svg' }, NOW).ok).toBe(false);
  });

  it('写真の URL は検証した値から組み立て、表示時にも再確認する', () => {
    const p = validatePhoto(fixture('photos1.json').items[0], NOW);
    if (!p.ok) throw new Error('invalid');
    expect(buildPhotoUrl(p.photo, '300x300')).toBe('https://fastly.4sqi.net/img/general/300x300/900000001_FAKEphotoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1.jpg');
    expect(buildPhotoUrl({ prefix: 'javascript:', suffix: '/a.jpg' }, '300x300')).toBeNull();
  });

  it('店ページの URL は検証した ID から組み立てる', () => {
    expect(buildVenueUrl('5b00000000000000000000b1')).toBe('https://foursquare.com/v/5b00000000000000000000b1');
    expect(buildVenueUrl('"><script>')).toBeNull();
    expect(buildVenueUrl(null)).toBeNull();
  });
});
