'use client';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageContainer } from '@/components/ui/misc';
import { useAppState } from './AppStateProvider';

const reload = () => window.location.reload();

/** 他のタブの操作で接続を閉じた場合などの、画面全体の案内(9.1.3、9.6) */
export function StatusBanner() {
  const { status } = useAppState();
  if (status === 'closed-deleted') {
    return (
      <PageContainer className="pt-4">
        <Notice tone="warning" title="このブラウザのデータが、別のタブで削除されました" role="alert">
          <p>表示中の内容は古くなっています。再読み込みしてください。</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={reload}>
            再読み込み
          </Button>
        </Notice>
      </PageContainer>
    );
  }
  if (status === 'closed-upgraded') {
    return (
      <PageContainer className="pt-4">
        <Notice tone="warning" title="新しい版があります" role="alert">
          <p>別のタブで新しい版のアプリが開かれました。再読み込みしてください。</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={reload}>
            再読み込み
          </Button>
        </Notice>
      </PageContainer>
    );
  }
  if (status === 'blocked') {
    return (
      <PageContainer className="pt-4">
        <Notice tone="warning" title="データを更新しています" role="status">
          <p>古い版のアプリを開いている他のタブがあるため、待っています。他のタブを閉じるか、再読み込みしてください。</p>
        </Notice>
      </PageContainer>
    );
  }
  return null;
}
