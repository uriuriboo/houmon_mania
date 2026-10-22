/**
 * メモリ上の検索用データとの照合(9.3.2 の 8)。日時の降順に並べた検索用テキストを順に照合し、
 * 該当件数と表示ページ分の ID を返す。
 */
import { clampPage } from '@/lib/pagination';
import type { SearchEntries } from '@/lib/db/queries';
import type { QueryNode } from '@/lib/query/ast';
import { compileMatcher } from '@/lib/query/match';

export type EngineResult = { total: number; page: number; ids: string[] };

export class SearchEngine {
  private readonly ids: string[];
  private readonly texts: string[];

  public constructor(entries: SearchEntries) {
    this.ids = entries.ids;
    this.texts = entries.texts;
  }

  public get count(): number {
    return this.ids.length;
  }

  /** ast が null なら全件(閲覧モード) */
  public search(ast: QueryNode | null, page: number, size: number): EngineResult {
    if (ast === null) {
      const total = this.ids.length;
      const p = clampPage(page, total, size);
      return { ids: this.ids.slice((p - 1) * size, p * size), page: p, total };
    }
    const match = compileMatcher(ast);
    const hits = new Int32Array(this.texts.length);
    let total = 0;
    for (let i = 0; i < this.texts.length; i++) {
      if (match(this.texts[i]!)) hits[total++] = i;
    }
    const p = clampPage(page, total, size);
    const ids: string[] = [];
    for (let k = (p - 1) * size; k < Math.min(total, p * size); k++) ids.push(this.ids[hits[k]!]!);
    return { ids, page: p, total };
  }
}
