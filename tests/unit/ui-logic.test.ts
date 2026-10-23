import { describe, expect, it } from 'vitest';
import { buildSearchHash, parseSearchHash } from '@/lib/hashState';
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
    expect(s).toEqual({ id: '6a00000000000000000000a1', page: 5, q: '一蘭', size: 20 });
    expect(parseSearchHash(buildSearchHash(s))).toEqual(s);
    expect(buildSearchHash({ id: null, page: 1, q: '', size: 50 })).toBe('');
  });

  it('不正な値は既定値にする', () => {
    expect(parseSearchHash('#page=-1&size=7&id=<script>')).toEqual({ id: null, page: 1, q: '', size: 50 });
    expect(parseSearchHash('#page=abc')).toMatchObject({ page: 1 });
    expect(parseSearchHash('#page=99999999')).toMatchObject({ page: 1 });
    expect(parseSearchHash('')).toEqual({ id: null, page: 1, q: '', size: 50 });
  });
});
