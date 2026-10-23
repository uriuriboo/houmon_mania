import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { writeImportPlan } from '@/lib/db/importWriter';
import { readMeta } from '@/lib/db/meta';
import { rebuildDerivedValues } from '@/lib/db/migrations';
import { deleteAppDb, openAppDb } from '@/lib/db/open';
import { getCheckinViews, loadExistingState, loadSearchEntries } from '@/lib/db/queries';
import { DB_VERSION, META_KEYS, type AppDB } from '@/lib/db/schema';
import { analyzeExport, type ExportSource } from '@/lib/import/analyze';
import { ImportError } from '@/lib/import/errors';
import { SearchEngine } from '@/lib/search/engine';
import { parseSearchQuery } from '@/lib/query/parse';
import { generateFakeExport } from '../../scripts/lib/fake-export.mjs';

const NOW = Date.UTC(2026, 9, 22);

const sourceOf = (files: Record<string, string | Uint8Array>): ExportSource => ({
  files: Object.entries(files).map(([name, data]) => ({
    path: `data-export-1/${name}`,
    read: async () => (typeof data === 'string' ? new TextEncoder().encode(data) : data),
  })),
  kind: 'zip',
});

const importFiles = async (db: AppDB, files: Record<string, string | Uint8Array>, applyDeletions = false) => {
  const plan = await analyzeExport(sourceOf(files), await loadExistingState(db), { now: NOW });
  const result = await writeImportPlan(db, plan, { applyDeletions, now: NOW });
  return { plan, result };
};

let db: AppDB | null = null;
afterEach(async () => {
  db?.close();
  db = null;
  await deleteAppDb();
});

describe('保存形式', () => {
  it('初めて開くとストアが作られ、版が記録される', async () => {
    db = await openAppDb();
    expect([...db.objectStoreNames].sort()).toEqual(['checkins', 'meta', 'photos', 'search_index']);
    expect(db.transaction('checkins').store.indexNames.contains('created_at')).toBe(true);
    expect(db.transaction('photos').store.indexNames.contains('checkin_id')).toBe(true);
    const meta = await readMeta(db);
    expect(meta).toMatchObject({ checkinCount: 0, importInProgress: null, schemaVersion: DB_VERSION });
  });

  it('raw から検索・表示用の値を作り直せる(移行処理)', async () => {
    db = await openAppDb();
    const { files } = generateFakeExport({ count: 30, photoRatio: 0.5, seed: 11 });
    await importFiles(db, files);
    const before = await db.getAll('search_index');
    // 壊れた派生値を作る
    const tx0 = db.transaction(['search_index', 'checkins'], 'readwrite');
    for (const r of before) await tx0.objectStore('search_index').put({ ...r, search_text: 'broken' });
    await tx0.done;

    // 版を上げずに、移行で使う関数を直接試す(versionchange トランザクションの代わりに readwrite を使う)
    const tx = db.transaction(['checkins', 'search_index', 'photos'], 'readwrite');
    const n = await rebuildDerivedValues(tx as never);
    await tx.done;
    expect(n).toBe(30);
    const after = await db.getAll('search_index');
    expect(after).toEqual(before);
  });
});

describe('取り込みの保存', () => {
  it('保存・期間・件数・取り込み状況', async () => {
    db = await openAppDb();
    const { files, photos } = generateFakeExport({ count: 2500, seed: 12 });
    const { result, plan } = await importFiles(db, files);
    expect(result).toEqual({ checkinCount: 2500, deleted: 0, written: 2500 });
    const meta = await readMeta(db);
    expect(meta).toMatchObject({
      checkinCount: 2500,
      importInProgress: null,
      lastImportedAt: NOW,
      latestCheckinAt: plan.summary.periodMax,
      periodMin: plan.summary.periodMin,
      photoCount: photos.length,
    });
    expect(meta.lastImportSummary).toMatchObject({ files: ['checkins1.json', 'checkins2.json', 'checkins3.json', 'photos1.json'], newCount: 2500 });
    expect(await db.count('search_index')).toBe(2500);
  });

  it('再取り込みは冪等で、変更なしのものは書き込まない', async () => {
    db = await openAppDb();
    const { files } = generateFakeExport({ count: 100, seed: 13 });
    await importFiles(db, files);
    const again = await importFiles(db, files);
    expect(again.plan.summary).toMatchObject({ newCount: 0, unchangedCount: 100, updatedCount: 0 });
    expect(again.result.written).toBe(0);
    expect(await db.count('checkins')).toBe(100);
  });

  it('写真は今回の集合で置き換え、削除の反映を選んだ場合だけ削除する', async () => {
    db = await openAppDb();
    const base = generateFakeExport({ count: 100, photoRatio: 1, seed: 14 });
    await importFiles(db, base.files);
    const target = base.checkins[5];
    const photosAll = base.photos as Array<{ relatedItemUrl: string; id: string }>;
    const keep = photosAll.filter((p) => !p.relatedItemUrl.endsWith(target.id));
    const removedCheckin = base.checkins[1];
    const items = base.checkins.filter((c: { id: string }) => c.id !== removedCheckin.id);
    const files = {
      'checkins1.json': JSON.stringify({ count: items.length, items }),
      'photos1.json': JSON.stringify({ count: keep.length, items: keep }),
    };

    const noDelete = await importFiles(db, files, false);
    expect(noDelete.plan.summary).toMatchObject({ deletionAllowed: true, deletionCandidateCount: 1, updatedCount: 1 });
    expect(await db.get('checkins', removedCheckin.id)).toBeDefined();
    const [view] = await getCheckinViews(db, [target.id]);
    expect(view!.photo_count).toBe(0);
    expect(view!.photos).toEqual([]);
    expect(await db.getAllFromIndex('photos', 'checkin_id', target.id)).toEqual([]);

    const withDelete = await importFiles(db, files, true);
    expect(withDelete.result.deleted).toBe(1);
    expect(await db.get('checkins', removedCheckin.id)).toBeUndefined();
    expect(await db.get('search_index', removedCheckin.id)).toBeUndefined();
    expect(await db.getAllFromIndex('photos', 'checkin_id', removedCheckin.id)).toEqual([]);
    expect((await readMeta(db)).checkinCount).toBe(99);
  });

  it('中止すると取り込み中の印が残る(次に開いたとき途中終了と判断する)', async () => {
    db = await openAppDb();
    const { files } = generateFakeExport({ count: 4500, photoRatio: 0, seed: 15 });
    const plan = await analyzeExport(sourceOf(files), await loadExistingState(db), { now: NOW });
    const ac = new AbortController();
    await expect(
      writeImportPlan(db, plan, {
        applyDeletions: false,
        now: NOW,
        onProgress: (p) => {
          if (p.written > 0) ac.abort();
        },
        signal: ac.signal,
      }),
    ).rejects.toBeInstanceOf(ImportError);
    const meta = await readMeta(db);
    expect(meta.importInProgress).toEqual({ startedAt: NOW });
    expect(await db.count('checkins')).toBe(2000);

    // 読み込み直せば完了し、印が外れる
    await importFiles(db, files);
    expect((await readMeta(db)).importInProgress).toBeNull();
    expect(await db.count('checkins')).toBe(4500);
  });
});

describe('検索', () => {
  it('日時の降順に並べ、ページ分のチェックインを返す', async () => {
    db = await openAppDb();
    const { files } = generateFakeExport({ count: 500, photoRatio: 0.3, seed: 16 });
    await importFiles(db, files);
    const engine = new SearchEngine(await loadSearchEntries(db));
    expect(engine.count).toBe(500);

    const all = engine.search(null, 1, 50);
    expect(all).toMatchObject({ page: 1, total: 500 });
    const views = await getCheckinViews(db, all.ids);
    expect(views).toHaveLength(50);
    for (let i = 1; i < views.length; i++) expect(views[i - 1]!.created_at).toBeGreaterThanOrEqual(views[i]!.created_at);
    expect(views[0]).not.toHaveProperty('raw');

    const r = engine.search(parseSearchQuery('架空ラーメン 渋谷').ast, 1, 20);
    const hits = await getCheckinViews(db, r.ids);
    expect(r.total).toBeGreaterThan(0);
    expect(hits.every((h) => h.venue_canonical_name === '架空ラーメン 渋谷店')).toBe(true);

    // 英字表記でも見つかる。全角でも見つかる
    expect(engine.search(parseSearchQuery('ｋａｋｕｕ ramen shibuya').ast, 1, 20).total).toBe(r.total);

    // 範囲外のページは最終ページに補正する
    const last = engine.search(null, 999, 50);
    expect(last).toMatchObject({ page: 10 });
    expect(last.ids).toHaveLength(50);
    expect(engine.search(parseSearchQuery('存在しない語').ast, 3, 50)).toEqual({ ids: [], page: 1, total: 0 });
  });

  it('写真の情報を含めて返す', async () => {
    db = await openAppDb();
    const { files } = generateFakeExport({ count: 50, photoRatio: 1, seed: 17 });
    await importFiles(db, files);
    const views = await getCheckinViews(db, (await loadSearchEntries(db)).ids.slice(0, 5));
    expect(views.every((v) => v.photos.length === v.photo_count && v.photo_count > 0)).toBe(true);
  });
});

describe('データの削除', () => {
  it('データベースごと削除し、他の接続には versionchange が届く', async () => {
    db = await openAppDb();
    const { files } = generateFakeExport({ count: 20, seed: 18 });
    await importFiles(db, files);
    let notified: number | null | undefined;
    const other = await openAppDb({ onVersionChange: (v) => (notified = v) });
    db.close();
    db = null;
    await deleteAppDb();
    expect(notified).toBeNull();
    void other;
    db = await openAppDb();
    expect(await db.count('checkins')).toBe(0);
    expect((await readMeta(db)).checkinCount).toBe(0);
    expect(await db.get('meta', META_KEYS.lastImportedAt)).toBeUndefined();
  });
});
