import { describe, expect, it } from 'vitest';
import { buildSearchHash, INITIAL_SEARCH_STATE, parseSearchHash } from '@/lib/hashState';
import { describeFilters, EMPTY_FILTERS, hasFilters, sanitizeFilters } from '@/lib/search/filters';
import { clampPage, pageRange, pageSlots, totalPages } from '@/lib/pagination';

describe('ページネーション', () => {
  it('総ページ数と範囲外の補正', () => {
    expect(totalPages(0, 50)).toBe(1);
    expect(totalPages(1234, 50)).toBe(25);
    expect(clampPage(99, 1234, 50)).toBe(25);
    expect(clampPage(0, 1234, 50)).toBe(1);
    expect(clampPage(3, 0, 50)).toBe(1);
  });

  it('ページ番号の並び(最大7枠)', () => {
    expect(pageSlots(5, 25)).toEqual([1, 'ellipsis-start', 4, 5, 6, 'ellipsis-end', 25]);
    expect(pageSlots(1, 25)).toEqual([1, 2, 3, 4, 5, 'ellipsis-end', 25]);
    expect(pageSlots(4, 25)).toEqual([1, 2, 3, 4, 5, 'ellipsis-end', 25]);
    expect(pageSlots(22, 25)).toEqual([1, 'ellipsis-start', 21, 22, 23, 24, 25]);
    expect(pageSlots(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageSlots(1, 1)).toEqual([1]);
  });

  it('件数の範囲', () => {
    expect(pageRange(5, 50, 1234)).toEqual({ from: 201, to: 250 });
    expect(pageRange(25, 50, 1234)).toEqual({ from: 1201, to: 1234 });
    expect(pageRange(1, 50, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe('URL の # 以降の状態', () => {
  it('読み取りと組み立て', () => {
    const s = parseSearchHash('#q=%E4%B8%80%E8%98%AD&page=5&size=20&id=6a00000000000000000000a1');
    expect(s).toEqual({ filters: EMPTY_FILTERS, id: '6a00000000000000000000a1', page: 5, q: '一蘭', size: 20 });
    expect(parseSearchHash(buildSearchHash(s))).toEqual(s);
    expect(buildSearchHash(INITIAL_SEARCH_STATE)).toBe('');
  });

  it('不正な値は既定値にする', () => {
    expect(parseSearchHash('#page=-1&size=7&id=<script>')).toEqual(INITIAL_SEARCH_STATE);
    expect(parseSearchHash('#page=abc')).toMatchObject({ page: 1 });
    expect(parseSearchHash('#page=99999999')).toMatchObject({ page: 1 });
    expect(parseSearchHash('')).toEqual(INITIAL_SEARCH_STATE);
  });

  it('詳細条件の読み取りと組み立て', () => {
    const s = parseSearchHash('#q=a&from=2024-01-01&to=2024-12-31&wd=60&hf=22&ht=3&photo=1&shout=0&event=1&vis=closeFriends&vmin=3&vmax=10');
    expect(s.filters).toEqual({
      event: 'with',
      from: '2024-01-01',
      hourFrom: 22,
      hourTo: 3,
      photo: 'with',
      shout: 'without',
      to: '2024-12-31',
      visibility: 'closeFriends',
      visitsMax: 10,
      visitsMin: 3,
      weekdays: [0, 6],
    });
    expect(parseSearchHash(buildSearchHash(s))).toEqual(s);
    expect(hasFilters(s.filters)).toBe(true);
    expect(describeFilters(s.filters)).toEqual([
      '2024/01/01〜2024/12/31',
      '日・土曜',
      '22時〜3時台',
      '写真あり',
      'コメントなし',
      'イベントのみ',
      '公開範囲: 親しい友達',
      '同じ店に3〜10回',
    ]);
  });

  it('詳細条件の不正な値は指定なしにする', () => {
    const s = parseSearchHash('#from=2024-02-30&to=abc&wd=79x&hf=24&ht=-1&photo=yes&vis=everyone&vmin=0&vmax=1e3');
    expect(s.filters).toEqual(EMPTY_FILTERS);
    // 7曜日すべては指定なしと同じ
    expect(parseSearchHash('#wd=0123456').filters.weekdays).toEqual([]);
    expect(sanitizeFilters({ from: '0002-01-01', visitsMin: 2.5, weekdays: 'abc' })).toEqual(EMPTY_FILTERS);
    expect(sanitizeFilters(null)).toEqual(EMPTY_FILTERS);
  });
});
