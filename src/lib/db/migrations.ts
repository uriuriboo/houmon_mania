/**
 * 保存形式の移行(L-02、9.1.3)。
 *
 * 移行は IndexedDB の versionchange トランザクションの中で行う。このトランザクションは仕様上、他のすべての接続が
 * 閉じるまで始まらない排他的なものなので、取り込み・削除と同時には走らない(他のタブには versionchange が届き、接続を閉じる)。
 *
 * 版を上げる手順:
 * 1. schema.ts の DB_VERSION を上げる
 * 2. 下の MIGRATIONS に、新しい版への移行処理を加える
 *    - 抽出項目や正規化の関数を変えた場合は rebuildDerivedValues を呼び、raw から値を作り直す
 *    - raw から作り直せない変更の場合は、データを消して再取り込みを案内する
 * 3. 移行処理の単体テストを加える
 */
import { deriveRecords, comparePhotos } from '@/lib/export/records';
import { parseCreatedAt } from '@/lib/datetime';
import type { PhotoRecord } from '@/lib/model';
import { META_KEYS, type AppDB, type UpgradeTransaction } from './schema';

type Migration = (db: AppDB, tx: UpgradeTransaction) => Promise<void> | void;

const MIGRATIONS: Record<number, Migration> = {
  1: (db) => {
    const checkins = db.createObjectStore('checkins', { keyPath: 'id' });
    checkins.createIndex('created_at', 'created_at');
    db.createObjectStore('search_index', { keyPath: 'id' });
    const photos = db.createObjectStore('photos', { keyPath: 'photo_id' });
    photos.createIndex('checkin_id', 'checkin_id');
    db.createObjectStore('meta');
  },
  // search_index に詳細条件(絞り込み)用の値を加えた。raw から作り直す
  2: async (_db, tx) => {
    await rebuildDerivedValues(tx);
  },
};

export const runMigrations = async (db: AppDB, oldVersion: number, newVersion: number, tx: UpgradeTransaction): Promise<void> => {
  for (let v = oldVersion + 1; v <= newVersion; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) throw new Error(`missing migration for version ${v}`);
    await migrate(db, tx);
  }
  await tx.objectStore('meta').put(newVersion, META_KEYS.schemaVersion);
};

/**
 * 保存済みの raw と写真の情報から、検索・表示用の値(checkins の各項目と search_index)を作り直す(P-5、N-06)。
 * 抽出項目や正規化の関数を変えたときの移行で使う。
 */
export const rebuildDerivedValues = async (tx: UpgradeTransaction): Promise<number> => {
  const checkinStore = tx.objectStore('checkins');
  const searchStore = tx.objectStore('search_index');
  const photoIndex = tx.objectStore('photos').index('checkin_id');
  let count = 0;
  let cursor = await checkinStore.openCursor();
  while (cursor) {
    const old = cursor.value;
    const createdAt = parseCreatedAt(old.raw.createdAt, Number.MAX_SAFE_INTEGER) ?? old.created_at;
    const photos: PhotoRecord[] = (await photoIndex.getAll(old.id)).sort(comparePhotos);
    const { checkin, searchIndex } = deriveRecords(old.raw, createdAt, photos);
    await cursor.update(checkin);
    await searchStore.put(searchIndex);
    count += 1;
    cursor = await cursor.continue();
  }
  return count;
};
