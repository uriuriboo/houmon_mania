/**
 * 取り込みワーカー(2.2)。ZIP の目次の読み取り、必要なファイルの展開、レコードの検証と組み立て直し、
 * 既存データとの差分の算出、IndexedDB への保存を、画面とは別のスレッドで行う。
 *
 * 排他ロックは、分析の開始から保存の完了(または中止)まで保持する(9.2.1)。
 */
import { DATA_LOCK_NAME, LIMITS } from '@/lib/constants';
import { writeImportPlan } from '@/lib/db/importWriter';
import { openAppDb } from '@/lib/db/open';
import { loadExistingState } from '@/lib/db/queries';
import type { AppDB } from '@/lib/db/schema';
import { isExportDataPath } from '@/lib/export/files';
import { analyzeExport, toImportError, type ExportSource, type ImportPlan } from '@/lib/import/analyze';
import { ImportError } from '@/lib/import/errors';
import type { ImportInput, ImportRequest, ImportResponse, WorkerScope } from '@/lib/workers/protocol';
import { extractZipEntry, readZipDirectory } from '@/lib/zip/zipReader';

const scope = self as unknown as WorkerScope<ImportRequest, ImportResponse>;
const post = (message: ImportResponse) => scope.postMessage(message);

type Session = {
  release: () => void;
  db: AppDB | null;
  abort: AbortController;
  plan: ImportPlan | null;
  firstImport: boolean;
  saving: boolean;
};

let session: Session | null = null;

const endSession = () => {
  if (!session) return;
  session.db?.close();
  session.release();
  session = null;
};

/** 排他ロックを取る。他のタブ(または同じタブ)で取り込み・削除・移行の実行中なら取れない */
const acquireLock = (): Promise<(() => void) | null> =>
  new Promise((resolve, reject) => {
    navigator.locks
      .request(DATA_LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        return new Promise<void>((release) => resolve(release));
      })
      .catch(reject);
  });

const buildSource = async (input: ImportInput): Promise<ExportSource> => {
  if (input.kind === 'zip') {
    const file = input.file;
    const dir = await readZipDirectory(file, {
      filter: isExportDataPath,
      maxDirectoryBytes: LIMITS.zipMaxDirectoryBytes,
      maxEntries: LIMITS.zipMaxEntries,
    });
    return {
      files: dir.entries.map((entry) => ({
        path: entry.name,
        read: (maxBytes: number) => {
          // 目次の大きさは信用しないが、明らかに超えるものは展開する前に止める
          if (entry.uncompressedSize > maxBytes) throw new ImportError('TOO_LARGE');
          return extractZipEntry(file, entry, maxBytes);
        },
      })),
      kind: 'zip',
    };
  }
  return {
    files: input.files
      .filter((f) => isExportDataPath(f.path))
      .map((f) => ({
        path: f.path.replace(/\\/gu, '/'),
        read: async (maxBytes: number) => {
          if (f.file.size > maxBytes) throw new ImportError('TOO_LARGE');
          return new Uint8Array(await f.file.arrayBuffer());
        },
      })),
    kind: input.kind,
  };
};

const toErrorCode = (error: unknown): ImportError['code'] => {
  if (error instanceof ImportError) return error.code;
  if (error instanceof DOMException && error.name === 'NotReadableError') return 'READ_FAILED';
  return 'UNKNOWN';
};

const analyze = async (input: ImportInput) => {
  if (session) {
    post({ code: 'BUSY', type: 'error' });
    return;
  }
  const release = await acquireLock();
  if (!release) {
    post({ code: 'BUSY', type: 'error' });
    return;
  }
  const s: Session = { abort: new AbortController(), db: null, firstImport: false, plan: null, release, saving: false };
  session = s;
  try {
    try {
      s.db = await openAppDb({
        onVersionChange: () => {
          // 他のタブでデータが削除された。接続は閉じられているので、処理を止める
          s.db = null;
          s.abort.abort();
        },
      });
    } catch {
      throw new ImportError('STORAGE_UNAVAILABLE');
    }
    const existing = await loadExistingState(s.db);
    s.firstImport = existing.hashes.size === 0;
    const source = await buildSource(input).catch((error: unknown) => {
      throw toImportError(error);
    });
    s.plan = await analyzeExport(source, existing, {
      onProgress: (p) => post({ ...p, type: 'analyze-progress' }),
      signal: s.abort.signal,
    });
    if (session !== s) return;
    post({ summary: s.plan.summary, type: 'analyzed' });
  } catch (error) {
    if (session === s) endSession();
    const code = s.abort.signal.aborted && !s.db ? 'DB_CLOSED' : toErrorCode(error);
    post(code === 'CANCELLED' ? { type: 'cancelled' } : { code, type: 'error' });
  }
};

/** 保存の前に空き容量を確かめる(9.2.5)。見積りは多めにとる */
const checkQuota = async (plan: ImportPlan) => {
  if (!navigator.storage?.estimate) return;
  const { quota, usage } = await navigator.storage.estimate();
  if (quota === undefined || usage === undefined) return;
  let needed = 0;
  for (const w of plan.writes) needed += (JSON.stringify(w.checkin).length + w.searchIndex.search_text.length + w.photos.length * 300) * 3;
  if (quota - usage < needed) throw new ImportError('QUOTA');
};

const save = async (applyDeletions: boolean) => {
  const s = session;
  if (!s || !s.plan || s.saving) {
    post({ code: 'NO_ANALYSIS', type: 'error' });
    return;
  }
  if (!s.db) {
    endSession();
    post({ code: 'DB_CLOSED', type: 'error' });
    return;
  }
  s.saving = true;
  try {
    await checkQuota(s.plan);
    const result = await writeImportPlan(s.db, s.plan, {
      applyDeletions,
      onProgress: (p) => post({ ...p, type: 'save-progress' }),
      signal: s.abort.signal,
    });
    // 排他ロックを解放してから知らせる(画面が状態を読み直したとき、実行中と判断しないように)
    if (session === s) endSession();
    post({ result: { ...result, firstImport: s.firstImport }, type: 'saved' });
  } catch (error) {
    const code = !s.db ? 'DB_CLOSED' : toErrorCode(error);
    if (session === s) endSession();
    post(code === 'CANCELLED' ? { type: 'cancelled' } : { code, type: 'error' });
  }
};

const cancel = () => {
  const s = session;
  if (!s) {
    post({ type: 'cancelled' });
    return;
  }
  s.abort.abort();
  // 分析が終わって保存を待っている状態なら、ここで終える(分析中・保存中は、それぞれの処理が中止を検知して終える)
  if (s.plan && !s.saving) {
    endSession();
    post({ type: 'cancelled' });
  }
};

scope.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'analyze':
      void analyze(msg.input);
      break;
    case 'save':
      void save(msg.applyDeletions);
      break;
    case 'cancel':
      cancel();
      break;
  }
});
