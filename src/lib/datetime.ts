/**
 * 日時の解釈と表示。チェックイン日時は、チェックインした場所の現地時刻で表示する(1章)。
 */

/** チェックイン日時として受け付ける範囲の下限(2009-01-01 UTC) */
export const MIN_CHECKIN_TIME = Date.UTC(2009, 0, 1);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const CREATED_AT_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z?$/u;

/**
 * エクスポートの createdAt を UTC のミリ秒にする(7.1)。
 * - 文字列: `YYYY-MM-DD HH:MM:SS.ffffff`(UTC。2026年版の実物で確認)
 * - 整数: UNIX 秒(2019年ごろの形式)
 * 範囲(2009-01-01〜現在+1日)外や解釈できない値は null。
 */
export const parseCreatedAt = (value: unknown, now: number = Date.now()): number | null => {
  let ms: number;
  if (typeof value === 'string') {
    const m = CREATED_AT_RE.exec(value);
    if (!m) return null;
    const [, y, mo, d, h, mi, s, frac] = m;
    const year = Number(y);
    const month = Number(mo);
    const day = Number(d);
    const hour = Number(h);
    const minute = Number(mi);
    const second = Number(s);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
    ms = Date.UTC(year, month - 1, day, hour, minute, second, frac ? Number(frac.slice(0, 3).padEnd(3, '0')) : 0);
    // 2月30日のような存在しない日付を弾く
    const check = new Date(ms);
    if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null;
  } else if (typeof value === 'number' && Number.isInteger(value)) {
    ms = value * 1000;
  } else {
    return null;
  }
  if (!Number.isFinite(ms) || ms < MIN_CHECKIN_TIME || ms > now + ONE_DAY_MS) return null;
  return ms;
};

export type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=日
};

/** UTC のミリ秒と現地時刻との差(分)から、現地時刻の各部分を求める。差が無ければ UTC */
export const toLocalParts = (utcMs: number, tzOffsetMin: number | null): LocalParts => {
  const d = new Date(utcMs + (tzOffsetMin ?? 0) * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    weekday: d.getUTCDay(),
  };
};

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** 一覧の日時「MM/DD(曜) HH:mm」(5.4) */
export const formatListDateTime = (utcMs: number, tzOffsetMin: number | null): string => {
  const p = toLocalParts(utcMs, tzOffsetMin);
  return `${pad2(p.month)}/${pad2(p.day)}(${WEEKDAYS[p.weekday]}) ${pad2(p.hour)}:${pad2(p.minute)}`;
};

/** 月見出し「YYYY年M月」 */
export const formatMonthHeading = (utcMs: number, tzOffsetMin: number | null): string => {
  const p = toLocalParts(utcMs, tzOffsetMin);
  return `${p.year}年${p.month}月`;
};

/** 月見出しのまとまりを判定するキー */
export const monthKey = (utcMs: number, tzOffsetMin: number | null): string => {
  const p = toLocalParts(utcMs, tzOffsetMin);
  return `${p.year}-${p.month}`;
};

/** 「UTC+9」「UTC-5:30」「UTC±0」 */
export const formatUtcOffset = (tzOffsetMin: number | null): string => {
  if (tzOffsetMin === null) return 'UTC';
  if (tzOffsetMin === 0) return 'UTC±0';
  const sign = tzOffsetMin > 0 ? '+' : '-';
  const abs = Math.abs(tzOffsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${pad2(m)}` : ''}`;
};

/** 詳細の日時「YYYY年M月D日(曜) HH:mm(現地時刻 UTC+9)」 */
export const formatDetailDateTime = (utcMs: number, tzOffsetMin: number | null): string => {
  const p = toLocalParts(utcMs, tzOffsetMin);
  const zone = tzOffsetMin === null ? 'UTC' : `現地時刻 ${formatUtcOffset(tzOffsetMin)}`;
  return `${p.year}年${p.month}月${p.day}日(${WEEKDAYS[p.weekday]}) ${pad2(p.hour)}:${pad2(p.minute)}(${zone})`;
};

/** 利用者の端末の時刻での日付「YYYY/MM/DD」(取り込み日時などに使う) */
export const formatDeviceDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
};

/** 端末の時刻での「M/D」 */
export const formatDeviceShortDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 現地時刻の「M/D」(ヘッダーの鮮度の表示) */
export const formatLocalShortDate = (utcMs: number, tzOffsetMin: number | null): string => {
  const p = toLocalParts(utcMs, tzOffsetMin);
  return `${p.month}/${p.day}`;
};

/** 現地時刻の日付「YYYY/MM/DD」(チェックインの期間の表示に使う) */
export const formatLocalDate = (utcMs: number, tzOffsetMin: number | null): string => {
  const p = toLocalParts(utcMs, tzOffsetMin);
  return `${p.year}/${pad2(p.month)}/${pad2(p.day)}`;
};
