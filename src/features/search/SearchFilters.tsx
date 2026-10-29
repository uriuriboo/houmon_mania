'use client';

/** 検索の詳細条件(絞り込み)。折りたたみで、条件を変えるとすぐに検索し直す */
import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import {
  EMPTY_FILTERS,
  hasFilters,
  MAX_VISITS,
  VISIBILITY_FILTER_LABELS,
  VISIBILITY_FILTERS,
  WEEKDAY_LABELS,
  dateToDayNumber,
  type Presence,
  type SearchFilters,
  type VisibilityFilter,
} from '@/lib/search/filters';

const CONTROL =
  'h-9 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-900 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100';

/** 行の見出し。スマホの幅では入力欄の上に置く */
const LABEL = 'w-full text-sm text-stone-700 sm:w-auto sm:min-w-[8.5rem] dark:text-stone-300';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * 入力中の文字列を手元に持ち、正しい値になったときだけ反映する入力欄。
 * 日付の年を打ち込んでいる途中(0002-01-01 など)や、範囲外の数で、入力が消えないようにする。
 */
function DraftInput({
  value,
  commit,
  ...rest
}: { value: string; commit: (text: string) => boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  const [invalid, setInvalid] = useState(false);
  if (value !== synced) {
    setSynced(value);
    setText(value);
    setInvalid(false);
  }
  return (
    <input
      {...rest}
      value={text}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        setText(e.target.value);
        setInvalid(!commit(e.target.value));
      }}
    />
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  const Label = htmlFor ? 'label' : 'span';
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Label htmlFor={htmlFor} className={LABEL}>
        {label}
      </Label>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function PresenceSelect({
  id,
  label,
  value,
  withLabel,
  withoutLabel,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: Presence;
  withLabel: string;
  withoutLabel: string;
  disabled: boolean;
  onChange: (v: Presence) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
      {label}
      <select
        id={id}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === 'with' || e.target.value === 'without' ? e.target.value : null)}
        className={CONTROL}
      >
        <option value="">すべて</option>
        <option value="with">{withLabel}</option>
        <option value="without">{withoutLabel}</option>
      </select>
    </label>
  );
}

const commitVisits = (text: string, set: (n: number | null) => void): boolean => {
  if (text === '') {
    set(null);
    return true;
  }
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > MAX_VISITS) return false;
  set(n);
  return true;
};

export function SearchFiltersPanel({
  filters,
  disabled,
  onChange,
}: {
  filters: SearchFilters;
  /** URL の状態を読み取る前(静的な HTML の描画中)は操作させない */
  disabled: boolean;
  onChange: (next: SearchFilters) => void;
}) {
  const active = hasFilters(filters);
  // 条件が付いた状態で開いた(戻る・ブックマークなど)ときは、開いて見せる
  const [open, setOpen] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);
  if (active && !autoOpened) {
    setAutoOpened(true);
    setOpen(true);
  }

  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => onChange({ ...filters, [key]: value });

  const commitDate = (key: 'from' | 'to') => (text: string) => {
    if (text === '') {
      set(key, null);
      return true;
    }
    if (dateToDayNumber(text) === null) return false;
    set(key, text);
    return true;
  };

  const toggleWeekday = (d: number) => {
    const next = filters.weekdays.includes(d) ? filters.weekdays.filter((x) => x !== d) : [...filters.weekdays, d].sort((a, b) => a - b);
    set('weekdays', next.length === 7 ? [] : next);
  };

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="mt-3">
      <summary className="cursor-pointer rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium select-none dark:border-stone-700">
        詳細条件
        {active && <span className="ml-2 text-xs font-normal text-orange-800 dark:text-orange-300">(指定あり)</span>}
      </summary>
      <fieldset disabled={disabled} className="mt-3 space-y-3 px-1">
        <legend className="sr-only">詳細条件</legend>

        <Row label="チェックイン日" htmlFor="f-from">
          <DraftInput
            id="f-from"
            type="date"
            value={filters.from ?? ''}
            max={filters.to ?? undefined}
            commit={commitDate('from')}
            className={CONTROL}
          />
          <span aria-hidden>〜</span>
          <label htmlFor="f-to" className="sr-only">
            チェックイン日(終わり)
          </label>
          <DraftInput id="f-to" type="date" value={filters.to ?? ''} min={filters.from ?? undefined} commit={commitDate('to')} className={CONTROL} />
        </Row>

        <div role="group" aria-labelledby="f-weekdays-label" className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span id="f-weekdays-label" className={LABEL}>
            曜日
          </span>
          <div className="flex flex-wrap gap-1">
            {WEEKDAY_LABELS.map((label, d) => (
              <label
                key={label}
                className="flex size-9 cursor-pointer items-center justify-center rounded-md border border-stone-300 text-sm has-checked:border-orange-700 has-checked:bg-orange-700 has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-orange-600 has-disabled:cursor-not-allowed has-disabled:opacity-60 dark:border-stone-700 dark:has-checked:border-orange-500 dark:has-checked:bg-orange-500 dark:has-checked:text-stone-950"
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  aria-label={`${label}曜日`}
                  checked={filters.weekdays.includes(d)}
                  onChange={() => toggleWeekday(d)}
                />
                <span aria-hidden>{label}</span>
              </label>
            ))}
          </div>
        </div>

        <Row label="時間帯(現地時刻)" htmlFor="f-hour-from">
          <select
            id="f-hour-from"
            value={filters.hourFrom ?? ''}
            onChange={(e) => set('hourFrom', e.target.value === '' ? null : Number(e.target.value))}
            className={CONTROL}
          >
            <option value="">指定なし</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}時
              </option>
            ))}
          </select>
          <span aria-hidden>〜</span>
          <label htmlFor="f-hour-to" className="sr-only">
            時間帯(終わり)
          </label>
          <select
            id="f-hour-to"
            value={filters.hourTo ?? ''}
            onChange={(e) => set('hourTo', e.target.value === '' ? null : Number(e.target.value))}
            className={CONTROL}
          >
            <option value="">指定なし</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}時台
              </option>
            ))}
          </select>
        </Row>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <PresenceSelect id="f-photo" label="写真" value={filters.photo} withLabel="あり" withoutLabel="なし" disabled={disabled} onChange={(v) => set('photo', v)} />
          <PresenceSelect id="f-shout" label="コメント" value={filters.shout} withLabel="あり" withoutLabel="なし" disabled={disabled} onChange={(v) => set('shout', v)} />
          <PresenceSelect
            id="f-event"
            label="イベント"
            value={filters.event}
            withLabel="イベントのみ"
            withoutLabel="イベント以外"
            disabled={disabled}
            onChange={(v) => set('event', v)}
          />
          <label htmlFor="f-vis" className="flex items-center gap-2 text-sm text-stone-700 dark:text-stone-300">
            公開範囲
            <select
              id="f-vis"
              value={filters.visibility ?? ''}
              onChange={(e) => set('visibility', (VISIBILITY_FILTERS as readonly string[]).includes(e.target.value) ? (e.target.value as VisibilityFilter) : null)}
              className={CONTROL}
            >
              <option value="">すべて</option>
              {VISIBILITY_FILTERS.map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_FILTER_LABELS[v]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Row label="同じ店への訪問回数" htmlFor="f-vmin">
            <DraftInput
              id="f-vmin"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_VISITS}
              value={filters.visitsMin === null ? '' : String(filters.visitsMin)}
              commit={(t) => commitVisits(t, (n) => set('visitsMin', n))}
              className={`${CONTROL} w-20`}
            />
            <span aria-hidden>〜</span>
            <label htmlFor="f-vmax" className="sr-only">
              同じ店への訪問回数(上限)
            </label>
            <DraftInput
              id="f-vmax"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_VISITS}
              value={filters.visitsMax === null ? '' : String(filters.visitsMax)}
              commit={(t) => commitVisits(t, (n) => set('visitsMax', n))}
              className={`${CONTROL} w-20`}
            />
            <span className="text-sm">回</span>
          </Row>
          <button
            type="button"
            disabled={!active}
            onClick={() => onChange(EMPTY_FILTERS)}
            className="h-9 rounded-full border border-red-700 px-4 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400 dark:text-red-400 dark:hover:bg-red-950"
          >
            条件をすべて解除
          </button>
        </div>
        <p className="text-xs text-stone-600 dark:text-stone-400">
          日付・曜日・時間帯は、チェックインした場所の現地時刻で判定します。訪問回数は、このブラウザに保存しているチェックイン全体で数えます。
        </p>
      </fieldset>
    </details>
  );
}
