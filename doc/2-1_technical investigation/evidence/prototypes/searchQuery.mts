/**
 * 検索クエリ → liqe AST → 中間AST → パラメータ化 SQL 変換の試作(検証7 / F-20,21,23,26, N-10)
 *
 * パイプライン:
 *   1. 長さ制限(パース前。liqe は長い1語で O(n^2) になるため必須)
 *   2. パース前正規化(既定 'selective': 空白類→半角空白、全角括弧→半角、全角/スマート二重引用符→")
 *   3. liqe.parse()
 *   4. AST ホワイトリスト検証 + 中間AST化(語は NFKC 正規化)
 *   5. 中間AST → WHERE 句 + パラメータ配列(ILIKE、LIKE メタ文字エスケープ、同一語はプレースホルダ共有)
 */
import { parse as liqeParse, LiqeError, SyntaxError as LiqeSyntaxError } from 'liqe';
import type { LiteralExpressionToken, LogicalExpressionToken, ParserAst, TagToken } from 'liqe';

// ───────────────────────── 中間AST ─────────────────────────
export type TermNode = { type: 'term'; value: string; quoted: boolean };
export type GroupNode = { type: 'and' | 'or'; children: QueryNode[] };
export type QueryNode = GroupNode | TermNode;

// ───────────────────────── エラー ─────────────────────────
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
  /** 正規化後入力 (normalizedInput) 上の位置。不明なら undefined */
  public readonly offset: number | undefined;
  public readonly normalizedInput: string | undefined;
  public constructor(code: QueryErrorCode, message: string, offset?: number, normalizedInput?: string) {
    super(message);
    this.name = 'SearchQueryError';
    this.code = code;
    this.offset = offset;
    this.normalizedInput = normalizedInput;
  }
}

// ───────────────────────── オプション ─────────────────────────
export type Options = {
  /** 'liqe' = liqe の AST どおり(左から順に結合・優先順位なし) / 'strict' = 括弧なしの AND/OR 混在をエラー
   *  'and-first' = AND を優先(SQL 流) / 'or-first' = OR を優先(Google 流) */
  readonly precedence: 'and-first' | 'liqe' | 'or-first' | 'strict';
  /** 小文字/大小混在の and/or: 'error' = エラーで大文字化を促す / 'operator' = 演算子とみなす / 'term' = 語として検索(liqe 既定) */
  readonly lowercaseOperators: 'error' | 'operator' | 'term';
  /** 非引用語中の半角 * ?: 'error' = 未対応構文として弾く / 'literal' = 文字として検索 */
  readonly wildcard: 'error' | 'literal';
  /** パース前正規化: 'selective' = 空白・括弧・引用符のみ / 'nfkc' = 入力全体を NFKC */
  readonly normalize: 'nfkc' | 'selective';
  readonly maxLength: number;
  readonly maxTermLength: number;
  readonly maxTerms: number;
  /** 括弧の入れ子の最大段数 */
  readonly maxDepth: number;
};

export const DEFAULT_OPTIONS: Options = {
  lowercaseOperators: 'error',
  maxDepth: 5,
  maxLength: 200,
  maxTermLength: 50,
  maxTerms: 10,
  normalize: 'selective',
  precedence: 'strict',
  wildcard: 'error',
};

export type ParsedSearchQuery = {
  /** null = 空クエリ(キーワード条件なし) */
  readonly ast: QueryNode | null;
  readonly normalizedInput: string;
  /** 利用者に見せる「解釈」 例: ラーメン AND (渋谷 OR 新宿) */
  readonly interpretation: string;
};

// ───────────────────────── 正規化 ─────────────────────────
// JS の \s は U+3000(全角空白), U+00A0, \r, \n, \t, U+2028/2029, U+FEFF 等を含む
const WHITESPACE = /\s/gu;
const ZERO_WIDTH = /[​-‍⁠﻿]/gu;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/u;

/** パース前正規化。'selective' は 1 文字→1 文字の置換のみ(liqe の offset が入力位置とずれない) */
export const preNormalize = (input: string, mode: Options['normalize']): string => {
  const s = mode === 'nfkc' ? input.normalize('NFKC') : input;
  return s
    .replace(WHITESPACE, ' ')
    .replace(/[（）]/gu, (c) => (c === '（' ? '(' : ')'))
    .replace(/[＂“”]/gu, '"');
};

/** 語の正規化(パース後)。DB 側 search_text と同じ NFKC を適用 */
export const normalizeTerm = (raw: string): string => raw.normalize('NFKC').replace(ZERO_WIDTH, '');

// ───────────────────────── エラーメッセージ ─────────────────────────
const QUOTE_HINT = '記号を含む語は "H&M" のようにダブルクォートで囲んでください。';

/** 引用符内を同じ長さの空白で塗りつぶす(位置を保ったまま、引用符外だけを調べるため) */
const maskQuoted = (input: string): string =>
  input.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu, (m) => ' '.repeat(m.length));

const syntaxMessage = (input: string, offset: number): string => {
  const ch = input[offset] ?? '';
  const pos = `${offset + 1}文字目「${ch}」付近`;
  const masked = maskQuoted(input);
  // 先頭の AND/OR、または直前の語が AND/OR/NOT(例: "OR B", "A AND AND B")
  const before = masked.slice(0, offset).trimEnd().split(' ').pop() ?? '';
  if (/^\s*(?:AND|OR)(?:\s|$)/u.test(masked) || ['AND', 'OR', 'NOT'].includes(before)) {
    return `検索式を解釈できません(${pos})。AND / OR の前後に検索語が必要です。`;
  }
  // 括弧が語に密着している(例: "A AND(B OR C)", "(A)B", "A(B)")
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
  if (unquoted.includes(':') || unquoted.includes('/')) return `検索式を解釈できません。コロン(:)やスラッシュ(/)を含む語(URL など)は "https://example.com" のようにダブルクォートで囲んでください。`;
  return '検索式が途中で終わっています。引用符や括弧の閉じ忘れ、末尾の AND / OR がないか確認してください。';
};

// ───────────────────────── 変換本体 ─────────────────────────
type Op = 'AND' | 'OR';
type Ctx = { readonly input: string; readonly opts: Options; termCount: number };

const fail = (ctx: Ctx, code: QueryErrorCode, message: string, offset?: number): never => {
  throw new SearchQueryError(code, message, offset, ctx.input);
};

/** 非引用・文字列値・ImplicitField の Tag なら、その生の値を返す */
const bareWord = (n: ParserAst): string | null => {
  if (n.type !== 'Tag' || n.field.type !== 'ImplicitField') return null;
  const e = n.expression;
  if (e.type !== 'LiteralExpression' || e.quoted || typeof e.value !== 'string') return null;
  return e.value;
};

/** 演算子語の判定: 'AND' | 'OR' | 'NOT' | 'lower-and' ... */
const operatorWord = (n: ParserAst): { kind: 'NOT' | Op; exactUpper: boolean } | null => {
  const w = bareWord(n);
  if (w === null) return null;
  const nk = w.normalize('NFKC');
  const up = nk.toUpperCase();
  if (up !== 'AND' && up !== 'OR' && up !== 'NOT') return null;
  return { exactUpper: nk === up, kind: up };
};

/** 数値リテラル等の元の綴りを入力から取り出す(liqe は "007"→7, "1.50"→1.5 に変換してしまうため) */
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
    return fail(ctx, 'UNSUPPORTED_FIELD', `フィールド指定(例: venue:一蘭)には対応していません。コロンを含む語は "12:30" のようにダブルクォートで囲んでください。`, at);
  }
  const e = n.expression;
  if (e.type === 'RegexExpression') return fail(ctx, 'UNSUPPORTED_REGEX', `正規表現(/.../)には対応していません。スラッシュを含む語は "a/b" のようにダブルクォートで囲んでください。`, at);
  if (e.type === 'RangeExpression') return fail(ctx, 'UNSUPPORTED_RANGE', '範囲指定([1 TO 5] など)には対応していません。', at);
  if (e.type === 'EmptyExpression') return fail(ctx, 'EMPTY_TERM', '空の検索語があります。', at);

  const raw = originalLiteralText(ctx, e);
  // * は全角/半角とも、? は半角のみワイルドカード扱い(全角の ？ は日本語文中の普通の記号として通す)
  if (!e.quoted && ctx.opts.wildcard === 'error' && /[*?＊]/u.test(raw)) {
    return fail(ctx, 'UNSUPPORTED_WILDCARD', 'ワイルドカード(* ?)には対応していません。検索は部分一致なので * は不要です。記号として検索する場合は "なに?" のようにダブルクォートで囲んでください。', at);
  }
  const value = normalizeTerm(raw);
  if (CONTROL.test(value)) {
    return fail(ctx, 'INVALID_CHAR', '検索語に使用できない文字(制御文字)が含まれています。引用符内の \\ はエスケープ文字として扱われるため、\\ 自体を検索する場合は \\\\ と入力してください。', at);
  }
  if (value.trim() === '') return fail(ctx, 'EMPTY_TERM', '空の引用符 "" は使えません。', at);
  if ([...value].length > ctx.opts.maxTermLength) return fail(ctx, 'TERM_TOO_LONG', `1つの検索語は${ctx.opts.maxTermLength}文字以内にしてください。`, at);
  ctx.termCount += 1;
  if (ctx.termCount > ctx.opts.maxTerms) return fail(ctx, 'TOO_MANY_TERMS', `検索語が多すぎます(最大${ctx.opts.maxTerms}語)。`, at);
  return { quoted: e.quoted, type: 'term', value };
};

/** 左再帰の LogicalExpression 連鎖を [operand, op, operand, op, ...] に平坦化(括弧はまたがない) */
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

const convertNode = (ctx: Ctx, n: ParserAst, depth: number): QueryNode => {
  switch (n.type) {
    case 'EmptyExpression':
      return fail(ctx, 'EMPTY_GROUP', '空の括弧 () は使えません。');
    case 'ParenthesizedExpression': {
      if (n.expression.type === 'EmptyExpression') return fail(ctx, 'EMPTY_GROUP', '空の括弧 () は使えません。', typeof n.location?.start === 'number' ? n.location.start : undefined);
      if (depth + 1 > ctx.opts.maxDepth) return fail(ctx, 'TOO_DEEP', `括弧の入れ子が深すぎます(最大${ctx.opts.maxDepth}段)。`);
      return convertNode(ctx, n.expression, depth + 1);
    }
    case 'UnaryOperator':
      return fail(ctx, 'UNSUPPORTED_NOT', '除外検索(NOT / -)には対応していません。ハイフンで始まる語は "-ラーメン" のようにダブルクォートで囲んでください。', n.location?.start);
    case 'Tag': {
      const w = operatorWord(n);
      if (w && ctx.opts.lowercaseOperators !== 'term') {
        if (w.kind === 'NOT') return fail(ctx, 'UNSUPPORTED_NOT', '除外検索(NOT)には対応していません。"not" という語を検索する場合はダブルクォートで囲んでください。', n.location?.start);
        return fail(ctx, 'DANGLING_OPERATOR', 'AND / OR の前後に検索語が必要です。', n.location?.start);
      }
      return convertTag(ctx, n);
    }
    case 'LogicalExpression':
      return convertChain(ctx, n, depth);
    default:
      return fail(ctx, 'INTERNAL', '検索式の解析中に不明な構文が見つかりました。');
  }
};

const convertChain = (ctx: Ctx, n: LogicalExpressionToken, depth: number): QueryNode => {
  const { operands, ops } = flattenChain(n);

  // 1) 演算子語(小文字 and/or、全角 ＡＮＤ/ＯＲ 等)の再解釈
  const cleanOperands: ParserAst[] = [];
  const cleanOps: Op[] = [];
  let pendingOp: Op | null = null;
  for (let i = 0; i < operands.length; i++) {
    const operand = operands[i]!;
    const w = ctx.opts.lowercaseOperators === 'term' ? null : operatorWord(operand);
    if (w) {
      if (w.kind === 'NOT') return fail(ctx, 'UNSUPPORTED_NOT', '除外検索(NOT)には対応していません。"not" という語を検索する場合はダブルクォートで囲んでください。', operand.location?.start);
      if (!w.exactUpper && ctx.opts.lowercaseOperators === 'error') {
        return fail(ctx, 'LOWERCASE_OPERATOR', `演算子は大文字の AND / OR で入力してください。"${bareWord(operand)}" という語を検索する場合はダブルクォートで囲んでください。`, operand.location?.start);
      }
      // 前後が暗黙AND(空白)であることが条件。先頭・末尾・連続はエラー
      const before = ops[i - 1];
      const after = ops[i];
      if (i === 0 || i === operands.length - 1 || pendingOp !== null || !before?.implicit || !after?.implicit) {
        return fail(ctx, 'DANGLING_OPERATOR', 'AND / OR の前後に検索語が必要です。', operand.location?.start);
      }
      pendingOp = w.kind;
      continue;
    }
    if (cleanOperands.length > 0) {
      cleanOps.push(pendingOp ?? ops[i - 1]!.op);
    }
    pendingOp = null;
    cleanOperands.push(operand);
  }

  // 2) 優先順位ポリシーの適用
  const conv = (x: ParserAst): QueryNode => convertNode(ctx, x, depth);
  const hasAnd = cleanOps.includes('AND');
  const hasOr = cleanOps.includes('OR');
  const policy = ctx.opts.precedence;
  if (!(hasAnd && hasOr)) {
    return { children: cleanOperands.map(conv), type: hasOr ? 'or' : 'and' };
  }
  if (policy === 'strict') {
    return fail(ctx, 'MIXED_AND_OR', 'AND と OR を括弧なしで混在させることはできません。例: ラーメン AND (渋谷 OR 新宿) / (ラーメン AND 渋谷) OR 新宿');
  }
  if (policy === 'liqe') {
    let acc: QueryNode = conv(cleanOperands[0]!);
    for (let i = 0; i < cleanOps.length; i++) {
      acc = { children: [acc, conv(cleanOperands[i + 1]!)], type: cleanOps[i] === 'AND' ? 'and' : 'or' };
    }
    return acc;
  }
  // and-first: OR で分割して各区間を AND / or-first: AND で分割して各区間を OR
  const splitOp: Op = policy === 'and-first' ? 'OR' : 'AND';
  const groups: ParserAst[][] = [[cleanOperands[0]!]];
  for (let i = 0; i < cleanOps.length; i++) {
    if (cleanOps[i] === splitOp) groups.push([]);
    groups[groups.length - 1]!.push(cleanOperands[i + 1]!);
  }
  const innerType = policy === 'and-first' ? 'and' : 'or';
  return {
    children: groups.map((g) => (g.length === 1 ? conv(g[0]!) : { children: g.map(conv), type: innerType })),
    type: policy === 'and-first' ? 'or' : 'and',
  };
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

// ───────────────────────── 表示用文字列 ─────────────────────────
const needsQuote = (v: string): boolean => !/^[^\s()"'&|:*?\\/!,+=%~^[\]{}<>]+$/u.test(v) || /^(?:and|or|not)$/iu.test(v) || v.startsWith('-');

export const toDisplayString = (n: QueryNode, top = true): string => {
  if (n.type === 'term') return n.quoted || needsQuote(n.value) ? JSON.stringify(n.value) : n.value;
  const s = n.children.map((c) => toDisplayString(c, false)).join(n.type === 'and' ? ' AND ' : ' OR ');
  return top ? s : `(${s})`;
};

// ───────────────────────── 公開 API ─────────────────────────
export const parseSearchQuery = (input: string, options: Partial<Options> = {}): ParsedSearchQuery => {
  const opts: Options = { ...DEFAULT_OPTIONS, ...options };
  // (1) 長さ制限はパース前に(コードポイント数で判定)
  if ([...input].length > opts.maxLength) {
    throw new SearchQueryError('TOO_LONG', `検索条件が長すぎます(最大${opts.maxLength}文字)。`);
  }
  const normalizedInput = preNormalize(input, opts.normalize);
  const ctx: Ctx = { input: normalizedInput, opts, termCount: 0 };

  let liqeAst: ParserAst;
  try {
    liqeAst = liqeParse(normalizedInput);
  } catch (error) {
    if (error instanceof LiqeSyntaxError) {
      return fail(ctx, 'SYNTAX', syntaxMessage(normalizedInput, error.offset), error.offset);
    }
    if (error instanceof LiqeError) {
      // 'Ambiguous results.' (例: "-5")
      return fail(ctx, 'AMBIGUOUS', '検索式を一意に解釈できません。ハイフンや数字で始まる語は "-5" のようにダブルクォートで囲んでください。');
    }
    if (error instanceof EvalError) {
      // eval/new Function 禁止環境(Cloudflare Workers 等)で ".a":b のような引用符付きフィールド名を parse した場合
      return fail(ctx, 'UNSUPPORTED_FIELD', 'フィールド指定には対応していません。');
    }
    if (error instanceof Error && error.message === 'Found no parsings.') {
      return fail(ctx, 'INCOMPLETE', incompleteMessage(normalizedInput));
    }
    throw new SearchQueryError('INTERNAL', '検索式の解析中にエラーが発生しました。', undefined, normalizedInput);
  }

  if (liqeAst.type === 'EmptyExpression') {
    return { ast: null, interpretation: '', normalizedInput };
  }
  const ast = simplify(convertNode(ctx, liqeAst, 0));
  return { ast, interpretation: toDisplayString(ast), normalizedInput };
};

// ───────────────────────── SQL 生成 ─────────────────────────
export type SqlOptions = {
  /** 検索対象列(識別子。利用者入力は絶対に渡さない) */
  readonly column?: string;
  /** プレースホルダ書式。既定は $n。PL/pgSQL の EXECUTE ... USING text[] 用には (i) => `$1[${i}]` 等 */
  readonly placeholder?: (index: number) => string;
  /** 最初のパラメータ番号(他の条件と合成する時のずらし用) */
  readonly startIndex?: number;
  /** 'ILIKE' = col ILIKE $n(要件どおり) / 'LIKE_LOWER' = col LIKE lower($n)
   *  search_text を lower(normalize(...)) で保持しているなら LIKE_LOWER で同じ結果になり、
   *  マルチバイト時に ILIKE が行ごとに lower() する負荷を避けられる(実測は 12-terms-cost 参照) */
  readonly operator?: 'ILIKE' | 'LIKE_LOWER';
};

/** LIKE のメタ文字(\ % _)をエスケープ。Postgres の LIKE 既定エスケープ文字は \ */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/gu, (c) => `\\${c}`);

export const toSqlWhere = (node: QueryNode, options: SqlOptions = {}): { params: string[]; sql: string } => {
  const column = options.column ?? 'search_text';
  if (!/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/u.test(column)) throw new Error('invalid column identifier');
  const start = options.startIndex ?? 1;
  const ph = options.placeholder ?? ((i: number) => `$${i}`);
  const op = options.operator ?? 'ILIKE';
  const params: string[] = [];
  const indexOf = new Map<string, number>();

  const walk = (n: QueryNode): string => {
    if (n.type === 'term') {
      const p = `%${escapeLike(n.value)}%`;
      let idx = indexOf.get(p);
      if (idx === undefined) {
        params.push(p);
        idx = start + params.length - 1;
        indexOf.set(p, idx);
      }
      return op === 'ILIKE' ? `(${column} ILIKE ${ph(idx)})` : `(${column} LIKE lower(${ph(idx)}))`;
    }
    const parts = n.children.map((c) => (c.type === 'term' ? walk(c) : `(${walk(c)})`));
    return parts.join(n.type === 'and' ? ' AND ' : ' OR ');
  };
  return { params, sql: walk(node) };
};

// ───────────────────────── テスト用: JS 参照評価器 ─────────────────────────
/** search_text(正規化済み)に対する期待結果を JS で計算(SQL 結果との突き合わせ用) */
export const evaluate = (n: QueryNode, normalizedText: string): boolean => {
  if (n.type === 'term') return normalizedText.toLowerCase().includes(n.value.toLowerCase());
  return n.type === 'and' ? n.children.every((c) => evaluate(c, normalizedText)) : n.children.some((c) => evaluate(c, normalizedText));
};

export const compactQuery = (n: QueryNode | null): string => {
  if (n === null) return 'null';
  if (n.type === 'term') return `${n.quoted ? 'q' : ''}${JSON.stringify(n.value)}`;
  return `${n.type}(${n.children.map(compactQuery).join(', ')})`;
};
