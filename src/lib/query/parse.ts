/**
 * 検索式 → liqe AST → 中間AST(9.3.2、F-20・F-21・F-26)。
 *
 * 1. 長さ制限(パース前。liqe は引用符なしの長い語で処理時間が急増するため)
 * 2. パース前の正規化(空白類→半角空白、全角括弧→半角、全角・スマートの二重引用符→")。入力全体には NFKC をかけない
 * 3. liqe.parse()
 * 4. 規則の検証と中間AST への変換(語は NFKC 正規化)。決定済みの規則:
 *    - AND と OR を括弧なしで混在させたらエラー(17章 D-4)
 *    - 小文字の and / or はエラー(17章 D-5)。全角大文字の ＡＮＤ / ＯＲ は演算子として扱う
 *    - フィールド指定・範囲・正規表現・除外・ワイルドカードはエラー(F-26)
 * 5. 同じ演算子の入れ子の平坦化と、同じ語の重複の除去
 *
 * 試作: doc/2-1_technical investigation/evidence/prototypes/searchQuery.mts
 */
import { parse as liqeParse, LiqeError, SyntaxError as LiqeSyntaxError } from 'liqe';
import type { LiteralExpressionToken, LogicalExpressionToken, ParserAst, TagToken } from 'liqe';
import { QUERY_LIMITS } from '@/lib/constants';
import { codePointLength } from '@/lib/text';
import { toDisplayString, type QueryNode, type TermNode } from './ast';

export type QueryErrorCode =
  | 'AMBIGUOUS'
  | 'DANGLING_OPERATOR'
  | 'EMPTY_GROUP'
  | 'EMPTY_TERM'
  | 'INCOMPLETE'
  | 'INTERNAL'
  | 'INVALID_CHAR'
  | 'LOWERCASE_OPERATOR'
  | 'MIXED_AND_OR'
  | 'SYNTAX'
  | 'TERM_TOO_LONG'
  | 'TOO_DEEP'
  | 'TOO_LONG'
  | 'TOO_MANY_TERMS'
  | 'UNSUPPORTED_FIELD'
  | 'UNSUPPORTED_NOT'
  | 'UNSUPPORTED_RANGE'
  | 'UNSUPPORTED_REGEX'
  | 'UNSUPPORTED_WILDCARD';

export class SearchQueryError extends Error {
  public readonly code: QueryErrorCode;
  /** 正規化後の入力の位置。不明なら undefined */
  public readonly offset: number | undefined;
  public constructor(code: QueryErrorCode, message: string, offset?: number) {
    super(message);
    this.name = 'SearchQueryError';
    this.code = code;
    this.offset = offset;
  }
}

export type ParsedSearchQuery = {
  /** null = 空の検索式(全件を新しい順に表示する) */
  readonly ast: QueryNode | null;
  /** 利用者に見せる「解釈」 例: ラーメン AND (渋谷 OR 新宿) */
  readonly interpretation: string;
};

// JS の \s は U+3000(全角空白)、U+00A0、改行、タブなどを含む
const WHITESPACE = /\s/gu;
const ZERO_WIDTH = /[​-‍⁠﻿]/gu;
const CONTROL = /[\u0000-\u001F\u007F]/u;

/** パース前の正規化。1文字→1文字の置換だけにして、liqe のエラー位置が入力の位置とずれないようにする */
export const preNormalize = (input: string): string =>
  input
    .replace(WHITESPACE, ' ')
    .replace(/[（）]/gu, (c) => (c === '（' ? '(' : ')'))
    .replace(/[＂“”]/gu, '"');

/** 語の正規化(パース後) */
const normalizeTerm = (raw: string): string => raw.normalize('NFKC').replace(ZERO_WIDTH, '');

// ───────────────────────── エラーメッセージ ─────────────────────────
const QUOTE_HINT = '記号を含む語は "H&M" のようにダブルクォートで囲んでください。';

/** 引用符の中を同じ長さの空白で塗りつぶす(位置を保ったまま、引用符の外だけを調べるため) */
const maskQuoted = (input: string): string =>
  input.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu, (m) => ' '.repeat(m.length));

const syntaxMessage = (input: string, offset: number): string => {
  const ch = input[offset] ?? '';
  const pos = `${offset + 1}文字目「${ch}」付近`;
  const masked = maskQuoted(input);
  const before = masked.slice(0, offset).trimEnd().split(' ').pop() ?? '';
  if (/^\s*(?:AND|OR)(?:\s|$)/u.test(masked) || ['AND', 'OR', 'NOT'].includes(before)) {
    return `検索式を解釈できません(${pos})。AND / OR の前後に検索語が必要です。`;
  }
  if (/[^\s(]\(|\)[^\s)]/u.test(masked)) {
    return `検索式を解釈できません(${pos})。括弧の前後には空白を入れてください(例: A AND (B OR C))。`;
  }
  if (ch === ':') return `検索式を解釈できません(${pos})。フィールド指定(例: venue:一蘭)には対応していません。コロンを含む語は "12:30" のようにダブルクォートで囲んでください。`;
  if ((ch === '&' && input[offset + 1] === '&') || (ch === '|' && input[offset + 1] === '|')) return `検索式を解釈できません(${pos})。&& や || ではなく AND / OR を使ってください。`;
  if (ch === '(' || ch === ')') return `検索式を解釈できません(${pos})。括弧の対応と、括弧の前後に空白があるかを確認してください。`;
  if (ch === '"') return `検索式を解釈できません(${pos})。引用符(")の前後には空白を入れてください。`;
  if (ch === "'") return `検索式を解釈できません(${pos})。アポストロフィを含む語は "Tully's" のようにダブルクォートで囲んでください。`;
  if (ch === '+' && offset === 0) return `検索式を解釈できません(${pos})。+ による必須指定には対応していません(空白区切りで AND 検索になります)。`;
  return `検索式を解釈できません(${pos})。${QUOTE_HINT}`;
};

const incompleteMessage = (input: string): string => {
  const unquoted = input.replace(/"(?:[^"\\]|\\.)*"/gu, '""');
  if ((unquoted.match(/"/gu) ?? []).length % 2 === 1) return '引用符(")が閉じられていません。';
  if ((unquoted.match(/'/gu) ?? []).length % 2 === 1) return `引用符(')が閉じられていません。アポストロフィを含む語は "Tully's" のようにダブルクォートで囲んでください。`;
  const open = (unquoted.match(/\(/gu) ?? []).length;
  const close = (unquoted.match(/\)/gu) ?? []).length;
  if (open > close) return '括弧が閉じられていません。';
  if (/(?:^|\s)(?:AND|OR|NOT)\s*$/u.test(unquoted) || /^\s*(?:AND|OR)(?:\s|$)/u.test(unquoted)) return 'AND / OR の前後に検索語が必要です。';
  if (unquoted.includes(':') || unquoted.includes('/')) return 'コロン(:)やスラッシュ(/)を含む語は "12:30" のようにダブルクォートで囲んでください。';
  return '検索式が途中で終わっています。引用符や括弧の閉じ忘れ、末尾の AND / OR がないか確認してください。';
};

// ───────────────────────── 変換本体 ─────────────────────────
type Op = 'AND' | 'OR';
type Ctx = { termCount: number; readonly input: string };

const fail = (code: QueryErrorCode, message: string, offset?: number): never => {
  throw new SearchQueryError(code, message, offset);
};

/** 引用符なし・文字列値・フィールド指定なしの語なら、その値を返す */
const bareWord = (n: ParserAst): string | null => {
  if (n.type !== 'Tag' || n.field.type !== 'ImplicitField') return null;
  const e = n.expression;
  if (e.type !== 'LiteralExpression' || e.quoted || typeof e.value !== 'string') return null;
  return e.value;
};

/** 演算子として書かれた語(小文字・全角を含む)の判定 */
const operatorWord = (n: ParserAst): { kind: 'NOT' | Op; exactUpper: boolean } | null => {
  const w = bareWord(n);
  if (w === null) return null;
  const nk = w.normalize('NFKC');
  const up = nk.toUpperCase();
  if (up !== 'AND' && up !== 'OR' && up !== 'NOT') return null;
  return { exactUpper: nk === up, kind: up };
};

/** 数値として解釈された語の元の綴りを入力から取り出す(liqe は "007"→7 に変換するため) */
const originalLiteralText = (ctx: Ctx, e: LiteralExpressionToken): string => {
  if (typeof e.value === 'string') return e.value;
  if (typeof e.value === 'number') {
    const m = /^-?\d+(?:\.\d+)?/u.exec(ctx.input.slice(e.location.start));
    return m ? m[0] : String(e.value);
  }
  return String(e.value); // true / false / null
};

const convertTag = (ctx: Ctx, n: TagToken): TermNode => {
  const at = n.location?.start;
  if (n.field.type === 'Field') {
    return fail('UNSUPPORTED_FIELD', 'フィールド指定(例: venue:一蘭)には対応していません。コロンを含む語は "12:30" のようにダブルクォートで囲んでください。', at);
  }
  const e = n.expression;
  if (e.type === 'RegexExpression') return fail('UNSUPPORTED_REGEX', '正規表現(/.../)には対応していません。スラッシュを含む語は "a/b" のようにダブルクォートで囲んでください。', at);
  if (e.type === 'RangeExpression') return fail('UNSUPPORTED_RANGE', '範囲指定([1 TO 5] など)には対応していません。', at);
  if (e.type === 'EmptyExpression') return fail('EMPTY_TERM', '空の検索語があります。', at);

  const raw = originalLiteralText(ctx, e);
  // * は全角/半角とも、? は半角のみワイルドカードとみなす(全角の ？ は日本語の文中の記号として通す)
  if (!e.quoted && /[*?＊]/u.test(raw)) {
    return fail('UNSUPPORTED_WILDCARD', 'ワイルドカード(* ?)には対応していません。検索は部分一致なので * は不要です。記号として検索する場合は "なに?" のようにダブルクォートで囲んでください。', at);
  }
  const value = normalizeTerm(raw);
  if (CONTROL.test(value)) {
    return fail('INVALID_CHAR', '検索語に使用できない文字(制御文字)が含まれています。引用符の中の \\ はエスケープ文字として扱われるため、\\ 自体を検索する場合は \\\\ と入力してください。', at);
  }
  if (value.trim() === '') return fail('EMPTY_TERM', '空の引用符 "" は使えません。', at);
  if (codePointLength(value) > QUERY_LIMITS.maxTermLength) return fail('TERM_TOO_LONG', `1つの検索語は${QUERY_LIMITS.maxTermLength}文字以内にしてください。`, at);
  ctx.termCount += 1;
  if (ctx.termCount > QUERY_LIMITS.maxTerms) return fail('TOO_MANY_TERMS', `検索語が多すぎます(最大${QUERY_LIMITS.maxTerms}語)。`, at);
  return { quoted: e.quoted, type: 'term', value };
};

/** 左再帰の LogicalExpression の連鎖を [項, 演算子, 項, 演算子, ...] に平坦化する(括弧はまたがない) */
const flattenChain = (n: LogicalExpressionToken): { operands: ParserAst[]; ops: Array<{ implicit: boolean; op: Op }> } => {
  const rights: Array<{ implicit: boolean; op: Op; right: ParserAst }> = [];
  let cur: ParserAst = n;
  while (cur.type === 'LogicalExpression') {
    rights.push({ implicit: cur.operator.type === 'ImplicitBooleanOperator', op: cur.operator.operator, right: cur.right });
    cur = cur.left;
  }
  const operands: ParserAst[] = [cur];
  const ops: Array<{ implicit: boolean; op: Op }> = [];
  for (let i = rights.length - 1; i >= 0; i--) {
    const r = rights[i]!;
    ops.push({ implicit: r.implicit, op: r.op });
    operands.push(r.right);
  }
  return { operands, ops };
};

const NOT_MESSAGE = '除外検索(NOT)には対応していません。"not" という語を検索する場合はダブルクォートで囲んでください。';

const convertNode = (ctx: Ctx, n: ParserAst, depth: number): QueryNode => {
  switch (n.type) {
    case 'EmptyExpression':
      return fail('EMPTY_GROUP', '空の括弧 () は使えません。');
    case 'ParenthesizedExpression': {
      if (n.expression.type === 'EmptyExpression') return fail('EMPTY_GROUP', '空の括弧 () は使えません。', n.location?.start);
      if (depth + 1 > QUERY_LIMITS.maxDepth) return fail('TOO_DEEP', `括弧の入れ子が深すぎます(最大${QUERY_LIMITS.maxDepth}段)。`);
      return convertNode(ctx, n.expression, depth + 1);
    }
    case 'UnaryOperator':
      return fail('UNSUPPORTED_NOT', '除外検索(NOT / -)には対応していません。ハイフンで始まる語は "-ラーメン" のようにダブルクォートで囲んでください。', n.location?.start);
    case 'Tag': {
      const w = operatorWord(n);
      if (w) {
        if (w.kind === 'NOT') return fail('UNSUPPORTED_NOT', NOT_MESSAGE, n.location?.start);
        if (!w.exactUpper) return fail('LOWERCASE_OPERATOR', `演算子は大文字の AND / OR で入力してください。"${bareWord(n)}" という語を検索する場合はダブルクォートで囲んでください。`, n.location?.start);
        return fail('DANGLING_OPERATOR', 'AND / OR の前後に検索語が必要です。', n.location?.start);
      }
      return convertTag(ctx, n);
    }
    case 'LogicalExpression':
      return convertChain(ctx, n, depth);
    default:
      return fail('INTERNAL', '検索式の解析中に不明な構文が見つかりました。');
  }
};

const convertChain = (ctx: Ctx, n: LogicalExpressionToken, depth: number): QueryNode => {
  const { operands, ops } = flattenChain(n);

  // 1) 語として現れた演算子(小文字の and/or、全角の ＡＮＤ/ＯＲ)を解釈し直す
  const cleanOperands: ParserAst[] = [];
  const cleanOps: Op[] = [];
  let pendingOp: Op | null = null;
  for (let i = 0; i < operands.length; i++) {
    const operand = operands[i]!;
    const w = operatorWord(operand);
    if (w) {
      if (w.kind === 'NOT') return fail('UNSUPPORTED_NOT', NOT_MESSAGE, operand.location?.start);
      if (!w.exactUpper) {
        return fail('LOWERCASE_OPERATOR', `演算子は大文字の AND / OR で入力してください。"${bareWord(operand)}" という語を検索する場合はダブルクォートで囲んでください。`, operand.location?.start);
      }
      // 前後が空白(暗黙の AND)であること。先頭・末尾・連続はエラー
      const before = ops[i - 1];
      const after = ops[i];
      if (i === 0 || i === operands.length - 1 || pendingOp !== null || !before?.implicit || !after?.implicit) {
        return fail('DANGLING_OPERATOR', 'AND / OR の前後に検索語が必要です。', operand.location?.start);
      }
      pendingOp = w.kind;
      continue;
    }
    if (cleanOperands.length > 0) cleanOps.push(pendingOp ?? ops[i - 1]!.op);
    pendingOp = null;
    cleanOperands.push(operand);
  }

  // 2) 括弧なしの AND と OR の混在はエラー(D-4)
  const hasAnd = cleanOps.includes('AND');
  const hasOr = cleanOps.includes('OR');
  if (hasAnd && hasOr) {
    return fail('MIXED_AND_OR', 'AND と OR を括弧なしで混ぜることはできません。例: ラーメン AND (渋谷 OR 新宿) / (ラーメン AND 渋谷) OR 新宿');
  }
  return { children: cleanOperands.map((x) => convertNode(ctx, x, depth)), type: hasOr ? 'or' : 'and' };
};

// ───────────────────────── 簡約(平坦化・重複除去) ─────────────────────────
const keyOf = (n: QueryNode): string =>
  n.type === 'term' ? `t:${n.value.toLowerCase()}` : `${n.type}(${n.children.map(keyOf).sort().join(',')})`;

export const simplify = (n: QueryNode): QueryNode => {
  if (n.type === 'term') return n;
  const flat: QueryNode[] = [];
  for (const c0 of n.children) {
    const c = simplify(c0);
    if (c.type === n.type) flat.push(...c.children);
    else flat.push(c);
  }
  const seen = new Set<string>();
  const uniq = flat.filter((c) => {
    const k = keyOf(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return uniq.length === 1 ? uniq[0]! : { children: uniq, type: n.type };
};

// ───────────────────────── 公開 API ─────────────────────────
export const parseSearchQuery = (input: string): ParsedSearchQuery => {
  if (codePointLength(input) > QUERY_LIMITS.maxLength) {
    throw new SearchQueryError('TOO_LONG', `検索式が長すぎます(最大${QUERY_LIMITS.maxLength}文字)。`);
  }
  const normalizedInput = preNormalize(input);
  const ctx: Ctx = { input: normalizedInput, termCount: 0 };

  let liqeAst: ParserAst;
  try {
    liqeAst = liqeParse(normalizedInput);
  } catch (error) {
    if (error instanceof LiqeSyntaxError) {
      return fail('SYNTAX', syntaxMessage(normalizedInput, error.offset), error.offset);
    }
    if (error instanceof LiqeError) {
      // 'Ambiguous results.'(例: "-5")
      return fail('AMBIGUOUS', '検索式を一意に解釈できません。ハイフンや数字で始まる語は "-5" のようにダブルクォートで囲んでください。');
    }
    if (error instanceof EvalError) {
      // CSP で eval が禁止された環境で、引用符付きのフィールド名(".a":b)を解析した場合
      return fail('UNSUPPORTED_FIELD', 'フィールド指定には対応していません。');
    }
    if (error instanceof Error && error.message === 'Found no parsings.') {
      return fail('INCOMPLETE', incompleteMessage(normalizedInput));
    }
    return fail('INTERNAL', '検索式の解析中にエラーが発生しました。');
  }

  if (liqeAst.type === 'EmptyExpression') return { ast: null, interpretation: '' };
  const ast = simplify(convertNode(ctx, liqeAst, 0));
  return { ast, interpretation: toDisplayString(ast) };
};
