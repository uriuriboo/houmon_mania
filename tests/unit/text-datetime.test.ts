import { describe, expect, it } from 'vitest';
import {
  formatDetailDateTime,
  formatListDateTime,
  formatMonthHeading,
  formatUtcOffset,
  monthKey,
  parseCreatedAt,
} from '@/lib/datetime';
import { contentHash } from '@/lib/hash';
import { cleanDisplayText, codePointLength, normalizeForSearch } from '@/lib/text';

describe('normalizeForSearch', () => {
  it('NFKC と小文字化。ゼロ幅の文字を除く', () => {
    expect(normalizeForSearch('ＡＢＣ　ﾗｰﾒﾝ')).toBe('abc ラーメン');
    expect(normalizeForSearch('Ca​fe')).toBe('cafe');
    expect(normalizeForSearch('カフェ')).not.toBe(normalizeForSearch('かふぇ'));
  });
});

describe('cleanDisplayText', () => {
  it('双方向制御文字と制御文字を取り除き、改行は残す', () => {
    expect(cleanDisplayText('abc‮fdp.exe')).toBe('abcfdp.exe');
    expect(cleanDisplayText('a\u0000b\u0007c')).toBe('abc');
    expect(cleanDisplayText('1行目\r\n2行目')).toBe('1行目\n2行目');
    expect(cleanDisplayText('⁦x⁩')).toBe('x');
  });
});

describe('codePointLength', () => {
  it('サロゲートペアを1文字と数える', () => {
    expect(codePointLength('𩸽')).toBe(1);
    expect(codePointLength('あいう')).toBe(3);
  });
});

describe('parseCreatedAt', () => {
  const now = Date.UTC(2026, 9, 22);
  it('2026年版の文字列形式(UTC)', () => {
    expect(parseCreatedAt('2024-11-14 05:00:09.000000', now)).toBe(Date.UTC(2024, 10, 14, 5, 0, 9));
    expect(parseCreatedAt('2024-11-14 05:00:09.123456', now)).toBe(Date.UTC(2024, 10, 14, 5, 0, 9, 123));
    expect(parseCreatedAt('2024-11-14T05:00:09Z', now)).toBe(Date.UTC(2024, 10, 14, 5, 0, 9));
  });
  it('UNIX 秒の整数', () => {
    expect(parseCreatedAt(1_700_000_000, now)).toBe(1_700_000_000_000);
  });
  it('範囲外・不正な値は null', () => {
    expect(parseCreatedAt('2008-12-31 23:59:59.000000', now)).toBeNull();
    expect(parseCreatedAt('2026-10-24 00:00:00.000000', now)).toBeNull();
    expect(parseCreatedAt('2024-02-30 00:00:00.000000', now)).toBeNull();
    expect(parseCreatedAt('2024/11/14', now)).toBeNull();
    expect(parseCreatedAt(1.5, now)).toBeNull();
    expect(parseCreatedAt(1_700_000_000_000, now)).toBeNull();
    expect(parseCreatedAt(null, now)).toBeNull();
  });
});

describe('日時の表示(現地時刻)', () => {
  const t = Date.UTC(2026, 9, 14, 10, 32); // 2026-10-14 10:32 UTC
  it('一覧の日時', () => {
    expect(formatListDateTime(t, 540)).toBe('10/14(水) 19:32');
    expect(formatListDateTime(t, -300)).toBe('10/14(水) 05:32');
    expect(formatListDateTime(t, null)).toBe('10/14(水) 10:32');
  });
  it('月見出しは現地時刻で決まる', () => {
    const edge = Date.UTC(2026, 8, 30, 20, 0); // 9/30 20:00 UTC = 10/1 05:00 JST
    expect(formatMonthHeading(edge, 540)).toBe('2026年10月');
    expect(formatMonthHeading(edge, 0)).toBe('2026年9月');
    expect(monthKey(edge, 540)).not.toBe(monthKey(edge, 0));
  });
  it('詳細の日時とタイムゾーン', () => {
    expect(formatDetailDateTime(t, 540)).toBe('2026年10月14日(水) 19:32(現地時刻 UTC+9)');
    expect(formatUtcOffset(330)).toBe('UTC+5:30');
    expect(formatUtcOffset(-300)).toBe('UTC-5');
    expect(formatUtcOffset(0)).toBe('UTC±0');
  });
});

describe('contentHash', () => {
  it('同じ入力で同じ値、違う入力で違う値', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'));
    expect(contentHash('abc')).not.toBe(contentHash('abd'));
    expect(contentHash('')).toMatch(/^[0-9a-f]{16}$/u);
  });
});
