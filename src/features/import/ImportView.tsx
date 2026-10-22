'use client';

import Link from 'next/link';
import { CircleCheck, LockKeyhole, Search } from 'lucide-react';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, buttonClasses } from '@/components/ui/button';
import { formatCount, ProgressBar } from '@/components/ui/misc';
import { Notice } from '@/components/ui/notice';
import { IosNotice } from '@/features/app/IosNotice';
import { useAppState } from '@/features/app/AppStateProvider';
import { formatLocalDate } from '@/lib/datetime';
import type { AnalysisSummary } from '@/lib/import/analyze';
import { FilePicker } from './FilePicker';
import { ImportGuide } from './ImportGuide';
import { importController, type ImportState, type PersistResult } from './importController';
import { DELETION_BLOCK_MESSAGES, IMPORT_ERROR_MESSAGES, warningMessage } from './messages';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-4" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="flex items-center gap-3 text-lg font-bold">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-stone-800 text-sm text-white dark:bg-stone-200 dark:text-stone-900" aria-hidden>
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Cautions() {
  return (
    <ul className="space-y-1.5 text-sm text-stone-700 dark:text-stone-300">
      <li className="flex gap-2">
        <LockKeyhole className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
        ファイルはこの端末の中で読み込みます。送信はしません。
      </li>
      <li>※ 共有のパソコンでは使わないでください(同じブラウザを使う人が見られます)。</li>
      <li>※ プライベートブラウズでは、ウィンドウを閉じるとデータが消えます。</li>
    </ul>
  );
}

function SummaryView({ summary }: { summary: AnalysisSummary }) {
  const period =
    summary.periodMin !== null && summary.periodMax !== null
      ? `(${formatLocalDate(summary.periodMin, summary.periodMinTz)} 〜 ${formatLocalDate(summary.periodMax, summary.periodMaxTz)})`
      : '';
  return (
    <div className="space-y-3">
      <p className="text-base">
        チェックイン <strong>{formatCount(summary.checkinCount)}</strong> 件{period}・写真の情報 {formatCount(summary.photoCount)} 件
      </p>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>
          新規 <strong>{formatCount(summary.newCount)}</strong> 件
        </span>
        <span>
          更新 <strong>{formatCount(summary.updatedCount)}</strong> 件
        </span>
        <span>変更なし {formatCount(summary.unchangedCount)} 件</span>
      </p>
      {summary.warnings.map((w) => {
        const m = warningMessage(w);
        return (
          <Notice key={w.code} tone={m.tone}>
            {m.text}
          </Notice>
        );
      })}
    </div>
  );
}

function AnalyzedView({ summary }: { summary: AnalysisSummary }) {
  const [applyDeletions, setApplyDeletions] = useState(false);
  const nothingToDo = summary.newCount === 0 && summary.updatedCount === 0 && summary.deletionCandidateCount === 0;
  return (
    <div className="space-y-5">
      <SummaryView summary={summary} />
      {summary.deletionCandidateCount > 0 && (
        <div className="rounded-lg border border-stone-300 p-4 dark:border-stone-700">
          <p className="text-sm">
            今回のエクスポートに含まれていないもの <strong>{formatCount(summary.deletionCandidateCount)}</strong> 件(Swarm で削除された可能性があります)
          </p>
          {summary.deletionAllowed ? (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-orange-700" checked={applyDeletions} onChange={(e) => setApplyDeletions(e.target.checked)} />
              これらを削除する
            </label>
          ) : (
            <div className="mt-2 space-y-1 text-sm text-stone-700 dark:text-stone-300">
              <p>削除は反映しません。完全なエクスポートを読み込むと反映できます。</p>
              <ul className="list-disc pl-5">
                {summary.deletionBlockedReasons.map((r) => (
                  <li key={r}>{DELETION_BLOCK_MESSAGES[r]}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {nothingToDo && <Notice tone="info">保存済みのデータから変更はありません。「取り込む」を押すと、取り込み日時だけを更新します。</Notice>}
      <div className="flex flex-wrap gap-3">
        <Button size="lg" onClick={() => importController.save(applyDeletions)}>
          取り込む
        </Button>
        <Button size="lg" variant="secondary" onClick={() => importController.cancel()}>
          やめる
        </Button>
      </div>
    </div>
  );
}

const PERSIST_TEXT: Record<PersistResult, string> = {
  denied: '許可されていません',
  granted: '許可されました',
  unsupported: 'このブラウザでは確認できません',
};

function DoneView({ state }: { state: Extract<ImportState, { phase: 'done' }> }) {
  const { result, persist } = state;
  return (
    <div className="space-y-4">
      <Notice tone="success" title="取り込みが完了しました" role="status">
        <p>
          新規・更新 {formatCount(result.written)} 件{result.deleted > 0 ? `・削除 ${formatCount(result.deleted)} 件` : ''}。このブラウザに{' '}
          {formatCount(result.checkinCount)} 件のチェックインがあります。
        </p>
      </Notice>
      <Link href="/search" className={buttonClasses('primary', 'lg')}>
        <Search className="size-5" aria-hidden />
        検索をはじめる
      </Link>
      {result.firstImport && (
        <div className="text-sm text-stone-700 dark:text-stone-300">
          <p>
            データを消えにくくする設定: <strong>{persist === null ? '確認中…' : PERSIST_TEXT[persist]}</strong>
          </p>
          {persist === 'denied' && (
            <p className="mt-1">
              Chrome・Edge は利用状況から自動で判断するため、始めは「許可されていません」になることがあります。異常ではありません。
              <Link href="/data">データ管理</Link> から、あとで許可を求めることもできます。
            </p>
          )}
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={() => importController.reset()}>
        別のファイルを読み込む
      </Button>
    </div>
  );
}

export function ImportView() {
  const state = useSyncExternalStore(importController.subscribe, importController.getSnapshot, importController.getServerSnapshot);
  const { meta, otherTabBusy, status } = useAppState();
  const partial = status === 'ready' && meta.importInProgress !== null && !otherTabBusy && !importController.busy;
  const picking = state.phase === 'idle' || state.phase === 'cancelled' || state.phase === 'error';

  return (
    <div className="space-y-10">
      {meta.checkinCount === 0 && state.phase === 'idle' && (
        <Notice tone="info">
          このブラウザにはまだデータがありません。以前に読み込んだのに消えている場合は、ブラウザがデータを消した可能性があります(Safari は 7
          日間サイトを開かないと消すことがあります)。エクスポートを読み込み直せば元に戻ります。
        </Notice>
      )}
      {partial && (
        <Notice tone="warning" title="前回の取り込みが途中で終わっています" role="status">
          保存済みの分は検索できます。もう一度読み込むと、続きから取り込めます(重複はしません)。
        </Notice>
      )}
      {otherTabBusy && (
        <Notice tone="warning" role="status">
          別のタブで取り込み・削除の実行中です。終わってから読み込んでください。
        </Notice>
      )}

      <Step n={1} title="エクスポートを申請する(まだの場合)">
        <ImportGuide />
        <IosNotice />
      </Step>

      <Step n={2} title="届いた ZIP ファイルを選ぶ">
        {picking && (
          <>
            {state.phase === 'error' && (
              <Notice tone="error" title={IMPORT_ERROR_MESSAGES[state.code].title} role="alert">
                <p>{IMPORT_ERROR_MESSAGES[state.code].action}</p>
                <p className="mt-1 text-xs opacity-80">エラーの種類: E-IMPORT-{state.code}</p>
              </Notice>
            )}
            {state.phase === 'cancelled' && (
              <Notice tone="info" role="status">
                中止しました。保存済みの分は残っています。もう一度読み込むと、続きから取り込めます(重複はしません)。
              </Notice>
            )}
            <FilePicker onSelect={(input) => importController.start(input)} disabled={otherTabBusy} />
            <Cautions />
          </>
        )}

        {state.phase === 'analyzing' && (
          <div className="space-y-3" aria-live="polite">
            <p className="font-medium">ファイルを分析しています…</p>
            <p className="text-sm text-stone-600 dark:text-stone-400">
              {state.filesTotal > 0 ? `${state.filesDone} / ${state.filesTotal} ファイル・` : ''}
              {formatCount(state.records)} 件を読み込みました
            </p>
            <ProgressBar value={state.filesTotal > 0 ? state.filesDone / state.filesTotal : 0} label="分析の進捗" />
            <Button variant="secondary" onClick={() => importController.cancel()}>
              中止
            </Button>
          </div>
        )}

        {state.phase === 'analyzed' && <AnalyzedView summary={state.summary} />}

        {state.phase === 'saving' && (
          <div className="space-y-3">
            <p className="font-medium" aria-live="polite">
              保存しています… {state.total > 0 ? `${Math.floor((state.written / state.total) * 100)}%` : ''} {formatCount(state.written)} /{' '}
              {formatCount(state.total)} 件
            </p>
            <ProgressBar value={state.total > 0 ? state.written / state.total : 1} label="保存の進捗" />
            <Notice tone="warning">
              終わるまでこの画面を開いたままにしてください(他のアプリに切り替えたり画面をロックしたりすると中断することがあります)。
            </Notice>
            <Button variant="secondary" onClick={() => importController.cancel()}>
              中止
            </Button>
          </div>
        )}

        {state.phase === 'done' && <DoneView state={state} />}
      </Step>

      {state.phase === 'done' && (
        <p className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400">
          <CircleCheck className="size-4" aria-hidden />
          読み込んだファイル: {state.summary.fileNames.join('、')}
        </p>
      )}
    </div>
  );
}
