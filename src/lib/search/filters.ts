/**
 * 検索の詳細条件(絞り込み)。検索式と AND で組み合わせる。
 * 日付・曜日・時間帯は、チェックインした場所の現地時刻で判定する(一覧の表示と同じ。現地時刻との差が無ければ UTC)。
 * 画面では URL の # 以降に持ち、検索ワーカーでも同じ関数で検証し直す。
 */

/** 有無の条件。null は指定なし */
export type Presence = 'with' | 'without' | null;

/** 公開範囲の条件。none は「記録なし」 */
export const VISIBILITY_FILTERS = ['public', 'friends', 'closeFriends', 'private', 'none'] as const;
export type VisibilityFilter = (typeof VISIBILITY_FILTERS)[number];

export type SearchFilters = {
  /** 現地の日付 YYYY-MM-DD。両端を含む */
  from: string | null;
  to: string | null;
  /** 曜日(0=日)の昇順。空なら指定なし */
  weekdays: number[];
  /** 時(0〜23)。両端の時台を含む。from > to なら日をまたぐ(例: 22〜3) */
  hourFrom: number | null;
  hourTo: number | null;
  photo: Presence;
  /** コメント(shout) */
  shout: Presence;
  event: Presence;
  visibility: VisibilityFilter | null;
  /** 同じ店への訪問回数(保存しているチェックイン全体で数える) */
  visitsMin: number | null;
  visitsMax: number | null;
};

export const EMPTY_FILTERS: SearchFilters = {
  event: null,
  from: null,
  hourFrom: null,
  hourTo: null,
  photo: null,
  shout: null,
  to: null,
  visibility: null,
  visitsMax: null,
  visitsMin: null,
  weekdays: [],
};

export const MAX_VISITS = 99_999;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD を 1970-01-01 からの日数にする。存在しない日付は null */
export const dateToDayNumber = (s: string): number | null => {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1000) return null;
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return ms / DAY_MS;
};

// ───────────────────────── 値ごとの検証 ─────────────────────────
const asDate = (v: unknown): string | null => (typeof v === 'string' && dateToDayNumber(v) !== null ? v : null);

const asInt = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'string' && /^\d{1,6}$/u.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const asPresence = (v: unknown): Presence => (v === 'with' || v === 'without' ? v : null);

const asVisibility = (v: unknown): VisibilityFilter | null =>
  typeof v === 'string' && (VISIBILITY_FILTERS as readonly string[]).includes(v) ? (v as VisibilityFilter) : null;

/** 曜日の集合。7曜日すべては指定なしと同じなので空にする */
const asWeekdays = (v: unknown): number[] => {
  if (!Array.isArray(v)) return [];
  const set = new Set<number>();
  for (const x of v.slice(0, 7)) {
    const n = asInt(x, 0, 6);
    if (n !== null) set.add(n);
  }
  return set.size === 7 ? [] : [...set].sort((a, b) => a - b);
};

/** 受け取った値(検索ワーカーへの依頼など)を検証する。不正な項目は指定なしにする */
export const sanitizeFilters = (input: unknown): SearchFilters => {
  if (typeof input !== 'object' || input === null) return EMPTY_FILTERS;
  const o = input as Record<string, unknown>;
  return {
    event: asPresence(o.event),
    from: asDate(o.from),
    hourFrom: asInt(o.hourFrom, 0, 23),
    hourTo: asInt(o.hourTo, 0, 23),
    photo: asPresence(o.photo),
    shout: asPresence(o.shout),
    to: asDate(o.to),
    visibility: asVisibility(o.visibility),
    visitsMax: asInt(o.visitsMax, 1, MAX_VISITS),
    visitsMin: asInt(o.visitsMin, 1, MAX_VISITS),
    weekdays: asWeekdays(o.weekdays),
  };
};

export const hasFilters = (f: SearchFilters): boolean =>
  f.from !== null ||
  f.to !== null ||
  f.weekdays.length > 0 ||
  f.hourFrom !== null ||
  f.hourTo !== null ||
  f.photo !== null ||
  f.shout !== null ||
  f.event !== null ||
  f.visibility !== null ||
  f.visitsMin !== null ||
  f.visitsMax !== null;

// ───────────────────────── URL の # 以降 ─────────────────────────
// 有無は 1 / 0、曜日は数字を並べた文字列(例: 06 = 日と土)
const PRESENCE_PARAM = { with: '1', without: '0' } as const;
const presenceFromParam = (v: string | null): Presence => (v === '1' ? 'with' : v === '0' ? 'without' : null);

export const filtersFromParams = (params: URLSearchParams): SearchFilters =>
  sanitizeFilters({
    event: presenceFromParam(params.get('event')),
    from: params.get('from'),
    hourFrom: params.get('hf'),
    hourTo: params.get('ht'),
    photo: presenceFromParam(params.get('photo')),
    shout: presenceFromParam(params.get('shout')),
    to: params.get('to'),
    visibility: params.get('vis'),
    visitsMax: params.get('vmax'),
    visitsMin: params.get('vmin'),
    weekdays: [...(params.get('wd') ?? '').slice(0, 7)],
  });

export const filtersToParams = (f: SearchFilters, params: URLSearchParams): void => {
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.weekdays.length > 0) params.set('wd', f.weekdays.join(''));
  if (f.hourFrom !== null) params.set('hf', String(f.hourFrom));
  if (f.hourTo !== null) params.set('ht', String(f.hourTo));
  if (f.photo) params.set('photo', PRESENCE_PARAM[f.photo]);
  if (f.shout) params.set('shout', PRESENCE_PARAM[f.shout]);
  if (f.event) params.set('event', PRESENCE_PARAM[f.event]);
  if (f.visibility) params.set('vis', f.visibility);
  if (f.visitsMin !== null) params.set('vmin', String(f.visitsMin));
  if (f.visitsMax !== null) params.set('vmax', String(f.visitsMax));
};

/** 検索の実行を判断するためのキー(同じ条件なら同じ文字列) */
export const filtersKey = (f: SearchFilters): string => {
  const params = new URLSearchParams();
  filtersToParams(f, params);
  return params.toString();
};

// ───────────────────────── 表示 ─────────────────────────
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

export const VISIBILITY_FILTER_LABELS: Record<VisibilityFilter, string> = {
  closeFriends: '親しい友達',
  friends: '友達',
  none: '記録なし',
  private: '非公開',
  public: '公開',
};

const slashDate = (s: string) => s.replaceAll('-', '/');

const rangeLabel = (from: string | null, to: string | null, unit = ''): string | null => {
  if (from !== null && to !== null) return `${from}〜${to}${unit}`;
  if (from !== null) return `${from}${unit}以上`;
  if (to !== null) return `${to}${unit}以下`;
  return null;
};

/** 利用者に見せる条件の一覧 例: ["2024/01/01〜2024/12/31", "土・日曜", "写真あり"] */
export const describeFilters = (f: SearchFilters): string[] => {
  const out: string[] = [];
  if (f.from !== null && f.to !== null) out.push(`${slashDate(f.from)}〜${slashDate(f.to)}`);
  else if (f.from !== null) out.push(`${slashDate(f.from)}以降`);
  else if (f.to !== null) out.push(`${slashDate(f.to)}以前`);
  if (f.weekdays.length > 0) out.push(`${f.weekdays.map((d) => WEEKDAY_LABELS[d]).join('・')}曜`);
  if (f.hourFrom !== null || f.hourTo !== null) out.push(`${f.hourFrom ?? 0}時〜${f.hourTo ?? 23}時台`);
  if (f.photo) out.push(f.photo === 'with' ? '写真あり' : '写真なし');
  if (f.shout) out.push(f.shout === 'with' ? 'コメントあり' : 'コメントなし');
  if (f.event) out.push(f.event === 'with' ? 'イベントのみ' : 'イベント以外');
  if (f.visibility) out.push(`公開範囲: ${VISIBILITY_FILTER_LABELS[f.visibility]}`);
  const visits = rangeLabel(
    f.visitsMin === null ? null : String(f.visitsMin),
    f.visitsMax === null ? null : String(f.visitsMax),
    '回',
  );
  if (visits) out.push(`同じ店に${visits}`);
  return out;
};
