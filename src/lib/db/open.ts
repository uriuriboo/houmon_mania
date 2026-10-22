/**
 * データベースを開く。画面・取り込みワーカー・検索ワーカーのどれも、この関数で開く(9.6)。
 */
import { deleteDB, openDB } from 'idb';
import { DB_NAME } from '@/lib/constants';
import { runMigrations } from './migrations';
import { DB_VERSION, type AppDB, type AppDBSchema } from './schema';

export type OpenHandlers = {
  /**
   * 他のタブがデータを削除した(newVersion = null)か、新しい版で開こうとしている。
   * 接続はこの関数の中で閉じる。呼び出し側はメモリ上のデータを捨て、自動では開き直さない(9.6)。
   */
  onVersionChange?: (newVersion: number | null) => void;
  /** 古い版で開いている他のタブがあり、開き直し(移行)が保留になっている */
  onBlocked?: () => void;
  /** ブラウザが接続を閉じた(保存領域が消されたなど) */
  onTerminated?: () => void;
};

export const openAppDb = (handlers: OpenHandlers = {}): Promise<AppDB> =>
  openDB<AppDBSchema>(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, newVersion, tx) {
      await runMigrations(db, oldVersion, newVersion ?? DB_VERSION, tx);
    },
    blocked() {
      handlers.onBlocked?.();
    },
    blocking(_currentVersion, blockedVersion, event) {
      (event.target as IDBDatabase).close();
      handlers.onVersionChange?.(blockedVersion);
    },
    terminated() {
      handlers.onTerminated?.();
    },
  });

/**
 * データベースごと削除する(DATA-03)。他のタブが接続を閉じない場合は onBlocked が呼ばれ、閉じられたら完了する。
 */
export const deleteAppDb = (onBlocked?: () => void): Promise<void> =>
  deleteDB(DB_NAME, {
    blocked() {
      onBlocked?.();
    },
  });
