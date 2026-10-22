/**
 * 文字列の正規化と表示用の整形。
 */

// ゼロ幅の文字(ZWSP・ZWNJ・ZWJ・WJ・BOM)
const ZERO_WIDTH = /[​-‍⁠﻿]/gu;

/**
 * 検索用の正規化(9.3.3)。データ(search_text)と検索語の両方に、この同じ関数をかける。
 * NFKC で全角/半角をそろえ、小文字にそろえる。ひらがなとカタカナは区別したまま。
 * この関数を変えたら保存形式の版を上げ、移行で search_text を作り直す(9.1.3)。
 */
export const normalizeForSearch = (s: string): string =>
  s.normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase();

// 双方向制御文字(LRM・RLM・ALM・LRE〜RLO・LRI〜PDI)
const BIDI_CONTROLS = /[‎‏؜‪-‮⁦-⁩]/gu;
// 改行以外の制御文字(C0・DEL・C1)
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/gu;

/**
 * 表示の前に、制御文字と双方向制御文字を取り除く(5.5、9.4)。文字の並びの偽装を防ぐ。
 * 改行は残す(コメントの改行を表示するため)。CR は LF にそろえる。
 */
export const cleanDisplayText = (s: string): string =>
  s
    .replace(/\r\n?/gu, '\n')
    .replace(BIDI_CONTROLS, '')
    .replace(ZERO_WIDTH, '')
    .replace(CONTROL_EXCEPT_NEWLINE, '');

/** コードポイント数(サロゲートペアを1文字と数える) */
export const codePointLength = (s: string): number => {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
};

/** UTF-8 のバイト数 */
export const utf8ByteLength = (s: string): number => new TextEncoder().encode(s).length;
