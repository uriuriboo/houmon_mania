/**
 * 検索ワーカーでの照合(9.3.2 の 6〜7)。
 * 中間AST を再検証し、照合用の関数の木に組み立てる。文字列からコードを作って実行する方法は使わない(N-10)。
 */
import { QUERY_LIMITS } from '@/lib/constants';
import { codePointLength, normalizeForSearch } from '@/lib/text';
import type { QueryNode } from './ast';

export class InvalidAstError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'InvalidAstError';
  }
}

/** 画面から受け取った値が、正しい中間AST であることを確かめる(語数・深さ・語の長さ・未知の type) */
export const validateAst = (input: unknown): QueryNode => {
  let terms = 0;
  const walk = (n: unknown, depth: number): QueryNode => {
    // 括弧の入れ子(maxDepth)+ 最上位の演算子 + 語
    if (depth > QUERY_LIMITS.maxDepth + 2) throw new InvalidAstError('too deep');
    if (typeof n !== 'object' || n === null) throw new InvalidAstError('not an object');
    const node = n as Record<string, unknown>;
    if (node.type === 'term') {
      const v = node.value;
      if (typeof v !== 'string' || v.length === 0 || codePointLength(v) > QUERY_LIMITS.maxTermLength) throw new InvalidAstError('bad term');
      terms += 1;
      if (terms > QUERY_LIMITS.maxTerms) throw new InvalidAstError('too many terms');
      return { quoted: node.quoted === true, type: 'term', value: v };
    }
    if (node.type === 'and' || node.type === 'or') {
      const children = node.children;
      if (!Array.isArray(children) || children.length === 0 || children.length > QUERY_LIMITS.maxTerms) throw new InvalidAstError('bad children');
      return { children: children.map((c) => walk(c, depth + 1)), type: node.type };
    }
    throw new InvalidAstError('unknown type');
  };
  return walk(input, 0);
};

export type Matcher = (searchText: string) => boolean;

/** 中間AST を照合用の関数にする。各語は検索用テキストと同じ関数で正規化し、部分一致で照合する(9.3.3) */
export const compileMatcher = (ast: QueryNode): Matcher => {
  if (ast.type === 'term') {
    const needle = normalizeForSearch(ast.value);
    return (text) => text.includes(needle);
  }
  const children = ast.children.map(compileMatcher);
  if (ast.type === 'and') return (text) => children.every((m) => m(text));
  return (text) => children.some((m) => m(text));
};
