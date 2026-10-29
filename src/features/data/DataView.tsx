'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, buttonClasses } from '@/components/ui/button';
import { formatCount } from '@/components/ui/misc';
import { Notice } from '@/components/ui/notice';
import { useToast } from '@/components/ui/toast';
import { useAppState } from '@/features/app/AppStateProvider';
import { importController } from '@/features/import/importController';
import { formatDeviceDate, formatLocalDate } from '@/lib/datetime';
import { DeleteDataControl } from './DeleteDataControl';

type PersistState = 'granted' | 'denied' | 'unsupported' | 'unknown';

const formatBytes = (n: number): string => {
  if (n < 1024 * 1024) return `約 ${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `約 ${Math.round(n / (1024 * 1024))} MB`;
  return `約 ${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-stone-200 py-2.5 last:border-0 dark:border-stone-800">
      <dt className="text-stone-600 dark:text-stone-400">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

export function DataView() {
  const { meta, status, otherTabBusy, recordPersistRequest } = useAppState();
  const importState = useSyncExternalStore(importController.subscribe, importController.getSnapshot, importController.getServerSnapshot);
  const toast = useToast();
  const router = useRouter();

  const [persist, setPersist] = useState<PersistState>('unknown');
  const [usage, setUsage] = useState<number | null>(null);

  // 保存領域の状態(F-04、F-17)
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const storage = navigator.storage;
      const p: PersistState = storage?.persisted ? ((await storage.persisted()) ? 'granted' : 'denied') : 'unsupported';
      const est = storage?.estimate ? await storage.estimate() : null;
      if (cancelled) return;
      setPersist(p);
      setUsage(est?.usage ?? null);
    };
    void load().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [meta]);

  const requestPersist = async () => {
    try {
      const granted = await navigator.storage.persist();
      setPersist(granted ? 'granted' : 'denied');
      await recordPersistRequest();
      toast.show(granted ? 'データを消えにくくする設定が許可されました' : '許可されませんでした(異常ではありません)');
    } catch {
      setPersist('unsupported');
    }
  };

  const hasData = status === 'ready' && meta.checkinCount > 0;
  const importing = importState.phase === 'analyzing' || importState.phase === 'analyzed' || importState.phase === 'saving';

  return (
    <div className="space-y-10">
      <section aria-labelledby="stored" className="space-y-4">
        <h2 id="stored" className="text-lg font-bold">
          このブラウザに保存しているデータ
        </h2>
        {!hasData && (
          <Notice tone="info">
            データはありません。以前に読み込んだのに消えている場合は、ブラウザがデータを消した可能性があります。<Link href="/import">エクスポートを読み込む</Link>
            と元に戻ります。
          </Notice>
        )}
        {meta.importInProgress !== null && !otherTabBusy && !importing && (
          <Notice tone="warning">
            前回の取り込みが途中で終わっています。<Link href="/import">もう一度読み込んでください</Link>。
          </Notice>
        )}
        <dl className="rounded-xl border border-stone-200 bg-white px-4 text-sm dark:border-stone-800 dark:bg-stone-900">
          <Row label="チェックイン">{formatCount(meta.checkinCount)} 件</Row>
          <Row label="写真の情報">{formatCount(meta.photoCount)} 件</Row>
          <Row label="最新チェックイン">{meta.latestCheckinAt !== null ? formatLocalDate(meta.latestCheckinAt, meta.latestCheckinTz) : '—'}</Row>
          <Row label="最終取り込み">{meta.lastImportedAt !== null ? formatDeviceDate(meta.lastImportedAt) : '—'}</Row>
          <Row label="使用量">{usage !== null ? formatBytes(usage) : '—'}</Row>
          <Row label="データを消えにくくする設定">
            {persist === 'granted' ? '許可されました' : persist === 'denied' ? '許可されていません' : persist === 'unsupported' ? '不明(このブラウザでは確認できません)' : '確認中…'}
          </Row>
        </dl>
        {persist === 'denied' && (
          <div className="space-y-2 text-sm text-stone-700 dark:text-stone-300">
            <Button variant="secondary" size="sm" onClick={requestPersist}>
              許可を求める
            </Button>
            <p>
              Chrome・Edge は、ブックマークやホーム画面への追加、利用状況から自動で判断するため、許可されないことがあります。異常ではありません。許可されていなくても、通常はデータは残ります(端末の空き容量が少なくなると、消されることがあります)。
            </p>
          </div>
        )}
        {meta.lastImportSummary && (
          <details className="text-sm text-stone-600 dark:text-stone-400">
            <summary className="cursor-pointer">直近の取り込みの内容</summary>
            <p className="mt-2">
              新規 {formatCount(meta.lastImportSummary.newCount)} 件・更新 {formatCount(meta.lastImportSummary.updatedCount)} 件・変更なし{' '}
              {formatCount(meta.lastImportSummary.unchangedCount)} 件・削除 {formatCount(meta.lastImportSummary.deletedCount)} 件・除外{' '}
              {formatCount(meta.lastImportSummary.invalidCount)} 件
            </p>
            <p className="mt-1 break-all">読み込んだファイル: {meta.lastImportSummary.files.join('、')}</p>
          </details>
        )}
        <Link href="/import" className={buttonClasses('secondary', 'md')}>
          <RefreshCw className="size-4" aria-hidden />
          データを更新する(エクスポートを読み込み直す)
        </Link>
      </section>

      <section aria-labelledby="delete" className="space-y-4">
        <h2 id="delete" className="text-lg font-bold">
          データの削除
        </h2>
        <DeleteDataControl onDeleted={() => router.push('/import')} />
      </section>
    </div>
  );
}
