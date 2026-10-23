import { describe, expect, it } from 'vitest';
import { analyzeExport, type ExportSource } from '@/lib/import/analyze';
import { computeDiff, maxAllowedDeletions, type ExistingState } from '@/lib/import/diff';
import { ImportError } from '@/lib/import/errors';
import { generateFakeExport } from '../../scripts/lib/fake-export.mjs';

const NOW = Date.UTC(2026, 9, 22);
const EMPTY: ExistingState = { hashes: new Map(), periodMax: null, periodMin: null };

const sourceOf = (files: Record<string, string | Uint8Array>, kind: ExportSource['kind'] = 'zip', dir = 'data-export-1/'): ExportSource => ({
  files: Object.entries(files).map(([name, data]) => ({
    path: dir + name,
    read: async (max: number) => {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      if (bytes.length > max) throw new ImportError('TOO_LARGE');
      return bytes;
    },
  })),
  kind,
});

/** 分析結果から、保存済みの状態を作る(再取り込みのテスト用) */
const existingFrom = (plan: Awaited<ReturnType<typeof analyzeExport>>): ExistingState => ({
  hashes: new Map(plan.writes.map((w) => [w.checkin.id, w.searchIndex.content_hash])),
  periodMax: plan.summary.periodMax,
  periodMin: plan.summary.periodMin,
});

describe('analyzeExport', () => {
  it('初回の取り込み: 件数・期間・写真・読み込まないファイル', async () => {
    const { files, checkins, photos } = generateFakeExport({ count: 2500, seed: 7 });
    const plan = await analyzeExport(sourceOf(files), EMPTY, { now: NOW });
    expect(plan.summary).toMatchObject({
      checkinCount: 2500,
      deletionCandidateCount: 0,
      fileNames: ['checkins1.json', 'checkins2.json', 'checkins3.json', 'photos1.json'],
      filesComplete: true,
      invalidCount: 0,
      newCount: 2500,
      photoCount: photos.length,
      unchangedCount: 0,
      updatedCount: 0,
    });
    expect(plan.writes).toHaveLength(2500);
    const withPhotos = plan.writes.filter((w) => w.photos.length > 0);
    expect(withPhotos.reduce((n, w) => n + w.photos.length, 0)).toBe(photos.length);
    expect(withPhotos.every((w) => w.checkin.photo_count === w.photos.length)).toBe(true);
    const times = checkins.map((c: { createdAt: string }) => Date.parse(c.createdAt.replace(' ', 'T').replace('.000000', 'Z')));
    expect(plan.summary.periodMin).toBe(Math.min(...times));
    expect(plan.summary.periodMax).toBe(Math.max(...times));
  });

  it('users.json など読み込まないファイルは開かない', async () => {
    const { files } = generateFakeExport({ count: 10, seed: 1 });
    const opened: string[] = [];
    const src = sourceOf(files);
    const spied: ExportSource = {
      ...src,
      files: src.files.map((f) => ({ ...f, read: (max: number) => (opened.push(f.path), f.read(max)) })),
    };
    // 画面とワーカーは isExportDataPath で絞り込んでから渡すが、渡されても読まないことを確かめる
    await analyzeExport(spied, EMPTY, { now: NOW });
    expect(opened.every((p) => /\/(checkins|photos)\d*\.json$/u.test(p))).toBe(true);
  });

  it('再取り込み: 変更なし・新規・更新・削除候補', async () => {
    const base = generateFakeExport({ count: 300, photoRatio: 0, seed: 3 });
    const first = await analyzeExport(sourceOf(base.files), EMPTY, { now: NOW });
    const existing = existingFrom(first);

    // 同じエクスポート → すべて変更なし
    const same = await analyzeExport(sourceOf(base.files), existing, { now: NOW });
    expect(same.summary).toMatchObject({ newCount: 0, unchangedCount: 300, updatedCount: 0 });
    expect(same.writes).toHaveLength(0);

    // 1件のコメントを変え、2番目に新しいものを削除、新しいものを1件追加
    const items = [...base.checkins];
    const edited = { ...items[10], shout: '書き換えた' };
    items[10] = edited;
    const removed = items.splice(1, 1)[0];
    items.unshift({ ...items[0], createdAt: '2026-10-20 00:00:00.000000', id: 'ffffffffffffffffffffff01' });
    const files = { 'checkins1.json': JSON.stringify({ count: items.length, items }), 'photos1.json': base.files['photos1.json'] as string };
    const next = await analyzeExport(sourceOf(files), existing, { now: NOW });
    expect(next.summary).toMatchObject({ deletionAllowed: true, deletionCandidateCount: 1, newCount: 1, updatedCount: 1 });
    expect(next.deletionIds).toEqual([removed.id]);
    expect(next.writes.find((w) => !w.isNew)?.checkin.shout).toBe('書き換えた');
  });

  it('JSON を直接選んだ場合は削除を反映できない', async () => {
    const base = generateFakeExport({ count: 100, photoRatio: 0, seed: 4 });
    const existing = existingFrom(await analyzeExport(sourceOf(base.files), EMPTY, { now: NOW }));
    const items = base.checkins.filter((_: unknown, i: number) => i !== 50);
    const files = { 'checkins1.json': JSON.stringify({ count: items.length, items }) };
    const plan = await analyzeExport(sourceOf(files, 'files', ''), existing, { now: NOW });
    expect(plan.summary.deletionCandidateCount).toBe(1);
    expect(plan.summary.deletionAllowed).toBe(false);
    expect(plan.summary.deletionBlockedReasons).toContain('NOT_FULL_EXPORT');
  });

  it('ファイルの欠け・件数の不一致を検知し、削除を反映できないようにする', async () => {
    const base = generateFakeExport({ count: 2500, photoRatio: 0, seed: 5 });
    const existing = existingFrom(await analyzeExport(sourceOf(base.files), EMPTY, { now: NOW }));
    const { 'checkins2.json': _missing, ...rest } = base.files;
    const plan = await analyzeExport(sourceOf(rest), existing, { now: NOW });
    expect(plan.summary.filesComplete).toBe(false);
    expect(plan.summary.warnings).toContainEqual({ code: 'INCOMPLETE_FILES', missing: ['checkins2.json'] });
    expect(plan.summary.deletionAllowed).toBe(false);

    const parsed = JSON.parse(base.files['checkins1.json'] as string);
    const lying = { ...base.files, 'checkins1.json': JSON.stringify({ ...parsed, count: 999 }) };
    const plan2 = await analyzeExport(sourceOf(lying), existing, { now: NOW });
    expect(plan2.summary.filesComplete).toBe(false);
    expect(plan2.summary.warnings).toContainEqual({ code: 'COUNT_MISMATCH', files: ['checkins1.json'] });
  });

  it('不正なレコードは除外して残りを取り込み、ID のあるものは削除候補にしない', async () => {
    const { files } = generateFakeExport({ count: 50, invalid: 4, seed: 6, unknownKey: true });
    const plan = await analyzeExport(sourceOf(files), EMPTY, { now: NOW });
    expect(plan.summary).toMatchObject({ checkinCount: 50, invalidCount: 4, unidentifiedCount: 2 });
    expect(plan.summary.warnings).toContainEqual({ code: 'UNKNOWN_KEYS', keys: ['brandNewField'] });
  });

  it('想定しない形式は止める', async () => {
    await expect(analyzeExport(sourceOf({ 'checkins1.json': '{"foo":1}' }), EMPTY, { now: NOW })).rejects.toMatchObject({ code: 'FORMAT' });
    await expect(analyzeExport(sourceOf({ 'checkins1.json': 'not json' }), EMPTY, { now: NOW })).rejects.toMatchObject({ code: 'FORMAT' });
    const junk = JSON.stringify({ count: 3, items: [{ a: 1 }, { b: 2 }, { c: 3 }] });
    await expect(analyzeExport(sourceOf({ 'checkins1.json': junk }), EMPTY, { now: NOW })).rejects.toMatchObject({ code: 'FORMAT' });
    await expect(analyzeExport(sourceOf({ 'users.json': '{}' }), EMPTY, { now: NOW })).rejects.toMatchObject({ code: 'NO_EXPORT_FILES' });
  });

  it('分割されていない古い形式(createdAt が UNIX 秒)', async () => {
    const items = [{ createdAt: 1_560_000_000, id: '5d00000000000000000000e1', type: 'checkin', venue: { id: '4b00000000000000000000f1', name: 'Old Cafe' } }];
    const plan = await analyzeExport(sourceOf({ 'checkins.json': JSON.stringify({ count: 1, items }) }), EMPTY, { now: NOW });
    expect(plan.summary).toMatchObject({ checkinCount: 1, filesComplete: true });
    expect(plan.writes[0]!.checkin.created_at).toBe(1_560_000_000_000);
  });

  it('中止できる', async () => {
    const { files } = generateFakeExport({ count: 10, seed: 1 });
    const ac = new AbortController();
    ac.abort();
    await expect(analyzeExport(sourceOf(files), EMPTY, { now: NOW, signal: ac.signal })).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('computeDiff: 削除の安全条件(9.2.4)', () => {
  const existing = (n: number): ExistingState => ({
    hashes: new Map(Array.from({ length: n }, (_, i) => [`id${i}`, 'h'])),
    periodMax: 1000,
    periodMin: 100,
  });
  const base = {
    exportPeriodMax: 1000,
    exportPeriodMin: 100,
    filesComplete: true,
    incoming: new Map<string, string>(),
    sourceKind: 'zip' as const,
    unidentifiedCount: 0,
  };
  const seen = (n: number, skip: number) => new Set(Array.from({ length: n }, (_, i) => `id${i}`).slice(skip));

  it('上限は保存件数の5% と 20件の大きい方', () => {
    expect(maxAllowedDeletions(100)).toBe(20);
    expect(maxAllowedDeletions(1000)).toBe(50);
  });

  it('条件を満たせば反映を選べる', () => {
    const r = computeDiff({ ...base, existing: existing(1000), seenIds: seen(1000, 50) });
    expect(r).toMatchObject({ deletionAllowed: true, deletionBlockedReasons: [] });
    expect(r.deletionCandidates).toHaveLength(50);
  });

  it('多すぎる削除・期間の不足・ID の無いレコード・欠け', () => {
    expect(computeDiff({ ...base, existing: existing(1000), seenIds: seen(1000, 51) }).deletionBlockedReasons).toEqual(['TOO_MANY_DELETIONS']);
    expect(computeDiff({ ...base, existing: existing(100), exportPeriodMin: 200, seenIds: seen(100, 1) }).deletionBlockedReasons).toEqual(['PERIOD_NOT_COVERED']);
    expect(computeDiff({ ...base, existing: existing(100), exportPeriodMax: 999, seenIds: seen(100, 1) }).deletionBlockedReasons).toEqual(['PERIOD_NOT_COVERED']);
    expect(computeDiff({ ...base, existing: existing(100), seenIds: seen(100, 1), unidentifiedCount: 1 }).deletionBlockedReasons).toEqual(['UNIDENTIFIED_RECORDS']);
    expect(computeDiff({ ...base, existing: existing(100), filesComplete: false, seenIds: seen(100, 1) }).deletionBlockedReasons).toEqual(['INCOMPLETE_FILES']);
  });

  it('削除候補が無ければ理由も無い', () => {
    expect(computeDiff({ ...base, existing: existing(10), seenIds: seen(10, 0), sourceKind: 'files' })).toMatchObject({ deletionAllowed: false, deletionBlockedReasons: [] });
  });
});
