import { describe, expect, it } from 'vitest';
import type { QueryNode } from '@/lib/query/ast';
import { compileMatcher, InvalidAstError, validateAst } from '@/lib/query/match';
import { parseSearchQuery, SearchQueryError } from '@/lib/query/parse';
import { normalizeForSearch } from '@/lib/text';

const compact = (n: QueryNode | null): string => {
  if (n === null) return 'null';
  if (n.type === 'term') return `${n.quoted ? 'q' : ''}${JSON.stringify(n.value)}`;
  return `${n.type}(${n.children.map(compact).join(', ')})`;
};

const parsed = (q: string) => compact(parseSearchQuery(q).ast);
const errorCode = (q: string): string => {
  try {
    parseSearchQuery(q);
  } catch (e) {
    if (e instanceof SearchQueryError) return e.code;
    throw e;
  }
  return 'OK';
};

describe('parseSearchQuery: 正しい検索式', () => {
  it.each([
    ['', 'null'],
    ['   ', 'null'],
    ['ラーメン', '"ラーメン"'],
    ['ラーメン カフェ', 'and("ラーメン", "カフェ")'],
    ['ラーメン AND カフェ', 'and("ラーメン", "カフェ")'],
    ['ラーメン OR カフェ', 'or("ラーメン", "カフェ")'],
    ['A OR (B AND C)', 'or("A", and("B", "C"))'],
    ['(A OR B) AND (C OR D)', 'and(or("A", "B"), or("C", "D"))'],
    ['((A))', '"A"'],
    ['A AND B AND C', 'and("A", "B", "C")'],
    ['A OR B OR C', 'or("A", "B", "C")'],
    ['一蘭 OR (ラーメン 渋谷)', 'or("一蘭", and("ラーメン", "渋谷"))'],
    ['替え玉 AND (一蘭 OR 二郎)', 'and("替え玉", or("一蘭", "二郎"))'],
    ['( A OR B )', 'or("A", "B")'],
    ['A A', '"A"'],
  ])('%j → %s', (q, expected) => {
    expect(parsed(q)).toBe(expected);
  });

  it('全角の空白・括弧・二重引用符を半角として扱う', () => {
    expect(parsed('ラーメン　カフェ')).toBe('and("ラーメン", "カフェ")');
    expect(parsed('（A OR B）')).toBe('or("A", "B")');
    expect(parsed('＂一蘭 渋谷＂')).toBe('q"一蘭 渋谷"');
    expect(parsed('“一蘭 渋谷”')).toBe('q"一蘭 渋谷"');
  });

  it('全角の大文字 ＡＮＤ / ＯＲ は演算子として扱う', () => {
    expect(parsed('ラーメン ＡＮＤ カフェ')).toBe('and("ラーメン", "カフェ")');
    expect(parsed('ラーメン　ＯＲ　カフェ')).toBe('or("ラーメン", "カフェ")');
  });

  it('語は NFKC で正規化する(入力全体にはかけない)', () => {
    expect(parsed('ﾗｰﾒﾝ')).toBe('"ラーメン"');
    expect(parsed('Ｃａｆｅ')).toBe('"Cafe"');
    expect(parsed('１００円')).toBe('"100円"');
    // 入力全体に NFKC をかけると ㈱ が (株) になり括弧と解釈されるが、語として扱える
    expect(parsed('㈱ほげ')).toBe('"(株)ほげ"');
    expect(parsed('Ｈ＆Ｍ')).toBe('"H&M"');
  });

  it('引用符で記号・演算子を語として検索できる', () => {
    expect(parsed('"H&M"')).toBe('q"H&M"');
    expect(parsed('"12:30"')).toBe('q"12:30"');
    expect(parsed('"OR"')).toBe('q"OR"');
    expect(parsed('"and"')).toBe('q"and"');
    expect(parsed('"なに?"')).toBe('q"なに?"');
  });

  it('数字だけの語は元の綴りを保つ', () => {
    expect(parsed('007')).toBe('"007"');
  });

  it('全角の ？ は記号として通す', () => {
    expect(parsed('なに？')).toBe('"なに?"');
  });

  it('解釈の文字列', () => {
    expect(parseSearchQuery('一蘭 OR (ラーメン 渋谷)').interpretation).toBe('一蘭 OR (ラーメン AND 渋谷)');
    expect(parseSearchQuery('"H&M" 銀座').interpretation).toBe('"H&M" AND 銀座');
  });
});

describe('parseSearchQuery: エラーにする検索式', () => {
  it.each([
    // D-4: 括弧なしの AND / OR の混在
    ['A AND B OR C', 'MIXED_AND_OR'],
    ['A OR B AND C', 'MIXED_AND_OR'],
    ['A B OR C', 'MIXED_AND_OR'],
    ['ラーメン 渋谷 OR 新宿', 'MIXED_AND_OR'],
    // D-5: 小文字の and / or
    ['a and b', 'LOWERCASE_OPERATOR'],
    ['a or b', 'LOWERCASE_OPERATOR'],
    ['a And b', 'LOWERCASE_OPERATOR'],
    ['ラーメン or つけ麺', 'LOWERCASE_OPERATOR'],
    // F-26: 対応しない構文
    ['venue:一蘭', 'UNSUPPORTED_FIELD'],
    ['ラーメン*', 'UNSUPPORTED_WILDCARD'],
    ['ラーメン＊', 'UNSUPPORTED_WILDCARD'],
    ['なに?', 'UNSUPPORTED_WILDCARD'],
    ['-ラーメン', 'UNSUPPORTED_NOT'],
    ['NOT ラーメン', 'UNSUPPORTED_NOT'],
    ['/ラー.*/', 'UNSUPPORTED_REGEX'],
    // 括弧・引用符・演算子の位置
    ['A AND(B OR C)', 'SYNTAX'],
    ['(A)B', 'SYNTAX'],
    ['"一蘭 渋谷', 'INCOMPLETE'],
    ['(A OR B', 'INCOMPLETE'],
    ['A AND', 'INCOMPLETE'],
    ['OR A', 'SYNTAX'],
    ['()', 'EMPTY_GROUP'],
    ['""', 'EMPTY_TERM'],
    ['H&M', 'SYNTAX'],
    ['12:30', 'SYNTAX'],
    ['a && b', 'SYNTAX'],
  ])('%j → %s', (q, code) => {
    expect(errorCode(q)).toBe(code);
  });

  it('上限: 200文字・1語50文字・10語・括弧5段', () => {
    expect(errorCode('あ'.repeat(201))).toBe('TOO_LONG');
    expect(errorCode('あ'.repeat(51))).toBe('TERM_TOO_LONG');
    expect(errorCode(Array.from({ length: 11 }, (_, i) => `w${i}`).join(' '))).toBe('TOO_MANY_TERMS');
    expect(errorCode('( ( ( ( ( ( A ) ) ) ) ) )')).toBe('TOO_DEEP');
    expect(errorCode('( ( ( ( ( A ) ) ) ) )')).toBe('OK');
  });

  it('エラーメッセージは日本語で、書き方の例を含む', () => {
    try {
      parseSearchQuery('A AND B OR C');
    } catch (e) {
      expect((e as Error).message).toContain('括弧');
      expect((e as Error).message).toContain('例:');
    }
  });
});

describe('照合', () => {
  const text = normalizeForSearch(['架空ラーメン 渋谷店', 'Kakuu Ramen Shibuya', '替え玉2回'].join('\n'));
  const match = (q: string) => compileMatcher(parseSearchQuery(q).ast!)(text);

  it('部分一致・AND・OR・括弧', () => {
    expect(match('ラーメン')).toBe(true);
    expect(match('ラーメン 渋谷')).toBe(true);
    expect(match('ラーメン 新宿')).toBe(false);
    expect(match('新宿 OR 渋谷')).toBe(true);
    expect(match('替え玉 AND (一蘭 OR 架空)')).toBe(true);
  });

  it('全角/半角・大文字/小文字を区別しない(F-23)。ひらがなとカタカナは区別する', () => {
    expect(match('ＲＡＭＥＮ')).toBe(true);
    expect(match('ramen')).toBe(true);
    expect(match('ﾗｰﾒﾝ')).toBe(true);
    expect(match('らーめん')).toBe(false);
    expect(match('替え玉２回')).toBe(true);
  });

  it('語は項目をまたいで一致しない(区切りは改行)', () => {
    expect(match('"渋谷店 Kakuu"')).toBe(false);
  });
});

describe('validateAst(ワーカーでの再検証)', () => {
  it('正しい中間AST を通す', () => {
    const ast = parseSearchQuery('A OR (B C)').ast;
    expect(validateAst(JSON.parse(JSON.stringify(ast)))).toEqual(ast);
  });

  it.each([
    [{ type: 'eval', value: 'x' }],
    [{ type: 'term', value: '' }],
    [{ type: 'term', value: 'あ'.repeat(51) }],
    [{ type: 'and', children: [] }],
    [{ type: 'or', children: 'x' }],
    [null],
    ['term'],
  ])('不正な値を拒否する %j', (input) => {
    expect(() => validateAst(input)).toThrow(InvalidAstError);
  });

  it('語数の上限を超えるものを拒否する', () => {
    const children = Array.from({ length: 11 }, (_, i) => ({ type: 'term', value: `w${i}` }));
    expect(() => validateAst({ children: children.slice(0, 10), type: 'and' })).not.toThrow();
    expect(() => validateAst({ children: [{ children: children.slice(0, 6), type: 'or' }, ...children.slice(6)], type: 'and' })).toThrow(InvalidAstError);
  });
});
