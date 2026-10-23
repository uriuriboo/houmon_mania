/**
 * 中間AST(9.3.2)。検索式を AND / OR / 語 だけで表した木構造。
 * 画面で作り、検索ワーカーに渡す(ワーカーでも再検証する)。
 */
export type TermNode = { type: 'term'; value: string; quoted: boolean };
export type GroupNode = { type: 'and' | 'or'; children: QueryNode[] };
export type QueryNode = GroupNode | TermNode;

const needsQuote = (v: string): boolean =>
  !/^[^\s()"'&|:*?\\/!,+=%~^[\]{}<>]+$/u.test(v) || /^(?:and|or|not)$/iu.test(v) || v.startsWith('-');

/** 利用者に見せる「解釈」の文字列。例: 一蘭 OR (ラーメン AND 渋谷) */
export const toDisplayString = (n: QueryNode, top = true): string => {
  if (n.type === 'term') return n.quoted || needsQuote(n.value) ? JSON.stringify(n.value) : n.value;
  const s = n.children.map((c) => toDisplayString(c, false)).join(n.type === 'and' ? ' AND ' : ' OR ');
  return top ? s : `(${s})`;
};
