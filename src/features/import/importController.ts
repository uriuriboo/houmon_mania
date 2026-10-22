/**
 * 取り込みの進行を管理する(IMPT-01〜04)。
 *
 * 画面の部品ではなくモジュールの中に持つので、取り込み中にアプリ内の別の画面へ移っても処理は続き、戻ると状態が見える。
 * ワーカーは取り込みを始めるときに作る(静的書き出しの時には作らない)。
 */
import type { AnalysisSummary } from '@/lib/import/analyze';
import type { ImportErrorCode } from '@/lib/import/errors';
import type { ImportInput, ImportRequest, ImportResponse, ImportSaveResult } from '@/lib/workers/protocol';

export type PersistResult = 'granted' | 'denied' | 'unsupported';

export type ImportState =
  | { phase: 'idle' }
  | { phase: 'analyzing'; filesDone: number; filesTotal: number; records: number }
  | { phase: 'analyzed'; summary: AnalysisSummary }
  | { phase: 'saving'; summary: AnalysisSummary; written: number; total: number }
  | { phase: 'done'; summary: AnalysisSummary; result: ImportSaveResult; persist: PersistResult | null }
  | { phase: 'error'; code: ImportErrorCode; during: 'analyze' | 'save' }
  | { phase: 'cancelled' };

type CompletedListener = (result: ImportSaveResult) => void;

type WakeLockSentinelLike = { release: () => Promise<void> };

class ImportController {
  private state: ImportState = { phase: 'idle' };
  private worker: Worker | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly completedListeners = new Set<CompletedListener>();
  private wakeLock: WakeLockSentinelLike | null = null;

  public getSnapshot = (): ImportState => this.state;
  public getServerSnapshot = (): ImportState => ({ phase: 'idle' });

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** 取り込みの完了を受け取る(画面全体の状態の更新・他のタブへの通知に使う) */
  public onCompleted(listener: CompletedListener): () => void {
    this.completedListeners.add(listener);
    return () => this.completedListeners.delete(listener);
  }

  public get busy(): boolean {
    return this.state.phase === 'analyzing' || this.state.phase === 'analyzed' || this.state.phase === 'saving';
  }

  private set(next: ImportState) {
    this.state = next;
    for (const l of this.listeners) l();
  }

  private send(msg: ImportRequest) {
    this.worker?.postMessage(msg);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('../../workers/import.worker.ts', import.meta.url), { name: 'import', type: 'module' });
    w.addEventListener('message', (e: MessageEvent<ImportResponse>) => this.handle(e.data));
    w.addEventListener('error', () => {
      // ワーカーが落ちた(メモリ不足など)。ロックはワーカーとともに解放される
      this.disposeWorker();
      this.set({ code: 'UNKNOWN', during: this.state.phase === 'saving' ? 'save' : 'analyze', phase: 'error' });
    });
    this.worker = w;
    return w;
  }

  private disposeWorker() {
    this.worker?.terminate();
    this.worker = null;
    this.endSaving();
  }

  private handle(msg: ImportResponse) {
    const s = this.state;
    switch (msg.type) {
      case 'analyze-progress':
        if (s.phase === 'analyzing') this.set({ ...s, filesDone: msg.filesDone, filesTotal: msg.filesTotal, records: msg.records });
        break;
      case 'analyzed':
        this.set({ phase: 'analyzed', summary: msg.summary });
        break;
      case 'save-progress':
        if (s.phase === 'saving') this.set({ ...s, total: msg.total, written: msg.written });
        break;
      case 'saved': {
        const summary = s.phase === 'saving' ? s.summary : null;
        this.endSaving();
        if (!summary) return;
        this.set({ persist: null, phase: 'done', result: msg.result, summary });
        for (const l of this.completedListeners) l(msg.result);
        if (msg.result.firstImport) void this.requestPersist();
        break;
      }
      case 'cancelled':
        this.endSaving();
        this.set({ phase: 'cancelled' });
        break;
      case 'error':
        this.endSaving();
        this.set({ code: msg.code, during: s.phase === 'saving' ? 'save' : 'analyze', phase: 'error' });
        break;
    }
  }

  /** 初回の取り込みの完了時に、保存領域の永続化を求める(DATA-02、F-17) */
  private async requestPersist() {
    let persist: PersistResult = 'unsupported';
    try {
      if (navigator.storage?.persist) persist = (await navigator.storage.persist()) ? 'granted' : 'denied';
    } catch {
      persist = 'denied';
    }
    const s = this.state;
    if (s.phase === 'done') this.set({ ...s, persist });
  }

  public start(input: ImportInput) {
    if (this.busy) return;
    this.ensureWorker();
    this.set({ filesDone: 0, filesTotal: 0, phase: 'analyzing', records: 0 });
    this.send({ input, type: 'analyze' });
  }

  public save(applyDeletions: boolean) {
    const s = this.state;
    if (s.phase !== 'analyzed') return;
    const total = s.summary.newCount + s.summary.updatedCount + (applyDeletions && s.summary.deletionAllowed ? s.summary.deletionCandidateCount : 0);
    this.set({ phase: 'saving', summary: s.summary, total, written: 0 });
    this.beginSaving();
    this.send({ applyDeletions, type: 'save' });
  }

  public cancel() {
    if (!this.busy) return;
    this.send({ type: 'cancel' });
  }

  public reset() {
    if (this.busy) return;
    this.set({ phase: 'idle' });
  }

  // ── 保存中: 画面のスリープを防ぎ、タブを閉じるときに確認する(9.2.1) ──
  private readonly onBeforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
  };

  private beginSaving() {
    window.addEventListener('beforeunload', this.onBeforeUnload);
    const wl = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    wl?.request('screen')
      .then((sentinel) => {
        if (this.state.phase === 'saving') this.wakeLock = sentinel;
        else void sentinel.release();
      })
      .catch(() => undefined);
  }

  private endSaving() {
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }
}

export const importController = new ImportController();
