'use client';

import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { formatCount } from '@/components/ui/misc';
import { Notice } from '@/components/ui/notice';
import { useToast } from '@/components/ui/toast';
import { useAppState } from '@/features/app/AppStateProvider';

/**
 * このブラウザのデータの削除(ボタン・注意書き・確認ダイアログ)。データ管理と取り込みの画面で使う(DATA-03、9.5)。
 * 削除すると保存領域(IndexedDB)ごと消えるので、ブラウザが使う容量も減る。
 */
export function DeleteDataControl({ onDeleted }: { onDeleted?: () => void }) {
  const { meta, status, deleteAllData, deleteBlocked } = useAppState();
  const toast = useToast();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [busyChoice, setBusyChoice] = useState(false);
  const waitAbort = useRef<AbortController | null>(null);

  const doDelete = async (wait: boolean) => {
    setDeleting(true);
    setDeleteError(null);
    const ac = new AbortController();
    waitAbort.current = ac;
    const result = await deleteAllData({ signal: ac.signal, wait });
    waitAbort.current = null;
    setDeleting(false);
    if (result === 'busy') {
      setBusyChoice(true);
      return;
    }
    setBusyChoice(false);
    if (result === 'deleted') {
      setConfirmOpen(false);
      toast.show('このブラウザのデータを削除しました');
      onDeleted?.();
    } else if (result === 'failed') {
      setDeleteError('削除できませんでした。再読み込みしてから、もう一度お試しください(エラーの種類: E-DATA-DELETE)。');
    }
  };

  return (
    <>
      <div className="space-y-4">
        <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={status !== 'ready'}>
          <Trash2 className="size-4" aria-hidden />
          このブラウザのデータを削除
        </Button>
        <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700 dark:text-stone-300">
          <li>すぐに削除します(取り消せません)。削除しても、エクスポートを読み込み直せば元に戻せます。</li>
          <li>
            ブラウザの閲覧履歴(検索式を含む URL)と写真の画像のキャッシュは、この操作では消えません。共有の端末では、ブラウザの履歴とキャッシュも削除してください。
          </li>
        </ul>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => {
          if (deleting) waitAbort.current?.abort();
          setConfirmOpen(false);
          setBusyChoice(false);
        }}
        title="このブラウザのデータを削除しますか?"
        footer={
          busyChoice ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  waitAbort.current?.abort();
                  setConfirmOpen(false);
                  setBusyChoice(false);
                }}
              >
                やめる
              </Button>
              <Button variant="danger" onClick={() => void doDelete(true)} loading={deleting}>
                終わるのを待って削除
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={deleting}>
                キャンセル
              </Button>
              <Button variant="danger" onClick={() => void doDelete(false)} loading={deleting}>
                削除する
              </Button>
            </>
          )
        }
      >
        <div className="space-y-3">
          <p>
            チェックイン {formatCount(meta.checkinCount)} 件と写真の情報を、このブラウザから削除します。エクスポートを読み込み直せば元に戻せます。
          </p>
          <p className="text-stone-600 dark:text-stone-400">ブラウザの閲覧履歴と画像のキャッシュは消えません。共有の端末では、ブラウザの機能で削除してください。</p>
          {busyChoice && (
            <Notice tone="warning" role="alert">
              取り込みの実行中です(このタブか、別のタブ)。終わるのを待って削除するか、取り込みを中止してからやり直してください。
            </Notice>
          )}
          {deleteBlocked && (
            <Notice tone="warning" role="status">
              このアプリを開いている他のタブを閉じてください。閉じると削除が完了します。
            </Notice>
          )}
          {deleteError && (
            <Notice tone="error" role="alert">
              {deleteError}
            </Notice>
          )}
        </div>
      </Dialog>
    </>
  );
}
