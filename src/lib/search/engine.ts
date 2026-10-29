/**
 * メモリ上の検索用データとの照合(9.3.2 の 8)。日時の降順に並べた検索用テキストを順に照合し、
 * 該当件数と表示ページ分の ID を返す。詳細条件(絞り込み)があれば、検索式と AND で組み合わせる。
 */
import { clampPage } from '@/lib/pagination';
import type { SearchEntries } from '@/lib/db/queries';
import type { QueryNode } from '@/lib/query/ast';
import { compileMatcher } from '@/lib/query/match';
import { dateToDayNumber, hasFilters, VISIBILITY_FILTERS, type Presence, type SearchFilters } from './filters';

export type EngineResult = { total: number; page: number; ids: string[] };

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const FLAG_PHOTO = 1;
const FLAG_SHOUT = 2;
const FLAG_EVENT = 4;

/** 公開範囲の番号(VISIBILITY_FILTERS の位置)。記録なしは none、未知の値はどの条件にも一致しない */
const VIS_NONE = VISIBILITY_FILTERS.indexOf('none');
const VIS_OTHER = 255;
const visibilityCode = (v: string | null): number => {
  if (v === null) return VIS_NONE;
  const i = (VISIBILITY_FILTERS as readonly string[]).indexOf(v);
  return i < 0 || i === VIS_NONE ? VIS_OTHER : i;
};

/** 1970-01-01 からの日数の曜日(0=日)。1970-01-01 は木曜(4) */
const weekdayOf = (day: number): number => (((day + 4) % 7) + 7) % 7;

type Predicate = (i: number) => boolean;

export class SearchEngine {
  private readonly ids: string[];
  private readonly texts: string[];
  /** 現地の日付(1970-01-01 からの日数) */
  private readonly day: Int32Array;
  /** 現地の時(0〜23) */
  private readonly hour: Uint8Array;
  private readonly flags: Uint8Array;
  private readonly vis: Uint8Array;
  /** 同じ店への訪問回数(店が無ければ 0) */
  private readonly visits: Uint32Array;

  public constructor(entries: SearchEntries) {
    this.ids = entries.ids;
    this.texts = entries.texts;
    const n = entries.ids.length;
    this.day = new Int32Array(n);
    this.hour = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.vis = new Uint8Array(n);
    this.visits = new Uint32Array(n);

    const venueCounts = new Map<string, number>();
    for (const a of entries.attrs) {
      if (a.venue_id) venueCounts.set(a.venue_id, (venueCounts.get(a.venue_id) ?? 0) + 1);
    }
    for (let i = 0; i < n; i++) {
      const a = entries.attrs[i]!;
      const local = a.created_at + (a.tz_offset ?? 0) * 60_000;
      this.day[i] = Math.floor(local / DAY_MS);
      this.hour[i] = Math.floor((((local % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS);
      this.flags[i] = (a.has_photo ? FLAG_PHOTO : 0) | (a.has_shout ? FLAG_SHOUT : 0) | (a.has_event ? FLAG_EVENT : 0);
      this.vis[i] = visibilityCode(a.visibility ?? null);
      this.visits[i] = a.venue_id ? venueCounts.get(a.venue_id)! : 0;
    }
  }

  public get count(): number {
    return this.ids.length;
  }

  /** 詳細条件を照合用の関数にする。条件が無ければ null */
  private compileFilters(f: SearchFilters): Predicate | null {
    if (!hasFilters(f)) return null;
    const tests: Predicate[] = [];

    const fromDay = f.from === null ? null : dateToDayNumber(f.from);
    const toDay = f.to === null ? null : dateToDayNumber(f.to);
    if (fromDay !== null) tests.push((i) => this.day[i]! >= fromDay);
    if (toDay !== null) tests.push((i) => this.day[i]! <= toDay);

    if (f.weekdays.length > 0) {
      let mask = 0;
      for (const d of f.weekdays) mask |= 1 << d;
      tests.push((i) => (mask & (1 << weekdayOf(this.day[i]!))) !== 0);
    }

    if (f.hourFrom !== null || f.hourTo !== null) {
      const hf = f.hourFrom ?? 0;
      const ht = f.hourTo ?? 23;
      tests.push(hf <= ht ? (i) => this.hour[i]! >= hf && this.hour[i]! <= ht : (i) => this.hour[i]! >= hf || this.hour[i]! <= ht);
    }

    const presence = (p: Presence, flag: number) => {
      if (p === 'with') tests.push((i) => (this.flags[i]! & flag) !== 0);
      else if (p === 'without') tests.push((i) => (this.flags[i]! & flag) === 0);
    };
    presence(f.photo, FLAG_PHOTO);
    presence(f.shout, FLAG_SHOUT);
    presence(f.event, FLAG_EVENT);

    if (f.visibility !== null) {
      const code = VISIBILITY_FILTERS.indexOf(f.visibility);
      tests.push((i) => this.vis[i] === code);
    }

    if (f.visitsMin !== null || f.visitsMax !== null) {
      const min = Math.max(f.visitsMin ?? 1, 1);
      const max = f.visitsMax ?? Number.MAX_SAFE_INTEGER;
      tests.push((i) => this.visits[i]! >= min && this.visits[i]! <= max);
    }

    return (i) => {
      for (const t of tests) if (!t(i)) return false;
      return true;
    };
  }

  /** ast が null で詳細条件も無ければ全件(閲覧モード) */
  public search(ast: QueryNode | null, filters: SearchFilters, page: number, size: number): EngineResult {
    const filter = this.compileFilters(filters);
    if (ast === null && filter === null) {
      const total = this.ids.length;
      const p = clampPage(page, total, size);
      return { ids: this.ids.slice((p - 1) * size, p * size), page: p, total };
    }
    const match = ast === null ? null : compileMatcher(ast);
    const hits = new Int32Array(this.texts.length);
    let total = 0;
    for (let i = 0; i < this.texts.length; i++) {
      if ((filter === null || filter(i)) && (match === null || match(this.texts[i]!))) hits[total++] = i;
    }
    const p = clampPage(page, total, size);
    const ids: string[] = [];
    for (let k = (p - 1) * size; k < Math.min(total, p * size); k++) ids.push(this.ids[hits[k]!]!);
    return { ids, page: p, total };
  }
}
